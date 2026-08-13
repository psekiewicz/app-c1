# Showcase

A professional, multi-page website for publishing and discovering projects, with a full working authentication system.

## Features

- **Real authentication** — registration, login, and logout backed by server-side sessions (`express-session`) and salted/hashed passwords (`bcryptjs`). No passwords or secrets are ever sent to the client.
- **Ownership-based authorization** — only a project's creator can edit, publish/unpublish, or delete it. Enforced on every API route, not just in the UI.
- **Multi-page frontend** — separate HTML documents for each view (home, project gallery, project detail, login, register, dashboard), not a single-page app.
- **Public gallery** — anyone can browse and search published projects by keyword or tag.
- **Personal dashboard** — logged-in users manage their own projects (create, edit, publish/unpublish, delete) from a dedicated dashboard.
- **Basic brute-force protection** — repeated failed logins from the same IP/identifier are temporarily locked out.

## Tech stack

- **Backend:** Node.js, Express
- **Auth:** `express-session` (server-side sessions, httpOnly cookies) + `bcryptjs` (password hashing)
- **Data:** a small JSON-file store (`lib/db.js`) — no native/compiled dependencies, so `npm install` works anywhere Node runs
- **Frontend:** plain HTML/CSS/vanilla JS (no build step, no framework)

## Getting started

```bash
npm install
npm start
```

The site is served at `http://localhost:3000`.

For development with auto-restart on file changes:

```bash
npm run dev
```

### Environment variables

| Variable         | Description                                                                 | Default (dev only)              |
| ---------------- | ----------------------------------------------------------------------------| -------------------------------- |
| `PORT`           | Port the server listens on                                                  | `3000`                           |
| `SESSION_SECRET` | Secret used to sign session cookies — **set a real random value in prod**   | insecure built-in fallback       |
| `NODE_ENV`       | Set to `production` to enable secure (HTTPS-only) cookies and proxy trust   | unset                            |

Example:

```bash
SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" npm start
```

## Project structure

```
server.js              Express app: middleware, session config, route mounting, static files
lib/db.js               JSON-file data layer (users, projects)
lib/validate.js          Shared input validation helpers
middleware/auth.js      requireAuth (API) and requirePageAuth (page redirect) guards
routes/auth.js          POST /api/auth/register, /login, /logout, GET /api/auth/me
routes/projects.js      Full CRUD + publish toggle for projects, ownership-checked
public/                 Static frontend: one .html file per page, shared css/ and js/
data/db.json            Auto-created on first run; gitignored
```

## Pages

| Page                | Path                | Access                                  |
| -------------------- | -------------------- | ---------------------------------------- |
| Home                 | `/index.html`        | Public                                   |
| Project gallery       | `/projects.html`     | Public (published projects only)         |
| Project detail        | `/project.html?id=…` | Public if published; owner can preview drafts |
| Log in               | `/login.html`        | Public                                   |
| Create account         | `/register.html`     | Public                                   |
| Dashboard             | `/dashboard.html`    | Requires login (server-side redirect guard) |

## API overview

All endpoints return JSON. Authenticated endpoints rely on the session cookie set at login/register.

- `POST /api/auth/register` — `{ username, email, password }`
- `POST /api/auth/login` — `{ identifier, password }` (identifier is email or username)
- `POST /api/auth/logout`
- `GET /api/auth/me` — current session user, or `{ user: null }`
- `GET /api/projects` — published projects, optional `?q=` and `?tag=`
- `GET /api/projects/mine` — the logged-in user's own projects (drafts included) — **auth required**
- `GET /api/projects/:id` — a single project (drafts only visible to their owner)
- `POST /api/projects` — create a project — **auth required**
- `PUT /api/projects/:id` — update a project — **auth + ownership required**
- `PATCH /api/projects/:id/publish` — `{ published: boolean }` — **auth + ownership required**
- `DELETE /api/projects/:id` — **auth + ownership required**

## Notes on the data layer

Data is stored in `data/db.json`, read and rewritten synchronously on each request. This avoids any native dependency (no `sqlite3`/`better-sqlite3` compilation step) so the app installs and runs in any Node environment. It's well suited to a personal or small-team showcase site; for higher traffic or multi-instance deployments, swap `lib/db.js` for a real database — the rest of the app only depends on the functions it exports.
