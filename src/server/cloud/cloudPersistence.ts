import { isTenantOrg, tenantIdOf } from '@shared/seed/tenant';
import type { Persistence, PersistedOrg } from '../store/store';
import type { ControlPlane } from './controlPlane';

/**
 * Tenant worlds live in Minglewood Cloud (one JSON document per company); everything else —
 * the Northstar demo — stays in the local persistence. Only orgs that changed are uploaded.
 */
export class CloudPersistence implements Persistence {
  private lastSaved = new Map<string, string>();

  constructor(
    private readonly local: Persistence,
    private readonly cloud: ControlPlane,
  ) {}

  async load(): Promise<Record<string, PersistedOrg>> {
    const all = await this.local.load();
    // Tenants are loaded lazily from the cloud (loadOrg); ignore stale local copies.
    return Object.fromEntries(Object.entries(all).filter(([id]) => !isTenantOrg(id)));
  }

  async loadOrg(orgId: string): Promise<PersistedOrg | undefined> {
    if (!isTenantOrg(orgId)) return undefined;
    const data = await this.cloud.loadState(tenantIdOf(orgId));
    if (data) this.lastSaved.set(orgId, JSON.stringify(data));
    return data;
  }

  async save(data: Record<string, PersistedOrg>): Promise<void> {
    const localPart: Record<string, PersistedOrg> = {};
    const uploads: Array<Promise<void>> = [];
    for (const [id, org] of Object.entries(data)) {
      if (!isTenantOrg(id)) {
        localPart[id] = org;
        continue;
      }
      const json = JSON.stringify(org);
      if (this.lastSaved.get(id) === json) continue;
      uploads.push(
        this.cloud.saveState(tenantIdOf(id), org).then(
          () => void this.lastSaved.set(id, json),
          (e) => console.warn(`[cloud] saving ${id} failed; will retry on next change`, (e as Error).message),
        ),
      );
    }
    await Promise.all([this.local.save(localPart), ...uploads]);
  }
}
