/**
 * ApproveNewHcPage.jsx — หน้า CEO approve/reject คำขอ New HC จากลิงก์ในอีเมล (/approve/:id/:token)
 * ─────────────────────────────────────────────────────────────────────────────
 * Public route — ไม่ต้อง login (carve-out ก่อน auth gate ใน App.jsx) — ทีมขอให้กดจากอีเมลได้เลย
 *
 * Security:
 * - doc เก็บแค่ approvalTokenHash (sha256) · token ดิบอยู่ในลิงก์อีเมลเท่านั้น → คนที่อ่าน doc ได้ (public get
 *   เฉพาะ PendingApproval) เอาไปอนุมัติไม่ได้ · firestore.rules เทียบ hashing.sha256(token) ตอน update
 * - ปุ่ม "อนุมัติ"/"ไม่อนุมัติ" ต้องกดเองเสมอ — ห้าม auto-approve ตอนโหลดหน้า เพราะ link scanner ของระบบเมล
 *   เปิดลิงก์เพื่อเช็คมัลแวร์ ถ้า approve ตอนโหลดจะโดนกดแทนโดยไม่มีใครตั้งใจ
 * - One-time โดยธรรมชาติ: rule อนุญาตเฉพาะ doc ที่ยัง PendingApproval → ตัดสินครั้งแรกแล้วลิงก์เดิม fail ทันที
 * - ไม่ login → เขียน hc_logs ไม่ได้ (rule) — ร่องรอยอยู่บน doc เอง (approvedAt/approvedByName + statusHistory)
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db } from '@/libs/firebase'
import { sendToWebhook } from '@/libs/webhook'
import { sha256Hex } from '@/utils/sha256'
import { buildHistoryEntry } from '@/utils/statusHistory'
import RequestSummary from './RequestSummary'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

// ตัวตนคนกดจากอีเมล — ไม่มี auth ให้อ้าง · โชว์ในตาราง "ตัดสินแล้ว" และ statusHistory
const EMAIL_APPROVER = { email: 'email-link', displayName: 'CEO (ลิงก์อีเมล)' }

export default function ApproveNewHcPage() {
  const { id, token } = useParams()
  const [loading, setLoading] = useState(true)
  const [reqData, setReqData] = useState(null)
  const [notFound, setNotFound] = useState(false)
  const [decision, setDecision] = useState(null) // null | 'approved' | 'rejected'
  const [showRejectBox, setShowRejectBox] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [snap, hash] = await Promise.all([getDoc(doc(db, 'hc_requests', id)), sha256Hex(token)])
        if (cancelled) return
        const d = snap.exists() ? snap.data() : null
        // เช็ค hash ฝั่ง client แค่เพื่อ UX (โชว์ "ลิงก์ใช้ไม่ได้" ทันที) — ของจริงตัดสินที่ rule ตอน update
        if (!d || d.status !== 'PendingApproval' || d.approvalTokenHash !== hash) setNotFound(true)
        else setReqData(d)
      } catch (err) {
        console.error('[ApproveNewHcPage] load error:', err)
        setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, token])

  async function submit(patch, onDone) {
    setSubmitting(true)
    setErrorMsg('')
    try {
      // approvalToken ดิบส่งไปให้ rule เทียบ sha256 กับ approvalTokenHash บน doc
      await updateDoc(doc(db, 'hc_requests', id), { ...patch, approvalToken: token })
      await onDone?.()
    } catch (err) {
      console.error('[ApproveNewHcPage] submit error:', err)
      setErrorMsg('เกิดข้อผิดพลาด ลองใหม่อีกครั้ง หรือแจ้งผู้ดูแลระบบ')
    } finally {
      setSubmitting(false)
    }
  }

  function handleApprove() {
    submit({
      status: 'Open',
      approvedAt: serverTimestamp(),
      approvedBy: EMAIL_APPROVER.email,
      approvedByName: EMAIL_APPROVER.displayName,
      statusHistory: arrayUnion(buildHistoryEntry('Open', EMAIL_APPROVER)),
    }, async () => {
      // อนุมัติแล้วถึงลง Sheets + แจ้ง TA เป็นครั้งแรก — openDate ใน Sheets = วันอนุมัติ (วันที่ TA ได้งานจริง)
      const { workDaysPerWeek: _w, shift: _s, approvalTokenHash: _h, ...webhookPayload } = reqData
      await sendToWebhook({ ...webhookPayload, status: 'Open', id, createdAt: new Date().toISOString() })
      setDecision('approved')
    })
  }

  function handleReject() {
    const reason = rejectReason.trim()
    if (!reason) return
    submit({
      status: 'RejectedByCEO',
      rejectReason: reason,
      rejectedAt: serverTimestamp(),
      rejectedBy: EMAIL_APPROVER.email,
      rejectedByName: EMAIL_APPROVER.displayName,
      statusHistory: arrayUnion(buildHistoryEntry('RejectedByCEO', EMAIL_APPROVER)),
    }, () => setDecision('rejected'))
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-neutral-100 bg-white p-6 sm:p-8">
        <img src="/freshket-original.svg" alt="Freshket" className="mb-6 h-6" />

        {loading && (
          <div className="flex items-center gap-2 text-neutral-400">
            <Loader2 size={18} strokeWidth={1} absoluteStrokeWidth className="animate-spin" /> กำลังโหลด...
          </div>
        )}

        {!loading && notFound && (
          <>
            <h1 className="mb-2 text-lg font-bold text-neutral-900">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
            <p className="text-sm text-neutral-500">คำขอนี้อาจถูกอนุมัติ/ไม่อนุมัติไปแล้วก่อนหน้านี้ หรือลิงก์ไม่ถูกต้อง</p>
          </>
        )}

        {!loading && !notFound && decision === 'approved' && (
          <>
            <div className="mb-2 flex items-center gap-2 text-dark-green-700">
              <CheckCircle size={20} strokeWidth={1} absoluteStrokeWidth />
              <h1 className="text-lg font-bold">อนุมัติแล้ว</h1>
            </div>
            <p className="text-sm text-neutral-500">คำขอ "{reqData?.position}" เข้าสู่กระบวนการปกติแล้ว — ทีม TA จะดำเนินการต่อ</p>
          </>
        )}

        {!loading && !notFound && decision === 'rejected' && (
          <>
            <div className="mb-2 flex items-center gap-2 text-red-700">
              <XCircle size={20} strokeWidth={1} absoluteStrokeWidth />
              <h1 className="text-lg font-bold">ไม่อนุมัติแล้ว</h1>
            </div>
            <p className="text-sm text-neutral-500">คำขอ "{reqData?.position}" ถูกบันทึกว่าไม่อนุมัติ — ผู้ยื่นจะเห็นเหตุผลในระบบ</p>
          </>
        )}

        {!loading && !notFound && !decision && (
          <>
            <h1 className="mb-4 text-lg font-bold text-neutral-900">คำขอ New Headcount รออนุมัติ</h1>
            <RequestSummary req={reqData} />

            {errorMsg && <p className="mb-4 text-sm font-bold text-red-700">{errorMsg}</p>}

            {!showRejectBox ? (
              <div className="flex gap-3">
                <button
                  onClick={() => setShowRejectBox(true)}
                  disabled={submitting}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-100 px-4 text-sm font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                >
                  <XCircle size={16} strokeWidth={1} absoluteStrokeWidth /> ไม่อนุมัติ
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-dark-green-600 px-4 text-sm font-bold text-neutral-50 transition-colors hover:bg-dark-green-700 disabled:opacity-50"
                >
                  <CheckCircle size={16} strokeWidth={1} absoluteStrokeWidth /> {submitting ? 'กำลังบันทึก...' : 'อนุมัติ'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="เหตุผลที่ไม่อนุมัติ (ผู้ยื่นจะเห็นข้อความนี้)"
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-lg border border-neutral-100 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-[1.5px] focus:border-dark-green-600 focus:outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowRejectBox(false); setRejectReason('') }}
                    disabled={submitting}
                    className="h-10 flex-1 rounded-lg border border-neutral-100 px-4 text-sm font-bold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-50"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting || !rejectReason.trim()}
                    className="h-10 flex-1 rounded-lg bg-red-600 px-4 text-sm font-bold text-neutral-50 transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {submitting ? 'กำลังบันทึก...' : 'ยืนยันไม่อนุมัติ'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
