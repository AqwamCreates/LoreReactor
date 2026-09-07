import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os';

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/model': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/model/, ''),
      },
      '/api/web': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/web/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['large-json-files', '@huggingface/transformers'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('@huggingface/transformers')) {
            return 'transformers';
          }
        },
      },
    },
  },
  define: {
    'import.meta.env.VITE_HOST_IP': JSON.stringify(getLocalIP()),
  },
});