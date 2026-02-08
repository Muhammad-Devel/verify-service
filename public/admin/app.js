const adminKeyInput = document.getElementById('adminKey');
const projectNameInput = document.getElementById('projectName');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const createStatus = document.getElementById('createStatus');
const listStatus = document.getElementById('listStatus');
const projectsEl = document.getElementById('projects');

function getAdminKey() {
  return adminKeyInput.value.trim();
}

function setStatus(el, message, isError = false) {
  el.textContent = message;
  el.style.color = isError ? '#b42318' : '';
}

function renderProjects(projects) {
  if (!projects.length) {
    projectsEl.innerHTML = '<div class="meta">Hozircha project yo‘q.</div>';
    return;
  }

  projectsEl.innerHTML = projects
    .map(
      (p) => `
      <div class="project">
        <strong>${p.name}</strong>
        <div class="meta">Code: ${p.code}</div>
        <div class="meta">
          Key: <span class="key-mask" data-key="${p.key}">••••••••••••</span>
          <button class="toggle-key" data-key="${p.key}" type="button">Show</button>
          <button class="copy-key" data-key="${p.key}" type="button">Copy</button>
        </div>
        <div class="meta">Active: ${p.isActive ? 'yes' : 'no'}</div>
      </div>
    `
    )
    .join('');
}

async function createProject() {
  const adminKey = getAdminKey();
  const name = projectNameInput.value.trim();

  if (!adminKey) {
    setStatus(createStatus, 'Admin API key kiriting.', true);
    return;
  }
  if (!name) {
    setStatus(createStatus, 'Project nomini kiriting.', true);
    return;
  }

  setStatus(createStatus, 'Yaratilmoqda...');

  try {
    const res = await fetch('/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ name }),
    });

    const data = await res.json();
    if (!res.ok) {
      setStatus(createStatus, data.error || 'Xatolik yuz berdi.', true);
      return;
    }

    setStatus(
      createStatus,
      `Yaratildi. Project key: ${data.key} | Project code: ${data.code}`
    );
    projectNameInput.value = '';
    await loadProjects();
  } catch (err) {
    setStatus(createStatus, 'Tarmoq xatosi.', true);
  }
}

async function loadProjects() {
  const adminKey = getAdminKey();
  if (!adminKey) {
    setStatus(listStatus, 'Admin API key kiriting.', true);
    return;
  }

  setStatus(listStatus, 'Yuklanmoqda...');

  try {
    const res = await fetch('/projects', {
      headers: {
        'x-admin-key': adminKey,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(listStatus, data.error || 'Xatolik yuz berdi.', true);
      return;
    }
    setStatus(listStatus, '');
    renderProjects(data.projects || []);
  } catch (err) {
    setStatus(listStatus, 'Tarmoq xatosi.', true);
  }
}

createBtn.addEventListener('click', createProject);
refreshBtn.addEventListener('click', loadProjects);
projectsEl.addEventListener('click', async (event) => {
  const toggleBtn = event.target.closest('.toggle-key');
  if (toggleBtn) {
    const key = toggleBtn.getAttribute('data-key') || '';
    const mask = toggleBtn.parentElement?.querySelector('.key-mask');
    if (!mask) return;

    const isHidden = mask.textContent.includes('•');
    mask.textContent = isHidden ? key : '••••••••••••';
    toggleBtn.textContent = isHidden ? 'Hide' : 'Show';
    return;
  }

  const copyBtn = event.target.closest('.copy-key');
  if (copyBtn) {
    const key = copyBtn.getAttribute('data-key') || '';
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      copyBtn.textContent = 'Copied';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1200);
    } catch (err) {
      copyBtn.textContent = 'Failed';
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
      }, 1200);
    }
  }
});
