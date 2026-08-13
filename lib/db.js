// Lightweight JSON-file data store. No native/compiled dependencies,
// so it runs anywhere Node runs. Reads/writes are synchronous, which is
// fine at this scale and keeps the read-modify-write logic race-free
// within a single Node process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = { users: [], projects: [] };
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(raw);
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function id() {
  return crypto.randomUUID();
}

// ---------- Users ----------

function findUserByEmail(email) {
  const db = load();
  return db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) || null;
}

function findUserByUsername(username) {
  const db = load();
  return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null;
}

function findUserById(userId) {
  const db = load();
  return db.users.find((u) => u.id === userId) || null;
}

function createUser({ username, email, passwordHash, displayName, bio }) {
  const db = load();
  const user = {
    id: id(),
    username,
    email,
    passwordHash,
    displayName: displayName || username,
    bio: bio || '',
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  save(db);
  return user;
}

// ---------- Projects ----------

function getAllProjects() {
  return load().projects;
}

function getPublishedProjects() {
  return load()
    .projects.filter((p) => p.published)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getProjectById(projectId) {
  const db = load();
  return db.projects.find((p) => p.id === projectId) || null;
}

function getProjectsByUser(userId) {
  return load()
    .projects.filter((p) => p.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function createProject({ userId, title, summary, description, imageUrl, tags, repoUrl, liveUrl, published }) {
  const db = load();
  const project = {
    id: id(),
    userId,
    title,
    summary: summary || '',
    description: description || '',
    imageUrl: imageUrl || '',
    tags: Array.isArray(tags) ? tags : [],
    repoUrl: repoUrl || '',
    liveUrl: liveUrl || '',
    published: Boolean(published),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.projects.push(project);
  save(db);
  return project;
}

function updateProject(projectId, updates) {
  const db = load();
  const idx = db.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) return null;
  db.projects[idx] = {
    ...db.projects[idx],
    ...updates,
    id: db.projects[idx].id,
    userId: db.projects[idx].userId,
    createdAt: db.projects[idx].createdAt,
    updatedAt: new Date().toISOString(),
  };
  save(db);
  return db.projects[idx];
}

function deleteProject(projectId) {
  const db = load();
  const before = db.projects.length;
  db.projects = db.projects.filter((p) => p.id !== projectId);
  save(db);
  return db.projects.length < before;
}

module.exports = {
  findUserByEmail,
  findUserByUsername,
  findUserById,
  createUser,
  getAllProjects,
  getPublishedProjects,
  getProjectById,
  getProjectsByUser,
  createProject,
  updateProject,
  deleteProject,
};
