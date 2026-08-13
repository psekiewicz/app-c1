(function () {
  document.addEventListener('DOMContentLoaded', async () => {
    const toggle = document.querySelector('.nav-toggle');
    const links = document.querySelector('.nav-links');
    if (toggle && links) {
      toggle.addEventListener('click', () => links.classList.toggle('is-open'));
    }

    // Highlight the current page's nav link.
    const path = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-link').forEach((link) => {
      const href = link.getAttribute('href');
      if (href === path) link.classList.add('active');
    });

    const actions = document.getElementById('nav-actions');
    if (!actions) return;

    try {
      const { user } = await api.get('/api/auth/me');
      renderNavActions(actions, user);
    } catch {
      renderNavActions(actions, null);
    }
  });

  function renderNavActions(container, user) {
    if (!user) {
      container.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="/login.html">Log in</a>
        <a class="btn btn-primary btn-sm" href="/register.html">Get started</a>
      `;
      return;
    }

    container.innerHTML = `
      <a class="btn btn-ghost btn-sm" href="/dashboard.html">Dashboard</a>
      <div class="user-chip">
        <span class="avatar">${escapeHtml(initials(user.displayName || user.username))}</span>
        <span>${escapeHtml(user.username)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" id="logout-btn" type="button">Log out</button>
    `;

    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      try {
        await api.post('/api/auth/logout');
      } finally {
        window.location.href = '/index.html';
      }
    });
  }
})();
