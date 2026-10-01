/** Share ECMAScript numeric serialization with the exact publication/evidence gate. */
import { readFileSync } from 'node:fs';
import { canonical, sha256 } from './lib/seat-verification';
const index = process.argv.indexOf('--input');
if (index < 0) throw new Error('--input source surface map JSON is required');
const maps = JSON.parse(readFileSync(process.argv[index + 1], 'utf8'));
console.log(JSON.stringify(Object.fromEntries(Object.entries(maps).map(([facing, map]) => [facing, sha256(canonical(map))]))));
