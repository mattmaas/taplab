import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    // HTTPS + LAN exposure enabled for phone / Web Bluetooth testing.
    host: true,
    port: 5173,
  },
});
