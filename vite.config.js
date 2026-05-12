import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/gas': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: () => '/hcrequest/asia-southeast1/gasProxy',
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) ต้องใช้ function แทน object
        manualChunks(id) {
          // Firebase — แยกออกเพราะหนักมาก
          if (id.includes('node_modules/firebase')) return 'vendor-firebase'
          // Supabase
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
          // Lucide icons
          if (id.includes('node_modules/lucide-react')) return 'vendor-lucide'
          // React core
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router')) return 'vendor-react'
        },
      },
    },
    chunkSizeWarningLimit: 400,
  },
})
