# CLAUDE.md — project context for eccl-calsync (ECAL)

## What this is

ECAL v1: a one-way macOS calendar mirror. It copies the user's **Ecclesia**
calendar into a dedicated **Ecclesia** calendar under his **Supstance** M365
account so it appears on his personal iPhone — without enrolling the phone and
without touching the Ecclesia tenant. Hourly, idempotent, lightweight.

Commit scope: `[ECAL]`.

## Hard constraints (do not violate)

1. **No Ecclesia tenant access.** No app registration, Graph, connector, admin,
   or new OAuth identity.
2. **No network calls at all.** The engine reads the local Calendar database the
   existing Exchange account already populates, and writes to the local
   Supstance calendar macOS already syncs. Nothing in `lib/` or `src/` should
   open a socket.
3. **User scope only.** No sudo, no MDM, no secrets (so no secret lifecycle).
4. Runs entirely on the user's own Mac.

## Architecture

Pure logic is separated from EventKit I/O so it can be built and tested in the
background without a Mac.

- `lib/identity.js` — PURE. `sourceKey`, `contentHash`, url-tag encode/decode.
- `lib/reconcile.js` — PURE. `diff(source, dest) -> {create, update, delete}`.
- `src/eventkit.js` — JXA EventKit adapter (read/write/create-calendar). Mac-only.
- `src/main.js` — orchestration core (`buildPlan`/`runSync`, testable with a mock
  adapter) + the JXA CLI entry (runs only under osascript).
- `build/build.sh` — concatenates `lib/*` + `src/*` -> `dist/eccl-calsync.js`
  because `osascript` cannot `require()` Node modules. Same pure files feed the
  Node tests.

## Conventions

- Pure modules use the `;(function(root, factory){...})` wrapper so they export
  via `module.exports` under Node **and** attach to the global under JXA.
- Anything touching `$`/`ObjC` lives in `src/` and must be guarded so the file
  is import-safe under Node.
- Dates are canonicalized to UTC ISO 8601 with ms (`toIso`) before hashing/keying.

## Stable cross-engine contract (keep frozen)

The future Windows OWA standby and the Teams/email modules will reuse these:

- url tag `x-eccl-sync:<sourceKey>` on every mirrored event.
- heartbeat tag `x-eccl-sync:__heartbeat__`, title `Ecclesia sync · HH:MM · <engine>`.
- the dest "Ecclesia" calendar as the shared destination.

Do **not** change the tag format or heartbeat title shape without updating
DECISIONS.md and treating it as a contract break.

## Build / test

```bash
npm test          # node --test over test/*.test.js
npm run build     # writes + node --check's dist/eccl-calsync.js
```

## What's out of scope for v1 (do not build)

Teams alert mirroring, email→Todoist rules, the Windows OWA standby engine.
Keep the identity scheme and heartbeat contract stable so they can plug in later.
