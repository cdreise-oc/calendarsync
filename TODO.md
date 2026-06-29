# TODO.md

## Done — background (Claude Code, no Mac)

- [x] `lib/identity.js` — sourceKey, contentHash, url-tag encode/decode, heartbeat tag.
- [x] `lib/reconcile.js` — pure `diff(source, dest) -> {create, update, delete}`.
- [x] `src/main.js` — orchestration core (buildPlan/runSync/formatPlan) + JXA CLI entry.
- [x] `src/eventkit.js` — EventKit adapter (read/write/create-calendar/heartbeat/log).
- [x] `build/build.sh` — concatenate -> `dist/eccl-calsync.js`, `node --check` verified.
- [x] Node tests: reconcile fixtures (empty dest, no change, new, changed time,
      deleted source, recurring distinct, heartbeat ignored), identity, sync/dry-run.
- [x] `install/` — launchd plist + install.sh + uninstall.sh.
- [x] Docs: README, CLAUDE, DECISIONS, LESSONS, HANDOFF.

## Pending — ON-MAC (user, after handoff)

- [ ] Run `list`, approve the Calendar privacy prompt, capture exact titles.
- [ ] Fill `~/EcclesiaSync/config.json` (sourceAccount, sourceCalendar, destAccount).
- [ ] Confirm whether the `Ecclesia` dest calendar must be created in OWA first.
- [ ] `once --dry-run` sanity check, then `once`.
- [ ] Confirm idempotency (second run = 0/0/0) and deletion propagation.
- [ ] Confirm heartbeat shows latest time on the iPhone.
- [ ] Confirm macOS version → access API path (14+ full-access vs older).

## Later modules (do not build in v1)

- [ ] Teams alert mirroring.
- [ ] Email → Todoist rules.
- [ ] Windows OWA standby engine (reuses url tag + heartbeat contract).
