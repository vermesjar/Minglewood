import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const serverPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
  root: 'src/client',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    // Discord Activities are served through a tunnel (e.g. cloudflared); allow any host in dev.
    allowedHosts: true,
    proxy: {
      '/api': `http://localhost:${serverPort}`,
      '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/client', import.meta.url)),
    emptyOutDir: true,
  },
});
