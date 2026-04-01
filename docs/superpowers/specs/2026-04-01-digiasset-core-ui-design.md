# DigiAsset Core Built-in UI — Design Spec

**Date:** 2026-04-01
**Scope:** Piece 1 of 3 — the self-contained UI built into DigiAsset Core
**Status:** Approved

## Overview

Replace the existing RPC documentation frontend with a full-featured app-style UI served by DigiAsset Core on port 14024. The UI provides node operators with sync monitoring, asset exploration, full v3 asset minting, wallet management, and node diagnostics — all running locally against their own node with zero external dependencies.

This is the first of three planned pieces:
1. **DigiAsset Core Built-in UI** (this spec)
2. Public Portal — education, ecosystem overview, node recruitment (future)
3. Mobile Wallet Bridge — backend APIs for DigiAsset-enabled mobile wallets (future)

The public portal will reuse patterns and components established here. The mobile wallet will connect to the same RPC interface this UI consumes.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Sidebar nav, app-style | Persistent navigation, shared state across sections |
| Framework | Vanilla HTML/CSS/JS | No build step, no npm, self-contained C++ binary |
| Routing | Single-page, hash-based | Preserves auth state, sync polling, sidebar across nav |
| Auth | RPC Basic Auth | Matches existing model, no C++ server changes needed |
| Existing RPC docs | Removed | Developers use CLI `help`; the new UI is the replacement |
| Asset creation depth | Full DigiAsset v3 | This is the protocol's own tool — expose everything |

## Architecture

### File Structure

```
web/
  index.html              # App shell: sidebar + content container
  css/
    style.css             # All styles
  js/
    app.js                # Router, auth state, sidebar, sync polling, RPC helper
    modules/
      dashboard.js        # Dashboard section
      explorer.js         # Asset explorer + detail views
      create.js           # Minting wizard (full v3)
      wallets.js          # Wallet management + holdings
      node.js             # Node status + diagnostics
  img/
    logo.svg              # DigiByte/DigiAsset branding
```

### Router

Hash-based routing (~30 lines). Routes map to modules:

| Hash | Module | Description |
|------|--------|-------------|
| `#/dashboard` | dashboard.js | Landing page, default route |
| `#/explorer` | explorer.js | Asset browser |
| `#/explorer/:assetIndex` | explorer.js | Asset detail view |
| `#/explorer/address/:addr` | explorer.js | Address holdings view |
| `#/create` | create.js | Minting wizard |
| `#/wallets` | wallets.js | Wallet management |
| `#/wallets/:name` | wallets.js | Single wallet detail |
| `#/node` | node.js | Node diagnostics |

Each module exports:
- `render(container, params)` — renders the section into the content div
- `destroy()` — cleanup (clear intervals, remove listeners)

Router calls `destroy()` on the current module before `render()` on the next.

### Auth Model

RPC credentials are held in memory only (never persisted to localStorage or cookies).

- A global `rpc(method, params)` function wraps `fetch()` with HTTP Basic Auth headers
- Read-only RPC methods (`syncstate`, `listassets`, `getassetdata`, etc.) work without auth via the existing `rpcallow*` config
- Write methods (`send`, `sendtoaddress`, asset creation) prompt for credentials if not yet provided
- An "Unlock" button in the sidebar lets users enter credentials proactively
- Auth state is displayed in the sidebar (locked/unlocked icon)
- Credentials are lost on page refresh (by design — security)

### Sync Polling

`app.js` polls `syncstate` every 5 seconds. The result object (`{count, sync}`) is stored globally and available to all modules. The sidebar displays a compact sync indicator:

- **Synced** (sync === 0): green dot + "Synced" + block height
- **Syncing** (sync < 0): progress animation + blocks behind + ETA
- **Rewinding** (sync === 3): yellow warning + "Rewinding"
- **Initializing** (sync === 2): "Starting up..."
- **Stopped** (sync === 1): red dot + "Stopped"

## Section Designs

### 1. Dashboard (`#/dashboard`)

The landing page. Provides at-a-glance node health and quick navigation.

**Components:**

- **Sync Card** — block height, progress bar (current / chain tip), sync state label, ETA when syncing. Data: `syncstate`
- **Assets Card** — total indexed asset count, latest indexed height. Data: `listassets` (count only, cached)
- **IPFS Card** — connected/disconnected status, pinned content count. Data: `getipfscount`
- **Node Card** — DigiAsset Core version, uptime. Data: `version`
- **Quick Actions** — three buttons: "Create Asset", "Browse Assets", "View Wallets". Navigate to respective sections.
- **Recent Assets** — last 5 assets indexed, showing assetId (truncated), type, height. Data: `listlastassets` with count=5. Each row links to the asset detail view.

**Polling:** Sync card updates every 5s (from global poll). Other cards refresh on section load and every 30s.

### 2. Asset Explorer (`#/explorer`)

Browse, search, and inspect all DigiAssets indexed by the node.

**List View (`#/explorer`):**
- Paginated table of assets from `listlastassets`
- Columns: Asset ID (truncated, linked), Name, Type, Height, Supply
- Pagination via `listlastassetspageindexes` for page navigation
- Search bar: enter an assetId to jump to detail, or an address to see holdings

**Asset Detail View (`#/explorer/:assetIndex`):**
- Full metadata from `getassetdata`: name, description, issuer, website URL
- Icon/media loaded from IPFS via the node's built-in IPFS gateway
- Supply info: total issued, divisibility (decimal places)
- Rules: royalties, expiry, transfer restrictions, KYC requirements, deflationary mechanics
- Issuance history from `listassetissuances`
- Holders table from `getassetholders`: address (truncated, linked), quantity held
- Click any holder address to navigate to address view

**Address View (`#/explorer/address/:addr`):**
- All DigiAssets held by an address via `getaddressholdings`
- Table: Asset ID (linked), Name, Quantity
- DGB balance info
- Transaction history via `listaddresshistory`
- Link to address stats via `addressstats`

### 3. Create Asset (`#/create`)

Full DigiAsset v3 minting wizard. Requires: RPC auth + sync state === 0 (fully synced). Shows a warning banner if not synced.

**Step 1 — Basics:**
- Asset name (required, text input)
- Description (textarea)
- Issuer name (text input)
- Website URL (text input, validated)

**Step 2 — Media:**
- Upload icon/image file
- File is pinned to IPFS via the node's built-in IPFS daemon
- Preview of uploaded image
- IPFS CID displayed after upload
- No external fees — uses local IPFS node

**Step 3 — Supply:**
- Total quantity (number input)
- Divisibility: dropdown 0-8 decimal places. 0 = indivisible (tickets, collectibles). 8 = highly divisible (currency-like)
- Locked supply toggle: if locked, no additional issuance possible after creation

**Step 4 — Rules:**
- Royalty percentage on transfers (0-100%, decimal input)
- Expiry block (optional, number input — asset becomes invalid after this block)
- Deflationary: enable burn-on-transfer (reduces supply over time)
- KYC requirement toggle: restrict transfers to KYC-verified addresses
- Transfer restrictions: whitelist/blacklist addresses (advanced, collapsible)

**Step 5 — Review & Mint:**
- Summary card showing all configured values
- Estimated DGB cost for the transaction
- Source wallet selector (from loaded wallets)
- "Create Asset" confirmation button
- Double-confirm dialog for irreversible action

**Step 6 — Result:**
- Transaction ID (linked to explorer)
- Asset ID assigned
- "View in Explorer" button (navigates to `#/explorer/:assetIndex`)
- "Create Another" button (resets wizard)

**Validation:** Each step validates required fields before the "Next" button activates. Back button available on all steps. Wizard state is held in memory (lost on page refresh).

### 4. My Wallets (`#/wallets`)

Wallet management for the local DigiByte node.

**Wallet List (`#/wallets`):**
- All loaded wallets from DigiByte Core (via `listwallets` proxied through DigiAsset Core)
- Each wallet shows: name, DGB balance
- Click to view wallet detail

**Wallet Detail (`#/wallets/:name`):**
- DGB balance (confirmed + unconfirmed)
- DigiAsset holdings table via `getaddressholdings` for all wallet addresses
- Columns: Asset ID (linked), Name, Quantity
- Address list with balances

**Send Asset:**
- Select asset from holdings dropdown
- Recipient address (text input, validated)
- Amount (number input, respects divisibility)
- Fee estimate
- Confirm dialog with transaction summary
- Uses `send` / `sendtoaddress` RPC
- Result: transaction ID displayed

**Receive:**
- Show existing wallet addresses
- "New Address" button to generate via `getnewaddress`
- Click-to-copy on any address
- QR code display for selected address (generated client-side using a lightweight vanilla JS QR encoder — no external library)

### 5. Node Status (`#/node`)

Operational diagnostics — everything an operator needs without SSH.

**Sync Detail:**
- Current height vs chain tip (from `syncstate` + `getblockcount`)
- Sync state with human-readable label
- Blocks behind count
- Estimated time remaining (calculated from sync rate)
- Sync progress bar

**IPFS Health:**
- Connection status
- Pinned content count via `getipfscount`
- PSP (Permanent Storage Pool) info via `getpsp`

**Exchange Rates:**
- Current DGB exchange rates via `getexchangerates`
- Useful for understanding asset values in fiat terms

**Performance:**
- Block processing time statistics (from profiling data if exposed)
- RPC response times (measured client-side)

**Configuration:**
- DigiAsset Core version via `version`
- Node uptime
- Connected to DigiByte Core: yes/no
- Sync configuration (prune age, stored data types)

## Visual Design

**Color scheme:** Dark theme matching the existing DigiAsset/DigiByte brand. Dark background (#0d1117), card surfaces (#161b22), borders (#30363d), primary blue (#58a6ff), success green (#3fb950), warning orange (#f0883e), error red (#f85149).

**Typography:** System font stack — no external font loading. Monospace for addresses, transaction IDs, and technical values.

**Responsive:** Sidebar collapses to hamburger menu on narrow viewports (< 768px). Content area is fluid. Tables scroll horizontally on mobile.

**Sidebar:**
- DigiAsset Core logo at top
- Navigation links with icons (unicode, no icon library)
- Compact sync indicator (always visible)
- Auth status (locked/unlocked)
- Version number at bottom

## RPC Methods Used

| Method | Section | Purpose |
|--------|---------|---------|
| `syncstate` | All (polling) | Sync height and state |
| `version` | Dashboard, Node | Software version |
| `getipfscount` | Dashboard, Node | IPFS pinned content count |
| `listassets` | Dashboard | Total asset count |
| `listlastassets` | Dashboard, Explorer | Recent/paginated asset list |
| `listlastassetspageindexes` | Explorer | Pagination support |
| `getassetdata` | Explorer | Full asset metadata |
| `getassetholders` | Explorer | Asset holder list |
| `getassetindexes` | Explorer | Asset lookup by ID |
| `getaddressholdings` | Explorer, Wallets | Assets held by address |
| `listassetissuances` | Explorer | Issuance history |
| `listaddresshistory` | Explorer, Wallets | Address transaction history |
| `addressstats` | Explorer | Address statistics |
| `getexchangerates` | Node | DGB exchange rates |
| `getpsp` | Node | Permanent storage pool info |
| `getdgbequivalent` | Create | DGB cost estimation |
| `send` | Create, Wallets | Send assets |
| `sendtoaddress` | Wallets | Send DGB |
| `sendmany` | Wallets | Batch sends |

DigiByte Core methods proxied through DigiAsset Core:
| Method | Section | Purpose |
|--------|---------|---------|
| `listwallets` | Wallets | Enumerate loaded wallets |
| `getbalance` | Wallets | Wallet DGB balance |
| `getnewaddress` | Wallets | Generate receive address |
| `getblockcount` | Node | Chain tip height |
| `listunspent` | Create | Available UTXOs for minting |

## Implementation Unknowns

Two areas require investigation during implementation:

**Asset creation RPC path:** The existing `send` method may or may not support full v3 asset creation parameters (rules, royalties, KYC, deflationary mechanics). Options:
1. The `send` RPC already accepts v3 creation parameters — use it directly
2. The `asyncstart` pattern supports asset creation — use the async flow
3. Neither works — add a new `createasset` method to `src/RPC/Methods/`

The implementation plan should investigate these options before building the Create Asset wizard.

**IPFS file upload:** The DigiAsset Core web server handles RPC (JSON) but may not support multipart file uploads for the media step. Options:
1. The web server can be extended to accept file uploads on a dedicated endpoint
2. The UI sends the file as base64 within an RPC call
3. The UI talks directly to the IPFS API (port 5001) for file pinning, then passes the CID to DigiAsset Core

Option 3 is most likely since IPFS Kubo already has an HTTP API, but it means the UI needs access to port 5001 in addition to 14024.

## Error Handling

- **RPC unreachable:** Sidebar sync indicator turns red. Banner at top: "Cannot reach DigiAsset Core RPC. Is the service running?"
- **Auth required:** Write operations show a modal prompting for RPC credentials
- **Not synced:** Create Asset section shows warning banner: "Node is still syncing. Asset creation requires a fully synced node."
- **Transaction failure:** Error message displayed inline with the RPC error text
- **IPFS upload failure:** Step 2 of wizard shows error, allows retry

## Out of Scope

- **Marketplace functionality** — DigiNexum handles this
- **Digi-ID authentication** — the local RPC auth model is sufficient
- **External API calls** — everything uses the local node's RPC
- **Mobile-responsive perfection** — functional on mobile, optimized for desktop
- **Log viewer** — would require a new RPC method to expose logs; deferred to a future iteration
