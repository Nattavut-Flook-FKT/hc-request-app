import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (rolldown) ต้องใช้ function แทน object
        manualChunks(id) {
          // Firebase — แยกออกเพราะหนักมาก
          if (id.includes('node_modules/firebase')) return 'vendor-firebase'
          // Supabase ไม่ manual chunk — ให้อยู่กับ lazy-loaded pages แทน
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
