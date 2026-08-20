/**
 * AuditLogPage.jsx — Audit Log viewer
 * ─────────────────────────────────────────────────────────────────────────────
 * หน้าแสดงประวัติการเปลี่ยนแปลงทั้งหมดในระบบ HC Request
 * ดึงข้อมูลจาก Firestore collection 'hc_logs' เรียงตาม timestamp ล่าสุดก่อน
 * จำกัดที่ 500 รายการล่าสุด
 * Admin สามารถลบ log รายการใดก็ได้ผ่านปุ่ม trash
 *
 * Action types ที่รองรับ:
 *   Submit      — ยื่นคำขอใหม่
 *   Assign      — TA รับเคส (assign ตัวเองเป็น TA)
 *   StatusChange — เปลี่ยนสถานะคำขอ (fromStatus → toStatus)
 *   Cancel      — ยกเลิกคำขอ
 *
 * Props:
 *   user          {object}   Firebase user object ของผู้ใช้ที่ login อยู่
 *   role          {string}   role ของผู้ใช้ ('admin' เท่านั้นที่เห็นปุ่มลบ log ได้)
 *   isDarkMode    {boolean}  สถานะ dark mode
 *   toggleDarkMode {function} toggle dark/light mode
 *
 * Notes:
 *   - STATUS_CONFIG map action type → label ภาษาไทย + Tailwind color classes
 *   - action ที่ไม่รู้จักจะ fallback เป็น gray badge แสดง action string ดิบ
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useMemo, useState } from 'react'
import { query, collection, orderBy, limit, getDocs, deleteDoc, doc, where, documentId } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { Trash2 } from 'lucide-react'
import Layout from '@/components/app-shell/Layout'
import ConfirmModal from '@/components/ui/ConfirmModal'

// map action type → label ภาษาไทย + DS Light-variant badge tokens
const STATUS_CONFIG = {
  Submit: { label: 'ยื่นคำขอ', bg: 'bg-green-fresh-50', text: 'text-green-fresh-900', border: 'border-green-fresh-100' },
  Assign: { label: 'รับเคส', bg: 'bg-purple-50', text: 'text-purple-900', border: 'border-purple-100' },
  StatusChange: { label: 'เปลี่ยนสถานะ', bg: 'bg-banana-50', text: 'text-banana-900', border: 'border-banana-100' },
  Cancel: { label: 'ยกเลิก', bg: 'bg-pink-50', text: 'text-pink-900', border: 'border-pink-100' },
  EditCase: { label: 'แก้ไขข้อมูล', bg: 'bg-teal-50', text: 'text-teal-900', border: 'border-teal-100' },
}

const INPUT_CLS = 'h-10 rounded-lg border border-neutral-100 bg-white px-3 text-sm text-neutral-900 transition-colors focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none'

/**
 * เติม hcId (REQ-YYYY-NNN) ให้ log ที่ไม่มี — hc_logs เก็บแค่ requestId (Firestore doc id)
 * ดึงเป็นชุดละ 30 ตามลิมิตของ where-in ไม่ยิง getDoc ทีละใบ (500 log = สูงสุด ~17 query)
 * doc ที่ถูกลบไปแล้วจะไม่มีใน map → ตกไปโชว์ short doc id ตามเดิม
 */
async function resolveHcIds(rows) {
  const ids = [...new Set(rows.filter((r) => !r.hcId && r.requestId).map((r) => r.requestId))]
  if (ids.length === 0) return rows
  const map = {}
  for (let i = 0; i < ids.length; i += 30) {
    try {
      const snap = await getDocs(query(collection(db, 'hc_requests'), where(documentId(), 'in', ids.slice(i, i + 30))))
      snap.forEach((d) => { const h = d.data().hcId; if (h) map[d.id] = h })
    } catch (e) {
      console.warn('[AuditLog] resolve hcId chunk failed:', e)
    }
  }
  return rows.map((r) => (r.hcId ? r : { ...r, hcId: map[r.requestId] ?? '' }))
}

export default function AuditLogPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingLogId, setDeletingLogId] = useState('')
  const [confirmState, setConfirmState] = useState({ isOpen: false, logId: '' })
  const [logError, setLogError] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    // ดึง log 500 รายการล่าสุด เรียงตาม timestamp desc
    const q = query(collection(db, 'hc_logs'), orderBy('timestamp', 'desc'), limit(500))
    getDocs(q)
      .then(async (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setLogs(rows)        // โชว์ตารางก่อน ไม่รอ resolve hcId
        setLoading(false)
        setLogs(await resolveHcIds(rows))
      })
      .catch((err) => {
        console.error('[AuditLog] fetch error:', err)
        setLoading(false)
      })
  }, [])

  // ดึงจาก log จริง ไม่ hardcode — action ใหม่โผล่มาเองไม่ต้องมาแก้ list
  const actions = useMemo(() => [...new Set(logs.map((l) => l.action).filter(Boolean))].sort(), [logs])

  const visibleLogs = useMemo(() => {
    let list = logs
    if (filterAction) list = list.filter((l) => l.action === filterAction)
    if (dateFrom) {
      const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
      list = list.filter((l) => (l.timestamp?.toDate?.() ?? 0) >= from)
    }
    if (dateTo) {
      const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
      list = list.filter((l) => (l.timestamp?.toDate?.() ?? 0) <= to)
    }
    return list
  }, [logs, filterAction, dateFrom, dateTo])

  const hasFilters = filterAction || dateFrom || dateTo

  async function handleDeleteLog(logId) {
    if (!logId) return
    setDeletingLogId(logId)
    try {
      await deleteDoc(doc(db, 'hc_logs', logId))
      // อัปเดต local state ให้ลบ log ออก โดยไม่ต้อง refetch ทั้งหมด
      setLogs((prev) => prev.filter((log) => log.id !== logId))
    } catch (e) {
      console.error('Delete log error:', e)
      setLogError('ลบ log ไม่สำเร็จ กรุณาลองใหม่')
      setTimeout(() => setLogError(''), 4000)
    } finally {
      setDeletingLogId('')
    }
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Audit Log</h1>
          <p className="mt-0.5 text-sm text-neutral-500">ประวัติการเปลี่ยนแปลงทั้งหมดในระบบ</p>
        </div>

        {/* ตัวกรอง — กรองในชุด 500 log ที่โหลดมาแล้ว ไม่ยิง query ใหม่ */}
        {!loading && logs.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 ml-1 block text-[11px] font-bold text-neutral-500">Action</label>
              <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className={INPUT_CLS}>
                <option value="">ทั้งหมด</option>
                {actions.map((a) => <option key={a} value={a}>{STATUS_CONFIG[a]?.label ?? a}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[11px] font-bold text-neutral-500">จากวันที่</label>
              <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <label className="mb-1 ml-1 block text-[11px] font-bold text-neutral-500">ถึงวันที่</label>
              <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={INPUT_CLS} />
            </div>
            {hasFilters && (
              <button
                onClick={() => { setFilterAction(''); setDateFrom(''); setDateTo('') }}
                className="h-10 rounded-lg px-3 text-sm font-bold text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
              >
                ล้างตัวกรอง
              </button>
            )}
            <p className="ml-auto pb-3 text-[11px] font-bold text-neutral-400">
              แสดง {visibleLogs.length} จาก {logs.length} รายการ
            </p>
          </div>
        )}

        {logError && (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">
            {logError}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-neutral-400">กำลังโหลด...</div>
        ) : logs.length === 0 ? (
          <div className="py-20 text-center text-neutral-400">ยังไม่มีประวัติ</div>
        ) : visibleLogs.length === 0 ? (
          <div className="py-20 text-center text-neutral-400">ไม่พบรายการตามตัวกรอง</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-neutral-100 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50">
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">เวลา</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">Request ID</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">ตำแหน่ง / แผนก</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">Action</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">จาก → ไป</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">รายละเอียด</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">โดย</th>
                  {/* คอลัมน์จัดการแสดงเฉพาะ admin */}
                  {role === 'admin' && (
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-neutral-500">จัดการ</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visibleLogs.map((log) => {
                  // fallback config สำหรับ action type ที่ไม่รู้จัก
                  const config = STATUS_CONFIG[log.action] || { label: log.action, bg: 'bg-neutral-100', text: 'text-neutral-600', border: 'border-neutral-100' }
                  return (
                    <tr key={log.id} className="group transition-colors hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-neutral-400">
                        {log.timestamp?.toDate?.().toLocaleString('th-TH') ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        {/* ใช้ hcId (REQ-YYYY-NNN) เป็นหลัก — ตกไปใช้ 8 ตัวแรกของ doc id
                            เมื่อหา hcId ไม่ได้ (เคสถูกลบ หรือยังไม่เคยขึ้น Sheets) */}
                        <span className="rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1 font-mono text-[11px] font-bold text-neutral-400">
                          {log.hcId || log.requestId?.slice(0, 8).toUpperCase() || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-bold text-neutral-900 transition-colors group-hover:text-dark-green-700">{log.position || '—'}</p>
                        {log.department && <p className="text-[11px] font-bold text-neutral-400">{log.department}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${config.bg} ${config.text} ${config.border}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[11px] font-bold text-neutral-500">
                        {/* แสดง fromStatus → toStatus สำหรับ StatusChange, หรือแค่ toStatus สำหรับ action อื่น */}
                        {log.fromStatus && log.toStatus
                          ? <div className="flex items-center gap-2">
                            {log.fromStatus} <span className="text-neutral-300">→</span> <span className="text-dark-green-700">{log.toStatus}</span>
                          </div>
                          : log.toStatus ? <span className="text-dark-green-700">{log.toStatus}</span> : '—'}
                      </td>
                      <td className="px-5 py-4 text-[11px] text-neutral-600">
                        {/* note เก็บรายละเอียดเป็น `field: "ก่อน" → "หลัง"` ต่อกันด้วย " | " (ดู EditCaseModal)
                            แตกเป็นบรรทัดละ field เพื่ออ่านออกจริง — ก่อนหน้านี้หน้านี้ไม่แสดง note เลย
                            รายละเอียดจึงถูกเก็บครบใน Firestore แต่มองไม่เห็น */}
                        {log.note
                          ? <div className="flex min-w-[220px] max-w-[420px] flex-col gap-0.5">
                            {log.note.split(' | ').map((line, i) => <span key={i} className="break-words">{line}</span>)}
                          </div>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      {/* byName ใช้ display name, by ใช้ email — โชว์ email ด้วยเวลาชื่อซ้ำกัน */}
                      <td className="px-5 py-4 text-xs font-bold text-neutral-600">
                        {log.byName ?? log.by ?? '—'}
                        {log.by && log.by !== log.byName && (
                          <p className="mt-0.5 text-[11px] font-normal text-neutral-400">{log.by}</p>
                        )}
                      </td>
                      {role === 'admin' && (
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => setConfirmState({ isOpen: true, logId: log.id })}
                            disabled={deletingLogId === log.id}
                            className="rounded-lg p-1.5 text-red-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                            title="ลบ log นี้"
                          >
                            <Trash2 size={14} strokeWidth={1} absoluteStrokeWidth />
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm dialog ก่อนลบ log */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        onClose={() => setConfirmState({ isOpen: false, logId: '' })}
        onConfirm={async () => {
          await handleDeleteLog(confirmState.logId)
          setConfirmState({ isOpen: false, logId: '' })
        }}
        title="ลบ Audit Log"
        message="ต้องการลบ log รายการนี้ใช่หรือไม่?"
        confirmText="ลบ Log"
        variant="danger"
      />
    </Layout>
  )
}
