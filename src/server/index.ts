import { resolve } from 'node:path';
import { BRAND } from '@shared/brand';
import { cloudConfigured, config } from './config';
import { ControlPlane } from './cloud/controlPlane';
import { CloudPersistence } from './cloud/cloudPersistence';
import { JsonFilePersistence } from './store/jsonFile';
import { createApp } from './app';

async function main() {
  const local = new JsonFilePersistence(config.dataDir);
  const cloud = cloudConfigured() ? new ControlPlane(config.controlPlaneUrl, config.serverKey) : undefined;
  const app = await createApp({
    persistence: cloud ? new CloudPersistence(local, cloud) : local,
    simulateCoworkers: config.simulateCoworkers,
    serveClient: true,
    demo: config.demoMode,
    cloud,
    slackTokenFile: resolve(config.dataDir, 'slack-tokens.json'),
  });
  app.server.listen(config.port, () => {
    console.log(`\n  ${BRAND.name} server on http://localhost:${config.port}`);
    console.log(
      `  demo mode: ${config.demoMode ? 'on' : 'off'} · simulated coworkers: ${config.simulateCoworkers ? 'on' : 'off'} · discord: ${config.discord.clientId ? 'configured' : 'not configured'} · slack: ${config.slack.clientId ? 'configured' : config.slack.mock ? 'mock' : 'not configured'} · cloud: ${cloud ? 'connected' : 'off (single-org)'}\n`,
    );
  });
  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
