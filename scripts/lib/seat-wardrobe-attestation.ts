/** Trust the installed local sampler, never a draft's self-reported coverage.
 * Same-OS-user arbitrary code is trusted; this is not a hostile-user sandbox.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
const keyPath = resolve(process.env.LOCALAPPDATA || resolve(homedir(), '.local', 'share'), 'Minglewood', 'evidence', 'wardrobe-runner-v1.key');
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
};
export type WardrobeDomain = 'context-v1' | 'aggregate-v1';
function key(create: boolean): Buffer {
  if (!existsSync(keyPath) && create) {
    mkdirSync(dirname(keyPath), { recursive: true });
    const staged = keyPath + '.' + randomBytes(12).toString('hex') + '.pending';
    writeFileSync(staged, randomBytes(32), { flag: 'wx', mode: 0o600 });
    try { linkSync(staged, keyPath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    finally { unlinkSync(staged); }
  }
  if (!existsSync(keyPath)) throw Error('Local wardrobe runner attestation is missing; run coverage on this installation.');
  const secret = readFileSync(keyPath);
  if (secret.length !== 32) throw Error('Invalid local wardrobe runner key.');
  return secret;
}
function mac(secret: Buffer, domain: WardrobeDomain, payload: unknown): string {
  return createHmac('sha256', secret).update('Minglewood wardrobe\0' + domain + '\0' + canonical(payload)).digest('hex');
}
/** Sampler only: callers must compute or authenticate every context before signing. */
export function attestWardrobe(domain: WardrobeDomain, payload: unknown): string { return mac(key(true), domain, payload); }
export function requireWardrobeAttestation(domain: WardrobeDomain, payload: unknown, signature: unknown): void {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature)) throw Error('Unauthenticated wardrobe evidence.');
  const expected = Buffer.from(mac(key(false), domain, payload), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw Error('Wardrobe runner attestation does not match the evidence.');
}

/** No partial cache file is ever visible, including concurrent draft workers. */
export function writeWardrobeCache(path: string, payload: unknown): void {
  const staged = path + '.' + randomBytes(12).toString('hex') + '.pending';
  const bytes = JSON.stringify(payload);
  writeFileSync(staged, bytes, { flag: 'wx' });
  try { linkSync(staged, path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (readFileSync(path, 'utf8') !== bytes) throw Error('Conflicting immutable wardrobe cache.');
  } finally { unlinkSync(staged); }
}
