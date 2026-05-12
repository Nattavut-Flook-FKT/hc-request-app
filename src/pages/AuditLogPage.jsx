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
import { useEffect, useState } from 'react'
import { query, collection, orderBy, limit, getDocs, deleteDoc, doc } from 'firebase/firestore'
import { db } from '../services/firebase'
import { Trash2 } from 'lucide-react'
import Layout from '../components/Shared/Layout'
import ConfirmModal from '../components/Shared/ConfirmModal'

// map action type → label ภาษาไทย + color classes สำหรับ badge
const STATUS_CONFIG = {
  Submit: { label: 'ยื่นคำขอ', bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-500/20' },
  Assign: { label: 'รับเคส', bg: 'bg-purple-50 dark:bg-purple-500/10', text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-200 dark:border-purple-500/20' },
  StatusChange: { label: 'เปลี่ยนสถานะ', bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-500/20' },
  Cancel: { label: 'ยกเลิก', bg: 'bg-rose-50 dark:bg-rose-500/10', text: 'text-rose-700 dark:text-rose-400', border: 'border-rose-200 dark:border-rose-500/20' },
}

export default function AuditLogPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingLogId, setDeletingLogId] = useState('')
  const [confirmState, setConfirmState] = useState({ isOpen: false, logId: '' })
  const [logError, setLogError] = useState('')

  useEffect(() => {
    // ดึง log 500 รายการล่าสุด เรียงตาม timestamp desc
    const q = query(collection(db, 'hc_logs'), orderBy('timestamp', 'desc'), limit(500))
    getDocs(q)
      .then((snap) => {
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
        setLoading(false)
      })
      .catch((err) => {
        console.error('[AuditLog] fetch error:', err)
        setLoading(false)
      })
  }, [])

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
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 italic tracking-tight">Audit Log</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">ประวัติการเปลี่ยนแปลงทั้งหมดในระบบ</p>
        </div>

        {logError && (
          <div className="flex items-center gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-400 rounded-2xl px-5 py-3 text-sm font-bold animate-in fade-in slide-in-from-top-2">
            {logError}
          </div>
        )}

        {loading ? (
          <div className="text-center py-20 text-gray-400">กำลังโหลด...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-20 text-gray-400">ยังไม่มีประวัติ</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-800 shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800/50">
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">เวลา</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">Request ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">ตำแหน่ง / แผนก</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">Action</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">จาก → ไป</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-left">โดย</th>
                  {/* คอลัมน์จัดการแสดงเฉพาะ admin */}
                  {role === 'admin' && (
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-right">จัดการ</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {logs.map((log) => {
                  // fallback config สำหรับ action type ที่ไม่รู้จัก
                  const config = STATUS_CONFIG[log.action] || { label: log.action, bg: 'bg-gray-100 dark:bg-slate-800', text: 'text-gray-600 dark:text-slate-400', border: 'border-gray-200 dark:border-slate-700' }
                  return (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors group">
                      <td className="px-5 py-4 text-gray-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-tighter whitespace-nowrap">
                        {log.timestamp?.toDate?.().toLocaleString('th-TH') ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        {/* แสดง 8 ตัวอักษรแรกของ doc ID เป็น short ID */}
                        <span className="font-mono text-[10px] font-bold text-gray-400 dark:text-slate-600 bg-gray-50 dark:bg-slate-950 px-2 py-1 rounded-md border border-gray-100 dark:border-slate-800">
                          {log.requestId?.slice(0, 8).toUpperCase() ?? '—'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-black text-gray-800 dark:text-gray-200 tracking-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">{log.position || '—'}</p>
                        {log.department && <p className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest">{log.department}</p>}
                      </td>
                      <td className="px-5 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider border ${config.bg} ${config.text} ${config.border}`}>
                          {config.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[11px] font-bold text-gray-500 dark:text-slate-400">
                        {/* แสดง fromStatus → toStatus สำหรับ StatusChange, หรือแค่ toStatus สำหรับ action อื่น */}
                        {log.fromStatus && log.toStatus
                          ? <div className="flex items-center gap-2">
                            {log.fromStatus} <span className="text-gray-300 dark:text-slate-700">→</span> <span className="text-emerald-600 dark:text-emerald-500">{log.toStatus}</span>
                          </div>
                          : log.toStatus ? <span className="text-emerald-600 dark:text-emerald-500">{log.toStatus}</span> : '—'}
                      </td>
                      {/* byName ใช้ display name, by ใช้ email — fallback ตามลำดับ */}
                      <td className="px-5 py-4 text-xs font-bold text-gray-600 dark:text-slate-400">{log.byName ?? log.by ?? '—'}</td>
                      {role === 'admin' && (
                        <td className="px-5 py-4 text-right">
                          <button
                            onClick={() => setConfirmState({ isOpen: true, logId: log.id })}
                            disabled={deletingLogId === log.id}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                            title="ลบ log นี้"
                          >
                            <Trash2 size={14} />
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
