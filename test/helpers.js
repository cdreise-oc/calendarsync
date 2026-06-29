// test/helpers.js — turn fixture events into reconcile descriptors the same way
// the EventKit adapter does, so fixtures exercise identity + reconcile together.

'use strict';

const identity = require('../lib/identity');

// Source descriptor: key from sourceKey, hash over mirrored fields.
function describeSource(events, config) {
  return events.map((e) => ({
    key: identity.sourceKey(e),
    hash: identity.contentHash(e, config),
    fields: e
  }));
}

// Dest descriptor: key parsed from the url tag; non-tagged events and the
// heartbeat are dropped (exactly what readDestDescriptors does on a Mac).
function describeDest(events, config) {
  const out = [];
  for (const e of events) {
    const key = identity.decodeUrlTag(e.url);
    if (key == null) continue;
    if (key === identity.HEARTBEAT_KEY) continue;
    out.push({ key, hash: identity.contentHash(e, config), eventRef: e });
  }
  return out;
}

module.exports = { describeSource, describeDest };
