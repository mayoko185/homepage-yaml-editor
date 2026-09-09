const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');

const router = express.Router();

let LOGIN_ENABLED;
let LOGIN_USER;
let LOGIN_PASSWORD;
let SESSION_COOKIE_NAME;
let SESSION_TTL_MS;
let LOGIN_ATTEMPT_WINDOW_MS;
let MAX_LOGIN_ATTEMPTS;
let MAX_AUTH_STATE_ENTRIES;
let PUBLIC_DIR;
let sessions;
let loginAttempts;
let setBoundedMapEntry;

function init(config) {
  LOGIN_ENABLED = config.LOGIN_ENABLED;
  LOGIN_USER = config.LOGIN_USER;
  LOGIN_PASSWORD = config.LOGIN_PASSWORD;
  SESSION_COOKIE_NAME = config.SESSION_COOKIE_NAME;
  SESSION_TTL_MS = config.SESSION_TTL_MS;
  LOGIN_ATTEMPT_WINDOW_MS = config.LOGIN_ATTEMPT_WINDOW_MS;
  MAX_LOGIN_ATTEMPTS = config.MAX_LOGIN_ATTEMPTS;
  MAX_AUTH_STATE_ENTRIES = config.MAX_AUTH_STATE_ENTRIES;
  PUBLIC_DIR = config.PUBLIC_DIR;
  sessions = config.sessions;
  loginAttempts = config.loginAttempts;
  setBoundedMapEntry = config.setBoundedMapEntry;
}

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, cookiePart) => {
    const separatorIndex = cookiePart.indexOf('=');
    if (separatorIndex === -1) return cookies;
    const name = cookiePart.slice(0, separatorIndex).trim();
    const value = cookiePart.slice(separatorIndex + 1).trim();
    if (name) cookies[name] = value;
    return cookies;
  }, {});
}

function getAuthenticatedSessionToken(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (!token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function credentialsMatch(actual, expected) {
  const actualDigest = crypto.createHash('sha256').update(String(actual || '')).digest();
  const expectedDigest = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(actualDigest, expectedDigest);
}

function getLoginAttemptState(req) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || now - existing.startedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
    const state = { key, count: 0, startedAt: now };
    setBoundedMapEntry(loginAttempts, key, state, MAX_AUTH_STATE_ENTRIES);
    return state;
  }
  return { key, ...existing };
}

function isSecureRequest(req) {
  return req.secure;
}

function setSessionCookie(req, res, token) {
  const secureAttribute = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureAttribute}`
  );
}

function clearSessionCookie(req, res) {
  const secureAttribute = isSecureRequest(req) ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureAttribute}`
  );
}

router.get('/login', (req, res) => {
  if (!LOGIN_ENABLED || getAuthenticatedSessionToken(req)) {
    return res.redirect(302, '/');
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

router.post('/login', (req, res) => {
  if (!LOGIN_ENABLED) {
    return res.redirect(303, '/');
  }

  const attempt = getLoginAttemptState(req);
  if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil(
      (attempt.startedAt + LOGIN_ATTEMPT_WINDOW_MS - Date.now()) / 1000
    ));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.redirect(303, '/login?error=locked');
  }

  const validUser = credentialsMatch(req.body.username, LOGIN_USER);
  const validPassword = credentialsMatch(req.body.password, LOGIN_PASSWORD);
  if (!validUser || !validPassword) {
    setBoundedMapEntry(loginAttempts, attempt.key, {
      count: attempt.count + 1,
      startedAt: attempt.startedAt
    }, MAX_AUTH_STATE_ENTRIES);
    return res.redirect(303, '/login?error=invalid');
  }

  loginAttempts.delete(attempt.key);
  const token = crypto.randomBytes(32).toString('hex');
  setBoundedMapEntry(sessions, token, Date.now() + SESSION_TTL_MS, MAX_AUTH_STATE_ENTRIES);
  setSessionCookie(req, res, token);
  return res.redirect(303, '/');
});

router.post('/logout', (req, res) => {
  const token = getAuthenticatedSessionToken(req);
  if (token) sessions.delete(token);
  clearSessionCookie(req, res);
  return res.redirect(303, LOGIN_ENABLED ? '/login' : '/');
});

// Auth middleware — mounted after login routes so they bypass it
function authMiddleware(req, res, next) {
  if (!LOGIN_ENABLED || getAuthenticatedSessionToken(req)) {
    return next();
  }

  if (req.method === 'GET' && [
    '/styles.css',
    '/favicon.ico',
    '/theme-bootstrap.js',
    '/js/login.js'
  ].includes(req.path)) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(302, '/login');
  }
  return res.status(401).send('Authentication required');
}

module.exports = { router, init, authMiddleware };
