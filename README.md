# eccl-calsync — ECAL v1, one-way calendar mirror (Mac)

Mirrors your Ecclesia calendar, **one way**, into a dedicated **Ecclesia**
calendar under your Supstance M365 account, so it shows on your personal iPhone
without enrolling the phone and without touching the Ecclesia tenant. Hourly,
idempotent, lightweight, no network calls.

It reads the local macOS Calendar store (which your existing Exchange account
already populates) via EventKit and writes to the local Supstance calendar
(which macOS already syncs to M365). No app registration, no Graph, no OAuth,
no admin, no secrets, user scope only.

## How it works

```
Ecclesia calendar (local EventKit, read-only)
        │  read window [-7d, +90d], expanded occurrences
        ▼
   reconcile.diff(source, dest) -> { create, update, delete }   (pure, tested)
        ▼
Supstance "Ecclesia" calendar (local EventKit, write) ──sync──▶ M365 ──▶ iPhone
```

- **Identity:** each mirrored event carries `x-eccl-sync:<sourceKey>` in its URL
  field, where `sourceKey = calendarItemExternalIdentifier + "|" + ISO start`.
  Recurring occurrences are keyed per occurrence by their start.
- **Change detection:** an FNV-1a hash over the mirrored fields (title, start,
  end, all-day, location; notes only if enabled).
- **Heartbeat:** one all-day event today titled `Ecclesia sync · HH:MM · mac`,
  tagged `x-eccl-sync:__heartbeat__`, refreshed each run and excluded from
  reconcile. It gives visible freshness on the phone.

## Repo layout

```
lib/        PURE logic, Node-tested (identity.js, reconcile.js)
src/        JXA EventKit adapter + entry (eventkit.js, main.js) — Mac-only
build/      build.sh: concatenates lib/* + src/* -> dist/eccl-calsync.js
dist/       deployable single JXA file (build output)
test/       Node tests + fixtures
install/    launchd plist, install.sh, uninstall.sh
```

`osascript` cannot `require()` Node modules, so the build inlines the pure files
ahead of the JXA files into one deployable script. The same pure files are
required directly by the Node tests, so the reconcile logic is fully built and
tested without a Mac.

## Develop / test (no Mac)

```bash
npm test            # run all Node tests
npm run build       # produce dist/eccl-calsync.js (also node --check's it)
```

## Install and operate (ON-MAC)

```bash
npm run build
bash install/install.sh
```

Then, once, from Terminal (this triggers the one-time Calendar privacy prompt —
approve it; the grant persists and does not expire):

```bash
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js list
```

`list` prints every calendar as `[write|READONLY] account :: calendar` plus the
macOS version. Copy the exact titles into `~/EcclesiaSync/config.json`:

```json
{
  "sourceAccount": "<Ecclesia account title from list>",
  "sourceCalendar": "<Ecclesia calendar title>",
  "destAccount":   "<Supstance account title>",
  "destCalendar":  "Ecclesia",
  "windowDaysBack": 7,
  "windowDaysAhead": 90,
  "copyNotes": false,
  "copyAlarms": false,
  "copyLocation": true
}
```

Defaults are chosen for lightweight and low-leak: notes and alarms off (you
already get alerts on the Mac, and bodies can be sensitive), location on.

Dry-run, then sync for real:

```bash
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once --dry-run
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once
```

If the **Ecclesia** dest calendar cannot be created automatically (some
Exchange/M365 sources reject client-created calendars), create a calendar named
exactly `Ecclesia` once in Supstance Outlook on the web, then re-run. One-time,
own-account, no IT.

### CLI modes

| command            | does                                                        |
|--------------------|-------------------------------------------------------------|
| `list`             | print calendars + macOS version (used to fill config)       |
| `once`             | perform one sync (also the launchd default)                 |
| `once --dry-run`   | compute and print the plan without writing                  |
| *(no argument)*    | same as `once`                                              |

## Schedule

`install.sh` installs `com.supstance.eccl-calsync` as a per-user LaunchAgent
that runs hourly at minute 5 with `RunAtLoad`, in your login session. Runs while
asleep or logged out are skipped and caught up on the next wake/load. v1 does
not use `caffeinate`; to keep the Mac syncing, set
*System Settings ▸ Battery/Energy ▸ wake for network access* (or keep it
plugged in and awake).

## Update

```bash
npm run build
cp dist/eccl-calsync.js ~/EcclesiaSync/eccl-calsync.js
launchctl kickstart -k gui/$(id -u)/com.supstance.eccl-calsync
```

A config change is just an edit of `~/EcclesiaSync/config.json` — no rebuild.

## Logs

`~/EcclesiaSync/sync.log` records, per run: timestamp, mode, created/updated/
deleted counts, duration, and any error. Truncated when it passes 1 MB. launchd
stdout/stderr also point here.

## Uninstall / decommission

```bash
bash install/uninstall.sh
```

Removes the LaunchAgent and `~/EcclesiaSync`. To clear the mirrored events and
heartbeat everywhere, delete the Supstance **Ecclesia** calendar — nothing was
ever provisioned on the Ecclesia side, so there is nothing to revoke.
