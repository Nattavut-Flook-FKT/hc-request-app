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
import { useState } from 'react'
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Clock, Tag, FileText, Trash2, DatabaseZap, Settings2, AlertTriangle, RefreshCw, CheckCircle2, AlertCircle, UserCog } from 'lucide-react'
import { listJDFiles, deleteJDFile } from '../services/supabase'
import { syncFromSheets } from '../services/webhook'
import Layout from '../components/Shared/Layout'

/** ตัดนามสกุลออก เหลือแค่ "ชื่อ (nickname)" — เหมือน RequestTable.shortName */
function shortName(fullName) {
  if (!fullName) return fullName
  const match = fullName.match(/^.+?\)/)
  return match ? match[0].trim() : fullName
}

export default function AdminToolsPage({ user, role, isDarkMode, toggleDarkMode }) {
  // สถานะการทำงานของแต่ละ tool: key → { state: 'idle'|'running'|'done'|'error', count }
  // state จะอัพเดตแบบ partial (เฉพาะ key ที่เกี่ยวข้อง ไม่ overwrite key อื่น)
  const [status, setStatus] = useState({})

  // key ของ tool ที่กำลังรอการยืนยันจาก confirm modal (null = ไม่มี modal เปิด)
  const [confirm, setConfirm] = useState(null)

  // ── Sync from Sheets state ────────────────────────────────────────────────
  const [syncState,  setSyncState]  = useState('idle')  // 'idle'|'running'|'done'|'error'
  const [syncResult, setSyncResult] = useState(null)

  // ── Fix TA Names state ────────────────────────────────────────────────────
  const [fixNamesState,  setFixNamesState]  = useState('idle') // 'idle'|'running'|'done'|'error'
  const [fixNamesResult, setFixNamesResult] = useState(null)

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
