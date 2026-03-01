#!/usr/bin/env node

import { Command } from 'commander';
import { api } from './api.js';

const program = new Command();

program
  .name('claw-task')
  .description('Claw Owner Task CLI - A minimalist task manager for humans and AI.')
  .version('1.3.2')
  .option('--json', 'Output in JSON format for AI Agent parsing');

function formatOutput(data) {
  if (program.opts().json) {
    console.log(JSON.stringify(data, null, 2));
    return true;
  }
  return false;
}

function parseDateStr(val) {
  if (!val) return undefined;
  const d = new Date(val);
  if (isNaN(d.getTime())) return val; // fallback
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// --- Info ---
program
  .command('info')
  .description('Get system info, enums, and self-discovery metadata')
  .action(async () => {
    const data = await api.info();
    if (!formatOutput(data)) {
      console.log(JSON.stringify(data, null, 2));
    }
  });

// --- Tasks ---
program
  .command('list')
  .description('List tasks')
  .option('-q, --query <string>', 'Search keyword')
  .option('-s, --status <string>', 'Filter by status')
  .action(async (options) => {
    const params = new URLSearchParams();
    if (options.query) params.append('q', options.query);
    if (options.status) params.append('status', options.status);
    const qs = params.toString() ? `?${params.toString()}` : '';
    
    const tasks = await api.tasks.list(qs);
    if (!formatOutput(tasks)) {
      console.table(tasks.map(t => ({
        ID: t.id,
        Title: t.title,
        Status: t.status,
        Priority: t.priority,
        Due: t.due_date,
        Category: t.category_name || '-',
        Tags: t.tags && t.tags.length > 0 ? t.tags.map(tag => tag.name).join(', ') : '-'
      })));
    }
  });

program
  .command('add <title>')
  .description('Create a new task')
  .option('-d, --desc <string>', 'Description')
  .option('-p, --priority <string>', 'Priority (low, medium, high)')
  .option('-c, --category <id>', 'Category ID')
  .option('--due <datetime>', 'Due date (accepts YYYY-MM-DD HH:mm:ss or ISO format)')
  .option('--remind <datetime>', 'Remind at date (accepts YYYY-MM-DD HH:mm:ss or ISO format)')
  .option('--rule <rule>', 'Recurring rule (daily, weekly, monthly)')
  .option('--tags <names>', 'Comma separated tag names (e.g. 紧急,工作)')
  .option('--source <string>', 'Source of the task (e.g., user, openclaw)')
  .option('--metadata <json>', 'JSON string of metadata')
  .action(async (title, options) => {
    let metadataObj = undefined;
    if (options.metadata) {
      try {
        metadataObj = JSON.parse(options.metadata);
      } catch (e) {
        console.error('Invalid JSON for metadata');
        process.exit(1);
      }
    }

    const payload = {
      title,
      description: options.desc,
      priority: options.priority,
      category_id: options.category ? parseInt(options.category) : undefined,
      due_date: parseDateStr(options.due),
      remind_at: parseDateStr(options.remind),
      recurring_rule: options.rule,
      tags: options.tags ? options.tags.split(/[,，]/).map(name => name.trim()).filter(Boolean) : undefined,
      source: options.source,
      metadata: metadataObj ? JSON.stringify(metadataObj) : undefined
    };
    const res = await api.tasks.create(payload);
    if (!formatOutput(res)) {
      console.log(`Task created with ID: ${res.id}`);
    }
  });

program
  .command('complete <id>')
  .description('Mark a task as completed')
  .action(async (id) => {
    const res = await api.tasks.complete(id);
    if (!formatOutput(res)) {
      console.log(res.message || `Task ${id} completed.`);
    }
  });

program
  .command('delete <id>')
  .description('Delete a task')
  .action(async (id) => {
    const res = await api.tasks.delete(id);
    if (!formatOutput(res || { success: true, id })) {
      console.log(`Task ${id} deleted.`);
    }
  });

// --- Remind ---
program
  .command('check')
  .description('Check and trigger reminders (For Cron/Agent use)')
  .requiredOption('--channel <channel>', 'Channel to trigger: "agent" or "cloud"')
  .action(async (options) => {
    const res = await api.remind.check(options.channel);
    if (program.opts().json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    
    // Agent channel defaults to JSON string output based on original implementation
    if (res.tasks && res.tasks.length > 0) {
      console.log(`Triggered ${res.tasks.length} reminders.`);
      if (options.channel === 'agent') {
        console.log(JSON.stringify(res.tasks, null, 2));
      }
    } else {
      console.log('No tasks to remind at this time.');
    }
  });

// --- Tags ---
program
  .command('tags')
  .description('List all tags')
  .action(async () => {
    const tags = await api.tags.list();
    if (!formatOutput(tags)) {
      console.table(tags);
    }
  });

program
  .command('add-tag <name>')
  .description('Create a new tag')
  .action(async (name) => {
    const res = await api.tags.create(name);
    if (!formatOutput(res)) {
      console.log(`Tag created with ID: ${res.id}`);
    }
  });

// --- Categories ---
program
  .command('categories')
  .description('List all categories')
  .action(async () => {
    const categories = await api.categories.list();
    if (!formatOutput(categories)) {
      console.table(categories);
    }
  });

program
  .command('add-category <name>')
  .description('Create a new category')
  .option('-c, --color <hex>', 'Color hex code (e.g. #FF0000)')
  .action(async (name, options) => {
    const res = await api.categories.create(name, options.color);
    if (!formatOutput(res)) {
      console.log(`Category created with ID: ${res.id}`);
    }
  });

program.parse();
