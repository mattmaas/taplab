import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    // Web Bluetooth requires secure context (HTTPS or localhost)
    port: 5173,
  },
});
