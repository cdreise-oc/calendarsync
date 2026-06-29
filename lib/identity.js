// lib/identity.js — PURE event-identity helpers.
//
// No platform calls. Runs under Node (require) and under JXA (osascript),
// where the concatenation build exposes it as the global `identity`.
//
// Responsibilities:
//   - sourceKey(event):   stable per-occurrence identity for a source event.
//   - contentHash(event): change-detection digest over mirrored fields only.
//   - url tag encode/decode: the `x-eccl-sync:<key>` back-reference written
//     into the mirrored EKEvent.url, plus the reserved heartbeat tag.
//
// The url-tag format and the heartbeat key are a stable cross-engine contract
// (see DECISIONS.md); the future Windows OWA standby reuses them verbatim.

;(function (root, factory) {
  'use strict';
  var mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  root.identity = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var URL_PREFIX = 'x-eccl-sync:';
  var HEARTBEAT_KEY = '__heartbeat__';
  var SEP = ''; // unit separator — cannot occur in calendar field text
  var FIELD_SEP = '|';

  // Canonical ISO 8601 (UTC, millisecond precision) for a Date or ISO string.
  // EKEvent dates are absolute NSDate values, so a UTC instant is unambiguous
  // and timezone-independent — two stores that agree on the instant agree here.
  function toIso(value) {
    if (value == null) return '';
    var d = (value instanceof Date) ? value : new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toISOString();
  }

  // sourceKey = calendarItemExternalIdentifier + '|' + ISO start.
  // The external identifier is stable across the local store; the start
  // disambiguates the expanded occurrences of a recurring event.
  function sourceKey(event) {
    var ext = event.externalId != null ? String(event.externalId) : '';
    return ext + FIELD_SEP + toIso(event.start);
  }

  // FNV-1a 32-bit over UTF-16 code units -> zero-padded 8-char hex.
  // Pure arithmetic so it yields identical digests under Node and JSC/JXA.
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h *= 16777619, via shift-adds, kept in uint32.
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // contentHash covers ONLY the fields we actually mirror, so the same digest
  // can be recomputed from the destination event and compared to the source
  // without spurious updates. title/start/end/isAllDay are always mirrored;
  // location and notes are gated by config exactly as the apply step gates
  // copying them (see DECISIONS.md for why location is conditional here).
  function contentHash(event, opts) {
    opts = opts || {};
    var copyLocation = opts.copyLocation !== false; // default true
    var copyNotes = opts.copyNotes === true;        // default false
    var parts = [
      event.title || '',
      toIso(event.start),
      toIso(event.end),
      event.isAllDay ? '1' : '0',
      copyLocation ? (event.location || '') : ''
    ];
    if (copyNotes) parts.push(event.notes || '');
    return fnv1a(parts.join(SEP));
  }

  function encodeUrlTag(key) {
    return URL_PREFIX + key;
  }

  // Returns the embedded sourceKey, or null if the url is not one of ours.
  function decodeUrlTag(url) {
    if (typeof url !== 'string') return null;
    if (url.lastIndexOf(URL_PREFIX, 0) !== 0) return null;
    return url.slice(URL_PREFIX.length);
  }

  function heartbeatUrlTag() {
    return URL_PREFIX + HEARTBEAT_KEY;
  }

  function isHeartbeatTag(url) {
    return decodeUrlTag(url) === HEARTBEAT_KEY;
  }

  return {
    URL_PREFIX: URL_PREFIX,
    HEARTBEAT_KEY: HEARTBEAT_KEY,
    toIso: toIso,
    sourceKey: sourceKey,
    contentHash: contentHash,
    encodeUrlTag: encodeUrlTag,
    decodeUrlTag: decodeUrlTag,
    heartbeatUrlTag: heartbeatUrlTag,
    isHeartbeatTag: isHeartbeatTag
  };
});
