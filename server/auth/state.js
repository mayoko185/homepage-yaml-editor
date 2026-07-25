function removeOldestMapEntry(map) {
  const oldestKey = map.keys().next().value;
  if (oldestKey !== undefined) map.delete(oldestKey);
}

function setBoundedMapEntry(map, key, value, maxEntries) {
  if (!map.has(key) && map.size >= maxEntries) removeOldestMapEntry(map);
  map.set(key, value);
}

function pruneExpiredAuthState({ sessions, loginAttempts, loginAttemptWindowMs, now = Date.now() }) {
  for (const [token, expiresAt] of sessions) {
    if (expiresAt <= now) sessions.delete(token);
  }
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.startedAt >= loginAttemptWindowMs) loginAttempts.delete(key);
  }
}

module.exports = { pruneExpiredAuthState, setBoundedMapEntry };
