/**
 * UserManagementPage.jsx — User Role Management
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าจัดการผู้ใช้งานในระบบ ใช้สำหรับกำหนด/แก้ไข/ลบ role ของ user
 * ข้อมูลถูกเก็บใน Firestore collection `users` โดยใช้ email เป็น document ID
 * รองรับเฉพาะ email ที่ลงท้ายด้วย @freshket.co เท่านั้น
 *
 * Props / Features:
 *   - user        — ข้อมูล user ที่ล็อกอิน (ส่งต่อไปยัง Layout)
 *   - role        — บทบาทของ user (ส่งต่อไปยัง Layout)
 *   - isDarkMode  — สถานะ dark mode ปัจจุบัน
 *   - toggleDarkMode — ฟังก์ชันสลับ dark/light mode
 *   - ใช้ onSnapshot (realtime listener) แทน getDocs เพื่ออัพเดต list อัตโนมัติ
 *   - Listener จะ unsubscribe เมื่อ tab ถูก hidden และ re-subscribe เมื่อกลับมา
 *   - สามารถเปลี่ยน role ของ user ได้ทันทีผ่าน dropdown ในตาราง (inline edit)
 *   - การลบใช้ ConfirmModal ยืนยันก่อนทุกครั้ง
 *
 * Notes:
 *   - document ID ใน Firestore คือ email ของ user ไม่ใช่ auto-generated ID
 *   - setDoc ใช้ทั้งการเพิ่มและ upsert (merge: true สำหรับ update role)
 *   - VALID_ROLES ถูก validate ทั้งฝั่ง client ก่อน write Firestore
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from 'react'
import { doc, onSnapshot, collection, setDoc, deleteDoc, query, limit, orderBy } from 'firebase/firestore'
import { db } from '../services/firebase'
import { UserPlus, Trash2 } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import ConfirmModal from '../components/Shared/ConfirmModal'

// roles ที่อนุญาตให้กำหนดได้ในระบบ — ใช้ validate ทั้งตอน add และ update
const VALID_ROLES = ['manager', 'ta', 'admin']

export default function UserManagementPage({ user, role, isDarkMode, toggleDarkMode }) {
  // รายการ users ทั้งหมดที่มี role ในระบบ (อัพเดต realtime จาก Firestore)
  const [users, setUsers] = useState([])

  // สถานะการโหลดข้อมูลครั้งแรก (ซ่อนตารางจนกว่าจะได้ข้อมูล)
  const [loading, setLoading] = useState(true)

  // ค่าใน input fields ของฟอร์มเพิ่ม user ใหม่
  const [emailInput, setEmailInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [roleSelect, setRoleSelect] = useState('manager') // default role = manager

  // ป้องกัน double submit ขณะรอ Firestore write
  const [isBusy, setIsBusy] = useState(false)

  // สถานะ confirm modal: isOpen และ email ของ user ที่จะลบ
  const [confirmState, setConfirmState] = useState({ isOpen: false, email: '' })

  // ข้อความ error ที่แสดงบนหน้า (จะหายอัตโนมัติใน 4 วินาที)
  const [pageError, setPageError] = useState('')

  /**
   * useEffect — ตั้ง realtime listener สำหรับ `users` collection
   * เรียงตาม role เพื่อแสดง admin/manager/ta เป็นกลุ่ม
   * จำกัดที่ 500 users เพื่อป้องกัน over-read
   *
   * Visibility optimization:
   *   - หยุด listener เมื่อ tab ถูก hidden (ประหยัด Firestore reads)
   *   - re-subscribe เมื่อ user กลับมาที่ tab
   */
  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('role'), limit(500))
    let unsub = null

    // สร้าง realtime listener และเก็บ unsubscribe function ไว้
    const subscribe = () => {
      if (!unsub) unsub = onSnapshot(q, (snap) => {
        // ใช้ document ID (email) เป็น key หลักในแต่ละ user object
        setUsers(snap.docs.map(d => ({ email: d.id, ...d.data() })))
        setLoading(false)
      })
    }

    // ยกเลิก listener และ reset ตัวแปร unsub
    const unsubscribe = () => { if (unsub) { unsub(); unsub = null } }

    subscribe()

    // pause/resume listener ตาม tab visibility เพื่อลด Firestore reads
    const handleVisibility = () => document.hidden ? unsubscribe() : subscribe()
    document.addEventListener('visibilitychange', handleVisibility)

    // cleanup: ยกเลิก listener และ event listener เมื่อ component unmount
    return () => { unsubscribe(); document.removeEventListener('visibilitychange', handleVisibility) }
  }, [])

  /**
   * handleAdd — เพิ่มหรืออัพเดต user ใน Firestore
   * ใช้ setDoc (upsert) โดยมี email เป็น document ID
   * validate ว่าเป็น @freshket.co และ role ถูกต้องก่อน write
   */
  async function handleAdd(e) {
    if (e) e.preventDefault()
    const email = emailInput.trim().toLowerCase()
    if (!email) return

    // บังคับใช้เฉพาะ email domain ของ Freshket
    if (!email.endsWith('@freshket.co')) {
      setPageError('อนุญาตเฉพาะ email @freshket.co เท่านั้น')
      setTimeout(() => setPageError(''), 4000)
      return
    }

    // ตรวจสอบ role ว่าอยู่ใน whitelist ก่อน write
    if (!VALID_ROLES.includes(roleSelect)) {
      setPageError('Role ไม่ถูกต้อง')
      setTimeout(() => setPageError(''), 4000)
      return
    }

    setIsBusy(true)
    try {
      // setDoc จะ create หรือ overwrite document ทั้งหมด (ไม่ใช่ merge)
      await setDoc(doc(db, 'users', email), {
        name: nameInput,
        role: roleSelect,
        updatedAt: new Date()
      })
      setEmailInput(''); setNameInput(''); setRoleSelect('manager')
    } catch (e) {
      setPageError('เพิ่มผู้ใช้ไม่สำเร็จ: ' + e.message)
      setTimeout(() => setPageError(''), 4000)
    }
    setIsBusy(false)
  }

  /**
   * handleDelete — ลบ user document ออกจาก Firestore
   * onSnapshot จะอัพเดต local state อัตโนมัติหลังลบสำเร็จ
   */
  async function handleDelete(email) {
    try {
      await deleteDoc(doc(db, 'users', email))
    } catch (e) {
      setPageError('ลบผู้ใช้ไม่สำเร็จ: ' + e.message)
      setTimeout(() => setPageError(''), 4000)
    }
  }

  /**
   * handleUpdateRole — อัพเดต role ของ user ที่มีอยู่แล้วใน Firestore
   * ใช้ merge: true เพื่ออัพเดตเฉพาะ field role โดยไม่ overwrite field อื่น
   * trigger ได้จาก dropdown ในแต่ละแถวของตาราง (inline edit)
   */
  async function handleUpdateRole(email, newRole) {
    // validate role ก่อน write เพื่อป้องกันค่าไม่ถูกต้อง
    if (!VALID_ROLES.includes(newRole)) return
    try {
      await setDoc(doc(db, 'users', email), { role: newRole }, { merge: true })
    } catch (e) {
      setPageError('อัพเดต role ไม่สำเร็จ: ' + e.message)
      setTimeout(() => setPageError(''), 4000)
    }
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-8">
        {/* แสดง error banner เมื่อมีข้อผิดพลาด */}
        {pageError && (
          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl px-5 py-3 text-sm font-bold animate-in fade-in slide-in-from-top-2">
            {pageError}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">จัดการผู้ใช้</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">กำหนดบทบาท Admin, TA หรือ Manager ในระบบ</p>
        </div>

        {/* Add User Form */}
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-6 rounded-3xl shadow-xl shadow-gray-200/40 dark:shadow-none">
          <h2 className="text-sm font-black text-[#008065] dark:text-emerald-500 uppercase tracking-widest mb-4 flex items-center gap-2">
            <UserPlus size={16} /> กำหนด Role ใหม่
          </h2>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <input
              id="user-email" name="user-email"
              type="email" required placeholder="User Email (freshket.co)"
              value={emailInput} onChange={e => setEmailInput(e.target.value)}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <input
              id="user-name" name="user-name"
              type="text" placeholder="Full Name"
              value={nameInput} onChange={e => setNameInput(e.target.value)}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <select
              value={roleSelect} onChange={e => setRoleSelect(e.target.value)}
              className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-950 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              <option value="manager">Manager</option>
              <option value="ta">TA / People Experience</option>
              <option value="admin">Admin</option>
            </select>
            <button
              type="submit" disabled={isBusy}
              className="bg-[#008065] text-white font-bold rounded-xl py-2 shadow-lg shadow-emerald-500/20 transition-all hover:bg-[#006651] disabled:opacity-50"
            >
              บันทึกสิทธิ์
            </button>
          </form>
        </div>

        {/* Users list — แสดง users ทั้งหมดที่มี role พร้อม inline role editor */}
        <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl shadow-xl shadow-gray-200/40 dark:shadow-none overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#fcfdfd] dark:bg-slate-800/30 border-b border-gray-50 dark:border-slate-800/50">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">User</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">Current Role</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {users.map(u => (
                  <tr key={u.email} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-gray-800 dark:text-gray-200">{u.name || '---'}</span>
                        <span className="text-xs text-gray-400 font-medium">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {/* Inline role dropdown — สีเปลี่ยนตาม role: indigo=admin, emerald=ta, orange=manager */}
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdateRole(u.email, e.target.value)}
                        className={`text-xs font-black px-3 py-1.5 rounded-full border border-gray-100 dark:border-slate-800 focus:outline-none transition-colors ${
                          u.role === 'admin' ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400' :
                          u.role === 'ta' ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' :
                          'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                        }`}
                      >
                        <option value="manager">Manager</option>
                        <option value="ta">TA</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {/* ปุ่มลบ — เปิด confirm modal ก่อนลบจริง */}
                      <button
                        onClick={() => setConfirmState({ isOpen: true, email: u.email })}
                        className="p-2 text-gray-300 hover:text-red-500 transition-colors rounded-xl hover:bg-red-50 dark:hover:bg-red-950/20"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
                {/* แสดงข้อความเมื่อยังไม่มี user ในระบบ (โหลดเสร็จแล้วแต่ list ว่าง) */}
                {users.length === 0 && !loading && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-gray-400 font-medium italic">ไม่พบบทบาทผู้ใช้ในฐานข้อมูล</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Confirm modal — ยืนยันก่อนลบ user ออกจากระบบ */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ isOpen: false, email: '' })}
        onConfirm={async () => {
          await handleDelete(confirmState.email)
          setConfirmState({ isOpen: false, email: '' })
        }}
        title="ลบผู้ใช้ออกจากระบบ"
        message={confirmState.email ? `ต้องการลบผู้ใช้ ${confirmState.email} ใช่หรือไม่?` : ''}
        confirmText="ลบผู้ใช้"
        variant="danger"
      />
    </Layout>
  )
}
