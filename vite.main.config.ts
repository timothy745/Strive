import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        'bcryptjs',
        'pg',
        'electron-store',
        'node-fetch',
        'dotenv',
        'electron-squirrel-startup',
      ],
    },
  },
});
