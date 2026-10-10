import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

function apiProxyTarget() {
  try {
    const env = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8');
    const port = env.match(/^PORT=(\d+)/m)?.[1];
    if (port) return `http://localhost:${port}`;
  } catch {
    // Fall back to the server default when .env is missing.
  }
  return 'http://localhost:3001';
}

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) } },
  server: { port: 5173, proxy: { '/api': apiProxyTarget() } },
  // DonateDialog is lazy-loaded; pre-bundling avoids a full dev reload on first open.
  optimizeDeps: { include: ['@stripe/stripe-js', '@stripe/react-stripe-js'] },
  build: { chunkSizeWarningLimit: 2500 },
});
