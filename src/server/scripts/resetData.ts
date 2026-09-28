/** Deletes locally persisted data (guest accounts, bindings, audit). Seed data regenerates on boot. */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config';

await rm(join(config.dataDir, 'minglewood.json'), { force: true });
console.log(`Removed ${join(config.dataDir, 'minglewood.json')}`);
