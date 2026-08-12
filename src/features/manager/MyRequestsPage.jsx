/**
 * MyRequestsPage.jsx — "คำขอของฉัน" — requests submitted by the current user
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าแสดงคำขออัตรากำลังที่ผู้ใช้ปัจจุบันเป็นคนยื่น
 * render component ต่างกันตาม role:
 *   - Manager / Admin → ManagerRequestsView (Scorecard + tab ประวัติ + กรองปี)
 *     Admin ไม่มี grant แผนก/division เป็นของตัวเอง จึงเห็นเฉพาะคำขอที่ตัวเองยื่นเอง
 *     เหมือน filterMine เดิม แค่ยกระดับ UI ให้เหมือนฝั่ง Manager
 *   - TA → RequestTable พร้อม filterMine=true (กรองเฉพาะที่ตัวเองยื่น, มี tab ประวัติในตัว)
 *
 * Props:
 *   user          {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role          {string}   role ของผู้ใช้ ('manager' | 'ta' | 'admin')
 *   department    {string}   แผนกของผู้ใช้
 *   isDarkMode    {boolean}  สถานะ dark mode
 *   toggleDarkMode {function} toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Layout from '@/components/app-shell/Layout'
import RequestTable from '@/features/dashboard/RequestTable'
import ManagerRequestsView from '@/features/manager/ManagerRequestsView'

export default function MyRequestsPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  const useManagerView = role === 'manager' || role === 'admin'

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">คำขอของฉัน</h1>
          <p className="mt-0.5 text-sm text-neutral-500">คำขออัตรากำลังที่คุณยื่นทั้งหมด</p>
        </div>

        {/* Manager/Admin ใช้ ManagerRequestsView (Scorecard + ประวัติ), TA ใช้ RequestTable */}
        {useManagerView
          ? <ManagerRequestsView user={user} role={role} />
          : <RequestTable user={user} role={role} department={department} filterMine />
        }
      </div>
    </Layout>
  )
}
