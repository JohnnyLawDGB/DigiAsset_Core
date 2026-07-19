# IPFS Pin-Queue Dedup + Cleanup — Design Spec

**Date:** 2026-07-12
**Status:** Implemented + **deployed to prod 2026-07-19** (fork `development` commit `32f8c21`). Verified: `dbVersion=7`, `idx_ipfs_pin_dedup` created, restart collapsed 5,335 assets → 4,541 distinct pins (queue structurally capped, no more 106k rebuild), sync healthy at tip. Plan: `docs/superpowers/plans/2026-07-19-ipfs-pin-queue-dedup.md`.
**Related:** DigiScope missing-asset-images investigation; follows the sync-wedge fix (`c29ecda`) and the getassetdata-hang fix (`03fd0dd`).

## Problem

DigiScope asset images/metadata are missing. Root cause is **not** lost content and **not** raw IPFS throughput — it is a **redundancy explosion in the `ipfs` job queue**.

Measured on prod (`134.199.198.90`, `/opt/DigiAsset_Core`) on 2026-07-12:

- `ipfs` table held ~106,000 jobs; **105,788 were `pin` jobs**.
- A sample of the oldest 20 queued pin jobs was **20/20 already pinned locally** (redundant re-pins of content the node already has).
- The queue drains at **~11.45 jobs/sec** (not stalled), but `pinned` count stayed flat at **5,429** for hours — the worker spends all its time re-pinning content it already has, starving genuinely-new asset media.
- The queue grew **~10k per restart**.

Source: `Database::repinPermanent` (`src/Database.cpp:2573`), called from `PermanentStoragePool` init on **every startup**, runs `INSERT INTO ipfs ... SELECT 'pin' ... FROM assets WHERE cid != ''` and `... FROM pspFiles WHERE poolIndex = ?` with **no dedup** against already-queued or already-pinned CIDs. Every boot re-enqueues a pin job for every asset × every subscribed pool. Combined with jobs left `lock=1` by killed processes (stale locks that clog the `getNextIPFSJob` scan), the queue fills with redundant work.

## Goals

- Make redundant `pin`/`unpin` jobs **structurally impossible**, regardless of which code path enqueues them.
- **One-time cleanup** of the existing bloated queue so the worker immediately reaches real work.
- Stop stale locks (from killed processes) from clogging the queue.
- No regression to download jobs (the per-request `getassetdata` metadata fetch path).

## Non-Goals (YAGNI — noted, not built here)

- Bounding the `getassetdata` `isPinned()` probe (the residual ~5 s on uncached lookups) — related but separate; recommended as a small follow-up.
- Adding an index for `getNextIPFSJob` — unnecessary once the table is small (query measured at 4 ms).
- Avoiding re-pinning already-pinned content on every boot / changing repin frequency — an optimization; ~5.5k re-pins per (rare) boot is acceptable and drains in ~8 min.
- Re-pinning historical asset media whose pin jobs already failed/expired — a separate targeted task if specific old images stay missing after this lands.

## Design

### 1. Structural dedup (backbone)

Add a **partial unique index** on the `ipfs` table:

```sql
CREATE UNIQUE INDEX idx_ipfs_pin_dedup ON ipfs(cid, sync) WHERE sync IN ('pin','unpin');
```

- Dedup key is `(cid, sync)`. It covers **only** `pin` and `unpin` jobs.
- Download jobs use `sync=''` (or other non-pin sync values) and carry a per-request `callback` (`"_"+jobIndex`); they are **not** in the partial index, so concurrent `getassetdata` fetches for the same uncached CID each keep their own job + promise callback. No regression to the download path.

Switch the enqueue statements that can hit the index to **`INSERT OR IGNORE`**:

- `_stmtInsertIPFSJob` (`src/Database.cpp:~515`) — used by `addIPFSJob`, the path for individual pin/unpin (`IPFS::pin`/`IPFS::unpin`) and for download jobs. `OR IGNORE` is safe for downloads because they never collide on the partial index, so the insert always succeeds and `last_insert_rowid()` (used by `addIPFSJobPromise` for the callback registry) stays valid.
- `_stmtRepinAssets` (`src/Database.cpp:549`) — `INSERT OR IGNORE INTO ipfs ... SELECT 'pin' ... FROM assets WHERE cid != ''`.
- `_stmtRepinPermanentSpecific` (`src/Database.cpp:551`) — same for `pspFiles`.
- The unpin-repin `INSERT` (`src/Database.cpp:~2608`).

Result: duplicate `pin`/`unpin` jobs are silently ignored at the DB layer. `repinPermanent` may keep running on boot; it becomes a no-op for anything already queued.

### 2. One-time cleanup via the `6 → 7` DB migration

The DB self-migrates through `Database::buildTables(dbVersionNumber)` (`src/Database.cpp:58`), which applies an array of per-version lambda steps and bumps the `dbVersion` flag (currently `6`). Add the `6 → 7` step. It must dedup **before** creating the unique index, or index creation fails on the existing duplicates:

```sql
UPDATE ipfs SET lock = false WHERE lock = true;                         -- release stale locks first
DELETE FROM ipfs
  WHERE sync IN ('pin','unpin')
    AND jobIndex NOT IN (
      SELECT MIN(jobIndex) FROM ipfs WHERE sync IN ('pin','unpin') GROUP BY cid, sync
    );                                                                   -- keep one per (cid,sync)
CREATE UNIQUE INDEX idx_ipfs_pin_dedup ON ipfs(cid, sync) WHERE sync IN ('pin','unpin');
UPDATE "flags" SET "value" = 7 WHERE "key" = "dbVersion";
```

On prod this collapses ~106k → ~5.5k distinct pin/unpin jobs in one migration. Fresh installs get the index at build time via the same version lambda; the migration is idempotent for the version it targets (guarded by the `dbVersion` gate in `buildTables`).

### 3. Stale-lock clear on every startup

The migration clears stale locks once, but any future crash/restart re-introduces them. Add `Database::resetInProgressIPFSJobs()`:

```sql
UPDATE ipfs SET lock = false WHERE lock = true;
```

Call it when the IPFS handler starts (IPFS init / where the IPFS worker thread is launched), so every boot releases locks orphaned by the previous process. Safe because at handler-start no worker holds a real lock yet.

## Affected Code

| File | Change |
|------|--------|
| `src/Database.cpp` `buildTables` (~58–205) | Add `6→7` migration lambda (dedup + partial unique index + version bump) |
| `src/Database.cpp` prepared statements (~515, 549, 551, ~2608) | `INSERT` → `INSERT OR IGNORE` for pin/unpin/repin enqueues |
| `src/Database.cpp` / `src/Database.h` | New `resetInProgressIPFSJobs()` method |
| IPFS handler startup (`src/IPFS.cpp` / wherever the worker is launched) | Call `resetInProgressIPFSJobs()` on boot |

## Error Handling / Edge Cases

- **Download jobs unaffected:** partial index excludes them; `OR IGNORE` never suppresses a download insert (no collision) so promise callbacks + `last_insert_rowid()` remain correct.
- **Migration on a table with existing dups:** the `DELETE` runs before `CREATE UNIQUE INDEX`, so the index build cannot fail on duplicates. If for any reason a dup survived, index creation would throw and surface loudly (acceptable — signals a bug).
- **`pin` vs `unpin` for same CID:** different `sync`, so both allowed; they process in `jobIndex` order (unchanged semantics).
- **Differing `extra` (pin maxSize) for same CID:** dedup keeps the first; acceptable (a pin is a pin).
- **Stale-lock reset at boot:** runs before workers start, so it cannot clobber an in-progress lock.

## Testing / Verification

- **Unit-ish / local:** after applying the migration to a copy of the DB, assert `SELECT COUNT(*) FROM ipfs WHERE sync='pin'` drops to the distinct-CID count, and that inserting a duplicate `('pin', <cid>)` is a no-op (row count unchanged).
- **On prod after deploy:** confirm `dbVersion=7`; queue drops ~106k → ~5.5k; `pinned` count begins climbing (no longer flat); a restart no longer adds ~10k jobs; sync remains healthy at tip with 0 errors; spot-check that a recently-issued asset's image CID becomes locally present (`block/stat?...&offline=true` = `have`).

## Deployment

Ships via the same in-place rebuild flow already used on prod (patch source → incremental `make digiasset_core` → swap binary with backup → restart). The migration runs automatically on first start of the new binary. Keep the previous binary for rollback.
