import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: Vite on 5173 proxies /api to the Python engine on 8000.
// Build: emits into apartment/static/dist, which FastAPI serves directly,
// so there is one command to run in production and no CORS anywhere.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../apartment/static/dist',
    emptyOutDir: true,
  },
})
