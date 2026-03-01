let API_URL = localStorage.getItem('TASK_API_URL') || 'http://localhost:8787/api';
let API_KEY = localStorage.getItem('TASK_API_KEY') || '';

export function updateConfig(url, key) {
  API_URL = url;
  API_KEY = key;
  localStorage.setItem('TASK_API_URL', url);
  localStorage.setItem('TASK_API_KEY', key);
}

export function getConfig() {
  return { url: API_URL, key: API_KEY };
}

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`,
    ...options.headers
  };

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Unauthorized: Please check your API Key.');
    }
    throw new Error(`API Error: ${res.status}`);
  }
  
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Unknown API Error');
  
  return json.data;
}

export const api = {
  tasks: {
    list: (query = '') => request(`/tasks${query}`),
    create: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    complete: (id) => request(`/tasks/${id}/complete`, { method: 'PUT' }),
    delete: (id) => request(`/tasks/${id}`, { method: 'DELETE' })
  }
};
