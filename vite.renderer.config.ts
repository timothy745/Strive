import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  root: 'frontend',
  build: {
    rollupOptions: {
      input: 'frontend/index.html',
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/chart.js')) {
            return 'chart';
          }
        },
      },
    },
  },
});
