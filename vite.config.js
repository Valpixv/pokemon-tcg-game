import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { relayPlugin } from './server/relay.js';

// `npm run dev`        -> http://localhost:5173 (browser preview, mouse)
// `npm run dev:quest`  -> https://<this-pc-ip>:5173 on the LAN (Quest Browser needs HTTPS for WebXR)
export default defineConfig(({ mode }) => {
  const quest = mode === 'quest';
  return {
    plugins: [relayPlugin(), ...(quest ? [basicSsl()] : [])],
    server: { host: quest ? true : 'localhost', port: 5173 },
    preview: { host: quest ? true : 'localhost', port: 5173 },
    build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  };
});
