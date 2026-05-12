/**
 * Layout.jsx — App Shell Layout
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrapper หลักของทุกหน้า
 *
 * โครงสร้าง:
 *   ┌──────────┬──────────────────────────────────┐
 *   │ Sidebar  │  <main> — scroll ได้ อิสระ       │
 *   │ (sticky) │  max-w-7xl centered               │
 *   └──────────┴──────────────────────────────────┘
 *
 * Design decisions:
 *   - `h-screen overflow-hidden` บน container หลัก → sidebar ไม่ scroll ตาม
 *   - `overflow-y-auto` บน <main> → content scroll ได้อิสระ
 *   - Sidebar ใช้ `sticky top-0 h-screen` → ไม่ต้องใช้ position: fixed
 *
 * Props:
 *   user           {object}  Firebase Auth user
 *   role           {string}  'admin' | 'ta' | 'manager'
 *   isDarkMode     {boolean}
 *   toggleDarkMode {fn}
 *   children       {ReactNode} content ของแต่ละหน้า
 * ─────────────────────────────────────────────────────────────────────────────
 */

import Sidebar from './Sidebar'

export default function Layout({ user, role, isDarkMode, toggleDarkMode, children }) {
  return (
    <div className="flex h-screen overflow-hidden transition-colors duration-300 bg-[#f5f7f6] dark:bg-slate-950">
      {/* Sidebar — แถบ navigation ซ้ายมือ, sticky ไม่เลื่อนตาม content */}
      <Sidebar user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode} />

      {/* Main content area — scroll อิสระจาก sidebar */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        {/* max-w-7xl เพื่อไม่ให้ content กว้างเกินไปบนจอใหญ่ */}
        <div className="px-7 py-7 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
