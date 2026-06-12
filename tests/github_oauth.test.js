import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGitHubUserAllowed,
  getOAuthFrontendUrl,
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