# LESSONS.md

Things learned while building, so they aren't rediscovered the hard way.

- **Hash only what you mirror.** Because the dest hash is recomputed from the
  dest event, including a field in the hash that you don't copy (e.g. location
  when `copyLocation:false`) creates a perpetual-update loop. The hash and the
  apply field-map must agree on exactly which fields exist. (See DECISIONS D5.)

- **Start is identity, so a start change is recreate.** With `sourceKey`
  embedding the start, moving an event's start is a delete+create, not an
  update. That's fine and idempotent — just don't expect the `update` path to
  fire for it. (DECISIONS D3.)

- **One file must run in two runtimes.** The pure modules are loaded by Node
  (`require`) and by osascript (global). The UMD-ish wrapper that sets both
  `module.exports` and `root.<name>` is what lets the *same* file be unit-tested
  and shipped. Keep `$`/`ObjC` strictly out of `lib/` and guard `src/main.js`'s
  CLI so importing it under Node never executes the bridge.

- **launchd argv ≠ a `run(argv)` handler.** When osascript runs a plain `.js`
  under a LaunchAgent, the `run(argv)` handler isn't reliably called; read
  arguments via `NSProcessInfo.processInfo.arguments` and slice after the script
  path instead.

- **macOS 14 changed the Calendar grant API.** Detect
  `requestFullAccessToEventsWithCompletion:` with `respondsToSelector`
  (built via `NSSelectorFromString`) and fall back to
  `requestAccessToEntityType:completion:` on older systems. The completion
  handler is async — pump the run loop until it fires.

- **Some Exchange/M365 sources reject client-created calendars.** Don't assume
  `saveCalendar` succeeds; on failure, tell the user to create the `Ecclesia`
  calendar once in Outlook on the web and re-run.
