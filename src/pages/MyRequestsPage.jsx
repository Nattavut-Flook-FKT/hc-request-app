/**
 * MyRequestsPage.jsx — "คำขอของฉัน" — requests submitted by the current user
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าแสดงคำขออัตรากำลังที่ผู้ใช้ปัจจุบันเป็นคนยื่น
 * render component ต่างกันตาม role:
 *   - Manager → ManagerRequestsView (มี UI เฉพาะสำหรับ manager)
 *   - TA / Admin → RequestTable พร้อม filterMine=true (กรองเฉพาะที่ตัวเองยื่น)
 *
 * Props:
 *   user          {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role          {string}   role ของผู้ใช้ ('manager' | 'ta' | 'admin')
 *   department    {string}   แผนกของผู้ใช้
 *   isDarkMode    {boolean}  สถานะ dark mode
 *   toggleDarkMode {function} toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Layout from '../components/Shared/Layout'
import RequestTable from '../components/Dashboard/RequestTable'
import ManagerRequestsView from '../components/Manager/ManagerRequestsView'

export default function MyRequestsPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  const isManager = role === 'manager'

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">คำขอของฉัน</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">คำขออัตรากำลังที่คุณยื่นทั้งหมด</p>
        </div>

        {/* Manager ใช้ ManagerRequestsView ที่ออกแบบมาเฉพาะ, role อื่นใช้ RequestTable */}
        {isManager
          ? <ManagerRequestsView user={user} />
          : <RequestTable user={user} role={role} department={department} filterMine />
        }
      </div>
    </Layout>
  )
}
