// test/identity.test.js — pure identity + hashing + url-tag contract.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const identity = require('../lib/identity');

test('sourceKey = externalId|ISOstart, stable and normalized', () => {
  const ev = { externalId: 'X', start: '2026-07-01T09:00:00Z' };
  assert.equal(identity.sourceKey(ev), 'X|2026-07-01T09:00:00.000Z');
  // Date and equivalent string yield the same key.
  assert.equal(
    identity.sourceKey({ externalId: 'X', start: new Date('2026-07-01T09:00:00Z') }),
    identity.sourceKey(ev)
  );
});

test('recurring occurrences get distinct keys by start', () => {
  const a = identity.sourceKey({ externalId: 'R', start: '2026-07-06T08:00:00.000Z' });
  const b = identity.sourceKey({ externalId: 'R', start: '2026-07-13T08:00:00.000Z' });
  assert.notEqual(a, b);
});

test('contentHash is deterministic and 8-char hex', () => {
  const ev = { title: 'T', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T10:00:00.000Z', isAllDay: false, location: 'L' };
  const h = identity.contentHash(ev, {});
  assert.match(h, /^[0-9a-f]{8}$/);
  assert.equal(h, identity.contentHash(ev, {}));
});

test('contentHash changes when a mirrored field changes', () => {
  const base = { title: 'T', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T10:00:00.000Z', isAllDay: false, location: 'L' };
  const h = identity.contentHash(base, {});
  assert.notEqual(h, identity.contentHash({ ...base, title: 'T2' }, {}));
  assert.notEqual(h, identity.contentHash({ ...base, end: '2026-07-01T11:00:00.000Z' }, {}));
  assert.notEqual(h, identity.contentHash({ ...base, isAllDay: true }, {}));
});

test('location is in the hash only when copyLocation is on', () => {
  const a = { title: 'T', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T10:00:00.000Z', isAllDay: false, location: 'Room A' };
  const b = { ...a, location: 'Room B' };
  // copyLocation default true -> location matters
  assert.notEqual(identity.contentHash(a, {}), identity.contentHash(b, {}));
  // copyLocation false -> location ignored, hashes match
  assert.equal(
    identity.contentHash(a, { copyLocation: false }),
    identity.contentHash(b, { copyLocation: false })
  );
});

test('notes are in the hash only when copyNotes is on', () => {
  const a = { title: 'T', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T10:00:00.000Z', isAllDay: false, location: '', notes: 'secret' };
  const b = { ...a, notes: 'other' };
  assert.equal(identity.contentHash(a, {}), identity.contentHash(b, {}));
  assert.notEqual(
    identity.contentHash(a, { copyNotes: true }),
    identity.contentHash(b, { copyNotes: true })
  );
});

test('url tag encode/decode round-trips', () => {
  const key = 'A1|2026-07-01T09:00:00.000Z';
  const tag = identity.encodeUrlTag(key);
  assert.equal(tag, 'x-eccl-sync:A1|2026-07-01T09:00:00.000Z');
  assert.equal(identity.decodeUrlTag(tag), key);
});

test('decodeUrlTag returns null for foreign / missing urls', () => {
  assert.equal(identity.decodeUrlTag(null), null);
  assert.equal(identity.decodeUrlTag('https://example.com'), null);
  assert.equal(identity.decodeUrlTag(''), null);
});

test('heartbeat tag is recognized and excluded by key', () => {
  const tag = identity.heartbeatUrlTag();
  assert.equal(tag, 'x-eccl-sync:__heartbeat__');
  assert.equal(identity.isHeartbeatTag(tag), true);
  assert.equal(identity.decodeUrlTag(tag), identity.HEARTBEAT_KEY);
  assert.equal(identity.isHeartbeatTag('x-eccl-sync:A1|2026-07-01T09:00:00.000Z'), false);
});
