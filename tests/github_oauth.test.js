import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGitHubUserAllowed,
  getOAuthFrontendUrl,
  buildOAuthSuccessHtml,
} from '../src/worker/handlers/auth/github.ts';

const sampleUser = { id: 12345678, login: 'gray0128', avatar_url: 'https://avatars.githubusercontent.com/u/1' };

test('isGitHubUserAllowed matches numeric user id', () => {
  assert.equal(isGitHubUserAllowed(sampleUser, '12345678'), true);
  assert.equal(isGitHubUserAllowed(sampleUser, '99999999'), false);
});

test('isGitHubUserAllowed matches username in GITHUB_ALLOWED_USER_ID', () => {
  assert.equal(isGitHubUserAllowed(sampleUser, 'gray0128'), true);
  assert.equal(isGitHubUserAllowed(sampleUser, 'Gray0128'), true);
  assert.equal(isGitHubUserAllowed(sampleUser, 'other-user'), false);
});

test('isGitHubUserAllowed matches GITHUB_ALLOWED_USERNAME', () => {
  assert.equal(isGitHubUserAllowed(sampleUser, undefined, 'gray0128'), true);
  assert.equal(isGitHubUserAllowed(sampleUser, '99999999', 'gray0128'), true);
});

test('getOAuthFrontendUrl prefers BASE_URL', () => {
  const env = { BASE_URL: 'https://claw-task.example.com/' };
  const url = getOAuthFrontendUrl(env, 'https://claw-task.example.com/api/auth/github/callback');
  assert.equal(url, 'https://claw-task.example.com');
});

test('getOAuthFrontendUrl falls back to redirect origin', () => {
  const env = {};
  const url = getOAuthFrontendUrl(env, 'https://claw-task.example.com/api/auth/github/callback');
  assert.equal(url, 'https://claw-task.example.com');
});

test('buildOAuthSuccessHtml writes localStorage bridge script', () => {
  const html = buildOAuthSuccessHtml('https://claw-task.example.com', 'secret-key', {
    id: 1,
    login: 'gray0128',
    avatar_url: 'https://avatars.githubusercontent.com/u/1',
  });
  assert.match(html, /localStorage\.setItem\('TASK_API_KEY', data\.apiKey\)/);
  assert.match(html, /window\.location\.replace\('\/'\)/);
  assert.match(html, /gray0128/);
});