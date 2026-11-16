import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the built app also works when served from any folder.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'node', include: ['tests/unit/**/*.test.ts'] },
} as any);
