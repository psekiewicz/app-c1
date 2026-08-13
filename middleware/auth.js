// Blocks unauthenticated API requests.
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'You must be logged in to do that.' });
  }
  next();
}

// Blocks unauthenticated page requests by redirecting to the login page
// (server-side guard; the client also self-checks via /api/auth/me).
function requirePageAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

module.exports = { requireAuth, requirePageAuth };
