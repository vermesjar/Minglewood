/**
 * Every request Slack sends (events, slash commands, interactions) is signed with the app's signing secret:
 * `v0=` + HMAC-SHA256(secret, `v0:{timestamp}:{raw body}`), sent as X-Slack-Signature with
 * X-Slack-Request-Timestamp. We reject anything unsigned, mis-signed, or older than five minutes (replays).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_SKEW_SECONDS = 60 * 5;

export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: 'no-secret' | 'missing' | 'stale' | 'mismatch' };

export function verifySlackRequest(
  secret: string,
  headers: { timestamp?: string; signature?: string },
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no-secret' };
  const { timestamp, signature } = headers;
  if (!timestamp || !signature) return { ok: false, reason: 'missing' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: 'stale' };
  const expected = Buffer.from(slackSignature(secret, timestamp, rawBody));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
