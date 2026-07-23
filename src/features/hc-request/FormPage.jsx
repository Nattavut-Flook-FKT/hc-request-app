/**
 * FormPage.jsx — HC Request submission form (Manager and Admin only)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าสำหรับยื่นคำขออัตรากำลังใหม่ เข้าถึงได้เฉพาะ Manager และ Admin
 * Lazy load HCRequestForm เพื่อลด initial bundle size
 * หาก maintenanceMode=true จะแสดง warning banner แจ้งว่าจะไม่ส่ง Slack notification
 *
 * Props:
 *   user            {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role            {string}   role ของผู้ใช้ ('manager' | 'admin')
 *   isDarkMode      {boolean}  สถานะ dark mode
 *   toggleDarkMode  {function} toggle dark/light mode
 *   maintenanceMode {boolean}  หากเป็น true ระบบปิดปรับปรุง — บันทึกได้แต่ไม่แจ้ง Slack
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { lazy, Suspense } from 'react'
import Layout from '@/components/app-shell/Layout'

// Lazy load ฟอร์มหลักเพื่อลด bundle size ที่โหลดครั้งแรก
const HCRequestForm = lazy(() => import('@/features/hc-request/HCRequestForm'))

export default function FormPage({ user, role, isDarkMode, toggleDarkMode, maintenanceMode }) {
  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">ยื่นคำขออัตรากำลัง</h1>
          <p className="mt-0.5 text-sm text-neutral-500">กรอกข้อมูลให้ครบถ้วน แล้วกด "ยื่นคำขอ"</p>
          {/* แสดง banner เตือนเมื่อระบบอยู่ใน maintenance mode */}
          {maintenanceMode && (
            <p className="mt-1 text-xs font-bold text-orange-600">ระบบปิดปรับปรุง — คำขอจะถูกบันทึกแต่ไม่แจ้ง Slack</p>
          )}
        </div>
        <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-neutral-400">กำลังโหลดฟอร์ม...</div>}>
          <HCRequestForm user={user} role={role} maintenanceMode={maintenanceMode} />
        </Suspense>
      </div>
    </Layout>
  )
}
