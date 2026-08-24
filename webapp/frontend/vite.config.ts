/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Respects $PORT when set (e.g. by preview tooling assigning a free port), falling back to
  // 5173 for a normal manual `npm run dev` — matters here specifically because the deployed
  // backend's CORS allowlist (see lib/cors.ts) only trusts http://localhost:5173.
  server: { port: process.env.PORT ? Number(process.env.PORT) : 5173, strictPort: !!process.env.PORT },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
