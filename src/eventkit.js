// src/eventkit.js — EventKit I/O adapter (Mac-only, JXA / ObjC bridge).
//
// This file is NOT runnable under Node: it talks to EventKit through the
// Objective-C bridge. It is concatenated into dist/eccl-calsync.js and exposes
// the global `eventkit`, the adapter that src/main.js's core drives.
//
// Adapter contract (consumed by core in src/main.js):
//   loadConfig()                       -> config object
//   requestAccess()                    -> true | throws
//   osVersion()                        -> "14.5.0"
//   listCalendars()                    -> [{ account, calendar, writable }]
//   readSourceEvents(config)           -> [ sourceEvent ]
//   readDestDescriptors(config)        -> [{ key, hash, eventRef }]  (heartbeat excluded)
//   createEvent(fields, config)
//   updateEvent(eventRef, fields, config)
//   deleteEvent(eventRef)
//   writeHeartbeat(config, nowMs)
//   appendLog(record)

;(function (root) {
  'use strict';

  // identity is a global in the dist build; require() under Node never runs
  // this file, but keep the lookup tolerant just in case.
  var identity = (typeof module !== 'undefined' && module.exports)
    ? require('../lib/identity')
    : root.identity;

  // Import the EventKit + Foundation frameworks once.
  function bridge() {
    if (bridge._done) return;
    ObjC.import('EventKit');
    ObjC.import('Foundation');
    bridge._done = true;
  }

  function nsstr(s) { return $(String(s == null ? '' : s)); }
  function jstr(o) { return o && o.js !== undefined ? o.js : (o ? ObjC.unwrap(o) : ''); }

  // ---- date helpers --------------------------------------------------------

  function isoFormatter() {
    if (!isoFormatter._f) {
      var f = $.NSISO8601DateFormatter.alloc.init;
      f.timeZone = $.NSTimeZone.timeZoneWithName('UTC');
      // Include fractional seconds so the ISO matches identity.toIso (ms).
      f.formatOptions = $.NSISO8601DateFormatWithInternetDateTime |
                        $.NSISO8601DateFormatWithFractionalSeconds;
      isoFormatter._f = f;
    }
    return isoFormatter._f;
  }

  function nsdateToIso(d) {
    if (!d) return '';
    return ObjC.unwrap(isoFormatter().stringFromDate(d));
  }

  function nsdateToJsDate(d) {
    if (!d) return null;
    return new Date(d.timeIntervalSince1970 * 1000);
  }

  function startOfToday() {
    var cal = $.NSCalendar.currentCalendar;
    var comps = cal.componentsFromDate(
      $.NSCalendarUnitYear | $.NSCalendarUnitMonth | $.NSCalendarUnitDay,
      $.NSDate.date);
    return cal.dateFromComponents(comps);
  }

  function dateByAddingDays(date, days) {
    return $.NSDate.dateWithTimeIntervalSinceReferenceDate(
      date.timeIntervalSinceReferenceDate + days * 86400);
  }

  // ---- store + access ------------------------------------------------------

  var _store = null;
  function store() {
    if (!_store) { bridge(); _store = $.EKEventStore.alloc.init; }
    return _store;
  }

  function osVersion() {
    bridge();
    var v = $.NSProcessInfo.processInfo.operatingSystemVersion;
    return v.majorVersion + '.' + v.minorVersion + '.' + v.patchVersion;
  }

  // EventKit Calendar grant (TCC). macOS 14+ exposes the "full access" selector;
  // older systems use the generic entity-type request. Detect at runtime.
  function requestAccess() {
    bridge();
    var s = store();
    var done = { ok: false, err: null, finished: false };
    var handler = function (granted, error) {
      done.ok = granted;
      done.err = error ? ObjC.unwrap(error.localizedDescription) : null;
      done.finished = true;
    };

    var fullSel = $.NSSelectorFromString('requestFullAccessToEventsWithCompletion:');
    if (s.respondsToSelector(fullSel)) {
      s.requestFullAccessToEventsWithCompletion(handler);
    } else {
      // EKEntityTypeEvent == 0
      s.requestAccessToEntityTypeCompletion(0, handler);
    }

    // Pump the run loop until the completion handler fires.
    var deadline = $.NSDate.dateWithTimeIntervalSinceNow(30);
    while (!done.finished && $.NSDate.date.compare(deadline) < 0) {
      $.NSRunLoop.currentRunLoop.runModeBeforeDate(
        $.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.05));
    }
    if (!done.ok) {
      throw new Error('Calendar access not granted' + (done.err ? ': ' + done.err : '') +
        '. Run `list` once from Terminal and approve the prompt.');
    }
    return true;
  }

  // ---- calendar resolution -------------------------------------------------

  function allCalendars() {
    bridge();
    return ObjC.unwrap(store().calendarsForEntityType(0)); // EKEntityTypeEvent
  }

  function listCalendars() {
    var cals = allCalendars();
    var rows = [];
    for (var i = 0; i < cals.length; i++) {
      var c = cals[i];
      rows.push({
        account: ObjC.unwrap(c.source.title),
        calendar: ObjC.unwrap(c.title),
        writable: c.allowsContentModifications
      });
    }
    rows.sort(function (a, b) {
      return (a.account + a.calendar).localeCompare(b.account + b.calendar);
    });
    return rows;
  }

  // Find exactly one EKCalendar matching account (EKSource.title) + calendar
  // (EKCalendar.title). Throw clearly on absent or ambiguous.
  function resolveCalendar(accountTitle, calendarTitle, opts) {
    opts = opts || {};
    var cals = allCalendars();
    var matches = [];
    for (var i = 0; i < cals.length; i++) {
      var c = cals[i];
      if (ObjC.unwrap(c.source.title) === accountTitle &&
          ObjC.unwrap(c.title) === calendarTitle) {
        matches.push(c);
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error('Ambiguous calendar: ' + accountTitle + ' :: ' + calendarTitle +
        ' (' + matches.length + ' matches). Rename one to disambiguate.');
    }
    if (opts.optional) return null;
    throw new Error('Calendar not found: ' + accountTitle + ' :: ' + calendarTitle +
      '. Run `list` to see exact titles.');
  }

  function resolveSource(config) {
    return resolveCalendar(config.sourceAccount, config.sourceCalendar);
  }

  // Resolve the dest calendar; create it under the dest EKSource if missing.
  function resolveDest(config) {
    var existing = resolveCalendar(config.destAccount, config.destCalendar, { optional: true });
    if (existing) return existing;

    // Locate the dest EKSource to attach a new calendar to.
    var src = null;
    var sources = ObjC.unwrap(store().sources);
    for (var i = 0; i < sources.length; i++) {
      if (ObjC.unwrap(sources[i].title) === config.destAccount) { src = sources[i]; break; }
    }
    if (!src) {
      throw new Error('Destination account not found: ' + config.destAccount +
        '. Run `list` to see exact titles.');
    }

    var cal = $.EKCalendar.calendarForEntityTypeEventStore(0, store());
    cal.title = nsstr(config.destCalendar);
    cal.source = src;
    var errRef = $();
    var ok = store().saveCalendarCommitError(cal, true, errRef);
    if (!ok) {
      throw new Error('Could not create the "' + config.destCalendar + '" calendar under ' +
        config.destAccount + ' (Exchange/M365 sources sometimes reject this). ' +
        'Create a calendar named exactly "' + config.destCalendar +
        '" once in Supstance Outlook on the web, then re-run.');
    }
    return cal;
  }

  // ---- reads ---------------------------------------------------------------

  function windowPredicate(calendar, config) {
    var today = $.NSDate.date;
    var start = dateByAddingDays(today, -Math.abs(config.windowDaysBack || 7));
    var end = dateByAddingDays(today, Math.abs(config.windowDaysAhead || 90));
    var arr = $.NSArray.arrayWithObject(calendar);
    return store().predicateForEventsWithStartDateEndDateCalendars(start, end, arr);
  }

  function ekToSourceEvent(ev) {
    return {
      externalId: ObjC.unwrap(ev.calendarItemExternalIdentifier),
      title: ObjC.unwrap(ev.title) || '',
      start: nsdateToIso(ev.startDate),
      end: nsdateToIso(ev.endDate),
      isAllDay: ev.isAllDay ? true : false,
      location: ev.location ? ObjC.unwrap(ev.location) : '',
      notes: ev.notes ? ObjC.unwrap(ev.notes) : '',
      // Absolute NSDate values retained for writing.
      _startDate: ev.startDate,
      _endDate: ev.endDate
    };
  }

  function readSourceEvents(config) {
    var cal = resolveSource(config);
    var pred = windowPredicate(cal, config);
    var events = ObjC.unwrap(store().eventsMatchingPredicate(pred));
    var out = [];
    for (var i = 0; i < events.length; i++) out.push(ekToSourceEvent(events[i]));
    return out;
  }

  // Dest descriptors: parse the url tag for the key, skip the heartbeat and any
  // event we did not write, and recompute the hash from the dest event's
  // mirrored fields with the SAME config so it compares to the source hash.
  function readDestDescriptors(config) {
    var cal = resolveDest(config);
    var pred = windowPredicateDest(cal, config);
    var events = ObjC.unwrap(store().eventsMatchingPredicate(pred));
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var url = ev.URL ? ObjC.unwrap(ev.URL.absoluteString) : null;
      var key = identity.decodeUrlTag(url);
      if (key == null) continue;                 // not one of ours
      if (key === identity.HEARTBEAT_KEY) continue; // excluded from reconcile
      var fields = ekToSourceEvent(ev);
      out.push({ key: key, hash: identity.contentHash(fields, config), eventRef: ev });
    }
    return out;
  }

  // Dest scan must reach today's heartbeat and any past mirror inside the
  // window; reuse the same window as the source.
  function windowPredicateDest(calendar, config) {
    return windowPredicate(calendar, config);
  }

  // ---- writes --------------------------------------------------------------

  function mapFields(ev, fields, config) {
    ev.title = nsstr(fields.title);
    ev.startDate = fields._startDate;
    ev.endDate = fields._endDate;
    ev.allDay = fields.isAllDay ? true : false;
    ev.availability = $.EKEventAvailabilityBusy;
    if (config.copyLocation) {
      ev.location = fields.location ? nsstr(fields.location) : $();
    }
    if (config.copyNotes) {
      ev.notes = fields.notes ? nsstr(fields.notes) : $();
    }
    // Attendees never copied. Alarms only if configured.
    if (!config.copyAlarms) ev.alarms = $();
  }

  function saveEvent(ev) {
    var errRef = $();
    var ok = store().saveEventSpanCommitError(ev, $.EKSpanThisEvent, true, errRef);
    if (!ok) throw new Error('saveEvent failed: ' + describeError(errRef));
    return ok;
  }

  function describeError(errRef) {
    try {
      var e = ObjC.deref ? ObjC.deref(errRef) : errRef;
      return e && e.localizedDescription ? ObjC.unwrap(e.localizedDescription) : 'unknown';
    } catch (x) { return 'unknown'; }
  }

  function createEvent(fields, config) {
    var ev = $.EKEvent.eventWithEventStore(store());
    ev.calendar = resolveDest(config);
    mapFields(ev, fields, config);
    ev.URL = $.NSURL.URLWithString(nsstr(identity.encodeUrlTag(
      identity.sourceKey(fields))));
    return saveEvent(ev);
  }

  function updateEvent(eventRef, fields, config) {
    mapFields(eventRef, fields, config);
    // Keep the existing url tag (key is unchanged for an update).
    return saveEvent(eventRef);
  }

  function deleteEvent(eventRef) {
    var errRef = $();
    var ok = store().removeEventSpanCommitError(eventRef, $.EKSpanThisEvent, true, errRef);
    if (!ok) throw new Error('deleteEvent failed: ' + describeError(errRef));
    return ok;
  }

  // ---- heartbeat -----------------------------------------------------------

  // One all-day event on today, url x-eccl-sync:__heartbeat__, title
  // "Ecclesia sync · HH:MM · mac". Found by url, moved to today, time updated.
  function writeHeartbeat(config, nowMs) {
    var cal = resolveDest(config);
    var existing = findHeartbeat(cal, config);
    var ev = existing || $.EKEvent.eventWithEventStore(store());
    if (!existing) {
      ev.calendar = cal;
      ev.URL = $.NSURL.URLWithString(nsstr(identity.heartbeatUrlTag()));
      ev.allDay = true;
    }
    var today = startOfToday();
    ev.startDate = today;
    ev.endDate = dateByAddingDays(today, 1);
    ev.availability = $.EKEventAvailabilityFree;
    ev.title = nsstr('Ecclesia sync · ' + hhmm(nowMs) + ' · mac');
    return saveEvent(ev);
  }

  function findHeartbeat(cal, config) {
    var pred = windowPredicate(cal, config);
    var events = ObjC.unwrap(store().eventsMatchingPredicate(pred));
    for (var i = 0; i < events.length; i++) {
      var url = events[i].URL ? ObjC.unwrap(events[i].URL.absoluteString) : null;
      if (identity.isHeartbeatTag(url)) return events[i];
    }
    return null;
  }

  function hhmm(nowMs) {
    var d = (nowMs ? new Date(nowMs) : new Date());
    var df = $.NSDateFormatter.alloc.init;
    df.dateFormat = nsstr('HH:mm');
    return ObjC.unwrap(df.stringFromDate(nsdateToNs(d)));
  }

  function nsdateToNs(jsDate) {
    return $.NSDate.dateWithTimeIntervalSince1970(jsDate.getTime() / 1000);
  }

  // ---- config + log --------------------------------------------------------

  function homeDir() { return ObjC.unwrap($.NSHomeDirectory()); }

  function syncDir() {
    var d = homeDir() + '/EcclesiaSync';
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(nsstr(d))) {
      fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(
        nsstr(d), true, $(), $());
    }
    return d;
  }

  function loadConfig() {
    bridge();
    var candidates = [
      scriptDir() + '/config.json',
      homeDir() + '/EcclesiaSync/config.json'
    ];
    var fm = $.NSFileManager.defaultManager;
    for (var i = 0; i < candidates.length; i++) {
      if (fm.fileExistsAtPath(nsstr(candidates[i]))) {
        var data = $.NSString.stringWithContentsOfFileEncodingError(
          nsstr(candidates[i]), $.NSUTF8StringEncoding, $());
        return applyConfigDefaults(JSON.parse(ObjC.unwrap(data)));
      }
    }
    throw new Error('config.json not found next to the script or in ~/EcclesiaSync/.');
  }

  function applyConfigDefaults(cfg) {
    cfg = cfg || {};
    if (cfg.windowDaysBack == null) cfg.windowDaysBack = 7;
    if (cfg.windowDaysAhead == null) cfg.windowDaysAhead = 90;
    if (cfg.copyNotes == null) cfg.copyNotes = false;
    if (cfg.copyAlarms == null) cfg.copyAlarms = false;
    if (cfg.copyLocation == null) cfg.copyLocation = true;
    if (!cfg.destCalendar) cfg.destCalendar = 'Ecclesia';
    return cfg;
  }

  function scriptDir() {
    // Directory of the running script, for the co-located config.json.
    try {
      var path = ObjC.unwrap($.NSProcessInfo.processInfo.arguments.objectAtIndex(
        $.NSProcessInfo.processInfo.arguments.count - 1));
      var ns = nsstr(path);
      return ObjC.unwrap(ns.stringByDeletingLastPathComponent);
    } catch (e) {
      return homeDir() + '/EcclesiaSync';
    }
  }

  function appendLog(record) {
    try {
      var path = syncDir() + '/sync.log';
      var ts = nsdateToIso($.NSDate.date);
      var parts = [ts, record.mode];
      if (record.error) {
        parts.push(record.error);
      } else {
        parts.push('created=' + (record.created || 0));
        parts.push('updated=' + (record.updated || 0));
        parts.push('deleted=' + (record.deleted || 0));
      }
      parts.push((record.durationMs || 0) + 'ms');
      if (record.dryRun) parts.push('dry-run');
      var line = parts.join(' ') + '\n';

      truncateIfLarge(path);
      var fm = $.NSFileManager.defaultManager;
      if (!fm.fileExistsAtPath(nsstr(path))) {
        nsstr(line).writeToFileAtomicallyEncodingError(nsstr(path), true,
          $.NSUTF8StringEncoding, $());
      } else {
        var fh = $.NSFileHandle.fileHandleForWritingAtPath(nsstr(path));
        fh.seekToEndOfFile;
        fh.writeData(nsstr(line).dataUsingEncoding($.NSUTF8StringEncoding));
        fh.closeFile;
      }
    } catch (e) { /* logging must never break a sync */ }
  }

  function truncateIfLarge(path) {
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(nsstr(path))) return;
    var attrs = fm.attributesOfItemAtPathError(nsstr(path), $());
    var size = attrs ? ObjC.unwrap(attrs.objectForKey($.NSFileSize)) : 0;
    if (size > 1024 * 1024) {
      fm.removeItemAtPathError(nsstr(path), $());
    }
  }

  root.eventkit = {
    loadConfig: loadConfig,
    requestAccess: requestAccess,
    osVersion: osVersion,
    listCalendars: listCalendars,
    readSourceEvents: readSourceEvents,
    readDestDescriptors: readDestDescriptors,
    createEvent: createEvent,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,
    writeHeartbeat: writeHeartbeat,
    appendLog: appendLog
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
