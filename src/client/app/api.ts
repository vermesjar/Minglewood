/**
 * HTTP client. Inside a Discord Activity all network traffic must go through Discord's proxy
 * (`/.proxy/...` with URL mappings configured in the Developer Portal) and third-party cookies
 * are unreliable, so we use a bearer token there. In the browser we use the HttpOnly cookie.
 */
let bearer: string | null = null;
let prefix = '';

export function setActivityTransport(token: string) {
  bearer = token;
  prefix = '/.proxy';
}

export function apiPrefix() {
  return prefix;
}

export function bearerToken() {
  return bearer;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${prefix}/api${path}`, { ...init, headers, body, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = bearer ? `?token=${encodeURIComponent(bearer)}` : '';
  return `${proto}://${location.host}${prefix}/ws${q}`;
}
