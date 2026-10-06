import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite on 5174 proxies /api and /models to the Python explorer server on 8020.
// Build: emits into explorer/web/dist, which the server serves at http://127.0.0.1:8020.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8020', changeOrigin: true },
      '/models': { target: 'http://127.0.0.1:8020', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
})
