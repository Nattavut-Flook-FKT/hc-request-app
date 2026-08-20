import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'   // import ตรงๆ ไม่งั้น eslint ฟ้อง no-undef (config นี้ไม่ได้ประกาศ node globals)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // อนุญาต ngrok tunnel (subdomain สุ่มทุกครั้งที่รันใหม่) สำหรับเปิดให้คนนอกวงดูชั่วคราว
    allowedHosts: ['.ngrok-free.dev', '.ngrok-free.app', '.ngrok.io'],
    // รับ port จาก env (เช่น preview harness จัดให้ตอน 5173 ไม่ว่าง) — default 5173 เหมือนเดิม
    port: Number(process.env.PORT) || 5173,
  },
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
