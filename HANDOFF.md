# HANDOFF.md — from background build to ON-MAC

The pure logic is built and tested; the deployable `dist/eccl-calsync.js` is
generated and parses. Everything below needs your Mac, your calendars, and a
one-time macOS Calendar privacy grant.

## What's ready

- `npm test` → 25 tests passing (reconcile fixtures, identity, sync/dry-run).
- `npm run build` → `dist/eccl-calsync.js` (single JXA file, `node --check`'d).
- `install/install.sh`, `uninstall.sh`, and the LaunchAgent plist.

## Do this on the Mac

1. **Build & install**
   ```bash
   npm run build
   bash install/install.sh
   ```

2. **Grant Calendar access + capture titles** (approve the system prompt):
   ```bash
   osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js list
   ```
   Note the macOS version it prints, and the exact `account :: calendar` titles.

3. **Fill config** `~/EcclesiaSync/config.json` with:
   - `sourceAccount`, `sourceCalendar` — the Ecclesia account + calendar titles.
   - `destAccount` — the Supstance account title. `destCalendar` stays `Ecclesia`.
   - Confirm defaults: window 7 back / 90 ahead, notes off, alarms off, location on.

4. **Dry-run, then sync**
   ```bash
   osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once --dry-run
   osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once
   ```

## Open questions to resolve at integration

1. Exact `sourceAccount` / `sourceCalendar` titles (from `list`).
2. Exact `destAccount` title, and whether the `Ecclesia` dest calendar must be
   created in Outlook on the web first (if `saveCalendar` is rejected).
3. macOS version → confirms the access API path (14+ full-access vs older).
4. Confirm the window/notes/alarms defaults are what you want.

## Acceptance to verify ON-MAC

- `once` makes Ecclesia events appear in the Supstance `Ecclesia` calendar and
  on the iPhone within a sync cycle.
- A no-change re-run reports `0 created, 0 updated, 0 deleted`.
- Deleting a source event removes its mirror on the next run.
- The heartbeat event shows the latest time on the phone.

## If something's off

- `~/EcclesiaSync/sync.log` has per-run counts, durations, and errors.
- Force a run: `launchctl kickstart -k gui/$(id -u)/com.supstance.eccl-calsync`.
- Re-deploy after a code change: rebuild, copy `dist/eccl-calsync.js` over, kickstart.
