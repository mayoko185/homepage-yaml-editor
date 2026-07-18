const assert = require('node:assert/strict');
const test = require('node:test');
const { pruneExpiredAuthState, setBoundedMapEntry } = require('../auth-state');

test('bounds authentication state and evicts the oldest entry', () => {
  const state = new Map([['oldest', 1], ['newer', 2]]);
  setBoundedMapEntry(state, 'newest', 3, 2);
  assert.deepEqual([...state], [['newer', 2], ['newest', 3]]);

  setBoundedMapEntry(state, 'newer', 4, 2);
  assert.deepEqual([...state], [['newer', 4], ['newest', 3]]);
});

test('prunes expired sessions and login attempts while preserving active state', () => {
  const sessions = new Map([['expired', 999], ['active', 1001]]);
  const loginAttempts = new Map([
    ['expired', { startedAt: 800 }],
    ['active', { startedAt: 901 }]
  ]);

  pruneExpiredAuthState({ sessions, loginAttempts, loginAttemptWindowMs: 100, now: 1000 });

  assert.deepEqual([...sessions], [['active', 1001]]);
  assert.deepEqual([...loginAttempts], [['active', { startedAt: 901 }]]);
});
