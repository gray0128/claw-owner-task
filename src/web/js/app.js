import { api, updateConfig, getConfig } from './api.js';

const ui = {
  apiKey: document.getElementById('apiKey'),
  apiUrl: document.getElementById('apiUrl'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  addTaskForm: document.getElementById('addTaskForm'),
  taskTitle: document.getElementById('taskTitle'),
  taskDesc: document.getElementById('taskDesc'),
  taskPriority: document.getElementById('taskPriority'),
  tasksContainer: document.getElementById('tasksContainer'),
  searchQ: document.getElementById('searchQ'),
  filterStatus: document.getElementById('filterStatus'),
  refreshBtn: document.getElementById('refreshBtn'),
  editModal: document.getElementById('editModal'),
  editTaskForm: document.getElementById('editTaskForm'),
  editTaskId: document.getElementById('editTaskId'),
  editTaskTitle: document.getElementById('editTaskTitle'),
  editTaskDesc: document.getElementById('editTaskDesc'),
  editTaskPriority: document.getElementById('editTaskPriority'),
  editTaskStatus: document.getElementById('editTaskStatus'),
  editModalClose: document.querySelector('.close'),
  githubLoginBtn: document.getElementById('githubLoginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  loginSection: document.getElementById('loginSection'),
  userInfoSection: document.getElementById('userInfoSection'),
  userAvatar: document.getElementById('userAvatar'),
  username: document.getElementById('username'),
};

let systemTimezone = 'Asia/Shanghai';

// Initialize settings
const config = getConfig();
ui.apiKey.value = config.key;
ui.apiUrl.value = config.url;

// Check for OAuth callback parameters
const urlParams = new URLSearchParams(window.location.search);
const apiKey = urlParams.get('api_key');
const username = urlParams.get('username');
const avatar = urlParams.get('avatar');

if (apiKey) {
  updateConfig(config.url, apiKey);
  if (username) localStorage.setItem('GITHUB_USERNAME', username);
  if (avatar) localStorage.setItem('GITHUB_AVATAR', avatar);
  // Clear query parameters
  window.history.replaceState({}, document.title, window.location.pathname);
  ui.apiKey.value = apiKey;
  initSystemInfo().then(loadTasks);
}

// Update login UI
function updateLoginUI() {
  const hasKey = !!getConfig().key;
  const savedUsername = localStorage.getItem('GITHUB_USERNAME');
  const savedAvatar = localStorage.getItem('GITHUB_AVATAR');

  if (hasKey && savedUsername) {
    ui.loginSection.style.display = 'none';
    ui.userInfoSection.style.display = 'block';
    ui.username.textContent = savedUsername;
    ui.userAvatar.src = savedAvatar;
  } else {
    ui.loginSection.style.display = 'block';
    ui.userInfoSection.style.display = 'none';
  }
}

// Call on init
updateLoginUI();

async function initSystemInfo() {
  if (getConfig().key) {
    try {
      const info = await api.info();
      if (info.timezone) systemTimezone = info.timezone;
    } catch (e) { console.error('Failed to fetch system info', e); }
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: systemTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  } catch (e) {
    return dateStr;
  }
}

ui.saveSettingsBtn.addEventListener('click', async () => {
  updateConfig(ui.apiUrl.value, ui.apiKey.value);
  localStorage.removeItem('GITHUB_USERNAME');
  localStorage.removeItem('GITHUB_AVATAR');
  await initSystemInfo();
  updateLoginUI();
  alert('Settings saved!');
  loadTasks();
});

// GitHub login
ui.githubLoginBtn.addEventListener('click', () => {
  const apiUrl = getConfig().url;
  window.location.href = `${apiUrl}/auth/github/login`;
});

// Logout
ui.logoutBtn.addEventListener('click', () => {
  updateConfig(getConfig().url, '');
  localStorage.removeItem('GITHUB_USERNAME');
  localStorage.removeItem('GITHUB_AVATAR');
  updateLoginUI();
  loadTasks();
});

// Load tasks
async function loadTasks() {
  if (!getConfig().key) {
    ui.tasksContainer.innerHTML = '<li>Please configure your API Key.</li>';
    return;
  }

  ui.tasksContainer.innerHTML = '<li>Loading...</li>';
  try {
    const q = ui.searchQ.value;
    const status = ui.filterStatus.value;
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (status) params.append('status', status);
    
    const query = params.toString() ? `?${params.toString()}` : '';
    const tasks = await api.tasks.list(query);
    
    ui.tasksContainer.innerHTML = '';
    if (tasks.length === 0) {
      ui.tasksContainer.innerHTML = '<li>No tasks found.</li>';
      return;
    }

    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-card ${task.status === 'completed' ? 'completed' : ''}`;
      
      const tagsHtml = task.tags ? task.tags.map(t => `<span class="badge tag">#${t.name}</span>`).join('') : '';
      
      li.innerHTML = `
        <div class="task-header">
          <h3 class="task-title">#${task.id} ${task.title}</h3>
        </div>
        <div class="badges">
          <span class="badge priority-${task.priority}">${task.priority}</span>
          <span class="badge status-${task.status}">${task.status.replace('_', ' ')}</span>
          ${task.category_name ? `<span class="badge category">${task.category_name}</span>` : ''}
          ${tagsHtml}
        </div>
        ${task.description ? `<div class="task-desc">${task.description}</div>` : ''}
        <div class="task-meta">
          ${task.due_date ? `<div class="meta-item"><span class="meta-icon">📅</span> <span>Due: ${formatDate(task.due_date)}</span></div>` : ''}
          ${task.remind_at ? `<div class="meta-item"><span class="meta-icon">⏰</span> <span>Remind: ${formatDate(task.remind_at)}</span></div>` : ''}
          ${task.completed_at ? `<div class="meta-item" style="color: #10b981;"><span class="meta-icon">✅</span> <span>Completed: ${formatDate(task.completed_at)}</span></div>` : ''}
          <div class="meta-item"><span class="meta-icon">🕒</span> <span>Created: ${formatDate(task.created_at)}</span></div>
        </div>
        <div class="task-actions">
          ${task.status !== 'completed' ? `<button class="btn-complete" data-id="${task.id}">Complete</button>` : ''}
          <button class="btn-edit" data-id="${task.id}">Edit</button>
          <button class="btn-delete" data-id="${task.id}">Delete</button>
        </div>
      `;
      ui.tasksContainer.appendChild(li);
    });

  } catch (err) {
    ui.tasksContainer.innerHTML = `<li style="color: red;">Error: ${err.message}</li>`;
  }
}

// Add task
ui.addTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api.tasks.create({
      title: ui.taskTitle.value,
      description: ui.taskDesc.value,
      priority: ui.taskPriority.value
    });
    ui.addTaskForm.reset();
    loadTasks();
  } catch (err) {
    alert(`Failed to create task: ${err.message}`);
  }
});

// Handle complete/delete/edit clicks
ui.tasksContainer.addEventListener('click', async (e) => {
  if (e.target.classList.contains('btn-complete')) {
    const id = e.target.getAttribute('data-id');
    try {
      await api.tasks.complete(id);
      loadTasks();
    } catch (err) {
      alert(err.message);
    }
  } else if (e.target.classList.contains('btn-edit')) {
    const id = e.target.getAttribute('data-id');
    // Fetch task details and open modal
    try {
      const tasks = await api.tasks.list(`?id=${id}`);
      const task = tasks[0];
      if (task) {
        ui.editTaskId.value = task.id;
        ui.editTaskTitle.value = task.title;
        ui.editTaskDesc.value = task.description || '';
        ui.editTaskPriority.value = task.priority;
        ui.editTaskStatus.value = task.status;
        ui.editModal.style.display = 'block';
      }
    } catch (err) {
      alert(err.message);
    }
  } else if (e.target.classList.contains('btn-delete')) {
    const id = e.target.getAttribute('data-id');
    if (confirm('Are you sure?')) {
      try {
        await api.tasks.delete(id);
        loadTasks();
      } catch (err) {
        alert(err.message);
      }
    }
  }
});

// Close modal when clicking X
ui.editModalClose.addEventListener('click', () => {
  ui.editModal.style.display = 'none';
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
  if (e.target === ui.editModal) {
    ui.editModal.style.display = 'none';
  }
});

// Handle edit form submit
ui.editTaskForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = ui.editTaskId.value;
  try {
    await api.tasks.update(id, {
      title: ui.editTaskTitle.value,
      description: ui.editTaskDesc.value,
      priority: ui.editTaskPriority.value,
      status: ui.editTaskStatus.value
    });
    ui.editModal.style.display = 'none';
    loadTasks();
  } catch (err) {
    alert(`Failed to update task: ${err.message}`);
  }
});

// Refresh triggers
ui.refreshBtn.addEventListener('click', loadTasks);
ui.filterStatus.addEventListener('change', loadTasks);

// Initial load
if (getConfig().key) {
  initSystemInfo().then(loadTasks);
}
