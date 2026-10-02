/** Read saved movement pixels without rerendering or granting review approval. */
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function seatMotionFrames(folder: string, resultPath: string | undefined, facing: string, look: number) {
  if (!['se', 'sw', 'ne', 'nw'].includes(facing) || !Number.isInteger(look) || look < 0 || look > 3)
    throw Error('Unknown movement direction or outfit.');
  if (!resultPath) throw Error('Movement has not been recorded yet.');
  const base = realpathSync(folder);
  const safe = (path: string) => {
    const file = realpathSync(path), rel = relative(base, file);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) throw Error('Movement evidence is outside this draft.');
    return file;
  };
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const resultFile = safe(resolve(base, resultPath)), resultBytes = readFileSync(resultFile);
  const result = JSON.parse(resultBytes.toString('utf8'));
  const candidates = (result.artifacts ?? []).filter((a: any) => typeof a.path === 'string' && a.path.endsWith(`-${facing}-L${look}-film.json`));
  if (candidates.length !== 1) throw Error('This direction and outfit do not have one recorded movement film.');
  const artifact = candidates[0], bytes = readFileSync(safe(resolve(dirname(resultFile), artifact.path)));
  if (hash(bytes) !== artifact.sha256) throw Error('Recorded movement bytes have changed.');
  const film = JSON.parse(bytes.toString('utf8'));
  if (film.facing !== facing || film.reviewLook !== look || !Array.isArray(film.frames) || !film.frames.length)
    throw Error('Movement context does not match the requested recording.');
  const frames = film.frames.map((f: any, index: number) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(f.png ?? '') || !Number.isInteger(f.crop?.width) || !Number.isInteger(f.crop?.height)
      || f.crop.width <= 0 || f.crop.height <= 0 || f.crop.width * f.crop.height > 4_000_000)
      throw Error(`Malformed movement screen pixels at frame ${index}.`);
    const png = Buffer.from(f.png.split(',')[1], 'base64');
    if (png.length < 33 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.toString('ascii', 12, 16) !== 'IHDR'
      || png.readUInt32BE(16) !== f.crop.width || png.readUInt32BE(20) !== f.crop.height)
      throw Error(`Movement PNG dimensions do not match the capture at frame ${index}.`);
    const settled = /^seated-(\d+)$/.exec(f.state?.phase ?? '');
    return { png: f.png, rect: f.crop, phase: String(f.state?.phase ?? 'unknown'), pose: String(f.state?.pose ?? 'unknown'),
      cushion: settled && f.state?.onSeat ? Number(settled[1]) : null, renderedFrame: f.renderedFrame };
  });
  return { facing, look, filmSha256: artifact.sha256, resultSha256: hash(resultBytes), frames,
    scope: 'Original recorded game-screen pixels. Viewing a recording does not approve its appearance or establish that its renderer is current.' };
}
