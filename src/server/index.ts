import { BRAND } from '@shared/brand';
import { config } from './config';
import { JsonFilePersistence } from './store/jsonFile';
import { createApp } from './app';

async function main() {
  const app = await createApp({
    persistence: new JsonFilePersistence(config.dataDir),
    simulateCoworkers: config.simulateCoworkers,
    serveClient: true,
  });
  app.server.listen(config.port, () => {
    console.log(`\n  ${BRAND.name} server on http://localhost:${config.port}`);
    console.log(
      `  demo mode: ${config.demoMode ? 'on' : 'off'} · simulated coworkers: ${config.simulateCoworkers ? 'on' : 'off'} · discord: ${config.discord.clientId ? 'configured' : 'not configured'}\n`,
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
