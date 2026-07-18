# Explorer IPFS Image Gateway Fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make built-in-explorer asset images load reliably by trying an ordered chain of IPFS gateways, advancing on error or timeout, and showing a placeholder when all fail.

**Architecture:** Extract the IPFS-reference→URL resolver from `explorer.js` into a small pure module (`ipfs-gateway.js`, unit-testable in Node), returning an *ordered candidate list*. `explorer.js` gains a DOM loader that walks that list on `error`/timeout and renders a placeholder on exhaustion.

**Tech Stack:** Vanilla ES5-style browser JS (IIFE + `window.*` globals, matching existing modules); Node for the standalone unit test. No new dependencies.

## Global Constraints

- **Vanilla JS only. No new dependencies, no build step, no ES modules.** Match the existing style: IIFE, `'use strict'`, shared helpers as bare globals (precedent: `window.esc` in `app.js`).
- **Preserve the CID/path charset validation** (injection defense against RPC-derived metadata): CID `^[A-Za-z0-9]+$`, path `^[A-Za-z0-9/._-]*$`.
- **Gateway chain order (exact):** `https://<cid>.ipfs.dweb.link<path>` → `https://ipfs.io/ipfs/<cid><path>` → `https://<cid>.ipfs.w3s.link<path>`.
- **Subdomain gateways require a CIDv1-base32 CID** (`^b[a-z2-7]+$`); a CIDv0 (`Qm…`) uses path-form (`ipfs.io`) only.
- **Test code must NOT live under `web/js/`** — `web/CMakeLists.txt` does `install(DIRECTORY css js img …)`, so anything under `js/` ships to `bin/web`. Tests go in `web/tests/`.
- **No `web/CMakeLists.txt` change** — the new module under `js/modules/` is auto-installed.
- Per-attempt image timeout: **`IMG_ATTEMPT_TIMEOUT_MS = 6000`**.

---

### Task 1: Pure gateway resolver module + Node unit test

**Files:**
- Create: `web/js/modules/ipfs-gateway.js`
- Test: `web/tests/ipfs-gateway.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: browser global `window.ipfsGateway = { toList }` and Node `module.exports = { toList }`, where `toList(url: string) -> string[]` returns the ordered candidate gateway URLs (`[]` if unusable).

- [ ] **Step 1: Write the failing test**

Create `web/tests/ipfs-gateway.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/tests/ipfs-gateway.test.js`
Expected: FAIL — `Cannot find module '.../web/js/modules/ipfs-gateway.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/js/modules/ipfs-gateway.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/tests/ipfs-gateway.test.js`
Expected: PASS — every line `ok   - …`, final `All tests passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add web/js/modules/ipfs-gateway.js web/tests/ipfs-gateway.test.js
git commit -m "feat(ui): add ordered IPFS gateway resolver with unit tests"
```

---

### Task 2: Wire multi-gateway fallback + placeholder into the explorer

**Files:**
- Modify: `web/index.html` (add `<script>` for the new module before `explorer.js`)
- Modify: `web/js/modules/explorer.js` (remove `_ipfsToGateway`; add `_loadImageWithFallback` + `_makeImagePlaceholder`; rewrite the media-card render)

**Interfaces:**
- Consumes: `window.ipfsGateway.toList(url)` from Task 1.
- Produces: internal `_loadImageWithFallback(img, urls, onExhausted)` and `_makeImagePlaceholder(label)` (module-private).

- [ ] **Step 1: Load the new module before explorer.js**

In `web/index.html`, the script block currently reads:

```html
  <script src="js/app.js"></script>
  <script src="js/modules/dashboard.js"></script>
  <script src="js/modules/explorer.js"></script>
```

Insert the module line so it loads before `explorer.js`:

```html
  <script src="js/app.js"></script>
  <script src="js/modules/dashboard.js"></script>
  <script src="js/modules/ipfs-gateway.js"></script>
  <script src="js/modules/explorer.js"></script>
```

- [ ] **Step 2: Remove the old single-gateway resolver from explorer.js**

Delete the entire `_ipfsToGateway` function (currently `web/js/modules/explorer.js:14-31`, the block from the `// Resolve an asset-metadata media reference …` comment through the closing `}` of `function _ipfsToGateway`). It is replaced by `window.ipfsGateway.toList`.

- [ ] **Step 3: Add the fallback loader + placeholder helpers**

Near the top of the explorer IIFE (e.g., just after the `esc`/helper functions), add:

```js
  var IMG_ATTEMPT_TIMEOUT_MS = 6000;

  // Load an <img> across an ordered gateway list. Advance on 'error' OR a per-attempt
  // timeout (guards a gateway that hangs and never fires 'error'). Call onExhausted()
  // once every candidate has failed.
  function _loadImageWithFallback(img, urls, onExhausted) {
    if (!urls || !urls.length) { onExhausted(); return; }
    var i = 0;
    var timer = null;

    function cleanup() {
      if (timer) { clearTimeout(timer); timer = null; }
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    }
    function onLoad() { cleanup(); }                 // success — terminal
    function onError() { cleanup(); advance(); }
    function advance() {
      i++;
      if (i >= urls.length) { onExhausted(); return; }
      attempt();
    }
    function attempt() {
      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      timer = setTimeout(function () { cleanup(); advance(); }, IMG_ATTEMPT_TIMEOUT_MS);
      img.src = urls[i];
    }
    attempt();
  }

  // Muted placeholder shown when an asset declares an image but no gateway served it.
  function _makeImagePlaceholder(label) {
    var ph = document.createElement('div');
    ph.textContent = 'Image unavailable';
    ph.setAttribute('role', 'img');
    ph.setAttribute('aria-label', label || 'Image unavailable');
    ph.style.padding = '24px';
    ph.style.textAlign = 'center';
    ph.style.color = 'var(--muted, #888)';
    ph.style.fontSize = '0.9em';
    ph.style.border = '1px dashed var(--border, #ccc)';
    ph.style.borderRadius = '8px';
    return ph;
  }
```

- [ ] **Step 4: Rewrite the media-card render to use the list + fallback**

Replace the current media-card block (currently `web/js/modules/explorer.js:299-324`, from the `// Media card …` comment through its closing `}`) with:

```js
      // Media card — render the asset icon/image from ipfs.data.urls[] (if any),
      // trying multiple IPFS gateways in order, falling back to a placeholder.
      var mediaUrls = Array.isArray(ipfsData.urls) ? ipfsData.urls : [];
      var imgEntry = null;
      for (var mi = 0; mi < mediaUrls.length; mi++) {
        var u = mediaUrls[mi];
        if (u && typeof u.mimeType === 'string' && u.mimeType.indexOf('image/') === 0) { imgEntry = u; break; }
      }
      if (!imgEntry && mediaUrls.length) imgEntry = mediaUrls[0];
      var gatewayUrls = imgEntry ? window.ipfsGateway.toList(imgEntry.url) : [];
      if (imgEntry && gatewayUrls.length) {
        var mediaCard = _makeCard('Media');
        var mediaBody = document.createElement('div');
        mediaBody.className = 'card-body';

        var img = document.createElement('img');
        img.alt = assetName + ' image';   // .alt is a property assignment — not HTML-parsed
        img.loading = 'lazy';
        img.style.maxWidth = '100%';
        img.style.maxHeight = '320px';
        img.style.borderRadius = '8px';
        img.style.display = 'block';
        mediaBody.appendChild(img);

        _loadImageWithFallback(img, gatewayUrls, function () {
          if (img.parentNode === mediaBody) mediaBody.removeChild(img);
          mediaBody.appendChild(_makeImagePlaceholder(assetName + ' image'));
        });

        mediaCard.appendChild(mediaBody);
        grid.insertBefore(mediaCard, grid.firstChild);   // show the image first
      }
```

- [ ] **Step 5: Syntax-check both changed JS files**

Run: `node --check web/js/modules/ipfs-gateway.js && node --check web/js/modules/explorer.js`
Expected: no output, exit code 0 (both parse clean).

- [ ] **Step 6: Re-run the Task 1 unit test (guard against regressions)**

Run: `node web/tests/ipfs-gateway.test.js`
Expected: PASS, `All tests passed`.

- [ ] **Step 7: Browser-verify the fallback + placeholder (verify/gstack skill)**

Serve the static UI and drive it in a real browser (use the `verify` or `gstack` skill):

1. `python3 -m http.server 8099 --directory web` (or point at the deployed `/core/` explorer).
2. Open an asset-detail route for an asset that has an image, e.g. `http://localhost:8099/#/explorer/<assetId>`, against a node whose RPC the page can reach.
3. **Happy path:** confirm the Media card shows the image.
4. **Fallback path:** temporarily edit `IPFS_GATEWAYS[0].build` in `ipfs-gateway.js` to return a bogus host (e.g. `https://nope.invalid/ipfs/…`), reload, and confirm the image STILL appears (advanced to `ipfs.io`). Revert the edit.
5. **Placeholder path:** open an asset whose image CID is unavailable on all gateways (or point all three builders at `nope.invalid`), reload, and confirm the "Image unavailable" placeholder renders and the card is NOT hidden. Revert.

Capture a screenshot of each of the three states as evidence.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/js/modules/explorer.js
git commit -m "feat(ui): multi-gateway IPFS image fallback + placeholder in explorer"
```

---

## Self-Review

- **Spec coverage:** resolver + chain order + subdomain-safety → Task 1; loader with error/timeout advance → Task 2 Step 3; placeholder-not-hide → Task 2 Step 4; test outside `js/` → Task 1 file paths; index.html include → Task 2 Step 1; no CMakeLists change → Global Constraints. All spec sections mapped.
- **Placeholders:** none — every code/step is concrete.
- **Type consistency:** `window.ipfsGateway.toList` (Task 1 Produces) is exactly what Task 2 Step 4 Consumes; `_loadImageWithFallback(img, urls, onExhausted)` / `_makeImagePlaceholder(label)` defined in Step 3, called in Step 4 with matching arity.
