/**
 * AllRequestsPage.jsx — All HC requests overview (TA / Admin only)
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าแสดงคำขออัตรากำลังทั้งหมดในระบบ สำหรับ TA และ Admin เท่านั้น
 * ใช้ RequestTable พร้อม showFilters=true เพื่อให้กรองและค้นหาข้อมูลได้
 *
 * Sync from Sheets:
 *   ปุ่ม "Sync Sheets" เรียก GAS ?action=syncFromSheets เพื่อดึงข้อมูล
 *   Status / PIC / Candidate ที่ TA แก้ไขใน Google Sheets กลับมายัง Firestore
 *   (ใช้เมื่อ onSheetEdit trigger ไม่ทำงาน หรือต้องการ sync ด้วยตนเอง)
 *
 * Props:
 *   user          {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role          {string}   role ของผู้ใช้ ('ta' | 'admin')
 *   department    {string}   แผนกของผู้ใช้
 *   isDarkMode    {boolean}  สถานะ dark mode
 *   toggleDarkMode {function} toggle dark/light mode
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../services/firebase'
import { RefreshCw, CheckCircle2, AlertCircle, Upload, X } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import RequestTable from '../components/Dashboard/RequestTable'
import { syncFromSheets, syncAllToSheets, syncBatchToSheets } from '../services/webhook'

export default function AllRequestsPage({ user, role, department, isDarkMode, toggleDarkMode }) {
  // 'idle' | 'running' | 'done' | 'error'
  const [syncState,    setSyncState]    = useState('idle')
  const [syncResult,   setSyncResult]   = useState(null)
  const [pushState,    setPushState]    = useState('idle')
  const [pushResult,   setPushResult]   = useState(null)
  // modal สำหรับเลือก hcIds ที่จะ push
  const [pushModal,    setPushModal]    = useState(false)
  const [pushIds,      setPushIds]      = useState('')

  async function handleSyncSheets() {
    if (syncState === 'running') return
    setSyncState('running')
    setSyncResult(null)
    try {
      const res = await syncFromSheets()
      if (res.success) {
        setSyncResult(`Updated ${res.synced}${res.created ? ` · Added ${res.created} new` : ''} / ${res.total} rows`)
        setSyncState('done')
      } else {
        setSyncResult(res.error || 'Sync failed')
        setSyncState('error')
      }
    } catch (err) {
      setSyncResult(err.message)
      setSyncState('error')
    }
    setTimeout(() => { setSyncState('idle'); setSyncResult(null) }, 5000)
  }

  // push ทั้งหมด
  async function handlePushAll() {
    if (pushState === 'running') return
    setPushModal(false)
    setPushState('running')
    setPushResult(null)
    try {
      const res = await syncAllToSheets()
      setPushResult(`Pushed ${res.total} rows`)
      setPushState('done')
    } catch (err) {
      setPushResult(err.message)
      setPushState('error')
    }
    setTimeout(() => { setPushState('idle'); setPushResult(null) }, 5000)
  }

  // push เฉพาะ hcIds ที่ระบุ
  async function handlePushSelected() {
    const ids = pushIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    if (!ids.length) return
    setPushModal(false)
    setPushState('running')
    setPushResult(null)
    try {
      // ดึง docs เฉพาะ hcIds ที่ระบุ (Firestore 'in' limit 30 ต่อ query)
      const CHUNK = 30
      const docs = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const snap  = await getDocs(query(collection(db, 'hc_requests'), where('hcId', 'in', chunk)))
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }))
      }
      if (!docs.length) { setPushResult('ไม่พบ hcId ที่ระบุ'); setPushState('error'); return }
      await syncBatchToSheets(docs)
      setPushResult(`Pushed ${docs.length} rows`)
      setPushState('done')
    } catch (err) {
      setPushResult(err.message)
      setPushState('error')
    }
    setTimeout(() => { setPushState('idle'); setPushResult(null) }, 5000)
  }

  function SyncBtn({ state, result, onClick, icon: Icon, label, title }) {
    const busy = state === 'running'
    const color = state === 'done' ? 'emerald' : state === 'error' ? 'red' : 'gray'
    return (
      <button onClick={onClick} disabled={busy} title={title}
        className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-black border transition-all shrink-0
          ${state === 'done'  ? 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
          : state === 'error' ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400'
          : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/5 shadow-sm'}`}>
        {busy ? <RefreshCw size={13} className="animate-spin" />
          : state === 'done'  ? <CheckCircle2 size={13} />
          : state === 'error' ? <AlertCircle size={13} />
          : <Icon size={13} />}
        <span>{busy ? 'กำลัง Sync...' : state !== 'idle' ? (result || label) : label}</span>
      </button>
    )
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        {/* ─── Header ─── */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">คำขอทั้งหมด</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">รายการคำขออัตรากำลังทั้งหมดในระบบ</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <SyncBtn state={syncState} result={syncResult} onClick={handleSyncSheets}
              icon={RefreshCw} label="Sheets → App"
              title="ดึง Status/PIC จาก Google Sheets → Firestore" />
            {role === 'admin' && (
              <SyncBtn state={pushState} result={pushResult} onClick={() => setPushModal(true)}
                icon={Upload} label="App → Sheets"
                title="Push ข้อมูลจาก Firestore → Google Sheets" />
            )}
          </div>
        </div>

        {/* showFilters=true เปิด filter bar ให้กรองตาม status, แผนก, ช่วงวันที่ ฯลฯ */}
        <RequestTable user={user} role={role} department={department} showFilters />
      </div>

      {/* Push to Sheets modal */}
      {pushModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-slate-700 w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="font-black text-gray-900 dark:text-gray-100 text-sm">App → Sheets</p>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">เลือก push เฉพาะ ID หรือทั้งหมด</p>
              </div>
              <button onClick={() => setPushModal(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400">
                <X size={16} />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                HC IDs (ระบุ ID ที่ต้องการ — คั่นด้วยจุลภาคหรือ Enter)
              </label>
              <textarea
                value={pushIds}
                onChange={e => setPushIds(e.target.value)}
                placeholder={"REQ-2026-455\nREQ-2026-456"}
                rows={4}
                className="w-full text-sm font-mono border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2.5 bg-gray-50 dark:bg-slate-800 text-gray-800 dark:text-gray-200 placeholder-gray-300 dark:placeholder-slate-600 focus:outline-none focus:border-emerald-400 resize-none"
              />
              <p className="text-[10px] text-gray-400 dark:text-slate-600 mt-1">
                ว่างไว้ = push ทั้งหมด ({' '}
                <span className="font-bold text-amber-500">ใช้เวลานาน</span>)
              </p>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setPushModal(false)}
                className="flex-1 px-4 py-2 text-sm font-bold rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                ยกเลิก
              </button>
              {pushIds.trim() ? (
                <button onClick={handlePushSelected}
                  className="flex-1 px-4 py-2 text-sm font-black rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-md shadow-emerald-500/20">
                  Push {pushIds.split(/[\s,]+/).filter(Boolean).length} ID
                </button>
              ) : (
                <button onClick={handlePushAll}
                  className="flex-1 px-4 py-2 text-sm font-black rounded-xl bg-gray-700 text-white hover:bg-gray-800 transition-colors">
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
