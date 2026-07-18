// Standalone Node test — no framework. Run: node web/tests/ipfs-gateway.test.js
var assert = require('assert');
var path = require('path');
var mod = require(path.join(__dirname, '..', 'js', 'modules', 'ipfs-gateway.js'));
var toList = mod.toList;

var CIDv1 = 'bafkreigi6pmgrywdx6qwdlb7uht7pga3fmfs3wxiidt6zdik4rdmyul3va'; // real DigiAsset CIDv1
var CIDv0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';             // legacy CIDv0

var failures = 0;
function check(name, cond) {
  if (cond) { console.log('ok   - ' + name); }
  else { console.error('FAIL - ' + name); failures++; }
}

// CIDv1 -> all three gateways, in order
var v1 = toList('ipfs://' + CIDv1);
check('CIDv1 -> 3 gateways', v1.length === 3);
check('CIDv1 dweb.link first', v1[0] === 'https://' + CIDv1 + '.ipfs.dweb.link');
check('CIDv1 ipfs.io second', v1[1] === 'https://ipfs.io/ipfs/' + CIDv1);
check('CIDv1 w3s.link third', v1[2] === 'https://' + CIDv1 + '.ipfs.w3s.link');

// CIDv0 -> path-form only
var v0 = toList('ipfs://' + CIDv0);
check('CIDv0 -> 1 gateway', v0.length === 1);
check('CIDv0 uses ipfs.io path form', v0[0] === 'https://ipfs.io/ipfs/' + CIDv0);

// prefixes / bare cid
check('bare CID -> 3 gateways', toList(CIDv1).length === 3);
check('ipfs/ prefix works', toList('ipfs/' + CIDv1)[1] === 'https://ipfs.io/ipfs/' + CIDv1);

// http(s) passthrough
check('https passthrough', JSON.stringify(toList('https://x.com/a.png')) === JSON.stringify(['https://x.com/a.png']));
check('http passthrough', JSON.stringify(toList('http://x.com/a.png')) === JSON.stringify(['http://x.com/a.png']));

// path preservation
var wp = toList('ipfs://' + CIDv1 + '/icon.png');
check('path preserved (subdomain)', wp[0] === 'https://' + CIDv1 + '.ipfs.dweb.link/icon.png');
check('path preserved (ipfs.io)', wp[1] === 'https://ipfs.io/ipfs/' + CIDv1 + '/icon.png');

// invalid / injection
check('empty -> []', toList('').length === 0);
check('null -> []', toList(null).length === 0);
check('injection CID rejected', toList('ipfs://abc"><script>').length === 0);
check('unsafe path stripped', toList('ipfs://' + CIDv1 + '/a b<c').every(function (u) {
  return u.indexOf(' ') === -1 && u.indexOf('<') === -1;
}));

if (failures) { console.error('\n' + failures + ' test(s) FAILED'); process.exit(1); }
console.log('\nAll tests passed');
