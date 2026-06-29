# SETUP — the lazy, copy-paste version

This gets the Ecclesia → iPhone calendar mirror running on your Mac. No thinking
required. Copy each grey block, paste it into **Terminal**, press Return.

You only do steps 1–6 once. After that it runs itself every hour.

---

## Before you start (2 things must already be true)

1. Your **Ecclesia** calendar already shows up in the Mac **Calendar** app
   (the Exchange account is already added).
2. Your **Supstance** Microsoft 365 account is also added in the Mac **Calendar**
   app (this is where the mirror gets written, and what your iPhone reads).

If both are true, continue. If not, add the accounts in
**Calendar ▸ Settings ▸ Accounts** first.

---

## Step 1 — Open Terminal

Press **⌘ Space**, type `Terminal`, press **Return**. A window opens. That's where
every block below goes.

## Step 2 — Get the code, build it, install it

Paste this **whole block** and press Return. It downloads the project, builds it,
and sets up the hourly schedule.

```bash
cd ~ && \
rm -rf ~/eccl-calsync && \
git clone https://github.com/cdreise-oc/calendarsync.git ~/eccl-calsync && \
cd ~/eccl-calsync && \
npm run build && \
bash install/install.sh
```

## Step 3 — Let it see your calendars

Paste this. A macOS window will pop up asking to allow access to Calendars —
click **Allow** / **OK**.

```bash
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js list
```

It then prints a list that looks like:

```
macOS 14.5.0
[READONLY] Ecclesia :: Calendar
[write] christian.dreise@supstance.com :: Calendar
...
```

**Keep this list visible** — you need three exact names from it in the next step:
- the **account** and **calendar** of your Ecclesia line,
- the **account** of your Supstance line.

## Step 4 — Fill in the settings file

Paste this to open the settings file in TextEdit:

```bash
open -e ~/EcclesiaSync/config.json
```

Replace the three `<...>` placeholders with the exact names from Step 3, then
**save** (⌘ S) and close. Only change the parts in quotes. Example:

```json
{
  "sourceAccount": "Ecclesia",
  "sourceCalendar": "Calendar",
  "destAccount": "christian.dreise@supstance.com",
  "destCalendar": "Ecclesia",
  "windowDaysBack": 7,
  "windowDaysAhead": 90,
  "copyNotes": false,
  "copyAlarms": false,
  "copyLocation": true
}
```

> Copy the names **exactly** as printed, including capital letters and spaces.
> Leave `destCalendar` as `"Ecclesia"`.

## Step 5 — Test run (changes nothing yet)

Paste this. It shows what it *would* do, without touching anything.

```bash
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once --dry-run
```

You should see lines like `create: 12`, `update: 0`, `delete: 0`. If you instead
see an error about a calendar not found, the names in Step 4 don't match Step 3 —
reopen the file and fix them.

## Step 6 — Do it for real

```bash
osascript -l JavaScript ~/EcclesiaSync/eccl-calsync.js once
```

Within a few minutes your Ecclesia events appear in the **Ecclesia** calendar on
your iPhone. **You're done.** It now re-syncs automatically every hour.

> If this step errors saying it could not create the **Ecclesia** calendar:
> open **Outlook on the web** with your Supstance account, create a new calendar
> named exactly `Ecclesia`, then paste the Step 6 command again. One time only.

---

## Everyday: nothing

It runs by itself every hour. A small all-day item titled
`Ecclesia sync · HH:MM · mac` shows on today — that's the freshness stamp, it
tells you the last time it synced. Ignore it.

For the hourly sync to fire, the Mac needs to be awake or set to wake for
network. **System Settings ▸ Battery ▸ Options ▸ Wake for network access**
(laptops) — turn it on, or just leave the Mac plugged in and on.

## If something looks wrong

See the log (last 20 lines):

```bash
tail -n 20 ~/EcclesiaSync/sync.log
```

Force a sync right now instead of waiting for the hour:

```bash
launchctl kickstart -k gui/$(id -u)/com.supstance.eccl-calsync
```

## If you ever want a newer version

```bash
cd ~/eccl-calsync && git pull && npm run build && \
cp dist/eccl-calsync.js ~/EcclesiaSync/eccl-calsync.js && \
launchctl kickstart -k gui/$(id -u)/com.supstance.eccl-calsync
```

## If you want it gone

This removes the schedule and the app folder. To also delete the copied events,
delete the **Ecclesia** calendar in Outlook afterwards.

```bash
cd ~/eccl-calsync && bash install/uninstall.sh
```
