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
import { useEffect, useState, useRef } from 'react'
import { doc, onSnapshot, collection, setDoc, deleteDoc, getDoc, getDocs, query, limit, orderBy } from 'firebase/firestore'
import { db } from '../services/firebase'
import { UserPlus, Trash2, Building2, ChevronDown, ChevronUp, X } from 'lucide-react'
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

  // ── Department assignment ─────────────────────────────────────────────────
  const [allDepts,    setAllDepts]    = useState([])   // unique depts จาก hc_requests
  const [deptMapping, setDeptMapping] = useState({})   // settings/deptManagers { dept: email }
  const [selectedDepts, setSelectedDepts] = useState([]) // เลือกแผนกในฟอร์ม
  const [deptOpen,    setDeptOpen]    = useState(false) // toggle dropdown เลือกแผนก
  const [editDeptFor, setEditDeptFor] = useState(null) // email ของ row ที่กำลัง edit dept
  const [editDeptOpen, setEditDeptOpen] = useState(false)
  const deptRef = useRef(null)
  const editDeptRef = useRef(null)

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

  /** โหลด departments ทั้งหมด + deptMapping เมื่อ component mount */
  useEffect(() => {
    async function loadDeptData() {
      const [reqSnap, settingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'hc_requests'), limit(3000))),
        getDoc(doc(db, 'settings', 'deptManagers')),
      ])
      const deptSet = new Set()
      reqSnap.docs.forEach(d => { if (d.data().department) deptSet.add(d.data().department) })
      setAllDepts([...deptSet].sort((a, b) => a.localeCompare(b, 'th')))
      setDeptMapping(settingsSnap.exists() ? settingsSnap.data() : {})
    }
    loadDeptData()

    // ปิด dropdown เมื่อคลิกนอก
    const handleClick = (e) => {
      if (deptRef.current && !deptRef.current.contains(e.target)) setDeptOpen(false)
      if (editDeptRef.current && !editDeptRef.current.contains(e.target)) { setEditDeptFor(null); setEditDeptOpen(false) }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  /** รับ dept list ของ manager email นั้นๆ จาก deptMapping */
  function getManagerDepts(email) {
    return Object.entries(deptMapping)
      .filter(([, v]) => v === email.toLowerCase())
      .map(([dept]) => dept)
  }

  /** อัปเดต deptMapping ใน Firestore + local state */
  async function saveDeptMapping(newMapping) {
    await setDoc(doc(db, 'settings', 'deptManagers'), newMapping)
    setDeptMapping(newMapping)
  }

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

      // ถ้าเป็น manager และเลือกแผนกไว้ → อัปเดต deptMapping
      if (roleSelect === 'manager' && selectedDepts.length > 0) {
        const newMapping = { ...deptMapping }
        // ลบ mapping เดิมของ email นี้ก่อน (กรณี re-assign)
        Object.keys(newMapping).forEach(k => { if (newMapping[k] === email) delete newMapping[k] })
        selectedDepts.forEach(dept => { newMapping[dept] = email })
        await saveDeptMapping(newMapping)
      }

      setEmailInput(''); setNameInput(''); setRoleSelect('manager'); setSelectedDepts([])
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
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                value={roleSelect} onChange={e => { setRoleSelect(e.target.value); setSelectedDepts([]) }}
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
            </div>

            {/* Dept selector — แสดงเฉพาะเมื่อ role = manager */}
            {roleSelect === 'manager' && (
              <div className="flex items-start gap-3">
                <Building2 size={15} className="text-orange-400 mt-2.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1.5">แผนกที่ดูแล</p>
                  {/* Selected chips */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {selectedDepts.map(d => (
                      <span key={d} className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                        {d}
                        <button type="button" onClick={() => setSelectedDepts(s => s.filter(x => x !== d))}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    {selectedDepts.length === 0 && (
                      <span className="text-[11px] text-gray-400 italic">ยังไม่ได้เลือกแผนก</span>
                    )}
                  </div>
                  {/* Dropdown */}
                  <div ref={deptRef} className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setDeptOpen(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border border-orange-200 dark:border-orange-800 bg-white dark:bg-slate-900 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                    >
                      <Building2 size={12}/> เลือกแผนก {deptOpen ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                    </button>
                    {deptOpen && (
                      <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl py-2 min-w-56 max-h-60 overflow-y-auto">
                        {allDepts.map(d => (
                          <button
                            key={d} type="button"
                            onClick={() => setSelectedDepts(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d])}
                            className={`w-full text-left px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${selectedDepts.includes(d) ? 'text-orange-600 dark:text-orange-400 font-bold' : 'text-gray-700 dark:text-gray-300'}`}
                          >
                            {d}
                            {selectedDepts.includes(d) && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
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
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap">แผนกที่ดูแล</th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest whitespace-nowrap text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                {users.map(u => {
                  const managerDepts = u.role === 'manager' ? getManagerDepts(u.email) : []
                  const isEditingDept = editDeptFor === u.email
                  return (
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
                    <td className="px-6 py-4">
                      {u.role === 'manager' ? (
                        <div ref={isEditingDept ? editDeptRef : null} className="relative">
                          {/* แสดง dept chips + ปุ่ม edit */}
                          <div className="flex flex-wrap gap-1 items-center">
                            {managerDepts.length > 0
                              ? managerDepts.map(d => (
                                  <span key={d} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400">{d}</span>
                                ))
                              : <span className="text-[10px] text-gray-400 italic">ยังไม่ได้กำหนด</span>
                            }
                            <button
                              onClick={() => { setEditDeptFor(u.email); setEditDeptOpen(true) }}
                              className="text-[10px] text-gray-400 hover:text-orange-500 ml-1 flex items-center gap-0.5"
                            >
                              <Building2 size={11}/> แก้ไข
                            </button>
                          </div>
                          {/* Dropdown edit แผนก */}
                          {isEditingDept && editDeptOpen && (
                            <div className="absolute top-full left-0 mt-1 z-20 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-xl py-2 min-w-56 max-h-60 overflow-y-auto">
                              {allDepts.map(d => {
                                const checked = managerDepts.includes(d)
                                return (
                                  <button
                                    key={d}
                                    onClick={async () => {
                                      const newMapping = { ...deptMapping }
                                      if (checked) {
                                        delete newMapping[d]
                                      } else {
                                        // ถ้า dept นี้มี manager อื่นอยู่แล้ว ให้ override
                                        newMapping[d] = u.email.toLowerCase()
                                      }
                                      await saveDeptMapping(newMapping)
                                    }}
                                    className={`w-full text-left px-4 py-2 text-xs font-medium flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${checked ? 'text-orange-600 dark:text-orange-400 font-bold' : 'text-gray-700 dark:text-gray-300'}`}
                                  >
                                    {d}
                                    {checked && <span className="w-2 h-2 rounded-full bg-orange-400 shrink-0" />}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px] text-gray-300 dark:text-slate-600">—</span>
                      )}
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
                  )
                })}
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
