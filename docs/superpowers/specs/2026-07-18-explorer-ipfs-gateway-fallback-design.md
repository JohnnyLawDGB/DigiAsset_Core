# Built-in Explorer — IPFS Image Gateway Fallback

**Date:** 2026-07-18
**Status:** Design approved, pending spec review
**Component:** `web/js/modules/explorer.js` (built-in UI in this repo)

## Background

DigiScope assets frequently show no image. Root-cause investigation (see
`memory: ipfs-interaction-model-and-deviations`) established that this is *mostly
by design*: media is only pinned by the DigiAssetX permanent-storage pool for
assets whose issuer paid the fee, so ordinary assets' images are not held by our
node or the pool. Local pinning therefore cannot fix the symptom. The images that
*are* retrievable live on the public IPFS network and must be fetched, at display
time, through an IPFS gateway.

The built-in explorer already does gateway rendering (commit `17c7749`):
`_ipfsToGateway()` maps `ipfs://<cid>` → `https://<cid>.ipfs.dweb.link<path>` and
the media card sets that as an `<img>` src, hiding the card on error. The weakness
is that it uses **one** gateway. If `dweb.link` is slow, rate-limiting, or does not
have the CID, the image silently disappears even when other gateways would serve it.

## Goal

Make explorer asset images load reliably by trying an **ordered list of IPFS
gateways**, advancing to the next on error **or** timeout, and showing a
**placeholder** when all gateways fail.

## Non-goals

- Not creating content that isn't on IPFS. If no gateway has the CID (issuer never
  pinned it anywhere), the placeholder is the correct terminal state.
- Not the separate public digiscope.me app (`digibyte-compendium`). This change is
  scoped to the built-in explorer in this repo.
- No node-side pinning / PSP changes.
- No caching layer, no `fetch()` pre-probing, no parallel gateway racing (see
  "Rejected alternatives").

## Gateway chain (approved)

Ordered, public, browser-reliable. Evidence: `ipfs.io/ipfs/<realCID>` returned 200;
`ipfs.digiassetx.com` is the pool **API** (JSON 404 / TLS failure for real CIDs),
not a content gateway, so it is excluded; `cloudflare-ipfs.com` is excluded
(Cloudflare discontinued the gateway).

1. `https://<cid>.ipfs.dweb.link<path>`  (subdomain form)
2. `https://ipfs.io/ipfs/<cid><path>`     (path form)
3. `https://<cid>.ipfs.w3s.link<path>`   (subdomain form)

## Design

### New module: `web/js/modules/ipfs-gateway.js` (pure, testable)

Extract the resolver out of `explorer.js` into a small, DOM-free module so it can be
unit-tested in isolation. Following the existing convention (`app.js` exposes shared
helpers as bare globals, e.g. `window.esc`), it attaches **`window.ipfsGateway`** =
`{ toList }` for the browser, and also supports `module.exports` (UMD guard) so a Node
test can load it directly. It is included by a `<script>` tag in `index.html` before
`explorer.js` (which loads after `app.js`).

**`IPFS_GATEWAYS`** — data-driven list; each entry knows its URL form:

```js
var IPFS_GATEWAYS = [
  { build: function (cid, path) { return 'https://' + cid + '.ipfs.dweb.link' + path; }, subdomainForm: true },
  { build: function (cid, path) { return 'https://ipfs.io/ipfs/' + cid + path; },        subdomainForm: false },
  { build: function (cid, path) { return 'https://' + cid + '.ipfs.w3s.link' + path; },  subdomainForm: true }
];
```

**`ipfsGateway.toList(url) -> string[]`** — replaces `_ipfsToGateway`. Returns an
ordered array of candidate URLs (empty array if the input is unusable).

- `''` / non-string → `[]`.
- Already `http://` or `https://` → `[url]` (pass-through, unchanged behavior).
- Strip a leading `ipfs://` or `ipfs/` prefix, then split off `path` at the first `/`.
- Validate: CID must match `^[A-Za-z0-9]+$`; path must match `^[A-Za-z0-9/._-]*$`
  (else path is dropped). Same injection defense as today, since these values come
  from RPC-derived metadata.
- **Subdomain safety:** a gateway entry with `subdomainForm: true` is included only
  when the CID is subdomain-safe (CIDv1 base32 lowercase: `^b[a-z2-7]+$`). A CIDv0
  (`Qm…`, base58) or otherwise unsafe CID skips subdomain gateways and still
  resolves via the path-form `ipfs.io` entry. Path-form gateways are always included.

### `explorer.js` — image loader with fallback

**`_loadImageWithFallback(img, urls, onExhausted)`** — DOM-coupled; stays in
`explorer.js`.

- Maintains an index `i`, starting at 0; sets `img.src = urls[i]`.
- Arms a per-attempt timeout `IMG_ATTEMPT_TIMEOUT_MS = 6000` ms. This is the guard for
  a *hanging* gateway that never fires `error` (the current failure mode with a slow
  `dweb.link`).
- On `img` `load` → clear the timeout; done (success).
- On `img` `error` **or** timeout expiry → clear timeout, increment `i`; if
  `i < urls.length` set the next src and re-arm, else call `onExhausted()`.
- Listeners/timeout are cleaned up so a late event on an abandoned attempt can't
  double-advance.

### `explorer.js` — media-card render change (currently ~299–324)

- `var urls = window.ipfsGateway.toList(imgEntry.url);`
- If `urls.length === 0` → render the placeholder (no valid CID).
- Else create the `<img>` (lazy, existing styling) and call
  `_loadImageWithFallback(img, urls, showPlaceholder)`.
- `showPlaceholder()` replaces the media-card body with a lightweight
  "Image unavailable" placeholder (muted text/icon) **instead of hiding the card**.
  Keeping the card signals that the asset declares an image that couldn't be fetched.

## Edge cases

| Case | Behavior |
|---|---|
| CIDv1 (`bafk…`) | All 3 gateways tried. |
| CIDv0 (`Qm…`) | Only `ipfs.io` (path form); subdomain gateways skipped. |
| `imgEntry.url` already `https://…` | Used as-is, single candidate. |
| Non-IPFS / invalid CID charset | `[]` → placeholder, no network attempt. |
| Path after CID (`ipfs://cid/file.png`) | Preserved and appended, charset-filtered. |
| First gateway hangs (no error) | 6s timeout advances to next. |
| All gateways fail | Placeholder shown. |
| Injection attempt in CID/path | Rejected by charset validation (unchanged defense). |

## Testing

- **Unit (pure resolver):** add `web/tests/ipfs-gateway.test.js`, a **standalone Node
  script** (no framework — `web/` has no JS test runner). It lives under `web/tests/`,
  **not** `web/js/`, because `web/CMakeLists.txt` installs `css js img` — anything under
  `js/` would ship to `bin/web` on `make install`, and we don't want to ship test code.
  It loads `../js/modules/ipfs-gateway.js` via the `module.exports` guard and asserts:
  CIDv1 → 3 expected URLs in order; CIDv0 → path-only; `ipfs://` / `ipfs/` / bare-CID
  / `http(s)` passthrough; path preservation; invalid-CID → `[]`; injection strings
  rejected. Runnable with `node web/tests/ipfs-gateway.test.js` (exit non-zero on failure).
- **Behavioral (fallback + placeholder):** verified in a real browser via the
  `verify` / gstack skill — load an asset whose first gateway is forced to fail
  (e.g., a bogus first entry) and confirm the image advances to a working gateway,
  and that an all-fail CID shows the placeholder.

## Rejected alternatives

- **`fetch()`-probe gateways, then set src:** cross-origin `fetch` to IPFS gateways
  is subject to CORS and is often blocked even when an `<img>` load (not CORS-gated
  for rendering) would succeed → would wrongly reject working gateways.
- **Parallel race (N hidden imgs, first `load` wins):** N× gateway load and more
  teardown complexity for one image per asset view; not justified.

## Files changed

- **Add** `web/js/modules/ipfs-gateway.js` (pure resolver + gateway list). Auto-installed
  by the existing `install(DIRECTORY css js img …)` rule — no CMakeLists change.
- **Add** `web/tests/ipfs-gateway.test.js` (Node unit test; outside `js/` so it isn't shipped).
- **Edit** `web/js/modules/explorer.js` (drop `_ipfsToGateway`; use `window.ipfsGateway.toList`;
  add `_loadImageWithFallback` + placeholder in the media card).
- **Edit** `web/index.html` (add `<script src="js/modules/ipfs-gateway.js">` before `explorer.js`).
- **No** `web/CMakeLists.txt` change needed.
