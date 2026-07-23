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
          <h1 className="text-xl font-bold text-neutral-900">Audit Log</h1>
          <p className="mt-0.5 text-sm text-neutral-500">ประวัติการเปลี่ยนแปลงทั้งหมดในระบบ</p>
        </div>

        {logError && (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">
            {logError}
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-neutral-400">กำลังโหลด...</div>
        ) : logs.length === 0 ? (
          <div className="py-20 text-center text-neutral-400">ยังไม่มีประวัติ</div>
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
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-neutral-500">โดย</th>
                  {/* คอลัมน์จัดการแสดงเฉพาะ admin */}
                  {role === 'admin' && (
                    <th className="px-4 py-3 text-right text-[11px] font-bold text-neutral-500">จัดการ</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {logs.map((log) => {
                  // fallback config สำหรับ action type ที่ไม่รู้จัก
                  const config = STATUS_CONFIG[log.action] || { label: log.action, bg: 'bg-neutral-100', text: 'text-neutral-600', border: 'border-neutral-100' }
                  return (
                    <tr key={log.id} className="group transition-colors hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-[11px] text-neutral-400">
                        {log.timestamp?.toDate?.().toLocaleString('th-TH') ?? '—'}
                      </td>
                      <td className="px-5 py-4">
                        {/* แสดง 8 ตัวอักษรแรกของ doc ID เป็น short ID */}
                        <span className="rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1 font-mono text-[11px] font-bold text-neutral-400">
                          {log.requestId?.slice(0, 8).toUpperCase() ?? '—'}
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
                      {/* byName ใช้ display name, by ใช้ email — fallback ตามลำดับ */}
                      <td className="px-5 py-4 text-xs font-bold text-neutral-600">{log.byName ?? log.by ?? '—'}</td>
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
