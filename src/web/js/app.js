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

// Initialize settings
const config = getConfig();
ui.apiKey.value = config.key;
ui.apiUrl.value = config.url;

ui.saveSettingsBtn.addEventListener('click', () => {
  updateConfig(ui.apiUrl.value, ui.apiKey.value);
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
        <div>
          <strong class="task-title">${task.title}</strong>
          <span style="font-size: 12px; color: #64748b; margin-left: 10px;">[${task.priority}]</span>
          ${task.description ? `<div style="font-size: 14px; margin-top: 5px;">${task.description}</div>` : ''}
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
  if (e.target.classList.contains('complete-btn')) {
    const id = e.target.getAttribute('data-id');
    try {
      await api.tasks.complete(id);
      loadTasks();
    } catch (err) {
      alert(err.message);
    }
  } else if (e.target.classList.contains('delete-btn')) {
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
  loadTasks();
}
