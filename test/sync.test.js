// test/sync.test.js — orchestration core (src/main.js) against a mock adapter.
//
// Proves the dry-run path computes a plan without writing, and the apply path
// drives create/update/delete + heartbeat through the adapter. No Mac needed.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../src/main');
const identity = require('../lib/identity');

const config = { copyLocation: true, copyNotes: false };

// A mock adapter that records every write call.
function mockAdapter(sourceEvents, destEvents) {
  const calls = { create: [], update: [], delete: [], heartbeat: 0 };
  return {
    calls,
    readSourceEvents: () => sourceEvents,
    readDestDescriptors: () =>
      destEvents
        .map((e) => ({ url: e.url, ev: e }))
        .filter((x) => {
          const key = identity.decodeUrlTag(x.url);
          return key != null && key !== identity.HEARTBEAT_KEY;
        })
        .map((x) => ({
          key: identity.decodeUrlTag(x.url),
          hash: identity.contentHash(x.ev, config),
          eventRef: x.ev
        })),
    createEvent: (fields) => calls.create.push(fields),
    updateEvent: (ref, fields) => calls.update.push({ ref, fields }),
    deleteEvent: (ref) => calls.delete.push(ref),
    writeHeartbeat: () => { calls.heartbeat += 1; }
  };
}

const source = [
  { externalId: 'A1', title: 'Standup', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T09:15:00.000Z', isAllDay: false, location: 'Room 1' },
  { externalId: 'C3', title: 'New', start: '2026-07-05T14:00:00.000Z', end: '2026-07-05T15:00:00.000Z', isAllDay: false, location: '' }
];
const dest = [
  // matches A1 but with a different end -> update
  { url: 'x-eccl-sync:A1|2026-07-01T09:00:00.000Z', title: 'Standup', start: '2026-07-01T09:00:00.000Z', end: '2026-07-01T09:30:00.000Z', isAllDay: false, location: 'Room 1' },
  // stale mirror -> delete
  { url: 'x-eccl-sync:Z9|2026-07-02T12:00:00.000Z', title: 'Gone', start: '2026-07-02T12:00:00.000Z', end: '2026-07-02T13:00:00.000Z', isAllDay: false, location: '' },
  // heartbeat -> ignored
  { url: 'x-eccl-sync:__heartbeat__', title: 'Ecclesia sync · 09:05 · mac', start: '2026-06-29T00:00:00.000Z', end: '2026-06-30T00:00:00.000Z', isAllDay: true, location: '' }
];

test('buildPlan computes create/update/delete from adapter reads', () => {
  const adapter = mockAdapter(source, dest);
  const plan = core.buildPlan(adapter, config);
  assert.deepEqual(plan.create.map((c) => c.key), ['C3|2026-07-05T14:00:00.000Z']);
  assert.deepEqual(plan.update.map((u) => u.source.key), ['A1|2026-07-01T09:00:00.000Z']);
  assert.deepEqual(plan.delete.map((d) => d.key), ['Z9|2026-07-02T12:00:00.000Z']);
});

test('dry-run computes a plan and writes nothing', () => {
  const adapter = mockAdapter(source, dest);
  const result = core.runSync(adapter, config, { dryRun: true });
  assert.equal(result.applied, false);
  assert.deepEqual(result.counts, { created: 1, updated: 1, deleted: 1 });
  assert.deepEqual(adapter.calls, { create: [], update: [], delete: [], heartbeat: 0 });
});

test('apply drives create/update/delete and writes the heartbeat once', () => {
  const adapter = mockAdapter(source, dest);
  const result = core.runSync(adapter, config, {});
  assert.equal(result.applied, true);
  assert.equal(adapter.calls.create.length, 1);
  assert.equal(adapter.calls.update.length, 1);
  assert.equal(adapter.calls.delete.length, 1);
  assert.equal(adapter.calls.heartbeat, 1);
  assert.equal(adapter.calls.create[0].externalId, 'C3');
});

test('idempotent: a second run with dest == source plans nothing', () => {
  const mirrored = source.map((e) => ({
    url: identity.encodeUrlTag(identity.sourceKey(e)),
    title: e.title, start: e.start, end: e.end, isAllDay: e.isAllDay, location: e.location
  }));
  const adapter = mockAdapter(source, mirrored);
  const result = core.runSync(adapter, config, {});
  assert.deepEqual(result.counts, { created: 0, updated: 0, deleted: 0 });
  assert.equal(adapter.calls.create.length, 0);
  assert.equal(adapter.calls.update.length, 0);
  assert.equal(adapter.calls.delete.length, 0);
});

test('formatPlan renders titles for each section', () => {
  const adapter = mockAdapter(source, dest);
  const plan = core.buildPlan(adapter, config);
  const text = core.formatPlan(plan);
  assert.match(text, /create: 1/);
  assert.match(text, /New/);
  assert.match(text, /update: 1/);
  assert.match(text, /delete: 1/);
});
