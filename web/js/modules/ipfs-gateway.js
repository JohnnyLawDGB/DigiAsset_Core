/**
 * DigiAsset Core UI — IPFS gateway resolver (pure, DOM-free).
 * Browser: window.ipfsGateway.toList(url) -> ordered array of candidate gateway URLs.
 * Node (tests): module.exports = { toList } via the UMD guard at the bottom.
 */
(function (root) {
  'use strict';

  // Ordered gateway chain. subdomainForm entries need a subdomain-safe CID (CIDv1 base32).
  var IPFS_GATEWAYS = [
    { build: function (cid, path) { return 'https://' + cid + '.ipfs.dweb.link' + path; }, subdomainForm: true },
    { build: function (cid, path) { return 'https://ipfs.io/ipfs/' + cid + path; },        subdomainForm: false },
    { build: function (cid, path) { return 'https://' + cid + '.ipfs.w3s.link' + path; },  subdomainForm: true }
  ];

  // CIDv1 base32 (lowercase, leading 'b') is safe as a DNS label; CIDv0 (Qm…) is not.
  function _subdomainSafe(cid) {
    return /^b[a-z2-7]+$/.test(cid);
  }

  // Resolve an ipfs reference to an ordered list of gateway URLs. [] if unusable.
  function toList(url) {
    if (typeof url !== 'string' || !url) return [];
    if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return [url];

    var rest = url;
    if (rest.indexOf('ipfs://') === 0) rest = rest.slice(7);
    if (rest.indexOf('ipfs/') === 0) rest = rest.slice(5);

    var slash = rest.indexOf('/');
    var path = '';
    if (slash >= 0) { path = rest.slice(slash); rest = rest.slice(0, slash); }

    if (!/^[A-Za-z0-9]+$/.test(rest)) return [];       // validate CID charset (injection defense)
    if (!/^[A-Za-z0-9/._-]*$/.test(path)) path = '';   // keep only safe path chars

    var safe = _subdomainSafe(rest);
    var out = [];
    for (var i = 0; i < IPFS_GATEWAYS.length; i++) {
      var g = IPFS_GATEWAYS[i];
      if (g.subdomainForm && !safe) continue;          // skip subdomain gateways for non-CIDv1
      out.push(g.build(rest, path));
    }
    return out;
  }

  var api = { toList: toList };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;   // Node (tests)
  } else {
    root.ipfsGateway = api;  // browser
  }
})(typeof window !== 'undefined' ? window : this);
