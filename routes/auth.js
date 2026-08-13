const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const { isValidEmail, isValidUsername, isValidPassword, cleanString } = require('../lib/validate');

const router = express.Router();

const SALT_ROUNDS = 10;

// Very small in-memory brute-force guard: N failed attempts per key
// locks that key out for a cooldown window. Resets on process restart,
// which is an acceptable tradeoff for this app's scale.
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;
const attempts = new Map();

function attemptKey(req, identifier) {
  return `${req.ip}:${String(identifier).toLowerCase()}`;
}

function isLockedOut(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.count < MAX_ATTEMPTS) return false;
  if (Date.now() - entry.lastAttempt > LOCKOUT_MS) {
    attempts.delete(key);
    return false;
  }
  return true;
}

function recordFailure(key) {
  const entry = attempts.get(key) || { count: 0, lastAttempt: 0 };
  entry.count += 1;
  entry.lastAttempt = Date.now();
  attempts.set(key, entry);
}

function clearFailures(key) {
  attempts.delete(key);
}

function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
    bio: user.bio,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const username = cleanString(req.body.username, 24);
  const email = cleanString(req.body.email, 254);
  const password = req.body.password;
  const displayName = cleanString(req.body.displayName, 60);

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Username must be 3-24 characters: letters, numbers, "_" or "-".' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }
  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }
  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: 'That username is already taken.' });
  }

  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  const user = db.createUser({ username, email, passwordHash, displayName });

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
    res.status(201).json({ user: toPublicUser(user) });
  });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const identifier = cleanString(req.body.identifier, 254); // email or username
  const password = req.body.password;

  if (!identifier || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Please enter your email/username and password.' });
  }

  const key = attemptKey(req, identifier);
  if (isLockedOut(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Please try again in a few minutes.' });
  }

  const user = isValidEmail(identifier) ? db.findUserByEmail(identifier) : db.findUserByUsername(identifier);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    recordFailure(key);
    return res.status(401).json({ error: 'Incorrect email/username or password.' });
  }

  clearFailures(key);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Could not start a session.' });
    req.session.userId = user.id;
    res.json({ user: toPublicUser(user) });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }
  const user = db.findUserById(req.session.userId);
  if (!user) return res.json({ user: null });
  res.json({ user: toPublicUser(user) });
});

module.exports = router;
