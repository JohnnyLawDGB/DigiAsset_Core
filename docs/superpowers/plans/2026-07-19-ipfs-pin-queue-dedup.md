# IPFS Pin-Queue Dedup + Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use `- [ ]` checkboxes.

**Goal:** Make redundant `pin`/`unpin` IPFS jobs structurally impossible, one-time-dedup the existing ~106k-job queue via a 6→7 DB migration, and clear stale locks on every boot — so the IPFS worker stops re-pinning content it already has.

**Architecture:** A partial unique index `idx_ipfs_pin_dedup ON ipfs(cid,sync) WHERE sync IN ('pin','unpin')` makes dup pin/unpin inserts no-ops; enqueue statements switch to `INSERT OR IGNORE`. The DB's existing version-lambda migration system (`Database::buildTables`) gains a 6→7 step that dedups then builds the index; the fresh-install baseline (`lambda[0]`) also gets the index + `dbVersion=7`. A new `Database::resetInProgressIPFSJobs()` clears stale locks at IPFS-handler startup.

**Tech Stack:** C++ (SQLite via `sqlite3_exec` + prepared statements), existing `make digiasset_core` build.

## Global Constraints

- **Migration must dedup BEFORE creating the unique index** — otherwise `CREATE UNIQUE INDEX` fails on existing duplicates.
- **`INSERT OR IGNORE` is safe for download jobs** (`sync=''`): they're excluded from the partial index, never collide, so the insert always proceeds and `last_insert_rowid()` (used by `addIPFSJobPromise`) stays valid. **No regression to the getassetdata download path.**
- **NO production changes during implementation.** Build + test locally on synthetic/copy DBs only. Deploy is a **separate section requiring explicit user approval** (not executed by this plan).
- Prod `chain.db` is ~3.97 GB at `dbVersion=6`; the migration runs once on first boot of the new binary.
- Follow existing code idioms in `Database.cpp` (version-lambda array, `sqlite3_exec` with `Database::defaultCallback`, `exceptionFailedToCreateTable`).

---

### Task 1: Prove the migration SQL on a synthetic v6 DB (test-first)

**Files:**
- Create (scratchpad, not committed): `<scratchpad>/ipfs-dedup-migration.test.sh`

This validates the exact SQL that Task 2 embeds in `lambda[6]`, before writing any C++.

- [ ] **Step 1: Write the SQL test script**

Create `<scratchpad>/ipfs-dedup-migration.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
DB=$(mktemp); trap 'rm -f "$DB"' EXIT

# --- synthetic v6 ipfs table: dup pins, dup unpin, a stale lock, dup downloads ---
sqlite3 "$DB" <<'SQL'
CREATE TABLE "ipfs" ("jobIndex" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, "sync" TEXT NOT NULL, "lock" BOOL NOT NULL, "cid" TEXT NOT NULL, "extra" TEXT, "callback" TEXT NOT NULL, "pause" INTEGER, "maxTime" INTEGER);
CREATE TABLE "flags" ("key" TEXT NOT NULL, "value" INTEGER NOT NULL, PRIMARY KEY("key"));
INSERT INTO flags VALUES ('dbVersion',6);
INSERT INTO ipfs (sync,lock,cid,extra,callback,pause,maxTime) VALUES
 ('pin',0,'cidA','','',NULL,NULL),
 ('pin',1,'cidA','','',NULL,NULL),   -- stale lock=1, dup
 ('pin',0,'cidA','','',NULL,NULL),   -- dup
 ('pin',0,'cidB','','',NULL,NULL),
 ('pin',0,'cidB','','',NULL,NULL),   -- dup
 ('unpin',0,'cidC','','',NULL,NULL),
 ('unpin',0,'cidC','','',NULL,NULL), -- dup
 ('',0,'cidD','','_1',NULL,1000),    -- download job (sync='')
 ('',0,'cidD','','_2',NULL,1000);    -- SAME cid download, must be KEPT (2 rows)
SQL

# --- apply the migration SQL (identical to lambda[6] in Task 2) ---
sqlite3 "$DB" <<'SQL'
BEGIN TRANSACTION;
UPDATE ipfs SET lock=false WHERE lock=true;
DELETE FROM ipfs WHERE sync IN ('pin','unpin') AND jobIndex NOT IN (SELECT MIN(jobIndex) FROM ipfs WHERE sync IN ('pin','unpin') GROUP BY cid, sync);
CREATE UNIQUE INDEX idx_ipfs_pin_dedup ON ipfs(cid, sync) WHERE sync IN ('pin','unpin');
UPDATE "flags" SET "value"=7 WHERE "key"="dbVersion";
COMMIT;
SQL

pass=1
a(){ if [ "$2" = "$3" ]; then echo "ok   - $1 ($2)"; else echo "FAIL - $1: got $2 want $3"; pass=0; fi; }
q(){ sqlite3 "$DB" "$1"; }

a "pin cidA -> 1"        "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='pin' AND cid='cidA';")" 1
a "pin cidB -> 1"        "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='pin' AND cid='cidB';")" 1
a "unpin cidC -> 1"      "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='unpin' AND cid='cidC';")" 1
a "downloads cidD kept"  "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='' AND cid='cidD';")" 2
a "no stale locks"       "$(q "SELECT COUNT(*) FROM ipfs WHERE lock=1;")" 0
a "dbVersion -> 7"       "$(q "SELECT value FROM flags WHERE key='dbVersion';")" 7
a "kept min jobIndex A"  "$(q "SELECT jobIndex FROM ipfs WHERE sync='pin' AND cid='cidA';")" 1

# OR IGNORE idempotency (post-index)
sqlite3 "$DB" "INSERT OR IGNORE INTO ipfs (sync,lock,cid,extra,callback,pause,maxTime) VALUES ('pin',0,'cidA','','',NULL,NULL);"
a "OR IGNORE dup pin no-op"      "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='pin' AND cid='cidA';")" 1
sqlite3 "$DB" "INSERT OR IGNORE INTO ipfs (sync,lock,cid,extra,callback,pause,maxTime) VALUES ('pin',0,'cidE','','',NULL,NULL);"
a "OR IGNORE new pin inserts"    "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='pin' AND cid='cidE';")" 1
sqlite3 "$DB" "INSERT OR IGNORE INTO ipfs (sync,lock,cid,extra,callback,pause,maxTime) VALUES ('',0,'cidD','','_3',NULL,1000);"
a "OR IGNORE dup download inserts" "$(q "SELECT COUNT(*) FROM ipfs WHERE sync='' AND cid='cidD';")" 3

[ "$pass" = 1 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 2: Run it**

Run: `bash <scratchpad>/ipfs-dedup-migration.test.sh`
Expected: every `ok   - …`, final `ALL PASS`, exit 0. If any FAIL, the SQL is wrong — fix before writing C++.

---

### Task 2: Implement the C++ changes

**Files:**
- Modify: `src/Database.h` (declare `resetInProgressIPFSJobs`)
- Modify: `src/Database.cpp` (lambda[0] index+v7; new lambda[6]; 4× `INSERT OR IGNORE`; `resetInProgressIPFSJobs` impl)
- Modify: `src/IPFS.cpp` (call `resetInProgressIPFSJobs` at handler start)

**Interfaces:**
- Produces: `void Database::resetInProgressIPFSJobs()` — clears all `lock=true` rows; non-fatal on error.

- [ ] **Step 1: Declare `resetInProgressIPFSJobs` in Database.h**

Replace (around line 479):

```cpp
    unsigned int getIPFSJobCount();
```

with:

```cpp
    unsigned int getIPFSJobCount();
    void resetInProgressIPFSJobs();
```

- [ ] **Step 2: Fresh-install baseline (lambda[0]) — add the index + bump dbVersion to 7**

In `Database.cpp` lambda[0], change the dbVersion seed. Replace:

```cpp
                        "INSERT INTO \"flags\" VALUES (\"dbVersion\",6);"
```

with:

```cpp
                        "INSERT INTO \"flags\" VALUES (\"dbVersion\",7);"
```

Then add the index to the fresh schema. Replace:

```cpp
                        "INSERT INTO \"ipfs\" VALUES (2,'pin',false,'QmSAcz2H7veyeuuSyACLkSj9ts9EWm1c9v7uTqbHynsVbj','','',NULL,NULL);" //DigiByte Logo
```

with:

```cpp
                        "INSERT INTO \"ipfs\" VALUES (2,'pin',false,'QmSAcz2H7veyeuuSyACLkSj9ts9EWm1c9v7uTqbHynsVbj','','',NULL,NULL);" //DigiByte Logo
                        "CREATE UNIQUE INDEX idx_ipfs_pin_dedup ON ipfs(cid, sync) WHERE sync IN ('pin','unpin');"
```

- [ ] **Step 3: Add the 6→7 migration lambda[6]**

In `Database.cpp`, lambda[5] (v5→v6) currently ends as the last array element. Replace:

```cpp
                                  "UPDATE \"flags\" set \"value\"=6 WHERE \"key\"=\"dbVersion\";"
                                  "COMMIT;";
                rc = sqlite3_exec(_db, sql, Database::defaultCallback, nullptr, &zErrMsg);
                if (rc != SQLITE_OK) {
                    sqlite3_free(zErrMsg);
                    throw exceptionFailedToCreateTable();
                }
            }
```

with:

```cpp
                                  "UPDATE \"flags\" set \"value\"=6 WHERE \"key\"=\"dbVersion\";"
                                  "COMMIT;";
                rc = sqlite3_exec(_db, sql, Database::defaultCallback, nullptr, &zErrMsg);
                if (rc != SQLITE_OK) {
                    sqlite3_free(zErrMsg);
                    throw exceptionFailedToCreateTable();
                }
            },

            //Define what is changed from version 6 to version 7 (IPFS pin-queue dedup)
            [&]() {
                char* zErrMsg = nullptr;
                int rc;
                //Must DELETE dups BEFORE CREATE UNIQUE INDEX or the index build fails.
                const char* sql = "BEGIN TRANSACTION;"
                                  "UPDATE ipfs SET lock=false WHERE lock=true;"
                                  "DELETE FROM ipfs WHERE sync IN ('pin','unpin') AND jobIndex NOT IN (SELECT MIN(jobIndex) FROM ipfs WHERE sync IN ('pin','unpin') GROUP BY cid, sync);"
                                  "CREATE UNIQUE INDEX idx_ipfs_pin_dedup ON ipfs(cid, sync) WHERE sync IN ('pin','unpin');"
                                  "UPDATE \"flags\" set \"value\"=7 WHERE \"key\"=\"dbVersion\";"
                                  "COMMIT;";
                rc = sqlite3_exec(_db, sql, Database::defaultCallback, nullptr, &zErrMsg);
                if (rc != SQLITE_OK) {
                    sqlite3_free(zErrMsg);
                    throw exceptionFailedToCreateTable();
                }
            }
```

- [ ] **Step 4: Switch the four enqueue statements to `INSERT OR IGNORE`**

Replace each line individually in `Database.cpp`:

```cpp
    _stmtInsertIPFSJob.prepare(_db, "INSERT INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) VALUES (?,false,?,?,?,?,?);");
```
→
```cpp
    _stmtInsertIPFSJob.prepare(_db, "INSERT OR IGNORE INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) VALUES (?,false,?,?,?,?,?);");
```

```cpp
    _stmtRepinAssets.prepare(_db, "INSERT INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'pin', 0, cid, '', '', NULL, NULL FROM assets WHERE cid != '';");
```
→
```cpp
    _stmtRepinAssets.prepare(_db, "INSERT OR IGNORE INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'pin', 0, cid, '', '', NULL, NULL FROM assets WHERE cid != '';");
```

```cpp
    _stmtRepinPermanentSpecific.prepare(_db, "INSERT INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'pin', 0, cid, '', '', NULL, NULL FROM pspFiles WHERE \"poolIndex\" = ?;");
```
→
```cpp
    _stmtRepinPermanentSpecific.prepare(_db, "INSERT OR IGNORE INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'pin', 0, cid, '', '', NULL, NULL FROM pspFiles WHERE \"poolIndex\" = ?;");
```

```cpp
    string sql = "INSERT INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'unpin', 0, cid, '', '', NULL, NULL FROM pspFiles WHERE \"poolIndex\" = ?";
```
→
```cpp
    string sql = "INSERT OR IGNORE INTO ipfs (sync, lock, cid, extra, callback, pause, maxTime) SELECT 'unpin', 0, cid, '', '', NULL, NULL FROM pspFiles WHERE \"poolIndex\" = ?";
```

- [ ] **Step 5: Implement `resetInProgressIPFSJobs` (non-fatal)**

In `Database.cpp`, insert this function immediately before `void Database::addToPermanent(`. Replace:

```cpp
/**
* Adds a cid to permanent list
* @param cid
*/
void Database::addToPermanent(unsigned int poolIndex, const string& cid) {
```

with:

```cpp
/**
 * Clears stale IPFS job locks left by a previously-killed process. Called at IPFS
 * handler startup, before any worker thread runs, so it cannot clobber a live lock.
 * Non-fatal: a failure here must not prevent the node from starting.
 */
void Database::resetInProgressIPFSJobs() {
    char* zErrMsg = nullptr;
    int rc = sqlite3_exec(_db, "UPDATE ipfs SET lock=false WHERE lock=true;", nullptr, nullptr, &zErrMsg);
    if (rc != SQLITE_OK) {
        Log* log = Log::GetInstance();
        log->addMessage(string("resetInProgressIPFSJobs failed: ") + (zErrMsg ? zErrMsg : "unknown"), Log::WARNING);
        if (zErrMsg != nullptr) sqlite3_free(zErrMsg);
    }
}

/**
* Adds a cid to permanent list
* @param cid
*/
void Database::addToPermanent(unsigned int poolIndex, const string& cid) {
```

- [ ] **Step 6: Call it at IPFS handler start**

In `src/IPFS.cpp` constructor, replace:

```cpp
    if (runStart) start();
```

with:

```cpp
    if (runStart) {
        AppMain::GetInstance()->getDatabase()->resetInProgressIPFSJobs(); //clear stale locks from a prior process before workers start
        start();
    }
```

- [ ] **Step 7: Build**

Run: `make digiasset_core` (from the existing build dir, e.g. `cmake-build-*/` or `build/`; use the same target the prod rebuild uses).
Expected: compiles clean, links `digiasset_core`. Fix any compile errors before continuing.

- [ ] **Step 8: Commit**

```bash
git add src/Database.h src/Database.cpp src/IPFS.cpp
git commit -m "fix(ipfs,db): dedup pin-queue via partial unique index + 6->7 migration + stale-lock reset"
```

---

### Task 3: Integration verification (no prod changes)

**Files:** none (verification only).

- [ ] **Step 1: Migrate a synthetic v6 chain.db through the REAL binary**

Build a minimal v6 `chain.db` and confirm the built binary's `Database` constructor migrates it to v7. Because the full node needs a DigiByte RPC to sync, verify only the migration by constructing the DB path and letting `buildTables` run at startup, then reading the result (kill the process once past DB init). Concretely:

```bash
# create a synthetic v6 chain.db with dup pins (reuse Task 1's schema+seed, minus the migration)
# then run the binary pointed at a dir containing it, capture that dbVersion flips 6->7 and the queue dedups.
```
If starting the full binary requires RPC that isn't available, SKIP to Step 2 and rely on Task 1 (SQL proven) + Step 2 (real-data magnitude) — and note that the migration is exercised for the first time on the real DB at deploy, which is why deploy backs up chain.db first.

- [ ] **Step 2: Real-data magnitude dry-run (prod, READ-ONLY, immutable)**

Confirm the migration's effect on the real queue WITHOUT writing to prod:

```bash
ssh root@134.199.198.90 'cd /opt/DigiAsset_Core/bin
 sqlite3 "file:chain.db?immutable=1" "
   SELECT (SELECT COUNT(*) FROM ipfs WHERE sync IN (\"pin\",\"unpin\")) AS pin_unpin_total,
          (SELECT COUNT(*) FROM (SELECT 1 FROM ipfs WHERE sync IN (\"pin\",\"unpin\") GROUP BY cid,sync)) AS distinct_kept,
          (SELECT COUNT(*) FROM ipfs WHERE lock=1) AS stale_locks,
          (SELECT value FROM flags WHERE key=\"dbVersion\") AS dbver;"'
```
Expected: `distinct_kept` ≪ `pin_unpin_total` (the collapse the migration will perform); `dbver=6`. Record the numbers — they're the expected post-migration queue size.

- [ ] **Step 3: Report readiness**

Summarize: SQL proven (Task 1), binary compiles (Task 2), expected queue collapse N→M (Step 2). State that deploy is the next, separately-approved step.

---

## Deployment — SEPARATE, requires explicit user approval (NOT executed by this plan)

Do **not** run these without a go-ahead. On prod (`134.199.198.90`, `/opt/DigiAsset_Core/bin`):

1. `systemctl stop digiasset-core-watchdog.timer` (prevent watchdog restart mid-deploy).
2. `systemctl stop digiasset-core`.
3. Back up: `cp bin/digiasset_core bin/digiasset_core.bak-dedup` and `cp bin/chain.db bin/chain.db.bak-dedup` (~3.97 GB — ensure disk space; this is the rollback).
4. Swap in the new binary.
5. `systemctl start digiasset-core`; watch logs — the 6→7 migration runs once on first start.
6. Verify: `dbVersion=7`; `ipfs` pin/unpin count dropped to the Step-2 `distinct_kept`; `idx_ipfs_pin_dedup` exists; `pinned` count begins climbing; sync healthy at tip, 0 errors.
7. Re-enable watchdog: `systemctl start digiasset-core-watchdog.timer`.
8. Rollback if needed: stop service, restore `chain.db.bak-dedup` + `digiasset_core.bak-dedup`, restart.

## Self-Review

- **Spec coverage:** partial unique index → Task 2 Step 2/3; INSERT OR IGNORE (4 stmts) → Step 4; 6→7 migration (dedup before index, bump) → Step 3; fresh-install index → Step 2; resetInProgressIPFSJobs + call site → Steps 1,5,6; one-time cleanup magnitude → Task 3 Step 2; download-path safety → Global Constraints + Task 1 download assertions. All spec sections mapped.
- **Placeholder scan:** Task 3 Step 1 intentionally allows a skip (documented) if RPC-less startup isn't possible — not a placeholder, an explicit fallback with rationale.
- **Type consistency:** `resetInProgressIPFSJobs()` declared (Step 1), defined (Step 5), called (Step 6) — no args, void, matches. Migration SQL in Task 1 test == lambda[6] SQL in Step 3 (verbatim).
