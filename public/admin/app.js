const adminKeyInput = document.getElementById('adminKey');
const projectNameInput = document.getElementById('projectName');
const selectedProjectEl = document.getElementById('selectedProject');
const botUsernameInput = document.getElementById('botUsername');
const buttonCodeEl = document.getElementById('buttonCode');
const copyButtonCodeBtn = document.getElementById('copyButtonCode');
const buttonStatus = document.getElementById('buttonStatus');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const createStatus = document.getElementById('createStatus');
const listStatus = document.getElementById('listStatus');
const projectsEl = document.getElementById('projects');
const KEY_MASK = '************';

function getAdminKey() {
  return adminKeyInput.value.trim();
}

function setStatus(el, message, isError = false) {
  el.textContent = message;
  el.style.color = isError ? '#b42318' : '';
}

function renderProjects(projects) {
  if (!projects.length) {
    projectsEl.innerHTML = "<div class=\"meta\">Hozircha project yo'q.</div>";
    selectedProjectEl.textContent = 'Hech biri tanlanmagan';
    selectedProjectEl.setAttribute('data-code', '');
    updateButtonCard();
    return;
  }

  projectsEl.innerHTML = projects
    .map(
      (p) => `
      <div class="project" data-name="${p.name}" data-code="${p.code}">
        <strong>${p.name}</strong>
        <div class="meta">Code: ${p.code}</div>
        <div class="meta">
          Key: <span class="key-mask" data-key="${p.key}">${KEY_MASK}</span>
          <button class="toggle-key" data-key="${p.key}" type="button">Show</button>
          <button class="copy-key" data-key="${p.key}" type="button">Copy</button>
        </div>
        <div class="meta">Active: ${p.isActive ? 'yes' : 'no'}</div>
      </div>
    `
    )
    .join('');
}

function getBotUsername() {
  return (botUsernameInput.value || '').trim().replace(/^@/, '');
}

function buildButtonCode() {
  const projectCode = selectedProjectEl.getAttribute('data-code') || '';
  const botUsername = getBotUsername();
  if (!projectCode) return 'Project tanlang';
  if (!botUsername) return 'Bot username kiriting';
  const url = `https://t.me/${botUsername}?start=${projectCode}`;
  return `<a href="${url}" target="_blank" rel="noopener">Start Verification</a>`;
}

function updateButtonCard() {
  const code = buildButtonCode();
  buttonCodeEl.textContent = code;
}

function selectProject(el) {
  const name = el.getAttribute('data-name') || '';
  const code = el.getAttribute('data-code') || '';
  selectedProjectEl.textContent = name ? `${name} (${code})` : 'Hech biri tanlanmagan';
  selectedProjectEl.setAttribute('data-code', code);

  const prev = projectsEl.querySelector('.project.selected');
  if (prev) prev.classList.remove('selected');
  el.classList.add('selected');
  updateButtonCard();
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

    const isHidden = mask.textContent.includes('*');
    mask.textContent = isHidden ? key : KEY_MASK;
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
    return;
  }

  const projectEl = event.target.closest('.project');
  if (projectEl) {
    selectProject(projectEl);
  }
});

botUsernameInput.addEventListener('input', () => updateButtonCard());
copyButtonCodeBtn.addEventListener('click', async () => {
  const code = buttonCodeEl.textContent || '';
  if (!code || code === 'Project tanlang' || code === 'Bot username kiriting') {
    setStatus(buttonStatus, 'Project va bot username kiriting.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    setStatus(buttonStatus, 'Nusxalandi.');
  } catch (err) {
    setStatus(buttonStatus, 'Nusxalashda xatolik.', true);
  }
});
