import fs from 'fs';
import path from 'path';

const API_URL = process.env.TASK_API_URL || 'http://localhost:8787/api';
const isJsonMode = process.argv.includes('--json');

function handleError(msg) {
  if (isJsonMode) {
    console.error(JSON.stringify({ success: false, error: msg }));
  } else {
    console.error(`\n${msg}\n`);
  }
  process.exit(1);
}

async function request(endpoint, options = {}) {
  const API_KEY = process.env.TASK_API_KEY;

  if (!API_KEY) {
    handleError('[Error] TASK_API_KEY environment variable is not set.\nPlease configure it before using the CLI.');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  };

  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: { ...headers, ...options.headers }
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`API Error (${res.status}): ${errBody}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(`API logic error: ${JSON.stringify(json.error)}`);
    }

    return json.data;
  } catch (error) {
    if (error.cause && error.cause.code === 'ECONNREFUSED') {
      handleError(`[Offline] Cannot connect to API at ${API_URL}. Please check your network or server status.`);
    } else {
      handleError(`[Request Failed] ${error.message}`);
    }
  }
}

export const api = {
  info: () => request('/info'),
  tasks: {
    list: (query = '') => request(`/tasks${query}`),
    create: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    complete: (id) => request(`/tasks/${id}/complete`, { method: 'PUT' }),
    delete: (id) => request(`/tasks/${id}`, { method: 'DELETE' })
  },
  tags: {
    list: () => request('/tags'),
    create: (name) => request('/tags', { method: 'POST', body: JSON.stringify({ name }) })
  },
  categories: {
    list: () => request('/categories'),
    create: (name, color) => request('/categories', { method: 'POST', body: JSON.stringify({ name, color }) })
  },
  remind: {
    check: (channel) => request(`/remind/check?channel=${channel}`, { method: 'POST' })
  }
};
