# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies (pure JS, no native compilation needed)
npm start          # run the server at http://localhost:3000
npm run dev         # run with --watch (auto-restart on file changes)
```

There is no build step, bundler, linter config, or test suite in this repo — the frontend is served as-is from `public/`.

To exercise the API manually (useful for verifying auth/ownership changes), use `curl` with a cookie jar, e.g.:

```bash
curl -s -c /tmp/c.txt -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/auth/register \
  -d '{"username":"test","email":"test@example.com","password":"password123"}'
curl -s -b /tmp/c.txt http://localhost:3000/api/auth/me
```

## Architecture

Node/Express app with server-rendered sessions and a static multi-page HTML frontend (no SPA framework, no build step).

- **`server.js`** — app entry point. Configures `express-session` (httpOnly cookies, `SESSION_SECRET` env var, secure cookies when `NODE_ENV=production`), mounts `/api/auth` and `/api/projects`, applies a server-side redirect guard on `/dashboard.html`, then serves `public/` as static files with a 404 fallback.
- **`lib/db.js`** — the entire data layer. Reads/writes a single JSON file (`data/db.json`, gitignored, auto-created on first run) synchronously on every call. Deliberately has no native dependencies (no `sqlite3`/`better-sqlite3`) so `npm install` never needs a compiler. All persistence goes through this module's exported functions (`findUserByEmail`, `createProject`, etc.) — nothing else touches `data/db.json` directly. If this ever needs to become a real database, this is the only file that should need to change.
- **`lib/validate.js`** — shared input validators (email/username/password shape, string cleaning/truncation) used by both route files.
- **`middleware/auth.js`** — two guards: `requireAuth` (401 JSON for API routes) and `requirePageAuth` (302 redirect to `/login.html?next=...` for the dashboard page). Both just check `req.session.userId`.
- **`routes/auth.js`** — register/login/logout/me. Passwords are hashed with `bcryptjs` (pure JS). Includes a small in-memory brute-force lockout keyed by `${ip}:${identifier}` (resets on process restart — acceptable at this scale, not a substitute for a real rate limiter in production).
- **`routes/projects.js`** — CRUD + publish toggle for projects. Every mutating route re-fetches the project and checks `existing.userId === req.session.userId` before allowing changes — ownership is enforced server-side, not just hidden in the UI. `GET /api/projects` only returns `published: true` projects; `GET /api/projects/:id` additionally allows the owner to preview their own drafts.
- **`public/`** — one `.html` file per page (`index`, `projects`, `project`, `login`, `register`, `dashboard`, `404`), each a full document that loads shared `css/style.css`, `js/api.js`, and `js/nav.js`, then does its own page-specific `fetch()` calls inline in a `<script>` at the bottom. There is intentionally no client-side router or shared templating — each page is self-contained.
- **`public/js/api.js`** — the only fetch wrapper; every page-specific script calls `api.get/post/put/patch/del`, which throws using the server's `{ error }` message on non-2xx responses. Also has `escapeHtml`/`initials`/`timeAgo` helpers used when building HTML strings client-side (always via `escapeHtml`, never raw interpolation, to avoid XSS from user-supplied project titles/descriptions).
- **`public/js/nav.js`** — runs on every page: fetches `/api/auth/me` and swaps the navbar's `#nav-actions` between logged-out (Log in/Get started) and logged-in (Dashboard/user chip/Log out) states, plus mobile nav toggle.

### Auth/session flow

Session is the single source of truth for "who is logged in" — there is no JWT or client-stored token. `req.session.userId` is set on register/login (after `session.regenerate` to prevent session fixation) and cleared via `session.destroy` on logout. Both the dashboard page route and every mutating project API route re-derive identity from the session, never from a client-supplied user id.

### Adding a new page

Copy an existing page's `<nav>`/`<footer>` markup and `<script src="/js/api.js">` + `<script src="/js/nav.js">` includes, keep IDs (`nav-actions`, `.nav-toggle`, `.nav-links`) intact so `nav.js` still wires up correctly, and add the route to the nav links across *all* pages (there's no shared header partial — it's duplicated per file by design, since this is a plain multi-page site with no templating layer).
