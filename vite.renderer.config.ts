import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          chart: ['chart.js'],
        },
      },
    },
  },
});
