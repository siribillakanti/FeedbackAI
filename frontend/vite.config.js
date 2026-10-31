import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5174 because 5173 belongs to another local project (docs/00_DECISIONS.md §2).
// The proxy keeps the API same-origin, so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5002',
        changeOrigin: true
      }
    }
  }
})
