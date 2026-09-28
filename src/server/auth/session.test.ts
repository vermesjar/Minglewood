import { describe, expect, it } from 'vitest';
import { issueToken, verifyToken } from './session';

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const t = issueToken('m-1', 'org-1');
    expect(verifyToken(t)).toMatchObject({ memberId: 'm-1', orgId: 'org-1' });
  });

  it('rejects tampered payloads (e.g. switching organizations)', () => {
    const t = issueToken('m-1', 'org-1');
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ memberId: 'm-1', orgId: 'org-2', exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyToken('garbage')).toBeNull();
    expect(verifyToken(undefined)).toBeNull();
  });
});
