import { Hono } from 'hono';
import type { Bindings } from '../..';

const githubAuth = new Hono<{ Bindings: Bindings }>();

// GitHub OAuth login endpoint
githubAuth.get('/login', async (c) => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const redirectUri = c.env.GITHUB_OAUTH_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth is not configured' }
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

  if (!code) {
    return c.json({
      success: false,
      error: { message: 'Missing authorization code' }
    }, 400);
  }

  if (!clientId || !clientSecret || !allowedUserId || !taskApiKey || !redirectUri) {
    return c.json({
      success: false,
      error: { message: 'GitHub OAuth is not properly configured' }
    }, 500);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code
      })
    });

    const tokenData = await tokenResponse.json() as { access_token?: string };
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return c.json({
        success: false,
        error: { message: 'Failed to get access token' }
      }, 401);
    }

    // Get user info
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    const userData = await userResponse.json() as { id: number; login: string; avatar_url: string };

    // Verify user is allowed
    const userIdMatches = userData.id.toString() === allowedUserId.toString();
    const usernameMatches = !allowedUsername || userData.login === allowedUsername;

    if (!userIdMatches || !usernameMatches) {
      return c.json({
        success: false,
        error: { message: 'Access denied: User not authorized' }
      }, 403);
    }

    // Redirect back to frontend with API key
    const frontendUrl = new URL(redirectUri).origin;
    return c.redirect(`${frontendUrl}?api_key=${taskApiKey}&username=${userData.login}&avatar=${userData.avatar_url}`);

  } catch (error) {
    console.error('GitHub OAuth error:', error);
    return c.json({
      success: false,
      error: { message: 'OAuth authentication failed' }
    }, 500);
  }
});

export default githubAuth;
