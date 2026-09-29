/**
 * A review server for the working tree without hot reload (port 5190): lab renders and playtests aren't
 * interrupted when someone saves a file; reload the page to pick up changes.
 *   npx vite --config vite.review.config.ts
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    server: { port: 5190, strictPort: true, hmr: false, watch: null },
  }),
);
