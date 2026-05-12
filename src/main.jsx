/**
 * main.jsx — React Application Entry Point
 * ─────────────────────────────────────────────────────────────────────────────
 * จุดเริ่มต้นของแอปพลิเคชัน HC Request
 * ทำหน้าที่ mount React app เข้ากับ DOM element #root ใน index.html
 *
 * Wrappers ที่ครอบ App:
 *   StrictMode   — เปิด React strict mode ตรวจหา side effects และ deprecated APIs
 *                  (ใน development เท่านั้น ไม่มีผลกระทบใน production)
 *   BrowserRouter — เปิดใช้งาน React Router สำหรับ client-side navigation
 *                   ใช้ HTML5 History API (push/pop state) แทน hash-based routing
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

// Mount React app เข้า <div id="root"> ใน index.html
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
