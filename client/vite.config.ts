/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const api = process.env.API_ORIGIN ?? 'http://localhost:4000';
// The API serves /api, /sample (placeholder art), /uploads, sitemap and robots. In production put both behind one origin.
const proxy = Object.fromEntries(['/api', '/sample', '/uploads', '/sitemap.xml', '/robots.txt'].map((p) => [p, { target: api, changeOrigin: false }]));
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { proxy },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'], css: false },
});
