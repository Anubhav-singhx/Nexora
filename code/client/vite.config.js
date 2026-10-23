import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The browser talks to /api on port 5173; Vite forwards it to Express on 3001 (so no CORS pain in development).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
