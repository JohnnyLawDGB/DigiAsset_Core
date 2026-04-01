# DigiAsset Core Built-in UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing RPC docs frontend with an app-style UI featuring dashboard, asset explorer, wallet management, node diagnostics, and a full v3 asset minting wizard.

**Architecture:** Single-page vanilla JS app with hash-based routing, served from DigiAsset Core's built-in web server on port 14024. Five modules (dashboard, explorer, create, wallets, node) sharing a global RPC helper and sync poller. No build step, no external dependencies.

**Tech Stack:** Vanilla HTML/CSS/JS, C++ (for new RPC methods), DigiAsset Core RPC, IPFS Kubo API

**Spec:** `docs/superpowers/specs/2026-04-01-digiasset-core-ui-design.md`

**Security note:** All dynamic content rendered via innerHTML uses an `esc()` helper that sanitizes through `textContent` assignment — all RPC data (asset IDs, addresses, user input) passes through this XSS-safe escaper before insertion. The `esc()` function is defined in each module as: `function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }`

---

## File Structure

```
web/
  index.html                    # App shell: sidebar + content container + script tags
  css/
    style.css                   # Complete stylesheet (dark theme, sidebar, cards, tables, wizard)
  js/
    app.js                      # Router, RPC helper, auth state, sync polling, sidebar logic
    modules/
      dashboard.js              # Dashboard: sync card, assets card, IPFS card, quick actions
      explorer.js               # Asset list, asset detail, address view
      create.js                 # 6-step minting wizard (full v3)
      wallets.js                # Wallet list, detail, send, receive
      node.js                   # Sync detail, IPFS health, exchange rates, config
  img/
    logo.svg                    # DigiByte/DigiAsset logo

src/RPC/Methods/
  createasset.cpp               # Future: asset issuance RPC method (Phase 9)
  createasset.html              # Future: documentation (Phase 9)
```

Each JS module exports `{ render(container, params), destroy() }`.

---

## Phases 1-8: Frontend Implementation

The complete frontend code for all 8 tasks is provided inline. Each module renders sanitized HTML using the `esc()` helper for all dynamic data. See the spec for detailed section descriptions.

### Task 1: HTML Shell + CSS Foundation

**Files:**
- Create: `web/index.html`
- Create: `web/css/style.css`

- [ ] **Step 1: Write index.html** — app shell with sidebar nav, content container, auth modal, script tags for all modules
- [ ] **Step 2: Write style.css** — dark theme CSS with variables, sidebar, cards, tables, forms, wizard, modals, responsive breakpoints
- [ ] **Step 3: Verify** — `ls -la web/index.html web/css/style.css`
- [ ] **Step 4: Commit** — `git commit -m "feat(ui): app shell HTML and CSS foundation"`

### Task 2: App Core — Router, RPC Helper, Auth, Sync Polling

**Files:**
- Create: `web/js/app.js`

The App module (IIFE pattern) provides:
- `rpc(method, params)` — fetch wrapper with Basic Auth headers
- `rpcAuth(method, params)` — prompts for credentials if not set, then calls rpc()
- Hash-based router: parses `location.hash`, calls `destroy()` on old module, `render()` on new
- Sync polling: calls `syncstate` every 5s, updates sidebar indicator (synced/syncing/rewinding/stopped/error)
- Auth modal: credentials stored in memory only, validates via `getbalance` test call
- Sidebar toggle for mobile (< 768px)
- Module registration: `registerModule(name, mod)`

- [ ] **Step 1: Write app.js** with all above functionality
- [ ] **Step 2: Deploy to VPS and test** — `rsync` web/ to VPS, restart digiasset-core, open port 14024
- [ ] **Step 3: Verify** — sidebar shows, sync indicator updates, nav links highlight on click
- [ ] **Step 4: Commit** — `git commit -m "feat(ui): app core — router, RPC helper, auth, sync polling"`

### Task 3: Dashboard Module

**Files:**
- Create: `web/js/modules/dashboard.js`

Components: Sync Card (height + progress bar from `syncstate`), Assets Card (count from `listassets`), IPFS Card (status from `getipfscount`), Node Card (version), Quick Action buttons (Create/Browse/Wallets), Recent Assets table (last 5 from `listlastassets`). Refreshes every 15s.

- [ ] **Step 1: Write dashboard.js**
- [ ] **Step 2: Test at `#/dashboard`** — all cards populate, recent assets table shows data
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): dashboard module"`

### Task 4: Asset Explorer — List, Detail, Address Views

**Files:**
- Create: `web/js/modules/explorer.js`

Three views based on route params:
- **List** (`#/explorer`): paginated table from `listlastassets`, search bar that detects addresses vs asset IDs
- **Detail** (`#/explorer/:assetIndex`): metadata from `getassetdata`, holders from `getassetholders`, issuances from `listassetissuances`, rules display
- **Address** (`#/explorer/address/:addr`): holdings from `getaddressholdings`

All dynamic data (asset IDs, addresses, CIDs, descriptions) rendered through `esc()` sanitizer.

- [ ] **Step 1: Write explorer.js**
- [ ] **Step 2: Test all three views** — list shows assets, clicking opens detail, search by address works
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): asset explorer — list, detail, address views"`

### Task 5: Node Status Module

**Files:**
- Create: `web/js/modules/node.js`

Cards: Sync (height + blocks behind), Chain Tip (`getblockcount`), IPFS (`getipfscount`), Version. Sections: Exchange Rates table (`getexchangerates`), PSP info (`getpsp`). Refreshes every 10s.

- [ ] **Step 1: Write node.js**
- [ ] **Step 2: Test at `#/node`** — sync detail, chain tip, rates table
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): node status module"`

### Task 6: Wallets Module

**Files:**
- Create: `web/js/modules/wallets.js`

Requires auth for all operations. Views:
- **List** (`#/wallets`): wallet cards from `listwallets`, prompts auth if locked
- **Detail** (`#/wallets/:name`): balance from `getbalance`, addresses from `listaddressgroupings`, send form (address + amount, calls `sendtoaddress` with confirm dialog), new address button (`getnewaddress`)

Send flow: validates address/amount, shows confirm dialog, calls `sendtoaddress`, displays txid on success.

- [ ] **Step 1: Write wallets.js**
- [ ] **Step 2: Test auth flow, wallet list, send form**
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): wallets module — list, detail, send"`

### Task 7: Create Asset Wizard UI

**Files:**
- Create: `web/js/modules/create.js`

6-step wizard with state object tracking all v3 parameters. Shows warning banners if not synced or not authenticated.

- **Step 1 Basics**: name (required), description, issuer, URL
- **Step 2 Media**: file upload direct to IPFS Kubo (`POST http://localhost:5001/api/v0/add`), stores CID
- **Step 3 Supply**: quantity, decimals (0-8 dropdown), locked toggle
- **Step 4 Rules**: royalty %, expiry block, deflationary toggle, KYC toggle
- **Step 5 Review**: summary table of all fields
- **Step 6 Result**: calls `createasset` RPC (gracefully shows "method not available" until C++ is built)

Navigation: Next/Back buttons, validation on each step (name required, quantity >= 1). State saved on step change, lost on page refresh.

- [ ] **Step 1: Write create.js**
- [ ] **Step 2: Test wizard navigation, validation, IPFS upload** (upload needs IPFS on port 5001)
- [ ] **Step 3: Commit** — `git commit -m "feat(ui): create asset wizard — full v3 UI"`

### Task 8: Logo + Remove Old Frontend

**Files:**
- Create: `web/img/logo.svg`
- Delete: `web/main.cpp`, `web/js/main.js`, `web/rpc/` (entire directory)

- [ ] **Step 1: Create logo SVG** — DigiByte-blue "D" mark
- [ ] **Step 2: Remove old files** — `rm -f web/main.cpp web/js/main.js && rm -rf web/rpc/`
- [ ] **Step 3: Commit** — `git rm` old files, `git add` logo, commit

### Task 9: Deploy and Verify

- [ ] **Step 1: Sync to VPS** — `rsync -avz --delete web/ root@134.199.198.90:/opt/DigiAsset_Core/web/`
- [ ] **Step 2: Restart service** — `ssh root@134.199.198.90 "systemctl restart digiasset-core"`
- [ ] **Step 3: Verify all routes** — dashboard, explorer, explorer detail, create wizard, wallets (with auth), node status
- [ ] **Step 4: Test mobile** — resize to < 768px, verify sidebar toggle works
- [ ] **Step 5: Push** — `git push origin development`

---

## Future: Phase 9 — `createasset` C++ RPC Method

> **Not included in this plan.** Requires deep investigation of the DigiAsset v3 protocol encoding (OP_RETURN format), raw transaction construction, and integration with DigiByte Core's wallet signing. This should be a separate plan after the frontend is validated.

**What it needs to do:**
1. Accept JSON parameters: name, description, issuer, URL, CID, quantity, decimals, locked, royalty, expiry, deflationary, kyc
2. Construct IPFS metadata JSON and pin it
3. Build the v3 OP_RETURN encoding with the CID and rules
4. Create a raw transaction with the OP_RETURN output + asset outputs
5. Sign via DigiByte Core wallet
6. Broadcast and return txid + assetIndex

**Files to create:**
- `src/RPC/Methods/createasset.cpp`
- `src/RPC/Methods/createasset.html`

**Files to modify:**
- `src/CMakeLists.txt` (add new source file)
- `src/RPC/MethodList.cpp` (auto-generated by CMake from the Methods directory)
