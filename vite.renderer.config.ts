import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  root: 'frontend',
  publicDir: '../videos',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          chart: ['chart.js'],
        },
      },
    },
  },
});
