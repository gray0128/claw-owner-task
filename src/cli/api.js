import fs from 'fs';
import path from 'path';

const API_URL = process.env.TASK_API_URL || 'http://localhost:8787/api';

async function request(endpoint, options = {}) {
  const API_KEY = process.env.TASK_API_KEY;

  if (!API_KEY) {
    console.error('\n[Error] TASK_API_KEY environment variable is not set.');
    console.error('Please configure it before using the CLI.\n');
    process.exit(1);
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
      console.error(`\n[Offline] Cannot connect to API at ${API_URL}. Please check your network or server status.\n`);
    } else {
      console.error(`\n[Request Failed] ${error.message}\n`);
    }
    process.exit(1);
  }
}

export const api = {
  info: () => request('/info'),
  tasks: {
    list: (query = '') => request(`/tasks${query}`),
    create: (data) => request('/tasks', { method: 'POST', body: JSON.stringify(data) }),
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
