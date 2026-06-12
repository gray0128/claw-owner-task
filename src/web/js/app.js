import { api, updateConfig, getConfig, isAuthenticated, DEFAULT_API_URL } from './api.js';

const ui = {
  loginScreen: document.getElementById('loginScreen'),
  appScreen: document.getElementById('appScreen'),
  oauthError: document.getElementById('oauthError'),
  apiKeyForm: document.getElementById('apiKeyForm'),
  apiKey: document.getElementById('apiKey'),
  apiUrl: document.getElementById('apiUrl'),
  githubLoginBtn: document.getElementById('githubLoginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  userInfoSection: document.getElementById('userInfoSection'),
  userAvatar: document.getElementById('userAvatar'),
  username: document.getElementById('username'),
  systemMeta: document.getElementById('systemMeta'),
  statPending: document.getElementById('statPending'),
  statProgress: document.getElementById('statProgress'),
  statCompleted: document.getElementById('statCompleted'),
  statTotal: document.getElementById('statTotal'),
  addTaskForm: document.getElementById('addTaskForm'),
  taskTitle: document.getElementById('taskTitle'),
  taskDesc: document.getElementById('taskDesc'),
  taskPriority: document.getElementById('taskPriority'),
  taskCategory: document.getElementById('taskCategory'),
  taskTags: document.getElementById('taskTags'),
  taskDueDate: document.getElementById('taskDueDate'),
  taskRemindAt: document.getElementById('taskRemindAt'),
  tasksContainer: document.getElementById('tasksContainer'),
  searchQ: document.getElementById('searchQ'),
  filterStatus: document.getElementById('filterStatus'),
  filterPriority: document.getElementById('filterPriority'),
  filterCategory: document.getElementById('filterCategory'),
  refreshBtn: document.getElementById('refreshBtn'),
  categoriesList: document.getElementById('categoriesList'),
  tagsList: document.getElementById('tagsList'),
  addCategoryForm: document.getElementById('addCategoryForm'),
  categoryName: document.getElementById('categoryName'),
  categoryColor: document.getElementById('categoryColor'),
  addTagForm: document.getElementById('addTagForm'),
  tagName: document.getElementById('tagName'),
  editModal: document.getElementById('editModal'),
  editTaskForm: document.getElementById('editTaskForm'),
  editTaskId: document.getElementById('editTaskId'),
  editTaskTitle: document.getElementById('editTaskTitle'),
  editTaskDesc: document.getElementById('editTaskDesc'),
  editTaskPriority: document.getElementById('editTaskPriority'),
  editTaskStatus: document.getElementById('editTaskStatus'),
  editTaskCategory: document.getElementById('editTaskCategory'),
  editTaskTags: document.getElementById('editTaskTags'),
  editTaskDueDate: document.getElementById('editTaskDueDate'),
  editTaskRemindAt: document.getElementById('editTaskRemindAt'),
  toastContainer: document.getElementById('toastContainer'),
};

let systemInfo = null;
let systemTimezone = 'Asia/Shanghai';
let searchDebounce = null;

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  ui.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showScreen(authenticated) {
  ui.loginScreen.hidden = authenticated;
  ui.appScreen.hidden = !authenticated;
}

function updateLoginUI() {
  const savedUsername = localStorage.getItem('GITHUB_USERNAME');
  const savedAvatar = localStorage.getItem('GITHUB_AVATAR');

  if (savedUsername && savedAvatar) {
    ui.userAvatar.src = savedAvatar;
    ui.userAvatar.alt = savedUsername;
    ui.username.textContent = savedUsername;
    ui.userInfoSection.hidden = false;
  } else {
    ui.userInfoSection.hidden = true;
  }
}

function parseOAuthApiKey() {
  const query = new URLSearchParams(window.location.search);
  const hash = window.location.hash.slice(1);

  if (hash.startsWith('api_key=')) {
    return decodeURIComponent(hash.slice('api_key='.length));
  }
  if (hash) {
    const fromHash = new URLSearchParams(hash).get('api_key');
    if (fromHash) return fromHash;
  }
  return query.get('api_key');
}

function handleOAuthCallback() {
  const query = new URLSearchParams(window.location.search);
  const oauthError = query.get('oauth_error');
  if (oauthError) {
    ui.oauthError.textContent = decodeURIComponent(oauthError);
    ui.oauthError.hidden = false;
    window.history.replaceState({}, document.title, window.location.pathname);
    return false;
  }

  const apiKey = parseOAuthApiKey();
  if (!apiKey) return false;

  updateConfig(DEFAULT_API_URL, apiKey);

  const username = query.get('username');
  const avatar = query.get('avatar');
  if (username) localStorage.setItem('GITHUB_USERNAME', username);
  if (avatar) localStorage.setItem('GITHUB_AVATAR', avatar);

  window.history.replaceState({}, document.title, window.location.pathname);
  toast(`欢迎回来，${username || '用户'}！`, 'success');
  return true;
}

function toDatetimeLocalValue(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

function fromDatetimeLocalValue(val) {
  if (!val) return null;
  return new Date(val).toISOString();
}

function parseTagsInput(str) {
  if (!str || !str.trim()) return undefined;
  return str.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: systemTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function isOverdue(task) {
  if (!task.due_date || task.status === 'completed' || task.status === 'cancelled') return false;
  return new Date(task.due_date) < new Date();
}

function populateCategorySelects(categories) {
  const selects = [ui.taskCategory, ui.editTaskCategory, ui.filterCategory];
  selects.forEach((sel, idx) => {
    const current = sel.value;
    const isFilter = sel === ui.filterCategory;
    sel.innerHTML = isFilter
      ? '<option value="">全部分类</option>'
      : '<option value="">无分类</option>';
    (categories || []).forEach((cat) => {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  });
}

function renderCategoriesList(categories) {
  if (!categories?.length) {
    ui.categoriesList.innerHTML = '<li class="empty-hint">暂无分类</li>';
    return;
  }
  ui.categoriesList.innerHTML = categories.map((cat) => `
    <li>
      <span class="meta-name">
        <span class="color-dot" style="background:${escapeHtml(cat.color || '#3b82f6')}"></span>
        ${escapeHtml(cat.name)}
      </span>
      <button type="button" data-action="delete-category" data-id="${cat.id}">删除</button>
    </li>
  `).join('');
}

function renderTagsList(tags) {
  if (!tags?.length) {
    ui.tagsList.innerHTML = '<li class="empty-hint">暂无标签</li>';
    return;
  }
  ui.tagsList.innerHTML = tags.map((tag) => `
    <li>
      <span class="meta-name">#${escapeHtml(tag.name)}</span>
      <button type="button" data-action="delete-tag" data-id="${tag.id}">删除</button>
    </li>
  `).join('');
}

function updateStats(tasks) {
  const counts = { pending: 0, in_progress: 0, completed: 0, total: tasks.length };
  tasks.forEach((t) => {
    if (counts[t.status] !== undefined) counts[t.status]++;
  });
  ui.statPending.textContent = counts.pending;
  ui.statProgress.textContent = counts.in_progress;
  ui.statCompleted.textContent = counts.completed;
  ui.statTotal.textContent = counts.total;
}

async function initSystemInfo() {
  if (!isAuthenticated()) return;
  try {
    systemInfo = await api.info();
    systemTimezone = systemInfo.timezone || 'Asia/Shanghai';
    ui.systemMeta.textContent = `v${systemInfo.version} · 时区 ${systemTimezone}`;
    populateCategorySelects(systemInfo.categories);
    renderCategoriesList(systemInfo.categories);
    renderTagsList(systemInfo.tags);
  } catch (e) {
    console.error('Failed to fetch system info', e);
    toast('获取系统信息失败', 'error');
  }
}

async function loadTasks() {
  if (!isAuthenticated()) {
    showScreen(false);
    return;
  }

  ui.tasksContainer.innerHTML = '<li class="loading-state">加载中…</li>';
  try {
    const params = new URLSearchParams();
    const q = ui.searchQ.value.trim();
    const status = ui.filterStatus.value;
    const priority = ui.filterPriority.value;
    const categoryId = ui.filterCategory.value;

    if (q) params.append('q', q);
    if (status) params.append('status', status);
    if (priority) params.append('priority', priority);
    if (categoryId) params.append('category_id', categoryId);

    const query = params.toString() ? `?${params.toString()}` : '';
    const tasks = await api.tasks.list(query);

    updateStats(tasks);
    ui.tasksContainer.innerHTML = '';

    if (tasks.length === 0) {
      ui.tasksContainer.innerHTML = '<li class="empty-state">暂无任务，创建一条开始吧</li>';
      return;
    }

    tasks.forEach((task) => {
      const li = document.createElement('li');
      const overdue = isOverdue(task);
      li.className = `task-card${task.status === 'completed' ? ' completed' : ''}${overdue ? ' overdue' : ''}`;

      const tags = Array.isArray(task.tags) ? task.tags : [];
      const tagsHtml = tags.map((t) => `<span class="badge tag">#${escapeHtml(t.name)}</span>`).join('');

      li.innerHTML = `
        <h3 class="task-title">#${task.id} ${escapeHtml(task.title)}</h3>
        <div class="badges">
          <span class="badge priority-${task.priority}">${task.priority}</span>
          <span class="badge status-${task.status}">${task.status.replace('_', ' ')}</span>
          ${task.category_name ? `<span class="badge category">${escapeHtml(task.category_name)}</span>` : ''}
          ${tagsHtml}
        </div>
        ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
        <div class="task-meta">
          ${task.due_date ? `<div class="meta-item${overdue ? ' overdue' : ''}">📅 截止：${formatDate(task.due_date)}${overdue ? '（已逾期）' : ''}</div>` : ''}
          ${task.remind_at ? `<div class="meta-item">⏰ 提醒：${formatDate(task.remind_at)}</div>` : ''}
          ${task.completed_at ? `<div class="meta-item">✅ 完成：${formatDate(task.completed_at)}</div>` : ''}
          <div class="meta-item">🕒 创建：${formatDate(task.created_at)}</div>
        </div>
        <div class="task-actions">
          ${task.status !== 'completed' ? `<button class="btn-complete" data-action="complete" data-id="${task.id}">完成</button>` : ''}
          <button class="btn-edit" data-action="edit" data-id="${task.id}">编辑</button>
          <button class="btn-delete" data-action="delete" data-id="${task.id}">删除</button>
        </div>
      `;
      ui.tasksContainer.appendChild(li);
    });
  } catch (err) {
    ui.tasksContainer.innerHTML = `<li class="empty-state" style="color:var(--danger)">加载失败：${escapeHtml(err.message)}</li>`;
    if (err.message.includes('Unauthorized')) {
      updateConfig(getConfig().url, '');
      showScreen(false);
      toast('登录已失效，请重新登录', 'error');
    }
  }
}

function openEditModal(task) {
  ui.editTaskId.value = task.id;
  ui.editTaskTitle.value = task.title;
  ui.editTaskDesc.value = task.description || '';
  ui.editTaskPriority.value = task.priority;
  ui.editTaskStatus.value = task.status;
  ui.editTaskCategory.value = task.category_id || '';
  const tags = Array.isArray(task.tags) ? task.tags.map((t) => t.name).join(', ') : '';
  ui.editTaskTags.value = tags;
  ui.editTaskDueDate.value = toDatetimeLocalValue(task.due_date);
  ui.editTaskRemindAt.value = toDatetimeLocalValue(task.remind_at);
  ui.editModal.hidden = false;
}

function closeEditModal() {
  ui.editModal.hidden = true;
}

async function bootstrap() {
  const config = getConfig();
  ui.apiUrl.value = config.url || DEFAULT_API_URL;

  const oauthHandled = handleOAuthCallback();

  if (isAuthenticated()) {
    showScreen(true);
    updateLoginUI();
    try {
      await initSystemInfo();
      await loadTasks();
    } catch (err) {
      updateConfig(DEFAULT_API_URL, '');
      showScreen(false);
      ui.oauthError.textContent = oauthHandled
        ? `GitHub 登录后验证失败：${err.message}`
        : `登录已失效：${err.message}`;
      ui.oauthError.hidden = false;
    }
  } else {
    showScreen(false);
  }
}

// Event listeners
ui.apiKeyForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  updateConfig(ui.apiUrl.value, ui.apiKey.value);
  localStorage.removeItem('GITHUB_USERNAME');
  localStorage.removeItem('GITHUB_AVATAR');
  ui.oauthError.hidden = true;

  try {
    await initSystemInfo();
    showScreen(true);
    updateLoginUI();
    toast('登录成功', 'success');
    await loadTasks();
  } catch {
    updateConfig(ui.apiUrl.value, '');
    toast('API Key 无效，请检查后重试', 'error');
  }
});

ui.githubLoginBtn.addEventListener('click', () => {
  updateConfig(DEFAULT_API_URL, getConfig().key);
  window.location.href = `${DEFAULT_API_URL}/auth/github/login`;
});

ui.logoutBtn.addEventListener('click', async () => {
  updateConfig(getConfig().url, '');
  localStorage.removeItem('GITHUB_USERNAME');
  localStorage.removeItem('GITHUB_AVATAR');
  showScreen(false);
  ui.apiKey.value = '';
  toast('已退出登录');
});

ui.addTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = ui.addTaskForm.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await api.tasks.create({
      title: ui.taskTitle.value.trim(),
      description: ui.taskDesc.value.trim(),
      priority: ui.taskPriority.value,
      category_id: ui.taskCategory.value ? Number(ui.taskCategory.value) : null,
      tags: parseTagsInput(ui.taskTags.value),
      due_date: fromDatetimeLocalValue(ui.taskDueDate.value),
      remind_at: fromDatetimeLocalValue(ui.taskRemindAt.value),
    });
    ui.addTaskForm.reset();
    toast('任务已创建', 'success');
    await loadTasks();
    await initSystemInfo();
  } catch (err) {
    toast(`创建失败：${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

ui.tasksContainer.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'complete') {
    try {
      await api.tasks.complete(id);
      toast('任务已完成', 'success');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  } else if (action === 'edit') {
    try {
      const task = await api.tasks.get(id);
      openEditModal(task);
    } catch (err) {
      toast(err.message, 'error');
    }
  } else if (action === 'delete') {
    if (!confirm('确定删除此任务？')) return;
    try {
      await api.tasks.delete(id);
      toast('任务已删除', 'success');
      loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
});

ui.editTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = ui.editTaskId.value;
  try {
    await api.tasks.update(id, {
      title: ui.editTaskTitle.value.trim(),
      description: ui.editTaskDesc.value.trim(),
      priority: ui.editTaskPriority.value,
      status: ui.editTaskStatus.value,
      category_id: ui.editTaskCategory.value ? Number(ui.editTaskCategory.value) : null,
      tags: parseTagsInput(ui.editTaskTags.value),
      due_date: fromDatetimeLocalValue(ui.editTaskDueDate.value),
      remind_at: fromDatetimeLocalValue(ui.editTaskRemindAt.value),
    });
    closeEditModal();
    toast('任务已更新', 'success');
    loadTasks();
  } catch (err) {
    toast(`更新失败：${err.message}`, 'error');
  }
});

ui.editModal.querySelector('.modal-close').addEventListener('click', closeEditModal);
ui.editModal.querySelector('.modal-cancel').addEventListener('click', closeEditModal);
ui.editModal.querySelector('.modal-backdrop').addEventListener('click', closeEditModal);

ui.addCategoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.categories.create({
      name: ui.categoryName.value.trim(),
      color: ui.categoryColor.value,
    });
    ui.categoryName.value = '';
    toast('分类已创建', 'success');
    await initSystemInfo();
  } catch (err) {
    toast(err.message, 'error');
  }
});

ui.addTagForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.tags.create({ name: ui.tagName.value.trim() });
    ui.tagName.value = '';
    toast('标签已创建', 'success');
    await initSystemInfo();
  } catch (err) {
    toast(err.message, 'error');
  }
});

ui.categoriesList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-category"]');
  if (!btn) return;
  if (!confirm('确定删除此分类？')) return;
  try {
    await api.categories.delete(btn.dataset.id);
    toast('分类已删除', 'success');
    await initSystemInfo();
  } catch (err) {
    toast(err.message, 'error');
  }
});

ui.tagsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action="delete-tag"]');
  if (!btn) return;
  if (!confirm('确定删除此标签？')) return;
  try {
    await api.tags.delete(btn.dataset.id);
    toast('标签已删除', 'success');
    await initSystemInfo();
  } catch (err) {
    toast(err.message, 'error');
  }
});

ui.refreshBtn.addEventListener('click', loadTasks);
ui.filterStatus.addEventListener('change', loadTasks);
ui.filterPriority.addEventListener('change', loadTasks);
ui.filterCategory.addEventListener('change', loadTasks);
ui.searchQ.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadTasks, 300);
});

bootstrap();