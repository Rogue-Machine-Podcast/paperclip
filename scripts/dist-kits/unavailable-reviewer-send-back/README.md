# Install PR 13 on Paperclip 2026.1005.0

agent: DEV-1

This kit ports [PR 13](https://github.com/Rogue-Machine-Podcast/paperclip/pull/13) into the installed JavaScript. INDEX reviews the kit. ENG applies it after review and owns any later restart. The kit never restarts Paperclip and makes no network calls.

Source head: `21fc114c80be0811904f33a8cd0d524fe514e3a2`. Base: `62cc45ca5c0eee7cebddda067d13fb5548d90569`. GitHub records merge commit `2fd0248aa552ad12e6e5084360582f13a18dc5ec`; the port uses the specified PR head. This is a hand port of its hunks onto the pinned live files, not a copy of compiled master.

Default target:

```text
~/.paperclip/cli/installs/npm/2026.1005.0/node_modules/@paperclipai/server/dist/
```

Kit directory on the Studio:

```text
~/.paperclip-pilot/backups/rog1330-unavailable-reviewer-send-back-20261023/
```

## Verify, apply, and roll back

Run these commands from the kit directory. Verify is read-only for the install. Apply and rollback are for ENG after review.

```sh
python3 patch.py verify
# live: original; kit: verified (10 SHA-256 digests; new-file original: absent)

python3 patch.py apply
# live: patched; apply complete; no restart performed

python3 patch.py verify
# live: patched; kit: verified (10 SHA-256 digests; new-file original: absent)

python3 patch.py rollback
# live: original; rollback complete; no restart performed
```

Set `PAPERCLIP_DIST_ROOT` or pass `--root /absolute/path/to/dist` to target a scratch copy. The flag takes precedence. Duplicate apply or rollback requests fail. Mixed, unknown, missing-original, and corrupt-artifact states fail before installation. Verify exits with code 1 for mixed or unknown target state or failed kit integrity.

These files stack with the ROG-1165 `services/workspace-runtime.js` patch without overlap. A Paperclip upgrade drops both patches. Applying or rolling back files does not change the modules already loaded in the running process.

## Inspect the port

- `routes/issues.js`: pre-check availability and watchdog scope only in PATCH. Recheck the locked stage, availability, and scope in the transaction. Save the issue update, audit, and same-request comment together. Skip the ownership-change runner stop for this send-back.
- `services/issue-execution-policy.js`: allow the return assignee or an in-scope watchdog to send an unavailable participant's stage back with `in_progress` and a nonempty comment. Preserve the stage and review counter. Reject other agents, approval attempts, and available participants as in PR 13.
- `services/issues.js`: supply availability facts to both review-attention feeds.
- `services/recovery/issue-graph-liveness.js`: remove the execution-participant path when those facts show unavailability.
- `services/issue-execution-participant-availability.js`: compile the pinned TypeScript module. Keep imports from `@paperclipai/db`, `@paperclipai/shared`, and `drizzle-orm`, and the issue-scoped scheduled-retry and queued-wake checks.

`port.diff` contains every change to the four existing files. Their `.orig` and `.patched` copies retain their relative directories. The new module has no `.orig` file. The original board-override condition in the live route is preserved because PR 13 does not change that condition. The other two transition call sites remain byte-identical.

## Replacement integrity and failure behavior

`patch.py` pins the original and patched digests as literal constants. `manifest.json` is a readable reference and does not control acceptance. `state()` never hashes a mutable kit file to decide what the live state means. Original state requires four original digests and absence of the new module. Patched state requires all five patched digests.

Before installation, each command validates all nine dist artifacts and the TypeScript source against constants, reads the replacements into memory, and stages them in each destination directory. It validates staged replacement hashes before each `os.replace`. It stages copies of the previous target bytes for recovery, then checks that the target set has not changed during staging. A lock in the kit directory serializes commands using this kit.

A caught partial failure in either direction restores the exact prior target bytes, including presence or absence of the new file. Rollback removes the new file. Temporary files live next to the five target paths and are removed after success or successful recovery. The commands write only in the kit and those target directories. Symlink target components are refused.

Five independent filesystem paths cannot form one atomic filesystem transaction. If the process is killed without cleanup, power fails, or the filesystem refuses recovery writes, the kit cannot promise restoration. It reports recovery failures and retains surviving recovery files. Verify refuses any resulting mixed state. ENG must run these commands with exclusive control of installation changes.

## Assemble from the review branch

The Git branch contains scripts, exact replacement anchors, the new module, and its source. The four installed originals and their patched full-file builds stay in the local kit. To reconstruct a kit from the review branch, choose a new output directory:

```sh
python3 assemble.py --output /absolute/path/to/new-kit
```

Assembly verifies the live originals, copies them into the new kit, and reconstructs the four patched candidates. It refuses an existing output directory. It never changes the installation. To use copies as the source, pass `--root /absolute/path/to/scratch/dist`.

## Rerun the checks

Use `PAPERCLIP_RUN_SCRATCH_DIR` or `PAPERCLIP_SCRATCH_DIR` for scratch files. Without either variable, checks create a `checks/` directory inside the kit. No check targets the live install for writes.

```sh
python3 rebuild.py
# PASS exact-anchor rebuild: 4/4 artifacts match pinned patched SHA-256 constants

python3 check_source.py --tsc /path/to/repository/node_modules/typescript/bin/tsc
# PASS new availability module: repository tsc output is byte-identical to pinned JS; ES2022/ESNext syntax emit

python3 check_dist.py
# PASS node --check: 5/5 patched files
# PASS send-back: return assignee and scoped watchdog; status=in_progress; assignee=return; changesRequestedCount=2; failedRunId=failed-run
# ... required 422 cases, availability helper, liveness paths, and route import ...
# PASS patched-dist behavior and route import

python3 check_round_trip.py
# PASS scratch round trip: original -> patched -> original; 4 originals byte-identical; new file absent
# ... artifact corruption, all 30 mixed states, unknown states, and injected replacement failures ...
# PASS 112 corruption/state/failure checks plus round trip; live install never targeted
```

The new module was emitted with the repository's TypeScript 7.0.2 CLI using `--noCheck --noResolve --target es2022 --module esnext`. This proves byte-for-byte syntax emit, not full repository type checking. `check_dist.py` creates a fresh recursive symlink mirror of the installed server, copies in the five pinned candidates, and uses `--preserve-symlinks` so relative imports use mirrored modules. All behavior assertions import the patched JavaScript. The availability query test supplies a query-chain stub. This kit does not run database-backed route integration tests or a full workspace build.

The route import succeeds with the current local environment and logs an existing missing external Hermes adapter package warning. The loader skips that optional package. `checks.txt` records the validation output. No live apply, rollback, or restart was performed to build this kit.

## Pinned SHA-256 values

There are nine dist-file hashes and one TypeScript provenance hash. The new module's original state is **absent**, not an empty file. Absence has no SHA-256 digest.

| File | Original SHA-256 | Patched SHA-256 |
| --- | --- | --- |
| `routes/issues.js` | `5089ec331830eaa31a6f166721f9f5d7746531d2a698862900696db573b30964` | `baa808a570500d5de01b7f8afc0bf100fbcf9a4b1efe4a0332fc6ec56258de2c` |
| `services/issue-execution-policy.js` | `69cf5576be806043c123d7494a4060b7e66f0b59a64a4a0d4be07c4102763bad` | `161bbc3d8ad0729792d2a0f18b85066da65a81f7d4539671b14cf985c92b2a53` |
| `services/issues.js` | `0fa69b29c66acf9aaafc073ad5ebfb4bc9238c81a25066a0de1011bfe2e46073` | `9aaf2da2d3cc9dfaa2df9143ca94f2b00b2203675f21a3f1b597e652d5c731e6` |
| `services/recovery/issue-graph-liveness.js` | `be472a82ad60b77a13508ad7482f87c3a14bab29d7adff6a1bf67f6ec467f466` | `d205bf98bf96a9b0fb908d30a1c65e5048548e492bdb4cb06bca49170382f163` |
| `services/issue-execution-participant-availability.js` | absent | `4ec6fc9f4549bc88bb3cae341c70568785a1698f1a229bd9ef8c00f59f947668` |

Pinned source `source/issue-execution-participant-availability.ts`: `0a73c325dc62de3aba6ae6ec97e61a1a46866ab2bd53461b42cdb6dfb7c8d2b9`.
