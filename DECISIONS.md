# DECISIONS.md

Design decisions and the reasoning behind them. Append-only; newest at top.

## D5 — `contentHash` gates location on `copyLocation`

The spec lists the hash as "over title, start, end, isAllDay, and location (plus
notes only if copyNotes)". We extend the same gating to location: location is in
the hash only when `copyLocation` is true (default true), exactly as notes are
gated by `copyNotes`.

Why: the destination hash is **recomputed from the dest event's own fields** and
compared to the source hash. If location were always hashed but not always
copied, then with `copyLocation:false` the dest event would have no location, its
recomputed hash would never match the source hash, and every run would re-issue
an endless "update". Gating the hash to exactly the mirrored fields keeps the
mirror idempotent. With the default `copyLocation:true` this is identical to the
spec's wording.

## D4 — Dest hash is recomputed from dest fields, not stored

Reconcile needs a hash on both sides. Rather than persist the source hash on the
dest event (which would require widening the frozen url-tag contract), the
adapter recomputes the dest hash from the mirrored fields of the dest EKEvent
using the same `contentHash`. This keeps the url tag exactly
`x-eccl-sync:<sourceKey>` and makes "did anything change" a pure comparison.
Consequence: see D5 — the hash must cover only fields we actually mirror.

## D3 — A pure start-time change is recreate, not update

`sourceKey` embeds the start. If a non-recurring event's start moves, its key
changes: the old key is absent from source (delete) and the new key is absent
from dest (create). Net result on the dest is correct and idempotent. The
`update` path therefore fires for changes to other mirrored fields (title, end,
all-day, location) on an unchanged start. This matches the spec's identity
scheme, where start is part of identity to disambiguate recurring occurrences.

## D2 — FNV-1a 32-bit for `contentHash`

We need a hash computable identically under Node and JSC/JXA with no platform
calls. FNV-1a over UTF-16 code units is tiny, dependency-free, deterministic
across both runtimes, and collision-resistant enough for change detection (this
is not security). Output is zero-padded 8-char hex.

## D1 — Concatenation build instead of a module bundler

`osascript` cannot `require()` Node modules. `build/build.sh` simply concatenates
`lib/*` (pure) then `src/*` (adapter, then entry) into one `dist/eccl-calsync.js`.
The pure modules use a UMD-ish wrapper that exports under Node and attaches to
the global under JXA, so the exact same files are unit-tested under Node and run
under osascript. No toolchain, no install, nothing to keep in sync.
