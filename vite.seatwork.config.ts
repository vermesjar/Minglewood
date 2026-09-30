/**
 * A private review server for seat work (port 5195): no hot reload, but it watches files, so a page reload picks
 * up edits. (vite.review.config.ts on 5190 doesn't watch at all.)
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

export default mergeConfig(
  base,
  defineConfig({
    server: { port: 5195, strictPort: true, hmr: false },
  }),
);
