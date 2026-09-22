import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // Local: run `npm run pages:dev` on 8788, or use wrangler
        target: 'http://localhost:8788',
        changeOrigin: true,
      },
    },
  },
});
