/**
 * AdminToolsPage.jsx — Admin Bulk-Clear Toolbox
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าเครื่องมือสำหรับ Admin เพื่อลบข้อมูลจำนวนมากออกจากระบบ
 * รองรับการล้าง 4 ชุดข้อมูลหลัก ได้แก่ Audit Log, Custom Positions,
 * JD Files (Supabase Storage) และ HC Requests ทั้งหมด
 *
 * Props / Features:
 *   - user        — ข้อมูล user ที่ล็อกอินอยู่ (ส่งต่อไปยัง Layout)
 *   - role        — บทบาทของ user เพื่อควบคุมการแสดงผล Layout
 *   - isDarkMode  — สถานะ dark mode ปัจจุบัน
 *   - toggleDarkMode — ฟังก์ชันสลับ dark/light mode
 *   - ทุก clear action ต้องผ่าน confirm modal ก่อนดำเนินการจริง
 *   - Firestore batch delete รองรับ chunking ทีละ 400 docs (ต่ำกว่า limit 500)
 *
 * Notes:
 *   - การกระทำทุกอย่างในหน้านี้ไม่สามารถย้อนกลับได้ (irreversible)
 *   - JD files ถูกเก็บใน Supabase Storage ไม่ใช่ Firestore จึงใช้ API คนละชุด
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState, useRef, useCallback } from 'react'
import { collection, getDocs, getDoc, setDoc, writeBatch, doc, runTransaction, updateDoc, query, where, orderBy, limit } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Clock, Tag, FileText, Trash2, DatabaseZap, Settings2, AlertTriangle, RefreshCw, CheckCircle2, AlertCircle, UserCog, Users, ChevronDown, ChevronUp, Lock, Eye, EyeOff } from 'lucide-react'

const ADMIN_PIN = import.meta.env.VITE_ADMIN_TOOLS_PIN || 'Admin2025'
import { listJDFiles, deleteJDFile } from '../services/supabase'
import { syncFromSheets, syncBatchToSheets } from '../services/webhook'
import Layout from '../components/Shared/Layout'

/** ตัดนามสกุลออก เหลือแค่ "ชื่อ (nickname)" — เหมือน RequestTable.shortName */
function shortName(fullName) {
  if (!fullName) return fullName
  const match = fullName.match(/^.+?\)/)
  return match ? match[0].trim() : fullName
}

export default function AdminToolsPage({ user, role, isDarkMode, toggleDarkMode }) {
  // ── Password Gate ─────────────────────────────────────────────────────────
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem('adminToolsUnlocked') === '1')
  const [pinInput, setPinInput] = useState('')
  const [pinError, setPinError] = useState(false)
  const [showPin, setShowPin] = useState(false)

  function handlePinSubmit(e) {
    e.preventDefault()
    if (pinInput === ADMIN_PIN) {
      sessionStorage.setItem('adminToolsUnlocked', '1')
      setUnlocked(true)
      setPinError(false)
    } else {
      setPinError(true)
      setPinInput('')
    }
  }

  // ── สถานะการทำงานของแต่ละ tool ────────────────────────────────────────────
  const [status, setStatus] = useState({})

  // key ของ tool ที่กำลังรอการยืนยันจาก confirm modal (null = ไม่มี modal เปิด)
  const [confirm, setConfirm] = useState(null)

  // ── Sync from Sheets state ────────────────────────────────────────────────
  const [syncState,  setSyncState]  = useState('idle')  // 'idle'|'running'|'done'|'error'
  const [syncResult, setSyncResult] = useState(null)

  // ── Fix TA Names state ────────────────────────────────────────────────────
  const [fixNamesState,  setFixNamesState]  = useState('idle') // 'idle'|'running'|'done'|'error'
  const [fixNamesResult, setFixNamesResult] = useState(null)

  // ── Fix Requester Email-as-Name state ─────────────────────────────────────
  const [fixEmailNameState,  setFixEmailNameState]  = useState('idle')
  const [fixEmailNameResult, setFixEmailNameResult] = useState(null)

  // ── Department Manager Assignment state ──────────────────────────────────
  const [deptState,     setDeptState]     = useState('idle') // 'idle'|'loading'|'ready'|'saving'|'saved'|'error'
  const [departments,   setDepartments]   = useState([])     // [{name, total}]
  const [deptManagers,  setDeptManagers]  = useState({})     // { deptName: email }
  const [deptLookup,    setDeptLookup]    = useState({})     // { deptName: { loading, found, name } }
  const [deptExpanded,  setDeptExpanded]  = useState(false)
  const lookupTimers = useRef({})

  /** lookupEmail — debounce 600ms แล้ว getDoc จาก users collection */
  const lookupEmail = useCallback((dept, email) => {
    clearTimeout(lookupTimers.current[dept])
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) {
      setDeptLookup(l => ({ ...l, [dept]: null }))
      return
    }
    setDeptLookup(l => ({ ...l, [dept]: { loading: true } }))
    lookupTimers.current[dept] = setTimeout(async () => {
      try {
        const snap = await getDoc(doc(db, 'users', trimmed))
        if (snap.exists()) {
          setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: true, name: snap.data().name || trimmed } }))
        } else {
          setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: false } }))
        }
      } catch {
        setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: false } }))
      }
    }, 600)
  }, [])

  /**
   * fixTANames — แปลง assignedToName + changedByName ที่มีชื่อเต็ม (เช่น "Jitlada (Mo) Mooltha")
   * ให้เหลือแค่ชื่อสั้น "Jitlada (Mo)" เพื่อให้ตรงกับข้อมูลที่ Import จาก Sheets
   */
  async function fixTANames() {
    if (fixNamesState === 'running') return
    setFixNamesState('running')
    setFixNamesResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))
      const CHUNK = 400
      let updatedDocs = 0
      const toUpdate = [] // { ref, data }

      snap.docs.forEach(d => {
        const data = d.data()
        const updates = {}

        // แก้ assignedToName
        if (data.assignedToName) {
          const fixed = shortName(data.assignedToName)
          if (fixed !== data.assignedToName) updates.assignedToName = fixed
        }

        // แก้ changedByName ใน statusHistory array
        if (data.statusHistory?.length > 0) {
          const fixedHistory = data.statusHistory.map(entry => {
            if (!entry.changedByName) return entry
            const fixed = shortName(entry.changedByName)
            return fixed !== entry.changedByName ? { ...entry, changedByName: fixed } : entry
          })
          // เช็คว่ามีการเปลี่ยนแปลงจริงไหม
          const changed = fixedHistory.some((h, i) => h.changedByName !== data.statusHistory[i].changedByName)
          if (changed) updates.statusHistory = fixedHistory
        }

        if (Object.keys(updates).length > 0) toUpdate.push({ ref: doc(db, 'hc_requests', d.id), updates })
      })

      // batch write ทีละ 400
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const batch = writeBatch(db)
        toUpdate.slice(i, i + CHUNK).forEach(({ ref, updates }) => batch.update(ref, updates))
        await batch.commit()
        updatedDocs += toUpdate.slice(i, i + CHUNK).length
      }

      setFixNamesResult({ total: snap.size, updated: updatedDocs })
      setFixNamesState('done')
    } catch (err) {
      console.error('[fixTANames]', err)
      setFixNamesResult({ error: err.message })
      setFixNamesState('error')
    }
    setTimeout(() => { setFixNamesState('idle'); setFixNamesResult(null) }, 8000)
  }

  /**
   * fixRequesterEmailName — หา records ที่ requesterName มี '@' (email หลุดมาเป็นชื่อ)
   * lookup ชื่อจริงจาก users collection แล้ว batch update requesterName
   */
  async function fixRequesterEmailName() {
    if (fixEmailNameState === 'running') return
    setFixEmailNameState('running')
    setFixEmailNameResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))

      // หา records ที่ requesterName เป็น email (มี @)
      const badDocs = snap.docs.filter(d => {
        const name = d.data().requesterName || ''
        return name.includes('@')
      })

      if (!badDocs.length) {
        setFixEmailNameResult({ updated: 0, total: snap.size })
        setFixEmailNameState('done')
        setTimeout(() => { setFixEmailNameState('idle'); setFixEmailNameResult(null) }, 6000)
        return
      }

      // หา unique emails ที่ต้อง lookup
      const uniqueEmails = [...new Set(badDocs.map(d => d.data().requesterName.toLowerCase()))]
      const nameMap = {}
      await Promise.all(uniqueEmails.map(async email => {
        const userSnap = await getDoc(doc(db, 'users', email))
        nameMap[email] = userSnap.exists() ? (userSnap.data().name || null) : null
      }))

      // เฉพาะ records ที่ lookup เจอชื่อจริง
      const toUpdate = badDocs.filter(d => nameMap[d.data().requesterName.toLowerCase()])

      const CHUNK = 400
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const batch = writeBatch(db)
        toUpdate.slice(i, i + CHUNK).forEach(d => {
          const realName = nameMap[d.data().requesterName.toLowerCase()]
          batch.update(d.ref, { requesterName: realName })
        })
        await batch.commit()
      }

      setFixEmailNameResult({ updated: toUpdate.length, skipped: badDocs.length - toUpdate.length, total: snap.size })
      setFixEmailNameState('done')
    } catch (err) {
      console.error('[fixRequesterEmailName]', err)
      setFixEmailNameResult({ error: err.message })
      setFixEmailNameState('error')
    }
    setTimeout(() => { setFixEmailNameState('idle'); setFixEmailNameResult(null) }, 8000)
  }

  /** loadDepartments — ดึงแผนกทั้งหมด + mapping ที่บันทึกไว้แล้วจาก settings/deptManagers */
  async function loadDepartments() {
    setDeptState('loading')
    try {
      const [reqSnap, settingsSnap] = await Promise.all([
        getDocs(collection(db, 'hc_requests')),
        getDoc(doc(db, 'settings', 'deptManagers')),
      ])
      const existing = settingsSnap.exists() ? settingsSnap.data() : {}

      // รวม dept ทั้งหมดจาก requests
      const countMap = {}
      reqSnap.docs.forEach(d => {
        const dept = d.data().department || 'ไม่ระบุ'
        countMap[dept] = (countMap[dept] || 0) + 1
      })
      const depts = Object.entries(countMap)
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => a.name.localeCompare(b.name, 'th'))

      setDepartments(depts)
      // pre-fill email จาก existing mapping
      setDeptManagers(Object.fromEntries(depts.map(d => [d.name, existing[d.name] || ''])))
      // trigger lookup สำหรับ dept ที่มี email อยู่แล้ว
      setDeptLookup({})
      Object.entries(existing).forEach(([dept, email]) => {
        if (email) setTimeout(() => lookupEmail(dept, email), 0)
      })
      setDeptState('ready')
      setDeptExpanded(true)
    } catch (err) {
      console.error('[loadDepartments]', err)
      setDeptState('error')
    }
  }

  /** saveDeptManagers — บันทึก mapping dept → email ลง settings/deptManagers */
  async function saveDeptManagers() {
    setDeptState('saving')
    try {
      // เอาเฉพาะ dept ที่ lookup found เท่านั้น
      const mapping = {}
      Object.entries(deptLookup).forEach(([dept, v]) => {
        if (v?.found) mapping[dept] = deptManagers[dept].trim().toLowerCase()
      })
      await setDoc(doc(db, 'settings', 'deptManagers'), mapping)
      setDeptState('saved')
      setTimeout(() => setDeptState('ready'), 3000)
    } catch (err) {
      console.error('[saveDeptManagers]', err)
      setDeptState('error')
    }
  }

  async function handleSyncSheets() {
    if (syncState === 'running') return
    setSyncState('running')
    setSyncResult(null)
    try {
      const res = await syncFromSheets()
      setSyncResult(res)
      setSyncState(res.success ? 'done' : 'error')
    } catch (err) {
      setSyncResult({ success: false, error: err.message })
      setSyncState('error')
    }
    setTimeout(() => { setSyncState('idle'); setSyncResult(null) }, 6000)
  }

  // ── Fix Duplicate HCIDs state ─────────────────────────────────────────────
  const [fixDupState,  setFixDupState]  = useState('idle') // 'idle'|'running'|'done'|'error'
  const [fixDupResult, setFixDupResult] = useState(null)

  /**
   * fixDuplicateHCIDs — หา hcId ที่ซ้ำใน Firestore แล้วกำหนด ID ใหม่ให้ doc ที่เกิน
   * doc เก่าที่สุด (createdAt น้อยสุด) ต่อ hcId = ตรงกับ Sheets → เก็บไว้
   * doc ที่เหลือ = reassign ID ใหม่ → update Firestore + push ไป Sheets
   */
  async function fixDuplicateHCIDs() {
    if (fixDupState === 'running') return
    setFixDupState('running')
    setFixDupResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))

      // จัดกลุ่มตาม hcId
      const groups = {}
      snap.docs.forEach(d => {
        const hcId = d.data().hcId
        if (!hcId) return
        if (!groups[hcId]) groups[hcId] = []
        groups[hcId].push(d)
      })

      // กรองเฉพาะกลุ่มที่ซ้ำ
      const dupeGroups = Object.entries(groups).filter(([, docs]) => docs.length > 1)

      if (dupeGroups.length === 0) {
        setFixDupResult({ fixed: 0, message: 'ไม่พบ hcId ซ้ำในระบบ' })
        setFixDupState('done')
        setTimeout(() => { setFixDupState('idle'); setFixDupResult(null) }, 6000)
        return
      }

      // หา counter ปัจจุบัน
      const currentYear = new Date().getFullYear()
      const counterRef  = doc(db, 'counters', `hcId_${currentYear}`)
      const counterSnap = await getDoc(counterRef)
      let   nextSeq     = counterSnap.exists() ? (counterSnap.data().value || 0) : 0

      // เก็บ doc ที่ต้อง reassign
      const toReassign = [] // { docRef, data, newHcId }

      dupeGroups.forEach(([, docs]) => {
        // เรียงจากเก่าสุด → เก็บตัวแรก (ตรงกับ Sheets), reassign ที่เหลือ
        const sorted = [...docs].sort((a, b) => {
          const at = a.data().createdAt?.toMillis?.() ?? 0
          const bt = b.data().createdAt?.toMillis?.() ?? 0
          return at - bt
        })
        sorted.slice(1).forEach(d => {
          nextSeq++
          toReassign.push({ docRef: d.ref, data: d.data(), newHcId: `REQ-${currentYear}-${nextSeq}` })
        })
      })

      // อัพเดต Firestore doc + counter ด้วย batch
      const CHUNK = 400
      for (let i = 0; i < toReassign.length; i += CHUNK) {
        const batch = writeBatch(db)
        toReassign.slice(i, i + CHUNK).forEach(({ docRef, newHcId }) => {
          batch.update(docRef, { hcId: newHcId })
        })
        await batch.commit()
      }

      // อัพเดต counter
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef)
        const current = snap.exists() ? (snap.data().value || 0) : 0
        if (nextSeq > current) tx.set(counterRef, { value: nextSeq })
      })

      // Push docs ที่ reassign ไปยัง Sheets เป็น row ใหม่
      if (toReassign.length > 0) {
        const reassignedRequests = toReassign.map(({ data, newHcId }) => ({ ...data, hcId: newHcId }))
        await syncBatchToSheets(reassignedRequests)
      }

      setFixDupResult({ fixed: toReassign.length, groups: dupeGroups.length })
      setFixDupState('done')
    } catch (err) {
      console.error('[fixDuplicateHCIDs]', err)
      setFixDupResult({ error: err.message })
      setFixDupState('error')
    }
    setTimeout(() => { setFixDupState('idle'); setFixDupResult(null) }, 8000)
  }

  /**
   * bulkDeleteCollection — ลบทุก document ใน Firestore collection ที่กำหนด
   * แบ่ง batch ทีละ 400 docs เพื่อไม่เกิน limit ของ Firestore (500 per batch)
   * คืนค่าจำนวน document ที่ถูกลบทั้งหมด
   */
  async function bulkDeleteCollection(colName) {
    const snap = await getDocs(collection(db, colName))
    // Firestore batch max 500 — chunk ถ้ามีเยอะ
    const CHUNK = 400
    for (let i = 0; i < snap.docs.length; i += CHUNK) {
      const batch = writeBatch(db)
      snap.docs.slice(i, i + CHUNK).forEach(d => batch.delete(d.ref))
      await batch.commit()
    }
    return snap.size
  }

  /**
   * runClear — เรียกใช้การล้างข้อมูลตาม key ที่ส่งมา
   * อัพเดต status ระหว่างทำงาน (running) และเมื่อเสร็จ (done/error)
   * ปิด confirm modal หลังการทำงานเสร็จเสมอ (แม้จะ error)
   */
  async function runClear(key) {
    setStatus(s => ({ ...s, [key]: { state: 'running' } }))
    try {
      let count = 0
      if (key === 'auditlog') {
        // ลบ audit log ทั้งหมดใน collection hc_logs
        count = await bulkDeleteCollection('hc_logs')
      } else if (key === 'positions') {
        // ลบ custom positions ทั้งหมดใน Firestore
        count = await bulkDeleteCollection('custom_positions')
      } else if (key === 'jd') {
        // JD files อยู่ใน Supabase Storage — ต้อง list แล้ว delete ทีละไฟล์
        const { data: files } = await listJDFiles()
        for (const f of files) await deleteJDFile(f.path)
        count = files.length
      } else if (key === 'requests') {
        // ลบ HC requests ทั้งหมดใน Firestore
        count = await bulkDeleteCollection('hc_requests')
      }
      setStatus(s => ({ ...s, [key]: { state: 'done', count } }))
    } catch (err) {
      console.error('[AdminTools]', key, err)
      setStatus(s => ({ ...s, [key]: { state: 'error' } }))
    }
    setConfirm(null)
  }

  /**
   * TOOLS — รายการเครื่องมือที่แสดงในหน้า
   * แต่ละ entry มี key ที่ใช้อ้างอิงใน status/confirm state
   * และ Tailwind classes สำหรับ color scheme เฉพาะของแต่ละเครื่องมือ
   */
  const TOOLS = [
    {
      key: 'auditlog',
      icon: <Clock size={20} />,
      label: 'Audit Log',
      desc: 'ลบประวัติการเปลี่ยนแปลงทั้งหมดใน hc_logs',
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-50 dark:bg-orange-900/20',
      border: 'border-orange-200 dark:border-orange-800',
    },
    {
      key: 'positions',
      icon: <Tag size={20} />,
      label: 'Custom Positions',
      desc: 'ลบ custom positions ทั้งหมดใน Firestore',
      color: 'text-purple-600 dark:text-purple-400',
      bg: 'bg-purple-50 dark:bg-purple-900/20',
      border: 'border-purple-200 dark:border-purple-800',
    },
    {
      key: 'jd',
      icon: <FileText size={20} />,
      label: 'JD Files (Supabase)',
      desc: 'ลบไฟล์ JD PDF ทั้งหมดใน Supabase Storage',
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-900/20',
      border: 'border-red-200 dark:border-red-800',
    },
    {
      key: 'requests',
      icon: <Trash2 size={20} />,
      label: 'HC Requests (ทั้งหมด)',
      desc: 'ลบ request ทั้งหมดใน hc_requests — ระวัง ไม่สามารถย้อนกลับได้',
      color: 'text-rose-700 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-900/20',
      border: 'border-rose-300 dark:border-rose-800',
    },
  ]

  // ── Password Gate Screen ──────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
        <div className="min-h-[70vh] flex items-center justify-center px-4">
          <div className="w-full max-w-sm">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-800 shadow-xl p-8">
              <div className="flex flex-col items-center gap-4 mb-8">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                  <Lock size={24} className="text-slate-500 dark:text-slate-400" />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-black text-gray-900 dark:text-gray-100">Admin Tools</h2>
                  <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">กรอกรหัสผ่านเพื่อเข้าถึง</p>
                </div>
              </div>
              <form onSubmit={handlePinSubmit} className="flex flex-col gap-3">
                <div className="relative">
                  <input
                    type={showPin ? 'text' : 'password'}
                    value={pinInput}
                    onChange={(e) => { setPinInput(e.target.value); setPinError(false) }}
                    placeholder="รหัสผ่าน"
                    autoFocus
                    className={`w-full px-4 py-3 pr-10 rounded-xl border text-sm font-bold focus:outline-none focus:ring-2 transition-all bg-white dark:bg-slate-950 dark:text-gray-100
                      ${pinError
                        ? 'border-red-400 dark:border-red-600 focus:ring-red-500/20 text-red-600 dark:text-red-400'
                        : 'border-gray-200 dark:border-slate-700 focus:ring-emerald-500/20 focus:border-emerald-500'
                      }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
                  >
                    {showPin ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {pinError && (
                  <p className="text-xs font-bold text-red-500 text-center">รหัสผ่านไม่ถูกต้อง</p>
                )}
                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-[#008065] hover:bg-[#006d56] text-white text-sm font-black transition-colors shadow-md shadow-emerald-500/20"
                >
                  เข้าถึง Admin Tools
                </button>
              </form>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="max-w-xl mx-auto py-8 px-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800"><DatabaseZap size={20} className="text-slate-600 dark:text-slate-400"/></div>
          <div>
            <h1 className="text-lg font-black text-gray-900 dark:text-gray-100">Admin Tools</h1>
            <p className="text-xs text-gray-500 dark:text-slate-400">Bulk clear database — ไม่สามารถย้อนกลับได้</p>
          </div>
        </div>

        {/* ── Sync from Sheets card ───────────────────────────────────────────── */}
        <div className="rounded-2xl border p-5 bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 mb-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-emerald-600 dark:text-emerald-400"><RefreshCw size={20} /></span>
              <div>
                <p className="text-sm font-black text-emerald-700 dark:text-emerald-400">Sync จาก Google Sheets → Firestore</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  ดึง Status / PIC / Candidate ที่ TA แก้ใน Sheets อัปเดตกลับมา Firestore
                </p>
              </div>
            </div>
            <button
              onClick={handleSyncSheets}
              disabled={syncState === 'running'}
              className={`flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl border transition-all shrink-0 shadow-sm
                ${syncState === 'running'
                  ? 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 cursor-wait'
                  : syncState === 'done'
                    ? 'bg-emerald-100 dark:bg-emerald-800/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
                    : syncState === 'error'
                      ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400'
                      : 'bg-white dark:bg-slate-800 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-800/40'
                }`}
            >
              {syncState === 'running' ? (
                <><Settings2 size={13} className="animate-spin"/> กำลัง Sync...</>
              ) : syncState === 'done' ? (
                <><CheckCircle2 size={13}/> Synced {syncResult?.synced ?? 0} / {syncResult?.total ?? 0} rows</>
              ) : syncState === 'error' ? (
                <><AlertCircle size={13}/> {syncResult?.error || 'Error'}</>
              ) : (
                <><RefreshCw size={13}/> Sync Now</>
              )}
            </button>
          </div>

          {/* แสดง error list ถ้ามี (สูงสุด 5 rows) */}
          {syncState === 'done' && syncResult?.errors?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800">
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-500 dark:text-orange-400 mb-1">ไม่พบ HCID ({syncResult.errors.length} rows)</p>
              {syncResult.errors.slice(0, 5).map((e, i) => (
                <p key={i} className="text-[10px] text-gray-400 dark:text-slate-500 font-mono">{e.hcId}: {e.error}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── Fix TA Names card ───────────────────────────────────────────────── */}
        <div className="rounded-2xl border p-5 bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 mb-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-blue-600 dark:text-blue-400"><UserCog size={20} /></span>
              <div>
                <p className="text-sm font-black text-blue-700 dark:text-blue-400">Fix TA Names (ชื่อสั้น)</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  แปลง "Jitlada (Mo) Mooltha" → "Jitlada (Mo)" ใน assignedToName + statusHistory ทุก request
                </p>
              </div>
            </div>
            <button
              onClick={fixTANames}
              disabled={fixNamesState === 'running'}
              className={`flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl border transition-all shrink-0 shadow-sm whitespace-nowrap
                ${fixNamesState === 'running'
                  ? 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 cursor-wait'
                  : fixNamesState === 'done'
                    ? 'bg-blue-100 dark:bg-blue-800/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                    : fixNamesState === 'error'
                      ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400'
                      : 'bg-white dark:bg-slate-800 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/40'
                }`}
            >
              {fixNamesState === 'running' ? (
                <><Settings2 size={13} className="animate-spin"/> กำลังแก้ไข...</>
              ) : fixNamesState === 'done' ? (
                <><CheckCircle2 size={13}/> แก้แล้ว {fixNamesResult?.updated ?? 0} / {fixNamesResult?.total ?? 0} docs</>
              ) : fixNamesState === 'error' ? (
                <><AlertCircle size={13}/> {fixNamesResult?.error || 'Error'}</>
              ) : (
                <><UserCog size={13}/> Fix Names</>
              )}
            </button>
          </div>
        </div>

        {/* ── Fix Requester Email-as-Name card ──────────────────────────────── */}
        <div className="rounded-2xl border p-5 bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 mb-2">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-amber-600 dark:text-amber-400"><UserCog size={20} /></span>
              <div>
                <p className="text-sm font-black text-amber-700 dark:text-amber-400">Fix ชื่อผู้ยื่น (email → ชื่อจริง)</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  แก้ record ที่ requesterName เป็น email เช่น "chutikarn.s@freshket.co" → lookup ชื่อจริงจาก users
                </p>
              </div>
            </div>
            <button
              onClick={fixRequesterEmailName}
              disabled={fixEmailNameState === 'running'}
              className={`flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl border transition-all shrink-0 shadow-sm whitespace-nowrap
                ${fixEmailNameState === 'running'
                  ? 'bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 cursor-wait'
                  : fixEmailNameState === 'done'
                    ? 'bg-amber-100 dark:bg-amber-800/40 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300'
                    : fixEmailNameState === 'error'
                      ? 'bg-red-50 dark:bg-red-900/30 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400'
                      : 'bg-white dark:bg-slate-800 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40'
                }`}
            >
              {fixEmailNameState === 'running' ? (
                <><Settings2 size={13} className="animate-spin"/> กำลังแก้ไข...</>
              ) : fixEmailNameState === 'done' ? (
                fixEmailNameResult?.updated === 0
                  ? <><CheckCircle2 size={13}/> ไม่มี record ที่ต้องแก้</>
                  : <><CheckCircle2 size={13}/> แก้แล้ว {fixEmailNameResult?.updated} docs{fixEmailNameResult?.skipped > 0 ? ` (ข้าม ${fixEmailNameResult.skipped})` : ''}</>
              ) : fixEmailNameState === 'error' ? (
                <><AlertCircle size={13}/> {fixEmailNameResult?.error || 'Error'}</>
              ) : (
                <><UserCog size={13}/> Fix Now</>
              )}
            </button>
          </div>
        </div>

        {/* ── Backfill Department Manager card ──────────────────────────────── */}
        <div className="rounded-2xl border p-5 bg-violet-50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800 mb-2">
          {/* Header row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-violet-600 dark:text-violet-400"><Users size={20} /></span>
              <div>
                <p className="text-sm font-black text-violet-700 dark:text-violet-400">กำหนด Manager ต่อแผนก</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  Manager เห็นเฉพาะแผนกที่ถูก assign — บันทึกใน settings/deptManagers
                </p>
              </div>
            </div>
            {/* Action button */}
            {deptState === 'idle' || deptState === 'error' ? (
              <button
                onClick={loadDepartments}
                className="flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl border transition-all shrink-0 shadow-sm bg-white dark:bg-slate-800 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-800/40"
              >
                <Users size={13}/> จัดการ
              </button>
            ) : deptState === 'loading' ? (
              <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5 shrink-0">
                <Settings2 size={13} className="animate-spin"/> กำลังโหลด...
              </span>
            ) : deptState === 'saving' ? (
              <span className="text-xs font-bold text-gray-400 flex items-center gap-1.5 shrink-0">
                <Settings2 size={13} className="animate-spin"/> กำลังบันทึก...
              </span>
            ) : deptState === 'saved' ? (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 shrink-0">
                <CheckCircle2 size={13}/> บันทึกแล้ว
              </span>
            ) : null}
          </div>

          {/* Department table — แสดงเมื่อโหลดแล้ว */}
          {(deptState === 'ready' || deptState === 'saving' || deptState === 'saved') && departments.length > 0 && (
            <div className="mt-4 border-t border-violet-200 dark:border-violet-800 pt-4">
              {/* Toggle show/hide */}
              <button
                onClick={() => setDeptExpanded(v => !v)}
                className="flex items-center gap-1.5 text-[11px] font-black text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-3"
              >
                {deptExpanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
                {departments.length} แผนก · assigned {Object.values(deptLookup).filter(v => v?.found).length}
              </button>

              {deptExpanded && (
                <>
                  <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                    {departments.map(dept => (
                      <div key={dept.name} className="flex items-center gap-3 bg-white dark:bg-slate-800/50 rounded-xl border border-violet-100 dark:border-violet-900/50 px-3 py-2">
                        {/* Dept info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">{dept.name}</p>
                          <p className="text-[10px] text-gray-400 dark:text-slate-500">{dept.total} records</p>
                        </div>
                        {/* Manager email input */}
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="email"
                            placeholder="email@freshket.co"
                            value={deptManagers[dept.name] ?? ''}
                            onChange={e => {
                              setDeptManagers(m => ({ ...m, [dept.name]: e.target.value }))
                              lookupEmail(dept.name, e.target.value)
                            }}
                            disabled={deptState === 'saving' || deptState === 'saved'}
                            className={`w-48 text-[11px] px-3 py-1.5 rounded-lg border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 placeholder-gray-300 dark:placeholder-slate-600 focus:outline-none focus:ring-1 disabled:opacity-50
                              ${deptLookup[dept.name]?.found === false
                                ? 'border-red-300 dark:border-red-700 focus:ring-red-400'
                                : deptLookup[dept.name]?.found === true
                                  ? 'border-emerald-300 dark:border-emerald-700 focus:ring-emerald-400'
                                  : 'border-violet-200 dark:border-violet-700 focus:ring-violet-400'
                              }`}
                          />
                          {/* Lookup status badge */}
                          {deptLookup[dept.name]?.loading && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-1">
                              <Settings2 size={10} className="animate-spin"/> กำลังค้นหา...
                            </span>
                          )}
                          {deptLookup[dept.name]?.found === true && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 size={10}/> {deptLookup[dept.name].name}
                            </span>
                          )}
                          {deptLookup[dept.name]?.found === false && (
                            <span className="text-[10px] text-red-500 dark:text-red-400 flex items-center gap-1">
                              <AlertCircle size={10}/> ไม่พบใน users
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Save button */}
                  {(deptState === 'ready' || deptState === 'saved') && (
                    <button
                      onClick={saveDeptManagers}
                      disabled={!Object.values(deptLookup).some(v => v?.found)}
                      className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-black px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
                    >
                      {deptState === 'saved'
                        ? <><CheckCircle2 size={13}/> บันทึกแล้ว</>
                        : <><Users size={13}/> บันทึก {Object.values(deptLookup).filter(v => v?.found).length} แผนก</>
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Fix Duplicate HCIDs */}
        <div className="rounded-2xl border p-5 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-amber-600 dark:text-amber-400"><DatabaseZap size={20}/></span>
              <div>
                <p className="text-sm font-black text-amber-600 dark:text-amber-400">Fix Duplicate HC IDs</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  หา hcId ที่ซ้ำ → เก็บ doc เก่าสุดไว้ (ตรงกับ Sheets) → กำหนด ID ใหม่ให้ที่เหลือ + push ไป Sheets
                </p>
              </div>
            </div>
            {fixDupState === 'done' ? (
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-full whitespace-nowrap">
                {fixDupResult?.fixed === 0
                  ? '✓ ไม่มีซ้ำ'
                  : `✓ แก้ไขแล้ว ${fixDupResult?.fixed} รายการ`}
              </span>
            ) : fixDupState === 'running' ? (
              <span className="text-xs font-bold text-gray-500 dark:text-slate-400 flex items-center gap-1.5 whitespace-nowrap">
                <Settings2 size={13} className="animate-spin"/> กำลังตรวจสอบ...
              </span>
            ) : fixDupState === 'error' ? (
              <span className="text-xs font-bold text-red-600 dark:text-red-400 whitespace-nowrap">
                {fixDupResult?.error || 'เกิดข้อผิดพลาด'}
              </span>
            ) : (
              <button
                onClick={fixDuplicateHCIDs}
                className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/30 transition-colors shadow-sm whitespace-nowrap"
              >
                <RefreshCw size={12}/> Fix Now
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* วน render card ของแต่ละ tool พร้อม status indicator */}
          {TOOLS.map(t => {
            const s = status[t.key] // สถานะปัจจุบันของ tool นี้ (อาจเป็น undefined ถ้ายังไม่ได้ใช้)
            return (
              <div key={t.key} className={`rounded-2xl border p-5 ${t.bg} ${t.border}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={t.color}>{t.icon}</span>
                    <div>
                      <p className={`text-sm font-black ${t.color}`}>{t.label}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{t.desc}</p>
                    </div>
                  </div>
                  {/* แสดงผลตาม state: done → count badge | running → spinner | error → error text | default → clear button */}
                  {s?.state === 'done' ? (
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-full">
                      ✓ ลบแล้ว {s.count} รายการ
                    </span>
                  ) : s?.state === 'running' ? (
                    <span className="text-xs font-bold text-gray-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Settings2 size={13} className="animate-spin"/> กำลังลบ...
                    </span>
                  ) : s?.state === 'error' ? (
                    <span className="text-xs font-bold text-red-600 dark:text-red-400">เกิดข้อผิดพลาด</span>
                  ) : (
                    // ปุ่ม Clear จะเปิด confirm modal แทนที่จะ delete ทันที
                    <button
                      onClick={() => setConfirm(t.key)}
                      className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors shadow-sm"
                    >
                      <Trash2 size={12}/> Clear
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Confirm modal — แสดงเมื่อ confirm state ไม่ใช่ null */}
        {confirm && (() => {
          const t = TOOLS.find(x => x.key === confirm) // หา tool config จาก key ที่รอยืนยัน
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 w-full max-w-sm mx-4 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 rounded-xl bg-red-100 dark:bg-red-900/30"><AlertTriangle size={18} className="text-red-600 dark:text-red-400"/></div>
                  <div>
                    <p className="font-black text-gray-900 dark:text-gray-100 text-sm">ยืนยันการลบ {t.label}?</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  {/* ยกเลิก — ปิด modal โดยไม่ทำอะไร */}
                  <button onClick={() => setConfirm(null)} className="flex-1 px-4 py-2 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                    ยกเลิก
                  </button>
                  {/* ยืนยัน — เรียก runClear พร้อม key ที่รอยืนยัน */}
                  <button onClick={() => runClear(confirm)} className="flex-1 px-4 py-2 text-sm font-black rounded-xl bg-red-600 text-white hover:bg-red-700 transition-colors shadow-md shadow-red-500/20">
                    ลบทั้งหมด
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    </Layout>
  )
}
