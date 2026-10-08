import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReplayDeadline } from '../dist/esm/replay-deadline.js';

test('recording before session readiness counts toward the replay limit', () => {
  const original = Date.now;
  let now = original();
  Date.now = () => now;
  try {
    const deadline = new ReplayDeadline();
    now += 30_000;
    deadline.configure(new Date(now + 60_000).toISOString(), 60);
    assert.ok(deadline.remainingMilliseconds <= 30_000);
    now += 30_000;
    assert.throws(() => deadline.assertWithinLimit(), error => error.code === 'replay_limit_exceeded');
  } finally { Date.now = original; }
});

test('invalid limits are rejected instead of allowing an unbounded replay', () => {
  for (const limit of [0, -1, NaN, Infinity, 1801, 1.5, undefined])
    assert.throws(() => new ReplayDeadline().configure(new Date(Date.now() + 60_000).toISOString(), limit), /Invalid recording/);
});
