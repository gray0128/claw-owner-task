export const DEFAULT_API_URL = `${window.location.origin}/api`;

function resolveApiUrl() {
  const stored = localStorage.getItem('TASK_API_URL');
  if (!stored) return DEFAULT_API_URL;
  try {
    if (new URL(stored).origin !== window.location.origin) {
      localStorage.setItem('TASK_API_URL', DEFAULT_API_URL);
      return DEFAULT_API_URL;
    }
    return stored;
  } catch {
    localStorage.setItem('TASK_API_URL', DEFAULT_API_URL);
    return DEFAULT_API_URL;
  }
}

let API_URL = resolveApiUrl();
let API_KEY = localStorage.getItem('TASK_API_KEY') || '';

export function updateConfig(url, key) {
  API_URL = url || DEFAULT_API_URL;
  API_KEY = key || '';
  localStorage.setItem('TASK_API_URL', API_URL);
  localStorage.setItem('TASK_API_KEY', API_KEY);
}

export function getConfig() {
  return { url: API_URL, key: API_KEY };
}

export function isAuthenticated() {
  return !!API_KEY;
}

async function request(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${API_KEY}`,
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

  if (!res.ok) {
    let message = `API Error: ${res.status}`;
    try {
      const json = await res.json();
      message = json.error?.message || message;
    } catch {
      // ignore parse errors
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error('Unauthorized: Please check your API Key.');
    }
    throw new Error(message);
  }

  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Unknown API Error');

  return json.data;
}

export const api = {
  info: () => request('/info'),
  tasks: {
    list: (query = '') => request(`/tasks${query}`),
    get: (id) => request(`/tasks/${id}`),
    create: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    complete: (id) => request(`/tasks/${id}/complete`, { method: 'PUT' }),
    delete: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  },
  categories: {
    list: () => request('/categories'),
    create: (data) => request('/categories', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id) => request(`/categories/${id}`, { method: 'DELETE' }),
  },
  tags: {
    list: () => request('/tags'),
    create: (data) => request('/tags', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id) => request(`/tags/${id}`, { method: 'DELETE' }),
  },
};