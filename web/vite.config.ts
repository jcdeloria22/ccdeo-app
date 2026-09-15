/**
 * The frontend build.
 *
 * `/reminders` is proxied to the API in development so the browser sees one
 * origin and there is no CORS to configure — which matters because the API binds
 * loopback only and must stay that way while AUTH_MODE=none.
 *
 * The production build goes to `web/dist` and Nest serves it, so the deployed app
 * is one origin too. Nothing about the bind guard changes.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/reminders': 'http://127.0.0.1:3000' },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
