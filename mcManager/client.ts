/**
 * Thin client for the mc-manager-server API (https://mine.lomokwa.com).
 * Handles logging in as the bot's dedicated user account and refreshing the
 * JWT before it expires (tokens are issued with a 24h lifetime).
 */

const apiUrl = process.env.MC_MANAGER_API_URL;
const username = process.env.MC_MANAGER_USERNAME;
const password = process.env.MC_MANAGER_PASSWORD;

if (!apiUrl) {
  throw new Error('MC_MANAGER_API_URL environment variable is required');
}
if (!username) {
  throw new Error('MC_MANAGER_USERNAME environment variable is required');
}
if (!password) {
  throw new Error('MC_MANAGER_PASSWORD environment variable is required');
}

interface LoginResponse {
  success: boolean;
  data?: { token: string };
  error?: string;
}

// JWTs are issued with a 24h expiry (see mc-manager-server services/users.go).
// Refresh a bit early so we never try to use a token that's about to expire.
const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // refresh 1h before expiry

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;
let pendingLogin: Promise<string> | null = null;

async function login(): Promise<string> {
  const response = await fetch(`${apiUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const body = (await response.json()) as LoginResponse;
  if (!response.ok || !body.success || !body.data?.token) {
    throw new Error(`mc-manager login failed: ${body.error ?? response.statusText}`);
  }

  cachedToken = body.data.token;
  cachedTokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
  console.log('mc-manager: logged in, JWT refreshed');
  return cachedToken;
}

/**
 * Returns a valid JWT for the mc-manager API, logging in (or refreshing) as
 * needed. Safe to call concurrently — only one login request is in flight
 * at a time.
 */
export async function getToken(): Promise<string> {
  const needsRefresh = !cachedToken || Date.now() >= cachedTokenExpiresAt - REFRESH_MARGIN_MS;

  if (!needsRefresh && cachedToken) {
    return cachedToken;
  }

  if (!pendingLogin) {
    pendingLogin = login().finally(() => {
      pendingLogin = null;
    });
  }

  return pendingLogin;
}

/** Forces the next getToken() call to log in again, e.g. after a 401. */
export function invalidateToken(): void {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

export function getApiUrl(): string {
  return apiUrl!;
}

export function getWebSocketUrl(path: string): string {
  return `${apiUrl!.replace(/^http/, 'ws')}${path}`;
}
