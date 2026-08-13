const express = require('express');
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { cleanString } = require('../lib/validate');

const router = express.Router();

function isValidUrl(value) {
  if (!value) return true; // optional fields
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function toPublicProject(project) {
  const author = db.findUserById(project.userId);
  return {
    id: project.id,
    title: project.title,
    summary: project.summary,
    description: project.description,
    imageUrl: project.imageUrl,
    tags: project.tags,
    repoUrl: project.repoUrl,
    liveUrl: project.liveUrl,
    published: project.published,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    author: author ? { id: author.id, username: author.username, displayName: author.displayName } : null,
  };
}

function parseTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map((t) => cleanString(t, 30)).filter(Boolean).slice(0, 10);
  }
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => cleanString(t, 30))
      .filter(Boolean)
      .slice(0, 10);
  }
  return [];
}

function validateProjectInput(body, { partial = false } = {}) {
  const title = cleanString(body.title, 100);
  const summary = cleanString(body.summary, 200);
  const description = cleanString(body.description, 5000);
  const imageUrl = cleanString(body.imageUrl, 500);
  const repoUrl = cleanString(body.repoUrl, 500);
  const liveUrl = cleanString(body.liveUrl, 500);
  const tags = parseTags(body.tags);
  const published = Boolean(body.published);

  if (!partial || body.title !== undefined) {
    if (title.length < 3) return { error: 'Title must be at least 3 characters.' };
  }
  if (!isValidUrl(imageUrl)) return { error: 'Image URL must be a valid http(s) URL.' };
  if (!isValidUrl(repoUrl)) return { error: 'Repository URL must be a valid http(s) URL.' };
  if (!isValidUrl(liveUrl)) return { error: 'Live URL must be a valid http(s) URL.' };

  return { value: { title, summary, description, imageUrl, tags, repoUrl, liveUrl, published } };
}

// GET /api/projects - public, published only, optional ?tag= & ?q=
router.get('/', (req, res) => {
  let projects = db.getPublishedProjects();

  const tag = cleanString(req.query.tag, 30).toLowerCase();
  if (tag) {
    projects = projects.filter((p) => p.tags.some((t) => t.toLowerCase() === tag));
  }

  const q = cleanString(req.query.q, 100).toLowerCase();
  if (q) {
    projects = projects.filter(
      (p) => p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
    );
  }

  res.json({ projects: projects.map(toPublicProject) });
});

// GET /api/projects/mine - auth required, includes drafts
router.get('/mine', requireAuth, (req, res) => {
  const projects = db.getProjectsByUser(req.session.userId);
  res.json({ projects: projects.map(toPublicProject) });
});

// GET /api/projects/:id - published, or owned by the requester
router.get('/:id', (req, res) => {
  const project = db.getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  const isOwner = req.session && req.session.userId === project.userId;
  if (!project.published && !isOwner) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  res.json({ project: toPublicProject(project) });
});

// POST /api/projects - auth required
router.post('/', requireAuth, (req, res) => {
  const result = validateProjectInput(req.body);
  if (result.error) return res.status(400).json({ error: result.error });

  const project = db.createProject({ userId: req.session.userId, ...result.value });
  res.status(201).json({ project: toPublicProject(project) });
});

// PUT /api/projects/:id - auth + owner
router.put('/:id', requireAuth, (req, res) => {
  const existing = db.getProjectById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  if (existing.userId !== req.session.userId) return res.status(403).json({ error: 'You do not own this project.' });

  const result = validateProjectInput(req.body, { partial: true });
  if (result.error) return res.status(400).json({ error: result.error });

  const project = db.updateProject(existing.id, result.value);
  res.json({ project: toPublicProject(project) });
});

// PATCH /api/projects/:id/publish - auth + owner
router.patch('/:id/publish', requireAuth, (req, res) => {
  const existing = db.getProjectById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  if (existing.userId !== req.session.userId) return res.status(403).json({ error: 'You do not own this project.' });

  const project = db.updateProject(existing.id, { published: Boolean(req.body.published) });
  res.json({ project: toPublicProject(project) });
});

// DELETE /api/projects/:id - auth + owner
router.delete('/:id', requireAuth, (req, res) => {
  const existing = db.getProjectById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Project not found.' });
  if (existing.userId !== req.session.userId) return res.status(403).json({ error: 'You do not own this project.' });

  db.deleteProject(existing.id);
  res.json({ ok: true });
});

module.exports = router;
