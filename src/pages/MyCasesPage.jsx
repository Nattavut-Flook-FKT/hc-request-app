/**
 * MyCasesPage.jsx — My assigned cases (TA only)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าแสดงเฉพาะคำขอที่ TA คนปัจจุบันรับเป็นผู้ดูแล (assigned TA)
 * ใช้ RequestTable พร้อม filterMyCases=true เพื่อกรองเฉพาะเคสของตัวเอง
 *
 * Props:
 *   user          {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role          {string}   role ของผู้ใช้ (ควรเป็น 'ta')
 *   department    {string}   แผนกของผู้ใช้
 *   isDarkMode    {boolean}  สถานะ dark mode
 *   toggleDarkMode {function} toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Layout from '../components/Shared/Layout'
import RequestTable from '../components/Dashboard/RequestTable'

export default function MyCasesPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">เคสของฉัน</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">คำขอที่คุณรับเป็น TA ดูแลอยู่</p>
        </div>
        {/* filterMyCases=true กรองเฉพาะ request ที่ user.uid ตรงกับ assignedTA */}
        <RequestTable user={user} role={role} department={department} filterMyCases />
      </div>
    </Layout>
  )
}
