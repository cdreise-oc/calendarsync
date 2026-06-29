// src/main.js — JXA entry + orchestration core.
//
// Two layers live here on purpose:
//
//   core   — plain JS that takes an injected `adapter`. No platform calls of
//            its own, so it is fully unit-testable under Node with a mock
//            adapter (see test/sync.test.js). This is where the sync plan is
//            built and applied.
//
//   CLI    — argv parsing + config load + dispatch. Only runs when executed by
//            osascript (detected via the ObjC bridge `$`). Under Node `require`
//            this block is skipped, so the file is safe to load in tests.
//
// In the concatenation build (dist/eccl-calsync.js) `identity`, `reconcile`,
// and `eventkit` are globals; under Node they are required relative to src/.

;(function (root) {
  'use strict';

  var isNode = (typeof module !== 'undefined' && module.exports);
  var identity = isNode ? require('../lib/identity') : root.identity;
  var reconcile = isNode ? require('../lib/reconcile') : root.reconcile;

  // ---- core (testable) -----------------------------------------------------

  // Turn raw source events into reconcile descriptors.
  function describeSource(events, config) {
    var out = [];
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      out.push({
        key: identity.sourceKey(e),
        hash: identity.contentHash(e, config),
        fields: e
      });
    }
    return out;
  }

  // Compute the create/update/delete plan from the adapter's reads. The adapter
  // returns dest descriptors already keyed (url parsed) and with the heartbeat
  // excluded, its hash recomputed with the same contentHash over dest fields.
  function buildPlan(adapter, config) {
    var source = describeSource(adapter.readSourceEvents(config), config);
    var dest = adapter.readDestDescriptors(config);
    return reconcile.diff(source, dest);
  }

  // Apply a plan through the adapter. With opts.dryRun the adapter is read only;
  // nothing is written and the heartbeat is left untouched.
  function runSync(adapter, config, opts) {
    opts = opts || {};
    var plan = buildPlan(adapter, config);
    var counts = {
      created: plan.create.length,
      updated: plan.update.length,
      deleted: plan.delete.length
    };
    if (opts.dryRun) {
      return { plan: plan, counts: counts, applied: false };
    }

    var i;
    for (i = 0; i < plan.create.length; i++) {
      adapter.createEvent(plan.create[i].fields, config);
    }
    for (i = 0; i < plan.update.length; i++) {
      adapter.updateEvent(plan.update[i].dest.eventRef, plan.update[i].source.fields, config);
    }
    for (i = 0; i < plan.delete.length; i++) {
      adapter.deleteEvent(plan.delete[i].eventRef);
    }
    adapter.writeHeartbeat(config, opts.now);

    return { plan: plan, counts: counts, applied: true };
  }

  // Human-readable plan, used by `once --dry-run` and the run summary.
  function formatPlan(plan) {
    var lines = [];
    function section(label, items, titleOf) {
      lines.push(label + ': ' + items.length);
      for (var i = 0; i < items.length; i++) {
        lines.push('  - ' + titleOf(items[i]));
      }
    }
    var srcTitle = function (x) { return (x.fields && x.fields.title) || x.key; };
    section('create', plan.create, srcTitle);
    section('update', plan.update, function (u) {
      return (u.source.fields && u.source.fields.title) || u.source.key;
    });
    section('delete', plan.delete, function (d) {
      return (d.fields && d.fields.title) || d.key;
    });
    return lines.join('\n');
  }

  var core = {
    describeSource: describeSource,
    buildPlan: buildPlan,
    runSync: runSync,
    formatPlan: formatPlan
  };

  if (isNode) module.exports = core;
  root.core = core;

  // ---- CLI (osascript only) ------------------------------------------------
  //
  // Guarded so it never runs under Node. `$` is the JXA ObjC bridge; `eventkit`
  // is the adapter contributed by src/eventkit.js in the concatenation build.

  function runCli() {
    var argv = parseArgv();
    var mode = argv.mode;

    if (mode === 'list') {
      eventkit.requestAccess();
      var cals = eventkit.listCalendars();
      var out = ['macOS ' + eventkit.osVersion()];
      for (var i = 0; i < cals.length; i++) {
        var c = cals[i];
        out.push('[' + (c.writable ? 'write' : 'READONLY') + '] ' +
                 c.account + ' :: ' + c.calendar);
      }
      print(out.join('\n'));
      return 0;
    }

    // once / dry-run / default
    var config = eventkit.loadConfig();
    eventkit.requestAccess();
    var started = nowMs();
    var adapter = eventkit;
    var result;
    try {
      result = runSync(adapter, config, { dryRun: argv.dryRun });
    } catch (err) {
      var msg = 'ERROR ' + (err && err.message ? err.message : String(err));
      eventkit.appendLog({ mode: argv.modeName, error: msg, durationMs: nowMs() - started });
      print(msg);
      return 1;
    }

    var summary = (argv.dryRun ? 'DRY-RUN plan\n' : '') + formatPlan(result.plan);
    print(summary);
    eventkit.appendLog({
      mode: argv.modeName,
      created: result.counts.created,
      updated: result.counts.updated,
      deleted: result.counts.deleted,
      durationMs: nowMs() - started,
      dryRun: argv.dryRun
    });
    return 0;
  }

  function parseArgv() {
    var args = systemArgs();
    var dryRun = args.indexOf('--dry-run') !== -1;
    var positional = args.filter(function (a) { return a.lastIndexOf('--', 0) !== 0; });
    var verb = positional.length ? positional[0] : 'once';
    if (verb !== 'list' && verb !== 'once') {
      // Unknown verb: treat as default `once` per spec (no-arg == once).
      verb = 'once';
    }
    return {
      mode: verb,
      dryRun: verb === 'once' && dryRun,
      modeName: verb === 'list' ? 'list' : (dryRun ? 'dry-run' : 'once')
    };
  }

  // osascript argv access via NSProcessInfo (the `run(argv)` handler is not
  // reliably invoked when the script is launched as a plain .js by launchd).
  function systemArgs() {
    try {
      var pa = $.NSProcessInfo.processInfo.arguments;
      var all = [];
      for (var i = 0; i < pa.count; i++) all.push(ObjC.unwrap(pa.objectAtIndex(i)));
      // Drop the osascript / interpreter args; keep everything after the script path.
      var scriptIdx = -1;
      for (var j = 0; j < all.length; j++) {
        if (/\.js$/.test(all[j]) || /eccl-calsync/.test(all[j])) { scriptIdx = j; break; }
      }
      return scriptIdx >= 0 ? all.slice(scriptIdx + 1) : [];
    } catch (e) {
      return [];
    }
  }

  function nowMs() {
    try { return $.NSDate.date.timeIntervalSince1970 * 1000; }
    catch (e) { return 0; }
  }

  function print(s) {
    try {
      var out = $.NSFileHandle.fileHandleWithStandardOutput;
      out.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding));
    } catch (e) { /* best effort */ }
  }

  // Only drive the CLI when running under the ObjC bridge (osascript), and only
  // when the eventkit adapter is present (i.e. the concatenated dist build).
  if (!isNode && typeof $ !== 'undefined' && typeof eventkit !== 'undefined') {
    runCli();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
