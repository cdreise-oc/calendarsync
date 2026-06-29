// test/reconcile.test.js — fixture-driven reconcile coverage.
//
// Each fixture in test/fixtures/ is run through the same descriptor-building the
// EventKit adapter uses, then reconcile.diff, and compared to expected keys.
// Covers: empty dest, no change, new event, changed time, deleted source,
// recurring occurrences distinct, heartbeat ignored.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reconcile = require('../lib/reconcile');
const { describeSource, describeDest } = require('./helpers');

const FIX_DIR = path.join(__dirname, 'fixtures');

function keysOf(list, pick) {
  return list.map(pick).sort();
}

for (const file of fs.readdirSync(FIX_DIR).filter((f) => f.endsWith('.json'))) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIX_DIR, file), 'utf8'));
  test(`reconcile: ${fx.name} [${file}]`, () => {
    const source = describeSource(fx.source, fx.config);
    const dest = describeDest(fx.dest, fx.config);
    const plan = reconcile.diff(source, dest);

    assert.deepEqual(keysOf(plan.create, (c) => c.key), [...fx.expected.create].sort(),
      'create keys');
    assert.deepEqual(keysOf(plan.update, (u) => u.source.key), [...fx.expected.update].sort(),
      'update keys');
    assert.deepEqual(keysOf(plan.delete, (d) => d.key), [...fx.expected.delete].sort(),
      'delete keys');
  });
}

test('reconcile: update carries both source fields and dest eventRef', () => {
  const source = [{ key: 'k', hash: 'h2', fields: { title: 'new' } }];
  const dest = [{ key: 'k', hash: 'h1', eventRef: { id: 'ref-1' } }];
  const plan = reconcile.diff(source, dest);
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].source.fields.title, 'new');
  assert.equal(plan.update[0].dest.eventRef.id, 'ref-1');
});

test('reconcile: tolerates empty/undefined inputs', () => {
  const plan = reconcile.diff();
  assert.deepEqual(plan, { create: [], update: [], delete: [] });
});

test('reconcile: skips dest entries with empty keys', () => {
  const plan = reconcile.diff(
    [{ key: 'a', hash: '1' }],
    [{ key: '', hash: 'x' }, { key: null, hash: 'y' }]
  );
  assert.deepEqual(plan.create.map((c) => c.key), ['a']);
  assert.equal(plan.delete.length, 0);
});
