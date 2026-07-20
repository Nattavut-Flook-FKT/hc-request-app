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
import { useState, useRef, useCallback, useEffect } from 'react'
import { collection, getDocs, getDoc, setDoc, writeBatch, doc, runTransaction, updateDoc, query, where, orderBy, limit, serverTimestamp } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Clock, Tag, FileText, Trash2, DatabaseZap, Settings2, AlertTriangle, RefreshCw, CheckCircle2, AlertCircle, UserCog, Users, ChevronDown, ChevronUp, Lock, Eye, EyeOff, Upload, Power, PowerOff, X } from 'lucide-react'

// PIN อ่านจาก env เท่านั้น — ไม่มี fallback ใน source (ถ้า env ไม่ตั้ง = ล็อกตาย ปลดไม่ได้)
const ADMIN_PIN = import.meta.env.VITE_ADMIN_TOOLS_PIN
import { listJDFiles, deleteJDFile } from '../services/supabase'
import { syncFromSheets, syncBatchToSheets, syncAllToSheets } from '../services/webhook'
import Layout from '../components/Shared/Layout'
import { grantEmails } from '../utils/grants'

/** แปลง input คั่น comma → array อีเมล lowercase (รองรับ 1 แผนกหลาย Manager) */
function parseEmails(input) {
  return String(input || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
}

// ── DEPT_RENAME_MAP: ชื่อแผนกที่พิมพ์/import มาไม่ตรงกับชื่อมาตรฐาน → ชื่อที่ถูกต้อง ──
// เกิดจากข้อมูลดิบใน Google Sheets สะกดไม่ตรงกัน (เช่น เว้นวรรค/ไม่เว้นวรรค) ทำให้แผนกเดียวกัน
// แตกเป็น 2 ชื่อในระบบ — เพิ่ม key/value ใหม่ที่นี่ได้เรื่อยๆ ถ้าเจอเคสอื่นอีก
const DEPT_RENAME_MAP = {
  'Finance&Accounting': 'Finance & Accounting',
}

/** ตัดนามสกุลออก เหลือแค่ "ชื่อ (nickname)" — เหมือน RequestTable.shortName */
function shortName(fullName) {
  if (!fullName) return fullName
  const match = fullName.match(/^.+?\)/)
  return match ? match[0].trim() : fullName
}

export default function AdminToolsPage({ user, role, isDarkMode, toggleDarkMode, maintenanceMode, toggleMaintenance, togglingMaintenance }) {
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

  // ── App → Sheets state ────────────────────────────────────────────────────
  const [pushState,  setPushState]  = useState('idle')
  const [pushResult, setPushResult] = useState(null)
  const [pushModal,  setPushModal]  = useState(false)
  const [pushIds,    setPushIds]    = useState('')

  // ── Fix TA Names state ────────────────────────────────────────────────────
  const [fixNamesState,  setFixNamesState]  = useState('idle') // 'idle'|'running'|'done'|'error'
  const [fixNamesResult, setFixNamesResult] = useState(null)

  // ── Fix Requester Email-as-Name state ─────────────────────────────────────
  const [fixEmailNameState,  setFixEmailNameState]  = useState('idle')
  const [fixEmailNameResult, setFixEmailNameResult] = useState(null)

  // ── Fix Department Names state ────────────────────────────────────────────
  const [fixDeptNamesState,  setFixDeptNamesState]  = useState('idle')
  const [fixDeptNamesResult, setFixDeptNamesResult] = useState(null)

  // ── Reassign Imported Requests state ──────────────────────────────────────
  const [reassignState,  setReassignState]  = useState('idle') // 'idle'|'loading'|'ready'|'saving'|'error'
  const [reassignGroups, setReassignGroups] = useState([])     // [{dept, count}] เฉพาะ record ที่มาจาก import
  const [reassignDept,   setReassignDept]   = useState('')
  const [reassignEmail,  setReassignEmail]  = useState('')
  const [reassignName,   setReassignName]   = useState('')
  const [reassignResult, setReassignResult] = useState(null)

  // ── CEO Approval Beta — allow-list ของ Manager ที่ต้องผ่าน CEO approve ก่อน (New HC) ──
  const [ceoBetaInput,  setCeoBetaInput]  = useState('')     // comma-separated emails ที่พิมพ์อยู่
  const [ceoBetaState,  setCeoBetaState]  = useState('idle') // 'idle'|'loading'|'saving'|'saved'|'error'

  useEffect(() => {
    getDoc(doc(db, 'settings', 'ceoApprovalBeta')).then(snap => {
      if (snap.exists()) setCeoBetaInput((snap.data().testEmails || []).join(', '))
    }).catch(() => {})
  }, [])

  async function saveCeoBeta() {
    setCeoBetaState('saving')
    try {
      const emails = ceoBetaInput.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      await setDoc(doc(db, 'settings', 'ceoApprovalBeta'), { testEmails: emails, updatedAt: serverTimestamp(), updatedBy: user.email })
      setCeoBetaInput(emails.join(', '))
      setCeoBetaState('saved')
      setTimeout(() => setCeoBetaState('idle'), 2000)
    } catch (err) {
      console.error('[saveCeoBeta]', err)
      setCeoBetaState('error')
    }
  }

  // ── Department Manager Assignment state ──────────────────────────────────
  const [deptState,     setDeptState]     = useState('idle') // 'idle'|'loading'|'ready'|'saving'|'saved'|'error'
  const [departments,   setDepartments]   = useState([])     // [{name, total}]
  const [deptManagers,  setDeptManagers]  = useState({})     // { deptName: email }
  const [deptLookup,    setDeptLookup]    = useState({})     // { deptName: { loading, found, name } }
  const [deptExpanded,  setDeptExpanded]  = useState(false)
  const lookupTimers = useRef({})

  /** lookupEmail — debounce 600ms แล้ว getDoc จาก users collection
   *  รองรับหลายอีเมลคั่น comma — ทุกอีเมลต้องมีใน users ถึงจะถือว่า found */
  const lookupEmail = useCallback((dept, input) => {
    clearTimeout(lookupTimers.current[dept])
    const emails = parseEmails(input)
    if (!emails.length) {
      setDeptLookup(l => ({ ...l, [dept]: null }))
      return
    }
    setDeptLookup(l => ({ ...l, [dept]: { loading: true } }))
    lookupTimers.current[dept] = setTimeout(async () => {
      try {
        const snaps = await Promise.all(emails.map(e => getDoc(doc(db, 'users', e))))
        const missing = emails.filter((_, i) => !snaps[i].exists())
        if (missing.length === 0) {
          const names = snaps.map((s, i) => s.data().name || emails[i]).join(', ')
          setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: true, name: names } }))
        } else {
          setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: false, missing } }))
        }
      } catch {
        setDeptLookup(l => ({ ...l, [dept]: { loading: false, found: false } }))
      }
    }, 600)
  }, [])

  /**
   * fixTANames — แปลง assignedToName + changedByName + requesterName ที่มีชื่อเต็ม
   * (เช่น "Jitlada (Mo) Mooltha") ให้เหลือแค่ชื่อสั้น "Jitlada (Mo)" ให้ตรงกันทุก field ที่โชว์ชื่อคน
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

        // แก้ requesterName (ผู้ยื่น) — ใช้ shortName เดียวกับ TA เพื่อความสม่ำเสมอ
        if (data.requesterName) {
          const fixed = shortName(data.requesterName)
          if (fixed !== data.requesterName) updates.requesterName = fixed
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

  /**
   * fixDeptNames — รวม record ที่ department หรือ businessUnit สะกดไม่ตรงมาตรฐาน (ดู DEPT_RENAME_MAP)
   * เข้ากับชื่อที่ถูกต้อง เช่น "Finance&Accounting" → "Finance & Accounting"
   * เช็คทั้ง 2 field เพราะข้อมูลเดิมจาก Sheets ใช้ชื่อเดียวกันปนกันทั้งสองที่
   */
  async function fixDeptNames() {
    if (fixDeptNamesState === 'running') return
    setFixDeptNamesState('running')
    setFixDeptNamesResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))
      const toUpdate = snap.docs
        .map(d => {
          const data = d.data()
          const updates = {}
          if (DEPT_RENAME_MAP[data.department])   updates.department   = DEPT_RENAME_MAP[data.department]
          if (DEPT_RENAME_MAP[data.businessUnit]) updates.businessUnit = DEPT_RENAME_MAP[data.businessUnit]
          return { ref: d.ref, updates }
        })
        .filter(({ updates }) => Object.keys(updates).length > 0)

      if (!toUpdate.length) {
        setFixDeptNamesResult({ updated: 0, total: snap.size })
        setFixDeptNamesState('done')
        setTimeout(() => { setFixDeptNamesState('idle'); setFixDeptNamesResult(null) }, 6000)
        return
      }

      const CHUNK = 400
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const batch = writeBatch(db)
        toUpdate.slice(i, i + CHUNK).forEach(({ ref, updates }) => batch.update(ref, updates))
        await batch.commit()
      }

      setFixDeptNamesResult({ updated: toUpdate.length, total: snap.size })
      setFixDeptNamesState('done')
    } catch (err) {
      console.error('[fixDeptNames]', err)
      setFixDeptNamesResult({ error: err.message })
      setFixDeptNamesState('error')
    }
    setTimeout(() => { setFixDeptNamesState('idle'); setFixDeptNamesResult(null) }, 8000)
  }

  /**
   * loadReassignGroups — หา record ที่มาจาก import (มี importedBy) แล้ว group ตามแผนก
   * ใช้เลือกแผนกที่จะ reassign requesterEmail ให้เจ้าของจริง
   */
  async function loadReassignGroups() {
    setReassignState('loading')
    setReassignResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))
      const counts = {}
      snap.docs.forEach(d => {
        const data = d.data()
        // record จาก import: มี importedBy (marker ถาวร แม้ requesterName ถูกแก้ไปแล้ว)
        if (data.importedBy) counts[data.department || '(ไม่มีแผนก)'] = (counts[data.department || '(ไม่มีแผนก)'] || 0) + 1
      })
      const groups = Object.entries(counts).map(([dept, count]) => ({ dept, count })).sort((a, b) => a.dept.localeCompare(b.dept))
      setReassignGroups(groups)
      setReassignDept(groups[0]?.dept || '')
      setReassignState('ready')
    } catch (err) {
      console.error('[loadReassignGroups]', err)
      setReassignResult({ error: err.message })
      setReassignState('error')
    }
  }

  /**
   * reassignImported — bulk update requesterEmail (+ requesterName ถ้ากรอก) ของ record
   * ที่มาจาก import ในแผนกที่เลือก ให้เป็นเจ้าของจริง — แก้ปัญหา import เก่าที่แปะ email แอดมิน
   * ทำให้เจ้าของเห็นใน "คำขอของฉัน" — รันซ้ำได้ (ทับค่าเดิม)
   */
  async function reassignImported() {
    const email = reassignEmail.trim().toLowerCase()
    if (!reassignDept || !email || reassignState === 'saving') return
    setReassignState('saving')
    setReassignResult(null)
    try {
      const snap = await getDocs(collection(db, 'hc_requests'))
      const targets = snap.docs.filter(d => {
        const data = d.data()
        return data.importedBy && (data.department || '(ไม่มีแผนก)') === reassignDept
      })
      const name = reassignName.trim()
      const CHUNK = 400
      for (let i = 0; i < targets.length; i += CHUNK) {
        const batch = writeBatch(db)
        targets.slice(i, i + CHUNK).forEach(d => {
          const updates = { requesterEmail: email }
          if (name) updates.requesterName = name
          batch.update(d.ref, updates)
        })
        await batch.commit()
      }
      setReassignResult({ updated: targets.length, dept: reassignDept, email })
      setReassignState('ready')
      setReassignEmail('')
      setReassignName('')
      // refresh count (แผนกไม่หาย เพราะ marker คือ importedBy ไม่ใช่ requesterEmail)
    } catch (err) {
      console.error('[reassignImported]', err)
      setReassignResult({ error: err.message })
      setReassignState('error')
    }
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
      // pre-fill email จาก existing mapping — grantEmails รองรับทั้งค่าเก่า (string) และใหม่ (array)
      setDeptManagers(Object.fromEntries(depts.map(d => [d.name, grantEmails(existing[d.name]).join(', ')])))
      // trigger lookup สำหรับ dept ที่มี email อยู่แล้ว
      setDeptLookup({})
      Object.entries(existing).forEach(([dept, value]) => {
        const joined = grantEmails(value).join(', ')
        if (joined) setTimeout(() => lookupEmail(dept, joined), 0)
      })
      setDeptState('ready')
      setDeptExpanded(true)
    } catch (err) {
      console.error('[loadDepartments]', err)
      setDeptState('error')
    }
  }

  /** saveDeptManagers — บันทึก mapping dept → [emails] ลง settings/deptManagers
   *  เก็บเป็น array เสมอ (1 แผนกหลาย Manager) และ merge กับค่าเดิม
   *  เพื่อไม่ทับ grant ที่ตั้งจากหน้า Users ของแผนกที่ไม่ได้แก้ในนี้ */
  async function saveDeptManagers() {
    setDeptState('saving')
    try {
      const snap = await getDoc(doc(db, 'settings', 'deptManagers'))
      const mapping = snap.exists() ? { ...snap.data() } : {}
      departments.forEach(({ name }) => {
        const emails = parseEmails(deptManagers[name])
        if (emails.length === 0) {
          delete mapping[name]                       // เคลียร์ช่อง = ถอด grant ของแผนกนั้น
        } else if (deptLookup[name]?.found) {
          mapping[name] = emails                     // บันทึกเฉพาะช่องที่ทุกอีเมลผ่านการตรวจ
        }
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

  async function handlePushAll() {
    setPushModal(false); setPushState('running'); setPushResult(null)
    try {
      const res = await syncAllToSheets()
      setPushResult(`Pushed ${res.total} rows`); setPushState('done')
    } catch (err) { setPushResult(err.message); setPushState('error') }
    setTimeout(() => { setPushState('idle'); setPushResult(null) }, 5000)
  }

  async function handlePushSelected() {
    const ids = pushIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (!ids.length) return
    setPushModal(false); setPushState('running'); setPushResult(null)
    try {
      const CHUNK = 30; const docs = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const snap = await getDocs(query(collection(db, 'hc_requests'), where('hcId', 'in', ids.slice(i, i + CHUNK))))
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }))
      }
      if (!docs.length) { setPushResult('ไม่พบ hcId ที่ระบุ'); setPushState('error'); return }
      await syncBatchToSheets(docs)
      setPushResult(`Pushed ${docs.length} rows`); setPushState('done')
    } catch (err) { setPushResult(err.message); setPushState('error') }
    setTimeout(() => { setPushState('idle'); setPushResult(null) }, 5000)
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

      const currentYear = new Date().getFullYear()
      const counterRef  = doc(db, 'counters', `hcId_${currentYear}`)
      const counterSnap = await getDoc(counterRef)

      // คำนวณ nextSeq จาก numeric max ของ hcId ทั้งหมดที่มีอยู่จริง
      // เพื่อป้องกันกรณี counter ยังไม่ถูก seed หรือมีค่าผิด
      const allSeqs = snap.docs
        .map(d => { const m = String(d.data().hcId ?? '').match(/(\d+)$/); return m ? parseInt(m[1], 10) : 0 })
        .filter(n => n > 0)
      const firestoreMax = allSeqs.length ? Math.max(...allSeqs) : 0
      const counterVal   = counterSnap.exists() ? (counterSnap.data().value || 0) : 0
      let   nextSeq      = Math.max(firestoreMax, counterVal)

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
      icon: <Clock size={20} strokeWidth={1} absoluteStrokeWidth />,
      label: 'Audit Log',
      desc: 'ลบประวัติการเปลี่ยนแปลงทั้งหมดใน hc_logs',
      color: 'text-orange-700',
      bg: 'bg-orange-50',
      border: 'border-orange-100',
    },
    {
      key: 'positions',
      icon: <Tag size={20} strokeWidth={1} absoluteStrokeWidth />,
      label: 'Custom Positions',
      desc: 'ลบ custom positions ทั้งหมดใน Firestore',
      color: 'text-purple-700',
      bg: 'bg-purple-50',
      border: 'border-purple-100',
    },
    {
      key: 'jd',
      icon: <FileText size={20} strokeWidth={1} absoluteStrokeWidth />,
      label: 'JD Files (Supabase)',
      desc: 'ลบไฟล์ JD PDF ทั้งหมดใน Supabase Storage',
      color: 'text-red-700',
      bg: 'bg-red-50',
      border: 'border-red-100',
    },
    {
      key: 'requests',
      icon: <Trash2 size={20} strokeWidth={1} absoluteStrokeWidth />,
      label: 'HC Requests (ทั้งหมด)',
      desc: 'ลบ request ทั้งหมดใน hc_requests — ระวัง ไม่สามารถย้อนกลับได้ และลบเฉพาะ Firestore (แถวใน Google Sheets ไม่ถูกแตะ ต้องจัดการเอง)',
      color: 'text-pink-700',
      bg: 'bg-pink-50',
      border: 'border-pink-100',
    },
  ]

  // ── Password Gate Screen ──────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
        <div className="flex min-h-[70vh] items-center justify-center px-4">
          <div className="w-full max-w-sm">
            <div className="rounded-3xl border border-neutral-100 bg-white p-8 shadow-xl">
              <div className="mb-8 flex flex-col items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-100">
                  <Lock size={24} strokeWidth={1} absoluteStrokeWidth className="text-neutral-500" />
                </div>
                <div className="text-center">
                  <h2 className="text-lg font-bold text-neutral-900">Admin Tools</h2>
                  <p className="mt-1 text-xs text-neutral-500">กรอกรหัสผ่านเพื่อเข้าถึง</p>
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
                    className={`w-full rounded-lg border bg-white px-4 py-3 pr-10 text-sm font-bold transition-colors focus:outline-none
                      ${pinError
                        ? 'border-red-400 text-red-600'
                        : 'border-neutral-100 focus:border-[1.5px] focus:border-dark-green-600'
                      }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    {showPin ? <EyeOff size={15} strokeWidth={1} absoluteStrokeWidth /> : <Eye size={15} strokeWidth={1} absoluteStrokeWidth />}
                  </button>
                </div>
                {pinError && (
                  <p className="text-center text-xs font-bold text-red-600">รหัสผ่านไม่ถูกต้อง</p>
                )}
                <button
                  type="submit"
                  className="w-full rounded-lg bg-dark-green-600 py-3 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700"
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
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-xl bg-neutral-100 p-2"><DatabaseZap size={20} strokeWidth={1} absoluteStrokeWidth className="text-neutral-600"/></div>
          <div>
            <h1 className="text-lg font-bold text-neutral-900">Admin Tools</h1>
            <p className="text-xs text-neutral-500">Bulk clear database — ไม่สามารถย้อนกลับได้</p>
          </div>
        </div>

        {/* ── Sync from Sheets card ───────────────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-dark-green-100 bg-dark-green-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-dark-green-700"><RefreshCw size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-dark-green-800">Sync จาก Google Sheets → Firestore</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  ดึง Status / PIC / Candidate ที่ TA แก้ใน Sheets อัปเดตกลับมา Firestore
                </p>
              </div>
            </div>
            <button
              onClick={handleSyncSheets}
              disabled={syncState === 'running'}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition-colors
                ${syncState === 'running'
                  ? 'cursor-wait border-neutral-100 bg-neutral-50 text-neutral-400'
                  : syncState === 'done'
                    ? 'border-dark-green-100 bg-dark-green-100 text-dark-green-800'
                    : syncState === 'error'
                      ? 'border-red-100 bg-red-50 text-red-600'
                      : 'border-dark-green-100 bg-white text-dark-green-700 hover:bg-dark-green-100'
                }`}
            >
              {syncState === 'running' ? (
                <><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลัง Sync...</>
              ) : syncState === 'done' ? (
                <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> Synced {syncResult?.synced ?? 0} / {syncResult?.total ?? 0} rows</>
              ) : syncState === 'error' ? (
                <><AlertCircle size={13} strokeWidth={1} absoluteStrokeWidth/> {syncResult?.error || 'Error'}</>
              ) : (
                <><RefreshCw size={13} strokeWidth={1} absoluteStrokeWidth/> Sync Now</>
              )}
            </button>
          </div>

          {/* แสดง error list ถ้ามี (สูงสุด 5 rows) */}
          {syncState === 'done' && syncResult?.errors?.length > 0 && (
            <div className="mt-3 border-t border-dark-green-100 pt-3">
              <p className="mb-1 text-[11px] font-bold text-orange-600">ไม่พบ HCID ({syncResult.errors.length} rows)</p>
              {syncResult.errors.slice(0, 5).map((e, i) => (
                <p key={i} className="font-mono text-[11px] text-neutral-400">{e.hcId}: {e.error}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── App → Sheets card ───────────────────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-dark-green-100 bg-dark-green-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-dark-green-700"><Upload size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-dark-green-800">App → Google Sheets</p>
                <p className="mt-0.5 text-xs text-neutral-500">Push ข้อมูลจาก Firestore ขึ้น Sheets — ทั้งหมดหรือระบุ ID</p>
              </div>
            </div>
            {pushState === 'done' ? (
              <span className="shrink-0 rounded-lg bg-dark-green-100 px-3 py-1.5 text-xs font-bold text-dark-green-800">✓ {pushResult}</span>
            ) : pushState === 'running' ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-neutral-400"><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลัง Push...</span>
            ) : pushState === 'error' ? (
              <span className="shrink-0 text-xs font-bold text-red-600">{pushResult || 'Error'}</span>
            ) : (
              <button onClick={() => setPushModal(true)}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-dark-green-100 bg-white px-4 py-2 text-xs font-bold text-dark-green-700 transition-colors hover:bg-dark-green-100">
                <Upload size={13} strokeWidth={1} absoluteStrokeWidth/> Push to Sheets
              </button>
            )}
          </div>
        </div>

        {/* ── Maintenance Toggle card ──────────────────────────────────────────── */}
        {toggleMaintenance && (
          <div className={`mb-2 rounded-2xl border p-5 ${maintenanceMode
            ? 'border-dark-green-100 bg-dark-green-50'
            : 'border-orange-100 bg-orange-50'}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={maintenanceMode ? 'text-dark-green-700' : 'text-orange-600'}>
                  {maintenanceMode ? <Power size={20} strokeWidth={1} absoluteStrokeWidth/> : <PowerOff size={20} strokeWidth={1} absoluteStrokeWidth/>}
                </span>
                <div>
                  <p className={`text-sm font-bold ${maintenanceMode ? 'text-dark-green-800' : 'text-orange-700'}`}>
                    {maintenanceMode ? 'ระบบปิดอยู่' : 'ระบบเปิดอยู่'}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {maintenanceMode ? 'ผู้ใช้ทั่วไปไม่สามารถเข้าใช้งานได้' : 'ผู้ใช้ทุกคนเข้าใช้งานได้ตามปกติ'}
                  </p>
                </div>
              </div>
              <button onClick={toggleMaintenance} disabled={togglingMaintenance}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-neutral-50 transition-colors disabled:opacity-50
                  ${maintenanceMode ? 'bg-dark-green-600 hover:bg-dark-green-700' : 'bg-orange-600 hover:bg-orange-700'}`}>
                {togglingMaintenance ? <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> : maintenanceMode ? <Power size={13} strokeWidth={1} absoluteStrokeWidth/> : <PowerOff size={13} strokeWidth={1} absoluteStrokeWidth/>}
                {togglingMaintenance ? 'กำลังดำเนินการ...' : maintenanceMode ? 'เปิดระบบ' : 'ปิดระบบ'}
              </button>
            </div>
          </div>
        )}

        {/* ── CEO Approval Beta card ───────────────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-purple-100 bg-purple-50 p-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-purple-700"><UserCog size={20} strokeWidth={1} absoluteStrokeWidth /></span>
            <div>
              <p className="text-sm font-bold text-purple-800">CEO Approval — กลุ่มทดสอบ (Beta)</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                Manager ในรายชื่อนี้เท่านั้นที่ยื่น New HC แล้วต้องรอ CEO อนุมัติก่อน — คนอื่นได้ status
                'Open' ทันทีเหมือนเดิมทุกอย่าง
              </p>
            </div>
          </div>
          <textarea
            value={ceoBetaInput}
            onChange={(e) => setCeoBetaInput(e.target.value)}
            placeholder="manager1@freshket.co, manager2@freshket.co"
            rows={2}
            className="mb-3 w-full resize-none rounded-lg border border-neutral-100 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
          />
          <button
            onClick={saveCeoBeta}
            disabled={ceoBetaState === 'saving'}
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {ceoBetaState === 'saving' && <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin" />}
            {ceoBetaState === 'saving' ? 'กำลังบันทึก...' : ceoBetaState === 'saved' ? 'บันทึกแล้ว ✓' : 'บันทึก'}
          </button>
        </div>

        {/* ── Fix TA Names card ───────────────────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-blue-700"><UserCog size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-blue-800">Fix ชื่อสั้น (TA + ผู้ยื่น)</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  แปลง "Jitlada (Mo) Mooltha" → "Jitlada (Mo)" ใน TA (assignedToName), ผู้ยื่น (requesterName) และ statusHistory ทุก request
                </p>
              </div>
            </div>
            <button
              onClick={fixTANames}
              disabled={fixNamesState === 'running'}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-bold transition-colors
                ${fixNamesState === 'running'
                  ? 'cursor-wait border-neutral-100 bg-neutral-50 text-neutral-400'
                  : fixNamesState === 'done'
                    ? 'border-blue-100 bg-blue-100 text-blue-800'
                    : fixNamesState === 'error'
                      ? 'border-red-100 bg-red-50 text-red-600'
                      : 'border-blue-100 bg-white text-blue-700 hover:bg-blue-100'
                }`}
            >
              {fixNamesState === 'running' ? (
                <><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังแก้ไข...</>
              ) : fixNamesState === 'done' ? (
                <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> แก้แล้ว {fixNamesResult?.updated ?? 0} / {fixNamesResult?.total ?? 0} docs</>
              ) : fixNamesState === 'error' ? (
                <><AlertCircle size={13} strokeWidth={1} absoluteStrokeWidth/> {fixNamesResult?.error || 'Error'}</>
              ) : (
                <><UserCog size={13} strokeWidth={1} absoluteStrokeWidth/> Fix Names</>
              )}
            </button>
          </div>
        </div>

        {/* ── Fix Requester Email-as-Name card ──────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-banana-100 bg-banana-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-banana-700"><UserCog size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-banana-900">Fix ชื่อผู้ยื่น (email → ชื่อจริง)</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  แก้ record ที่ requesterName เป็น email เช่น "chutikarn.s@freshket.co" → lookup ชื่อจริงจาก users
                </p>
              </div>
            </div>
            <button
              onClick={fixRequesterEmailName}
              disabled={fixEmailNameState === 'running'}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-bold transition-colors
                ${fixEmailNameState === 'running'
                  ? 'cursor-wait border-neutral-100 bg-neutral-50 text-neutral-400'
                  : fixEmailNameState === 'done'
                    ? 'border-banana-100 bg-banana-100 text-banana-900'
                    : fixEmailNameState === 'error'
                      ? 'border-red-100 bg-red-50 text-red-600'
                      : 'border-banana-100 bg-white text-banana-700 hover:bg-banana-100'
                }`}
            >
              {fixEmailNameState === 'running' ? (
                <><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังแก้ไข...</>
              ) : fixEmailNameState === 'done' ? (
                fixEmailNameResult?.updated === 0
                  ? <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> ไม่มี record ที่ต้องแก้</>
                  : <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> แก้แล้ว {fixEmailNameResult?.updated} docs{fixEmailNameResult?.skipped > 0 ? ` (ข้าม ${fixEmailNameResult.skipped})` : ''}</>
              ) : fixEmailNameState === 'error' ? (
                <><AlertCircle size={13} strokeWidth={1} absoluteStrokeWidth/> {fixEmailNameResult?.error || 'Error'}</>
              ) : (
                <><UserCog size={13} strokeWidth={1} absoluteStrokeWidth/> Fix Now</>
              )}
            </button>
          </div>
        </div>

        {/* ── Fix Department Names card ──────────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-teal-100 bg-teal-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-teal-700"><Tag size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-teal-900">Fix ชื่อแผนก / Business Unit (สะกดไม่ตรง)</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  รวมแผนกและ Business Unit ที่สะกดไม่ตรงมาตรฐานเข้าด้วยกัน เช่น "Finance&Accounting" → "Finance & Accounting"
                </p>
              </div>
            </div>
            <button
              onClick={fixDeptNames}
              disabled={fixDeptNamesState === 'running'}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2 text-xs font-bold transition-colors
                ${fixDeptNamesState === 'running'
                  ? 'cursor-wait border-neutral-100 bg-neutral-50 text-neutral-400'
                  : fixDeptNamesState === 'done'
                    ? 'border-teal-100 bg-teal-100 text-teal-900'
                    : fixDeptNamesState === 'error'
                      ? 'border-red-100 bg-red-50 text-red-600'
                      : 'border-teal-100 bg-white text-teal-700 hover:bg-teal-100'
                }`}
            >
              {fixDeptNamesState === 'running' ? (
                <><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังแก้ไข...</>
              ) : fixDeptNamesState === 'done' ? (
                fixDeptNamesResult?.updated === 0
                  ? <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> ไม่มี record ที่ต้องแก้</>
                  : <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> แก้แล้ว {fixDeptNamesResult?.updated} docs</>
              ) : fixDeptNamesState === 'error' ? (
                <><AlertCircle size={13} strokeWidth={1} absoluteStrokeWidth/> {fixDeptNamesResult?.error || 'Error'}</>
              ) : (
                <><Tag size={13} strokeWidth={1} absoluteStrokeWidth/> Fix Now</>
              )}
            </button>
          </div>
        </div>

        {/* ── Reassign Imported Requests card ────────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-blue-700"><UserCog size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-blue-800">Reassign คำขอที่ import (คืนเจ้าของจริง)</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  คำขอที่ import ย้อนหลังถูกแปะ email แอดมิน — เลือกแผนกแล้วใส่ email เจ้าของจริง เพื่อให้โผล่ใน "คำขอของฉัน" ของเขา
                </p>
              </div>
            </div>
            {reassignState === 'idle' || reassignState === 'error' ? (
              <button
                onClick={loadReassignGroups}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-blue-100 bg-white px-4 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100"
              >
                <UserCog size={13} strokeWidth={1} absoluteStrokeWidth/> จัดการ
              </button>
            ) : reassignState === 'loading' ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-neutral-400">
                <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังโหลด...
              </span>
            ) : null}
          </div>

          {reassignState === 'error' && (
            <p className="mt-3 text-xs font-bold text-red-600">{reassignResult?.error || 'Error'}</p>
          )}

          {(reassignState === 'ready' || reassignState === 'saving') && (
            <div className="mt-4 space-y-3">
              {reassignGroups.length === 0 ? (
                <p className="text-xs text-neutral-500">ไม่พบ record ที่มาจาก import</p>
              ) : (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-neutral-500">แผนก</label>
                      <select
                        value={reassignDept}
                        onChange={e => setReassignDept(e.target.value)}
                        className="rounded-lg border border-neutral-100 bg-white px-3 py-2 text-xs text-neutral-900 focus:border-dark-green-600 focus:outline-none"
                      >
                        {reassignGroups.map(g => (
                          <option key={g.dept} value={g.dept}>{g.dept} ({g.count} คำขอ)</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-neutral-500">Email เจ้าของจริง *</label>
                      <input
                        type="email"
                        value={reassignEmail}
                        onChange={e => setReassignEmail(e.target.value)}
                        placeholder="somchai.j@freshket.co"
                        className="w-56 rounded-lg border border-neutral-100 bg-white px-3 py-2 text-xs text-neutral-900 focus:border-dark-green-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-bold text-neutral-500">ชื่อผู้ยื่น (optional)</label>
                      <input
                        type="text"
                        value={reassignName}
                        onChange={e => setReassignName(e.target.value)}
                        placeholder="ปล่อยว่าง = คงเดิม"
                        className="w-44 rounded-lg border border-neutral-100 bg-white px-3 py-2 text-xs text-neutral-900 focus:border-dark-green-600 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={reassignImported}
                      disabled={reassignState === 'saving' || !reassignEmail.trim() || !reassignDept}
                      className="flex items-center gap-2 rounded-lg bg-dark-green-600 px-4 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {reassignState === 'saving'
                        ? <><Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังบันทึก...</>
                        : <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> Reassign</>}
                    </button>
                  </div>
                  {reassignResult?.updated != null && (
                    <p className="text-xs font-bold text-dark-green-700">
                      อัพเดตแล้ว {reassignResult.updated} คำขอ ในแผนก {reassignResult.dept} → {reassignResult.email}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Backfill Department Manager card ──────────────────────────────── */}
        <div className="mb-2 rounded-2xl border border-purple-100 bg-purple-50 p-5">
          {/* Header row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-purple-700"><Users size={20} strokeWidth={1} absoluteStrokeWidth /></span>
              <div>
                <p className="text-sm font-bold text-purple-800">กำหนด Manager ต่อแผนก</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Manager เห็น + เลือก Division/แผนกได้เฉพาะที่ถูก assign — ใส่ได้หลายคนต่อแผนก คั่นด้วย comma
                </p>
              </div>
            </div>
            {/* Action button */}
            {deptState === 'idle' || deptState === 'error' ? (
              <button
                onClick={loadDepartments}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-purple-100 bg-white px-4 py-2 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-100"
              >
                <Users size={13} strokeWidth={1} absoluteStrokeWidth/> จัดการ
              </button>
            ) : deptState === 'loading' ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-neutral-400">
                <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังโหลด...
              </span>
            ) : deptState === 'saving' ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-neutral-400">
                <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังบันทึก...
              </span>
            ) : deptState === 'saved' ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-dark-green-700">
                <CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> บันทึกแล้ว
              </span>
            ) : null}
          </div>

          {/* Department table — แสดงเมื่อโหลดแล้ว */}
          {(deptState === 'ready' || deptState === 'saving' || deptState === 'saved') && departments.length > 0 && (
            <div className="mt-4 border-t border-purple-100 pt-4">
              {/* Toggle show/hide */}
              <button
                onClick={() => setDeptExpanded(v => !v)}
                className="mb-3 flex items-center gap-1.5 text-[11px] font-bold text-purple-700"
              >
                {deptExpanded ? <ChevronUp size={12} strokeWidth={1} absoluteStrokeWidth/> : <ChevronDown size={12} strokeWidth={1} absoluteStrokeWidth/>}
                {departments.length} แผนก · assigned {Object.values(deptLookup).filter(v => v?.found).length}
              </button>

              {deptExpanded && (
                <>
                  <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
                    {departments.map(dept => (
                      <div key={dept.name} className="flex items-center gap-3 rounded-xl border border-purple-100 bg-white px-3 py-2">
                        {/* Dept info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-neutral-700">{dept.name}</p>
                          <p className="text-[11px] text-neutral-400">{dept.total} records</p>
                        </div>
                        {/* Manager email input */}
                        <div className="flex flex-col items-end gap-1">
                          <input
                            type="text"
                            placeholder="email1@freshket.co, email2@..."
                            value={deptManagers[dept.name] ?? ''}
                            onChange={e => {
                              setDeptManagers(m => ({ ...m, [dept.name]: e.target.value }))
                              lookupEmail(dept.name, e.target.value)
                            }}
                            disabled={deptState === 'saving' || deptState === 'saved'}
                            className={`w-48 rounded-lg border bg-white px-3 py-1.5 text-[11px] text-neutral-700 transition-colors focus:outline-none disabled:opacity-50
                              ${deptLookup[dept.name]?.found === false
                                ? 'border-red-100 focus:border-red-400'
                                : deptLookup[dept.name]?.found === true
                                  ? 'border-dark-green-100 focus:border-dark-green-600'
                                  : 'border-purple-100 focus:border-purple-400'
                              }`}
                          />
                          {/* Lookup status badge */}
                          {deptLookup[dept.name]?.loading && (
                            <span className="flex items-center gap-1 text-[11px] text-neutral-400">
                              <Settings2 size={10} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังค้นหา...
                            </span>
                          )}
                          {deptLookup[dept.name]?.found === true && (
                            <span className="flex items-center gap-1 text-[11px] text-dark-green-700">
                              <CheckCircle2 size={10} strokeWidth={1} absoluteStrokeWidth/> {deptLookup[dept.name].name}
                            </span>
                          )}
                          {deptLookup[dept.name]?.found === false && (
                            <span className="flex items-center gap-1 text-[11px] text-red-600">
                              <AlertCircle size={10} strokeWidth={1} absoluteStrokeWidth/>
                              {deptLookup[dept.name]?.missing?.length
                                ? `ไม่พบใน users: ${deptLookup[dept.name].missing.join(', ')}`
                                : 'ไม่พบใน users'}
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
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-xs font-bold text-neutral-50 transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deptState === 'saved'
                        ? <><CheckCircle2 size={13} strokeWidth={1} absoluteStrokeWidth/> บันทึกแล้ว</>
                        : <><Users size={13} strokeWidth={1} absoluteStrokeWidth/> บันทึก {Object.values(deptLookup).filter(v => v?.found).length} แผนก</>
                      }
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Fix Duplicate HCIDs */}
        <div className="mb-2 rounded-2xl border border-yellow-100 bg-yellow-50 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-yellow-700"><DatabaseZap size={20} strokeWidth={1} absoluteStrokeWidth/></span>
              <div>
                <p className="text-sm font-bold text-yellow-900">Fix Duplicate HC IDs</p>
                <p className="mt-0.5 text-xs text-neutral-500">
                  หา hcId ที่ซ้ำ → เก็บ doc เก่าสุดไว้ (ตรงกับ Sheets) → กำหนด ID ใหม่ให้ที่เหลือ + push ไป Sheets
                </p>
              </div>
            </div>
            {fixDupState === 'done' ? (
              <span className="whitespace-nowrap rounded-full bg-dark-green-50 px-3 py-1 text-xs font-bold text-dark-green-700">
                {fixDupResult?.fixed === 0
                  ? '✓ ไม่มีซ้ำ'
                  : `✓ แก้ไขแล้ว ${fixDupResult?.fixed} รายการ`}
              </span>
            ) : fixDupState === 'running' ? (
              <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-bold text-neutral-500">
                <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังตรวจสอบ...
              </span>
            ) : fixDupState === 'error' ? (
              <span className="whitespace-nowrap text-xs font-bold text-red-600">
                {fixDupResult?.error || 'เกิดข้อผิดพลาด'}
              </span>
            ) : (
              <button
                onClick={fixDuplicateHCIDs}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-yellow-100 bg-white px-3 py-1.5 text-xs font-bold text-yellow-800 transition-colors hover:bg-yellow-100"
              >
                <RefreshCw size={12} strokeWidth={1} absoluteStrokeWidth/> Fix Now
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
                      <p className={`text-sm font-bold ${t.color}`}>{t.label}</p>
                      <p className="mt-0.5 text-xs text-neutral-500">{t.desc}</p>
                    </div>
                  </div>
                  {/* แสดงผลตาม state: done → count badge | running → spinner | error → error text | default → clear button */}
                  {s?.state === 'done' ? (
                    <span className="rounded-full bg-dark-green-50 px-3 py-1 text-xs font-bold text-dark-green-700">
                      ✓ ลบแล้ว {s.count} รายการ
                    </span>
                  ) : s?.state === 'running' ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-neutral-500">
                      <Settings2 size={13} strokeWidth={1} absoluteStrokeWidth className="animate-spin"/> กำลังลบ...
                    </span>
                  ) : s?.state === 'error' ? (
                    <span className="text-xs font-bold text-red-600">เกิดข้อผิดพลาด</span>
                  ) : (
                    // ปุ่ม Clear จะเปิด confirm modal แทนที่จะ delete ทันที
                    <button
                      onClick={() => setConfirm(t.key)}
                      className="flex items-center gap-1.5 rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50"
                    >
                      <Trash2 size={12} strokeWidth={1} absoluteStrokeWidth/> Clear
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
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
              <div className="mx-4 w-full max-w-sm rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
                <div className="mb-4 flex items-center gap-3">
                  <div className="rounded-xl bg-red-50 p-2"><AlertTriangle size={18} strokeWidth={1} absoluteStrokeWidth className="text-red-600"/></div>
                  <div>
                    <p className="text-sm font-bold text-neutral-900">ยืนยันการลบ {t.label}?</p>
                    <p className="mt-0.5 text-xs text-neutral-500">การกระทำนี้ไม่สามารถย้อนกลับได้</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  {/* ยกเลิก — ปิด modal โดยไม่ทำอะไร */}
                  <button onClick={() => setConfirm(null)} className="flex-1 rounded-lg border border-neutral-100 px-4 py-2 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50">
                    ยกเลิก
                  </button>
                  {/* ยืนยัน — เรียก runClear พร้อม key ที่รอยืนยัน */}
                  <button onClick={() => runClear(confirm)} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-neutral-50 transition-colors hover:bg-red-700">
                    ลบทั้งหมด
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>

      {/* App → Sheets modal */}
      {pushModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/45">
          <div className="mx-4 w-full max-w-md rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-neutral-900">App → Sheets</p>
                <p className="mt-0.5 text-xs text-neutral-500">เลือก push เฉพาะ ID หรือทั้งหมด</p>
              </div>
              <button onClick={() => setPushModal(false)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50">
                <X size={16} strokeWidth={1} absoluteStrokeWidth/>
              </button>
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-bold text-neutral-500">
                HC IDs — คั่นด้วยจุลภาคหรือ Enter (ว่างไว้ = push ทั้งหมด)
              </label>
              <textarea value={pushIds} onChange={e => setPushIds(e.target.value)}
                placeholder={"REQ-2026-455\nREQ-2026-456"} rows={4}
                className="w-full resize-none rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5 font-mono text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPushModal(false)} className="flex-1 rounded-lg border border-neutral-100 px-4 py-2 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50">ยกเลิก</button>
              {pushIds.trim() ? (
                <button onClick={handlePushSelected} className="flex-1 rounded-lg bg-dark-green-600 px-4 py-2 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700">
                  Push {pushIds.split(/[\s,]+/).filter(Boolean).length} ID
                </button>
              ) : (
                <button onClick={handlePushAll} className="flex-1 rounded-lg bg-neutral-700 px-4 py-2 text-sm font-bold text-neutral-50 transition-colors hover:bg-neutral-800">
                  Push ทั้งหมด
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
