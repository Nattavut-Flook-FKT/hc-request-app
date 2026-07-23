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
import { db } from '@/libs/firebase'
import { UserPlus, Trash2, Building2, Network, ChevronDown, ChevronUp, X, Clock3 } from 'lucide-react'
import Layout from '@/components/app-shell/Layout'
import ConfirmModal from '@/components/ui/ConfirmModal'
import { DIVISIONS } from '@/config/orgStructure'
import { grantEmails, grantedKeys } from '@/utils/grants'

// roles ที่อนุญาตให้กำหนดได้ในระบบ — ใช้ validate ทั้งตอน add และ update
const VALID_ROLES = ['manager', 'ta', 'admin', 'ceo']

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

  // ── Division assignment (Head of Division — คุม "ทั้ง Division" แทนที่จะ grant ทีละแผนก) ───
  const [divisionMapping, setDivisionMapping] = useState({})   // settings/divisionManagers { division: email }
  const [selectedDivisions, setSelectedDivisions] = useState([]) // เลือก division ในฟอร์ม
  const [divOpen,    setDivOpen]    = useState(false) // toggle dropdown เลือก division
  const [editDivFor, setEditDivFor] = useState(null) // email ของ row ที่กำลัง edit division
  const [editDivOpen, setEditDivOpen] = useState(false)
  const divRef = useRef(null)
  const editDivRef = useRef(null)

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

  /** โหลด departments ทั้งหมด + deptMapping + divisionMapping เมื่อ component mount */
  useEffect(() => {
    async function loadDeptData() {
      const [reqSnap, settingsSnap, divSnap] = await Promise.all([
        getDocs(query(collection(db, 'hc_requests'), limit(3000))),
        getDoc(doc(db, 'settings', 'deptManagers')),
        getDoc(doc(db, 'settings', 'divisionManagers')),
      ])
      const deptSet = new Set()
      reqSnap.docs.forEach(d => { if (d.data().department) deptSet.add(d.data().department) })
      setAllDepts([...deptSet].sort((a, b) => a.localeCompare(b, 'th')))
      setDeptMapping(settingsSnap.exists() ? settingsSnap.data() : {})
      setDivisionMapping(divSnap.exists() ? divSnap.data() : {})
    }
    loadDeptData()

    // ปิด dropdown เมื่อคลิกนอก
    const handleClick = (e) => {
      if (deptRef.current && !deptRef.current.contains(e.target)) setDeptOpen(false)
      if (editDeptRef.current && !editDeptRef.current.contains(e.target)) { setEditDeptFor(null); setEditDeptOpen(false) }
      if (divRef.current && !divRef.current.contains(e.target)) setDivOpen(false)
      if (editDivRef.current && !editDivRef.current.contains(e.target)) { setEditDivFor(null); setEditDivOpen(false) }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  /** รับ dept list ของ manager email นั้นๆ จาก deptMapping (รองรับทั้งค่าเก่า string และใหม่ array) */
  function getManagerDepts(email) {
    return grantedKeys(deptMapping, email)
  }

  /** อัปเดต deptMapping ใน Firestore + local state */
  async function saveDeptMapping(newMapping) {
    await setDoc(doc(db, 'settings', 'deptManagers'), newMapping)
    setDeptMapping(newMapping)
  }

  /** รับ division list ของ manager email นั้นๆ จาก divisionMapping */
  function getManagerDivisions(email) {
    return grantedKeys(divisionMapping, email)
  }

  /** อัปเดต divisionMapping ใน Firestore + local state */
  async function saveDivisionMapping(newMapping) {
    await setDoc(doc(db, 'settings', 'divisionManagers'), newMapping)
    setDivisionMapping(newMapping)
  }

  /** เพิ่มอีเมลเข้า grant ของ key นั้น (เก็บเป็น array เสมอ — 1 แผนกมีได้หลาย Manager) */
  function addToGrant(mapping, key, email) {
    return { ...mapping, [key]: [...new Set([...grantEmails(mapping[key]), email.toLowerCase()])] }
  }

  /** ถอดอีเมลออกจาก grant ของ key นั้น — ถ้าไม่เหลือใครให้ลบ key ทิ้ง */
  function removeFromGrant(mapping, key, email) {
    const rest = grantEmails(mapping[key]).filter(e => e !== email.toLowerCase())
    const next = { ...mapping }
    if (rest.length === 0) delete next[key]
    else next[key] = rest
    return next
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
      // (ถอด email นี้ออกจากแผนกเดิมทั้งหมดก่อนแล้วเพิ่มเข้าแผนกที่เลือก — ไม่กระทบ Manager คนอื่นที่ถือแผนกร่วมกัน)
      if (roleSelect === 'manager' && selectedDepts.length > 0) {
        let newMapping = { ...deptMapping }
        Object.keys(newMapping).forEach(k => { newMapping = removeFromGrant(newMapping, k, email) })
        selectedDepts.forEach(dept => { newMapping = addToGrant(newMapping, dept, email) })
        await saveDeptMapping(newMapping)
      }

      // ถ้าเป็น manager และเลือก division ไว้ (Head of Division) → อัปเดต divisionMapping
      if (roleSelect === 'manager' && selectedDivisions.length > 0) {
        let newDivMapping = { ...divisionMapping }
        Object.keys(newDivMapping).forEach(k => { newDivMapping = removeFromGrant(newDivMapping, k, email) })
        selectedDivisions.forEach(division => { newDivMapping = addToGrant(newDivMapping, division, email) })
        await saveDivisionMapping(newDivMapping)
      }

      setEmailInput(''); setNameInput(''); setRoleSelect('manager'); setSelectedDepts([]); setSelectedDivisions([])
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
          <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">
            {pageError}
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-neutral-900">จัดการผู้ใช้</h1>
          <p className="mt-0.5 text-sm text-neutral-500">กำหนดบทบาท Admin, TA หรือ Manager ในระบบ</p>
        </div>

        {/* Pending Approval — user ที่ login ครั้งแรกแล้วรอ Admin กำหนด role
            แสดงแยกต่างหากด้านบนสุด ให้เห็นชัดทันทีว่าใครกำลังรออยู่ ไม่ต้องไล่หาในตารางรวม */}
        {users.filter(u => u.role === 'pending').length > 0 && (
          <div className="rounded-3xl border border-yellow-100 bg-yellow-50 p-6">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-yellow-900">
              <Clock3 size={16} strokeWidth={1} absoluteStrokeWidth />
              รออนุมัติ ({users.filter(u => u.role === 'pending').length})
            </h2>
            <div className="flex flex-col gap-2">
              {users.filter(u => u.role === 'pending').map(u => (
                <div key={u.email} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-yellow-100 bg-white px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-bold text-neutral-900">{u.name || '---'}</span>
                    <span className="text-xs text-neutral-400">{u.email}</span>
                  </div>
                  <select
                    defaultValue=""
                    onChange={(e) => e.target.value && handleUpdateRole(u.email, e.target.value)}
                    className="rounded-full border border-neutral-100 bg-neutral-50 px-3 py-1.5 text-xs font-bold text-neutral-700 transition-colors focus:outline-none"
                  >
                    <option value="" disabled>เลือก Role...</option>
                    <option value="manager">Manager</option>
                    <option value="ta">TA</option>
                    <option value="admin">Admin</option>
                    <option value="ceo">CEO</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add User Form */}
        <div className="rounded-3xl border border-neutral-100 bg-white p-6">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-dark-green-700">
            <UserPlus size={16} strokeWidth={1} absoluteStrokeWidth /> กำหนด Role ใหม่
          </h2>
          <form onSubmit={handleAdd} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <input
                id="user-email" name="user-email"
                type="email" required placeholder="User Email (freshket.co)"
                value={emailInput} onChange={e => setEmailInput(e.target.value)}
                className="rounded-lg border border-neutral-100 bg-white px-4 py-2 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              />
              <input
                id="user-name" name="user-name"
                type="text" placeholder="Full Name"
                value={nameInput} onChange={e => setNameInput(e.target.value)}
                className="rounded-lg border border-neutral-100 bg-white px-4 py-2 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              />
              <select
                value={roleSelect} onChange={e => { setRoleSelect(e.target.value); setSelectedDepts([]); setSelectedDivisions([]) }}
                className="rounded-lg border border-neutral-100 bg-white px-4 py-2 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              >
                <option value="manager">Manager</option>
                <option value="ta">TA / People Experience</option>
                <option value="admin">Admin</option>
                <option value="ceo">CEO</option>
              </select>
              <button
                type="submit" disabled={isBusy}
                className="rounded-lg bg-dark-green-600 py-2 font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
              >
                บันทึกสิทธิ์
              </button>
            </div>

            {/* Dept selector — แสดงเฉพาะเมื่อ role = manager */}
            {roleSelect === 'manager' && (
              <div className="flex items-start gap-3">
                <Building2 size={15} strokeWidth={1} absoluteStrokeWidth className="mt-2.5 shrink-0 text-orange-400" />
                <div className="flex-1">
                  <p className="mb-1.5 text-xs font-bold text-neutral-500">แผนกที่ดูแล</p>
                  {/* Selected chips */}
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {selectedDepts.map(d => (
                      <span key={d} className="flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-1 text-[11px] font-bold text-orange-900">
                        {d}
                        <button type="button" onClick={() => setSelectedDepts(s => s.filter(x => x !== d))}>
                          <X size={10} strokeWidth={1} absoluteStrokeWidth />
                        </button>
                      </span>
                    ))}
                    {selectedDepts.length === 0 && (
                      <span className="text-[11px] italic text-neutral-400">ยังไม่ได้เลือกแผนก</span>
                    )}
                  </div>
                  {/* Dropdown */}
                  <div ref={deptRef} className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setDeptOpen(v => !v)}
                      className="flex items-center gap-1.5 rounded-lg border border-orange-100 bg-white px-3 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-50"
                    >
                      <Building2 size={12} strokeWidth={1} absoluteStrokeWidth/> เลือกแผนก {deptOpen ? <ChevronUp size={11} strokeWidth={1} absoluteStrokeWidth/> : <ChevronDown size={11} strokeWidth={1} absoluteStrokeWidth/>}
                    </button>
                    {deptOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-2xl border border-neutral-100 bg-white py-2 shadow-xl">
                        {allDepts.map(d => (
                          <button
                            key={d} type="button"
                            onClick={() => setSelectedDepts(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d])}
                            className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 ${selectedDepts.includes(d) ? 'font-bold text-orange-700' : 'text-neutral-700'}`}
                          >
                            {d}
                            {selectedDepts.includes(d) && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Division selector — สำหรับ Head of Division ที่ดูแลทั้ง division (ทุกแผนกในนั้นอัตโนมัติ) */}
            {roleSelect === 'manager' && (
              <div className="flex items-start gap-3">
                <Network size={15} strokeWidth={1} absoluteStrokeWidth className="mt-2.5 shrink-0 text-blue-400" />
                <div className="flex-1">
                  <p className="mb-1.5 text-xs font-bold text-neutral-500">Division ที่ดูแลทั้งหมด (Head of Division)</p>
                  {/* Selected chips */}
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {selectedDivisions.map(d => (
                      <span key={d} className="flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-900">
                        {d}
                        <button type="button" onClick={() => setSelectedDivisions(s => s.filter(x => x !== d))}>
                          <X size={10} strokeWidth={1} absoluteStrokeWidth />
                        </button>
                      </span>
                    ))}
                    {selectedDivisions.length === 0 && (
                      <span className="text-[11px] italic text-neutral-400">ยังไม่ได้เลือก division (ไม่บังคับ — ใช้เมื่อต้องดูแลทุกแผนกในสาย)</span>
                    )}
                  </div>
                  {/* Dropdown */}
                  <div ref={divRef} className="relative inline-block">
                    <button
                      type="button"
                      onClick={() => setDivOpen(v => !v)}
                      className="flex items-center gap-1.5 rounded-lg border border-blue-100 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                    >
                      <Network size={12} strokeWidth={1} absoluteStrokeWidth/> เลือก Division {divOpen ? <ChevronUp size={11} strokeWidth={1} absoluteStrokeWidth/> : <ChevronDown size={11} strokeWidth={1} absoluteStrokeWidth/>}
                    </button>
                    {divOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-2xl border border-neutral-100 bg-white py-2 shadow-xl">
                        {DIVISIONS.map(d => (
                          <button
                            key={d} type="button"
                            onClick={() => setSelectedDivisions(s => s.includes(d) ? s.filter(x => x !== d) : [...s, d])}
                            className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 ${selectedDivisions.includes(d) ? 'font-bold text-blue-700' : 'text-neutral-700'}`}
                          >
                            {d}
                            {selectedDivisions.includes(d) && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
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
        <div className="overflow-hidden rounded-3xl border border-neutral-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-neutral-100 bg-neutral-50">
                <tr>
                  <th className="whitespace-nowrap px-6 py-4 text-[11px] font-bold text-neutral-500">User</th>
                  <th className="whitespace-nowrap px-6 py-4 text-[11px] font-bold text-neutral-500">Current Role</th>
                  <th className="whitespace-nowrap px-6 py-4 text-[11px] font-bold text-neutral-500">แผนกที่ดูแล</th>
                  <th className="whitespace-nowrap px-6 py-4 text-right text-[11px] font-bold text-neutral-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {users.map(u => {
                  const managerDepts = u.role === 'manager' ? getManagerDepts(u.email) : []
                  const managerDivisions = u.role === 'manager' ? getManagerDivisions(u.email) : []
                  const isEditingDept = editDeptFor === u.email
                  const isEditingDiv = editDivFor === u.email
                  return (
                  <tr key={u.email} className="transition-colors hover:bg-neutral-50">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-neutral-900">{u.name || '---'}</span>
                        <span className="text-xs text-neutral-400">{u.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {/* Inline role dropdown — สีเปลี่ยนตาม role: purple=admin, dark-green=ta, orange=manager */}
                      <select
                        value={u.role}
                        onChange={(e) => handleUpdateRole(u.email, e.target.value)}
                        className={`rounded-full border border-neutral-100 px-3 py-1.5 text-xs font-bold transition-colors focus:outline-none ${
                          u.role === 'admin' ? 'bg-purple-50 text-purple-900' :
                          u.role === 'ta' ? 'bg-dark-green-50 text-dark-green-900' :
                          u.role === 'ceo' ? 'bg-blue-50 text-blue-900' :
                          u.role === 'pending' ? 'bg-yellow-50 text-yellow-900' :
                          'bg-orange-50 text-orange-900'
                        }`}
                      >
                        {/* 'pending' = user เพิ่ง login ครั้งแรก รอ Admin เลือก role จริง — เลือกไม่ได้ มีไว้แสดงผลเท่านั้น */}
                        {u.role === 'pending' && <option value="pending" disabled>รออนุมัติ</option>}
                        <option value="manager">Manager</option>
                        <option value="ta">TA</option>
                        <option value="admin">Admin</option>
                        <option value="ceo">CEO</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {u.role === 'manager' ? (
                        <div className="flex flex-col gap-1.5">
                          {/* Division grant (Head of Division) */}
                          <div ref={isEditingDiv ? editDivRef : null} className="relative">
                            <div className="flex flex-wrap items-center gap-1">
                              {managerDivisions.length > 0 && managerDivisions.map(d => (
                                <span key={d} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800">{d} (ทั้ง Division)</span>
                              ))}
                              <button
                                onClick={() => { setEditDivFor(u.email); setEditDivOpen(true) }}
                                className="flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-blue-600"
                              >
                                <Network size={11} strokeWidth={1} absoluteStrokeWidth/> {managerDivisions.length > 0 ? 'แก้ไข Division' : '+ Division'}
                              </button>
                            </div>
                            {/* Dropdown edit division */}
                            {isEditingDiv && editDivOpen && (
                              <div className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-2xl border border-neutral-100 bg-white py-2 shadow-xl">
                                {DIVISIONS.map(d => {
                                  const checked = managerDivisions.includes(d)
                                  return (
                                    <button
                                      key={d}
                                      onClick={async () => {
                                        // toggle เฉพาะอีเมลคนนี้ใน array — ไม่กระทบ Manager คนอื่นที่ถือ division ร่วมกัน
                                        const newMapping = checked
                                          ? removeFromGrant(divisionMapping, d, u.email)
                                          : addToGrant(divisionMapping, d, u.email)
                                        await saveDivisionMapping(newMapping)
                                      }}
                                      className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 ${checked ? 'font-bold text-blue-700' : 'text-neutral-700'}`}
                                    >
                                      {d}
                                      {checked && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          {/* Department grant — แสดงเฉพาะแผนกเดี่ยว (Head of Division ไม่จำเป็นต้องกำหนดตรงนี้) */}
                          <div ref={isEditingDept ? editDeptRef : null} className="relative">
                            <div className="flex flex-wrap items-center gap-1">
                              {managerDepts.length > 0
                                ? managerDepts.map(d => (
                                    <span key={d} className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">{d}</span>
                                  ))
                                : managerDivisions.length === 0 && <span className="text-[10px] italic text-neutral-400">ยังไม่ได้กำหนด</span>
                              }
                              <button
                                onClick={() => { setEditDeptFor(u.email); setEditDeptOpen(true) }}
                                className="ml-1 flex items-center gap-0.5 text-[10px] text-neutral-400 hover:text-orange-600"
                              >
                                <Building2 size={11} strokeWidth={1} absoluteStrokeWidth/> แก้ไข
                              </button>
                            </div>
                            {/* Dropdown edit แผนก */}
                            {isEditingDept && editDeptOpen && (
                              <div className="absolute left-0 top-full z-20 mt-1 max-h-60 min-w-56 overflow-y-auto rounded-2xl border border-neutral-100 bg-white py-2 shadow-xl">
                                {allDepts.map(d => {
                                  const checked = managerDepts.includes(d)
                                  return (
                                    <button
                                      key={d}
                                      onClick={async () => {
                                        // toggle เฉพาะอีเมลคนนี้ใน array — ไม่ทับ Manager คนอื่นที่ถือแผนกร่วมกัน (เดิม override ทิ้งแบบเงียบๆ)
                                        const newMapping = checked
                                          ? removeFromGrant(deptMapping, d, u.email)
                                          : addToGrant(deptMapping, d, u.email)
                                        await saveDeptMapping(newMapping)
                                      }}
                                      className={`flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-50 ${checked ? 'font-bold text-orange-700' : 'text-neutral-700'}`}
                                    >
                                      {d}
                                      {checked && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-400" />}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-neutral-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {/* ปุ่มลบ — เปิด confirm modal ก่อนลบจริง */}
                      <button
                        onClick={() => setConfirmState({ isOpen: true, email: u.email })}
                        className="rounded-lg p-2 text-neutral-300 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 size={16} strokeWidth={1} absoluteStrokeWidth />
                      </button>
                    </td>
                  </tr>
                  )
                })}
                {/* แสดงข้อความเมื่อยังไม่มี user ในระบบ (โหลดเสร็จแล้วแต่ list ว่าง) */}
                {users.length === 0 && !loading && (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center italic text-neutral-400">ไม่พบบทบาทผู้ใช้ในฐานข้อมูล</td>
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
