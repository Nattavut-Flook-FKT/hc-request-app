/**
 * PendingApprovalsPage.jsx — fallback ในแอพสำหรับ CEO/Admin อนุมัติคำขอ New HC (beta)
 * ─────────────────────────────────────────────────────────────────────────────
 * ใช้เมื่อลิงก์ Slack หาย/หมดอายุ — ต่างจาก ApproveNewHcPage ตรงที่หน้านี้ authenticated
 * (login ผ่าน role 'ceo'/'admin' ปกติ) เขียนผ่าน isFreshket() rule เดิม ไม่ต้องใช้ token เลย
 */
import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot, query, updateDoc, where, serverTimestamp } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { sendToWebhook } from '@/libs/webhook'
import { logAudit } from '@/features/audit-log/auditLog'
import Layout from '@/components/app-shell/Layout'
import { CheckCircle, XCircle } from 'lucide-react'

export default function PendingApprovalsPage({ user, role, isDarkMode, toggleDarkMode }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [rejectingId, setRejectingId] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    const q = query(collection(db, 'hc_requests'), where('status', '==', 'PendingApproval'))
    const unsub = onSnapshot(q, (snap) => {
      setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      setLoading(false)
    }, (err) => {
      console.error('[PendingApprovalsPage] snapshot error:', err)
      setLoading(false)
    })
    return unsub
  }, [])

  async function handleApprove(req) {
    setBusyId(req.id)
    try {
      await updateDoc(doc(db, 'hc_requests', req.id), {
        status: 'Open',
        approvedAt: serverTimestamp(),
      })
      const { workDaysPerWeek: _w, shift: _s, approvalToken: _t, ...webhookPayload } = req
      await sendToWebhook({
        ...webhookPayload,
        status: 'Open',
        id: req.id,
        createdAt: req.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      })
      logAudit({
        requestId: req.id, action: 'CeoApprove', by: user.email, byName: user.displayName,
        fromStatus: 'PendingApproval', toStatus: 'Open', position: req.position, department: req.department,
      })
    } catch (err) {
      console.error('[PendingApprovalsPage] approve error:', err)
    }
    setBusyId(null)
  }

  async function handleReject(req) {
    if (!rejectReason.trim()) return
    setBusyId(req.id)
    try {
      await updateDoc(doc(db, 'hc_requests', req.id), {
        status: 'RejectedByCEO',
        rejectReason: rejectReason.trim(),
        rejectedAt: serverTimestamp(),
      })
      logAudit({
        requestId: req.id, action: 'CeoReject', by: user.email, byName: user.displayName,
        fromStatus: 'PendingApproval', toStatus: 'RejectedByCEO', position: req.position, department: req.department,
        note: rejectReason.trim(),
      })
    } catch (err) {
      console.error('[PendingApprovalsPage] reject error:', err)
    }
    setBusyId(null)
    setRejectingId(null)
    setRejectReason('')
  }

  return (
    <Layout user={user} role={role} isDarkMode={isDarkMode} toggleDarkMode={toggleDarkMode}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">Pending Approvals</h1>
          <p className="mt-0.5 text-sm text-neutral-500">คำขอ New HC ที่รออนุมัติ — {rows.length} รายการ</p>
        </div>

        {loading ? (
          <div className="h-32 animate-pulse rounded-2xl border border-neutral-100 bg-white" />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-100 bg-white py-16 text-center">
            <p className="font-bold text-neutral-400">ไม่มีคำขอรออนุมัติ</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {rows.map((req) => (
              <div key={req.id} className="rounded-2xl border border-neutral-100 bg-white p-6">
                <div className="mb-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p><span className="font-bold text-neutral-400">ตำแหน่ง:</span> {req.position}</p>
                  <p><span className="font-bold text-neutral-400">แผนก:</span> {req.department}</p>
                  <p><span className="font-bold text-neutral-400">จำนวน:</span> {req.headcount ?? 1} คน</p>
                  <p><span className="font-bold text-neutral-400">ผู้ยื่น:</span> {req.requesterName}</p>
                  {req.reason && <p className="sm:col-span-2"><span className="font-bold text-neutral-400">เหตุผล:</span> {req.reason}</p>}
                </div>

                {rejectingId === req.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="เหตุผลที่ไม่อนุมัติ..."
                      rows={2}
                      autoFocus
                      className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-3 py-2 text-sm focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="flex-1 rounded-lg border border-neutral-100 px-3 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-50">ยกเลิก</button>
                      <button onClick={() => handleReject(req)} disabled={busyId === req.id || !rejectReason.trim()} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-neutral-50 hover:bg-red-700 disabled:opacity-50">ยืนยันไม่อนุมัติ</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setRejectingId(req.id)}
                      disabled={busyId === req.id}
                      className="flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <XCircle size={12} strokeWidth={1} absoluteStrokeWidth /> ไม่อนุมัติ
                    </button>
                    <button
                      onClick={() => handleApprove(req)}
                      disabled={busyId === req.id}
                      className="flex items-center gap-1.5 rounded-lg bg-dark-green-600 px-3 py-2 text-xs font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
                    >
                      <CheckCircle size={12} strokeWidth={1} absoluteStrokeWidth /> {busyId === req.id ? 'กำลังบันทึก...' : 'อนุมัติ'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}
