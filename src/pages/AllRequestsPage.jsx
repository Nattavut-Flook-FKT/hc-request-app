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
    return (
      <button onClick={onClick} disabled={busy} title={title}
        className={`flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors
          ${state === 'done'  ? 'border-green-fresh-100 bg-green-fresh-50 text-green-fresh-900'
          : state === 'error' ? 'border-red-100 bg-red-50 text-red-700'
          : 'border-neutral-100 bg-white text-neutral-600 hover:border-dark-green-100 hover:bg-dark-green-50 hover:text-dark-green-700'}`}>
        {busy ? <RefreshCw size={14} strokeWidth={1} absoluteStrokeWidth className="animate-spin" />
          : state === 'done'  ? <CheckCircle2 size={14} strokeWidth={1} absoluteStrokeWidth />
          : state === 'error' ? <AlertCircle size={14} strokeWidth={1} absoluteStrokeWidth />
          : <Icon size={14} strokeWidth={1} absoluteStrokeWidth />}
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
            <h1 className="text-xl font-bold text-neutral-900">คำขอทั้งหมด</h1>
            <p className="mt-0.5 text-sm text-neutral-500">รายการคำขออัตรากำลังทั้งหมดในระบบ</p>
          </div>

        </div>

        {/* showFilters=true เปิด filter bar ให้กรองตาม status, แผนก, ช่วงวันที่ ฯลฯ */}
        <RequestTable user={user} role={role} department={department} showFilters />
      </div>

      {/* Push to Sheets modal */}
      {pushModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/15">
          <div className="mx-4 w-full max-w-md rounded-[24px] border border-neutral-100 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-neutral-900">App → Sheets</p>
                <p className="mt-0.5 text-xs text-neutral-500">เลือก push เฉพาะ ID หรือทั้งหมด</p>
              </div>
              <button onClick={() => setPushModal(false)} className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-50">
                <X size={16} strokeWidth={1} absoluteStrokeWidth />
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-[13px] font-bold text-neutral-900">
                HC IDs (ระบุ ID ที่ต้องการ — คั่นด้วยจุลภาคหรือ Enter)
              </label>
              <textarea
                value={pushIds}
                onChange={e => setPushIds(e.target.value)}
                placeholder={"REQ-2026-455\nREQ-2026-456"}
                rows={4}
                className="w-full resize-none rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2.5 font-mono text-sm text-neutral-700 placeholder-neutral-300 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
              />
              <p className="mt-1 text-xs text-neutral-400">
                ว่างไว้ = push ทั้งหมด ({' '}
                <span className="font-bold text-yellow-700">ใช้เวลานาน</span>)
              </p>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setPushModal(false)}
                className="flex-1 rounded-lg border border-neutral-100 px-4 py-2 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50">
                ยกเลิก
              </button>
              {pushIds.trim() ? (
                <button onClick={handlePushSelected}
                  className="flex-1 rounded-lg bg-dark-green-600 px-4 py-2 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700">
                  Push {pushIds.split(/[\s,]+/).filter(Boolean).length} ID
                </button>
              ) : (
                <button onClick={handlePushAll}
                  className="flex-1 rounded-lg bg-dark-green-600 px-4 py-2 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700">
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
