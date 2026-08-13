const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const { requirePageAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) {
  // Needed so `cookie.secure` works correctly behind a reverse proxy (e.g. Heroku, Render, nginx).
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

app.use(
  session({
    name: 'connect.sid',
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

if (!process.env.SESSION_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[warn] SESSION_SECRET is not set. Using an insecure default — set it before deploying.');
}

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

// Server-side guard for the dashboard page (defense in depth; the page
// also self-checks on load via /api/auth/me).
app.get('/dashboard.html', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
