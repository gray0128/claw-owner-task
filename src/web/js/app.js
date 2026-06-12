import { api, updateConfig, getConfig, isAuthenticated, reloadConfig, DEFAULT_API_URL } from './api.js';

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
  addTaskBtn: document.getElementById('addTaskBtn'),
  addTaskDrawer: document.getElementById('addTaskDrawer'),
  manageBtn: document.getElementById('manageBtn'),
  manageDrawer: document.getElementById('manageDrawer'),
  statsBar: document.getElementById('statsBar'),
  activeFilters: document.getElementById('activeFilters'),
};

let systemInfo = null;
let systemTimezone = 'Asia/Shanghai';
let searchDebounce = null;
let activeTagFilter = '';

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
  document.body.classList.toggle('is-authenticated', authenticated);
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

const STATUS_LABELS = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

const drawers = [ui.addTaskDrawer, ui.manageDrawer];

function isAnyDrawerOpen() {
  return drawers.some((d) => d && !d.hidden);
}

function openDrawer(drawer, focusSelector) {
  drawers.forEach((d) => { if (d) d.hidden = true; });
  drawer.hidden = false;
  document.body.style.overflow = 'hidden';
  if (focusSelector) {
    requestAnimationFrame(() => drawer.querySelector(focusSelector)?.focus());
  }
}

function closeDrawers() {
  drawers.forEach((d) => { if (d) d.hidden = true; });
  document.body.style.overflow = '';
}

function openAddTaskDrawer() {
  openDrawer(ui.addTaskDrawer, '#taskTitle');
}

function openManageDrawer() {
  openDrawer(ui.manageDrawer);
}

function renderCategoriesList(categories) {
  if (!categories?.length) {
    ui.categoriesList.innerHTML = '<li><span class="meta-name">暂无分类</span></li>';
    return;
  }
  ui.categoriesList.innerHTML = categories.map((cat) => `
    <li>
      <span class="meta-name">
        <span class="color-dot" style="background:${escapeHtml(cat.color || '#787774')}"></span>
        ${escapeHtml(cat.name)}
      </span>
      <button type="button" class="btn-icon" data-action="delete-category" data-id="${cat.id}" aria-label="删除">×</button>
    </li>
  `).join('');
}

function renderTagsList(tags) {
  if (!tags?.length) {
    ui.tagsList.innerHTML = '<li><span class="meta-name">暂无标签</span></li>';
    return;
  }
  ui.tagsList.innerHTML = tags.map((tag) => `
    <li>
      <span class="meta-name">${escapeHtml(tag.name)}</span>
      <button type="button" class="btn-icon" data-action="delete-tag" data-id="${tag.id}" aria-label="删除">×</button>
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

async function refreshStats() {
  try {
    const all = await api.tasks.list('');
    updateStats(all);
  } catch (e) {
    console.error('Failed to refresh stats', e);
  }
}

function syncStatusPills() {
  const status = ui.filterStatus.value;
  ui.statsBar.querySelectorAll('[data-filter-status]').forEach((el) => {
    const value = el.dataset.filterStatus;
    el.classList.toggle('active', value === status);
  });
}

function setStatusFilter(status) {
  ui.filterStatus.value = status;
  syncStatusPills();
  loadTasks();
}

function setTagFilter(tagName) {
  activeTagFilter = activeTagFilter === tagName ? '' : tagName;
  renderActiveFilters();
  loadTasks();
}

function clearAllFilters() {
  activeTagFilter = '';
  ui.filterStatus.value = '';
  ui.filterPriority.value = '';
  ui.filterCategory.value = '';
  ui.searchQ.value = '';
  syncStatusPills();
  renderActiveFilters();
  loadTasks();
}

function renderActiveFilters() {
  const chips = [];
  if (activeTagFilter) {
    chips.push(`<span class="filter-chip">标签：${escapeHtml(activeTagFilter)} <button type="button" data-action="clear-tag" aria-label="清除标签筛选">×</button></span>`);
  }
  const status = ui.filterStatus.value;
  if (status) {
    chips.push(`<span class="filter-chip">状态：${escapeHtml(STATUS_LABELS[status] || status)} <button type="button" data-action="clear-status" aria-label="清除状态筛选">×</button></span>`);
  }
  if (chips.length) {
    ui.activeFilters.innerHTML = chips.join('');
    ui.activeFilters.hidden = false;
  } else {
    ui.activeFilters.innerHTML = '';
    ui.activeFilters.hidden = true;
  }
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
    if (activeTagFilter) params.append('tag_name', activeTagFilter);

    const query = params.toString() ? `?${params.toString()}` : '';
    const tasks = await api.tasks.list(query);

    syncStatusPills();
    renderActiveFilters();
    ui.tasksContainer.innerHTML = '';

    if (tasks.length === 0) {
      ui.tasksContainer.innerHTML = '<li class="empty-state">暂无任务，创建一条开始吧</li>';
      return;
    }

    tasks.forEach((task, index) => {
      const li = document.createElement('li');
      const overdue = isOverdue(task);
      li.className = `task-row${task.status === 'completed' ? ' completed' : ''}`;
      li.style.setProperty('--i', String(index));

      const tags = Array.isArray(task.tags) ? task.tags : [];
      const lineParts = [
        `<span class="priority-dot ${task.priority}" aria-hidden="true"></span>`,
        `<span>${STATUS_LABELS[task.status] || task.status}</span>`,
      ];
      if (task.category_name) lineParts.push(`<span class="sep">·</span><span>${escapeHtml(task.category_name)}</span>`);
      if (tags.length) {
        const tagButtons = tags.map((t) => {
          const name = escapeHtml(t.name);
          const active = activeTagFilter === t.name ? ' active' : '';
          return `<button type="button" class="tag-link${active}" data-action="filter-tag" data-tag="${name}">${name}</button>`;
        }).join('');
        lineParts.push(`<span class="sep">·</span><span class="task-tags">${tagButtons}</span>`);
      }
      if (task.due_date) {
        lineParts.push(`<span class="sep">·</span><span class="${overdue ? 'overdue' : ''}">截止 ${formatDate(task.due_date)}${overdue ? ' 逾期' : ''}</span>`);
      }

      li.innerHTML = `
        <div class="task-main">
          <h3 class="task-title">${escapeHtml(task.title)}</h3>
          <div class="task-line">${lineParts.join('')}</div>
          ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ''}
        </div>
        <div class="task-actions">
          ${task.status !== 'completed' ? `<button type="button" class="btn-text" data-action="complete" data-id="${task.id}">完成</button>` : ''}
          <button type="button" class="btn-text" data-action="edit" data-id="${task.id}">编辑</button>
          <button type="button" class="btn-text" data-action="delete" data-id="${task.id}">删除</button>
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
  reloadConfig();
  const config = getConfig();
  ui.apiUrl.value = config.url || DEFAULT_API_URL;

  const oauthHandled = handleOAuthCallback();

  if (isAuthenticated()) {
    showScreen(true);
    updateLoginUI();
    try {
      await initSystemInfo();
      await Promise.all([refreshStats(), loadTasks()]);
      if (sessionStorage.getItem('oauth_just_logged_in')) {
        sessionStorage.removeItem('oauth_just_logged_in');
        const name = localStorage.getItem('GITHUB_USERNAME');
        toast(`欢迎回来，${name || '用户'}！`, 'success');
      }
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
    await Promise.all([refreshStats(), loadTasks()]);
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
    closeDrawers();
    toast('任务已创建', 'success');
    await initSystemInfo();
    await Promise.all([refreshStats(), loadTasks()]);
  } catch (err) {
    toast(`创建失败：${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

ui.tasksContainer.addEventListener('click', async (e) => {
  const tagBtn = e.target.closest('[data-action="filter-tag"]');
  if (tagBtn) {
    e.preventDefault();
    setTagFilter(tagBtn.dataset.tag);
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if (action === 'complete') {
    try {
      await api.tasks.complete(id);
      toast('任务已完成', 'success');
      Promise.all([refreshStats(), loadTasks()]);
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
      Promise.all([refreshStats(), loadTasks()]);
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
    Promise.all([refreshStats(), loadTasks()]);
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

ui.addTaskBtn.addEventListener('click', openAddTaskDrawer);
ui.manageBtn.addEventListener('click', openManageDrawer);

document.querySelectorAll('.drawer').forEach((drawer) => {
  drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="close-drawer"]')) closeDrawers();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isAnyDrawerOpen()) closeDrawers();
});

ui.statsBar.addEventListener('click', (e) => {
  const pill = e.target.closest('[data-filter-status]');
  if (!pill) return;
  setStatusFilter(pill.dataset.filterStatus);
});

ui.activeFilters.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'clear-tag') {
    activeTagFilter = '';
    renderActiveFilters();
    loadTasks();
  } else if (btn.dataset.action === 'clear-status') {
    ui.filterStatus.value = '';
    syncStatusPills();
    renderActiveFilters();
    loadTasks();
  }
});

ui.refreshBtn.addEventListener('click', async () => {
  await Promise.all([refreshStats(), loadTasks()]);
});
ui.filterStatus.addEventListener('change', () => {
  syncStatusPills();
  renderActiveFilters();
  loadTasks();
});
ui.filterPriority.addEventListener('change', loadTasks);
ui.filterCategory.addEventListener('change', loadTasks);
ui.searchQ.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadTasks, 300);
});

bootstrap();