/**
 * Stateless signed session tokens (HMAC-SHA256). Used as an HttpOnly cookie in the browser and
 * as a bearer token inside the Discord Activity iframe (where third-party cookies are unreliable).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';
import { config } from '../config';
import { BRAND } from '@shared/brand';

export const SESSION_COOKIE = `${BRAND.cookiePrefix}_session`;
const TTL_MS = 30 * 24 * 3600_000;

export interface Session {
  memberId: string;
  orgId: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString('base64url');
const sign = (payload: string) => createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');

export function issueToken(memberId: string, orgId: string): string {
  const payload = b64(JSON.stringify({ memberId, orgId, exp: Date.now() + TTL_MS } satisfies Session));
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string | undefined | null): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof s.memberId !== 'string' || typeof s.orgId !== 'string' || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Reads the session from a bearer header, falling back to the cookie. */
export function sessionFromRequest(req: Request | IncomingMessage): Session | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return verifyToken(auth.slice(7));
  return verifyToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
}

export function sessionCookie(token: string): string {
  const secure = config.isProd ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
