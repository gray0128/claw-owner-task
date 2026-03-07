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

// Handle complete/delete clicks
ui.tasksContainer.addEventListener('click', async (e) => {
  if (e.target.classList.contains('btn-complete')) {
    const id = e.target.getAttribute('data-id');
    try {
      await api.tasks.complete(id);
      loadTasks();
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

// Refresh triggers
ui.refreshBtn.addEventListener('click', loadTasks);
ui.filterStatus.addEventListener('change', loadTasks);

// Initial load
if (getConfig().key) {
  initSystemInfo().then(loadTasks);
}
