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
};

let systemTimezone = 'Asia/Shanghai';

// Initialize settings
const config = getConfig();
ui.apiKey.value = config.key;
ui.apiUrl.value = config.url;

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
  await initSystemInfo();
  alert('Settings saved!');
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
      li.className = `task-item ${task.status === 'completed' ? 'completed' : ''}`;
      
      li.innerHTML = `
        <div style="flex: 1;">
          <strong class="task-title">${task.title}</strong>
          <span class="priority-badge ${task.priority}">${task.priority}</span>
          ${task.description ? `<div class="task-desc">${task.description}</div>` : ''}
          <div class="task-meta">
            <span>Due: ${formatDate(task.due_date)}</span> | 
            <span>Remind: ${formatDate(task.remind_at)}</span>
            ${task.category_name ? ` | <span>Category: ${task.category_name}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          ${task.status !== 'completed' ? `<button class="complete-btn" data-id="${task.id}">Complete</button>` : ''}
          <button class="delete-btn" data-id="${task.id}">Delete</button>
        </div>
      `;
      ui.tasksContainer.appendChild(li);
    });

  } catch (err) {
    ui.tasksContainer.innerHTML = `<li style="color: red;">Error: ${err.message}</li>`;
  }
}

// ... (previous listeners)

// Initial load
if (getConfig().key) {
  initSystemInfo().then(loadTasks);
}
