import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Persistence, PersistedOrg } from './store';

/** Zero-setup local persistence: one JSON file, written atomically. */
export class JsonFilePersistence implements Persistence {
  private readonly file: string;
  constructor(private readonly dir: string) {
    this.file = join(dir, 'minglewood.json');
  }

  async load(): Promise<Record<string, PersistedOrg>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, PersistedOrg>;
    } catch {
      return {};
    }
  }

  async save(data: Record<string, PersistedOrg>): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2));
    await rename(tmp, this.file);
  }
}

/** For tests. */
export class MemoryPersistence implements Persistence {
  data: Record<string, PersistedOrg> = {};
  async load() {
    return structuredClone(this.data);
  }
  async save(d: Record<string, PersistedOrg>) {
    this.data = structuredClone(d);
  }
}
