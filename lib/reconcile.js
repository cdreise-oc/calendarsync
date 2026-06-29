// lib/reconcile.js — PURE one-way reconcile (the single place the diff is decided).
//
// No platform calls. Runs under Node (require) and under JXA (osascript),
// where the concatenation build exposes it as the global `reconcile`.
//
// diff(source, dest) -> { create, update, delete }
//   source: [{ key, hash, fields? }]   descriptors of current source events
//   dest:   [{ key, hash, eventRef? }] descriptors of mirrored dest events
//
// The caller is responsible for excluding the heartbeat from `dest` (it is not
// a mirrored event) and for filtering any dest entry whose url is not one of
// ours. As a safety net we also skip dest entries with a null/empty key.

;(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.reconcile = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function indexByKey(list) {
    var map = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var k = list[i].key;
      if (k == null || k === '') continue;
      map[k] = list[i];
    }
    return map;
  }

  function diff(source, dest) {
    source = source || [];
    dest = dest || [];

    var destByKey = indexByKey(dest);

    var create = [];
    var update = [];
    var seenSource = Object.create(null);

    for (var i = 0; i < source.length; i++) {
      var s = source[i];
      if (s.key == null || s.key === '') continue;
      seenSource[s.key] = true;
      var d = destByKey[s.key];
      if (!d) {
        create.push(s);
      } else if (d.hash !== s.hash) {
        // Carry both sides: apply needs source fields + the dest event ref.
        update.push({ source: s, dest: d });
      }
    }

    var del = [];
    for (var j = 0; j < dest.length; j++) {
      var de = dest[j];
      if (de.key == null || de.key === '') continue;
      if (!seenSource[de.key]) del.push(de);
    }

    return { create: create, update: update, delete: del };
  }

  return { diff: diff };
});
