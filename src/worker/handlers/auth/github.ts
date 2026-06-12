import { Hono } from 'hono';
import type { Bindings } from '../..';

const githubAuth = new Hono<{ Bindings: Bindings }>();

type GitHubUser = { id: number; login: string; avatar_url: string };

/** GITHUB_ALLOWED_USER_ID accepts numeric ID or username for backward compatibility. */
export function isGitHubUserAllowed(
  user: GitHubUser,
  allowedUserId?: string,
  allowedUsername?: string
): boolean {
  if (!allowedUserId && !allowedUsername) return false;

  const login = user.login.toLowerCase();

  if (allowedUserId) {
    if (/^\d+$/.test(allowedUserId)) {
      if (user.id.toString() === allowedUserId) return true;
    } else if (login === allowedUserId.toLowerCase()) {
      return true;
    }
  }

  if (allowedUsername && login === allowedUsername.toLowerCase()) {
    return true;
  }

  return false;
}

export function getOAuthFrontendUrl(env: Bindings, redirectUri: string): string {
  if (env.BASE_URL) return env.BASE_URL.replace(/\/$/, '');
  return new URL(redirectUri).origin;
}

function buildOAuthSuccessRedirect(frontendUrl: string, apiKey: string, user: GitHubUser): string {
  const hash = new URLSearchParams({
    api_key: apiKey,
    username: user.login,
    avatar: user.avatar_url,
  });
  return `${frontendUrl}/#${hash.toString()}`;
}

function buildOAuthErrorRedirect(frontendUrl: string, message: string): string {
  return `${frontendUrl}/?oauth_error=${encodeURIComponent(message)}`;
}



// GET /api/auth/github/url — return authorize URL for clients that need JSON
githubAuth.get('/url', async (c) => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri = c.env.GITHUB_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth is not configured' },
    }, 500);
  }

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', 'read:user');

  return c.json({ success: true, data: { url: githubAuthUrl.toString() }, error: null });
});

// GitHub OAuth login endpoint
githubAuth.get('/login', async (c) => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri = c.env.GITHUB_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth is not configured' },
    }, 500);
  }

  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', clientId);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  githubAuthUrl.searchParams.set('scope', 'read:user');

  return c.redirect(githubAuthUrl.toString());
});

// GitHub OAuth callback endpoint
githubAuth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = c.env.GITHUB_OAUTH_CLIENT_SECRET;
  const allowedUserId = c.env.GITHUB_ALLOWED_USER_ID;
  const allowedUsername = c.env.GITHUB_ALLOWED_USERNAME;
  const taskApiKey = c.env.TASK_API_KEY;
  const redirectUri = c.env.GITHUB_OAUTH_REDIRECT_URI;

  const frontendUrl = redirectUri
    ? getOAuthFrontendUrl(c.env, redirectUri)
    : c.env.BASE_URL?.replace(/\/$/, '');

  if (!frontendUrl) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth redirect is not configured' },
    }, 500);
  }

  if (!code) {
    return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'Missing authorization code'));
  }

  if (!clientId || !clientSecret || !taskApiKey || !redirectUri) {
    return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'GitHub OAuth is not properly configured'));
  }

  if (!allowedUserId && !allowedUsername) {
    return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'No allowed GitHub user configured'));
  }

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = await tokenResponse.json() as { access_token?: string; error?: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      const reason = tokenData.error || 'Failed to get access token';
      return c.redirect(buildOAuthErrorRedirect(frontendUrl, reason));
    }

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'claw-owner-task',
      },
    });

    if (!userResponse.ok) {
      return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'Failed to fetch GitHub user profile'));
    }

    const userData = await userResponse.json() as GitHubUser;

    if (!isGitHubUserAllowed(userData, allowedUserId, allowedUsername)) {
      return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'Access denied: User not authorized'));
    }

    return c.redirect(buildOAuthSuccessRedirect(frontendUrl, taskApiKey, userData));
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    return c.redirect(buildOAuthErrorRedirect(frontendUrl, 'OAuth authentication failed'));
  }
});

export default githubAuth;