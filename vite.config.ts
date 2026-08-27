import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Web Bluetooth requires a secure context: localhost qualifies.
    // NOTE: do not add --host / network exposure until phone testing —
    // and that will need HTTPS (@vitejs/plugin-basic-ssl) for Web Bluetooth.
    port: 5173,
  },
});
