/**
 * ConfirmModal.jsx — Reusable confirmation dialog
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal ขอยืนยันการทำรายการ (ลบข้อมูล, ยกเลิกคำขอ ฯลฯ) · 3 variant: danger/warning/info
 * คลิก backdrop ปิด modal เช่นเดียวกับปุ่ม X
 *
 * UI: FKT Design System (14-modal · 05-button) — r-2xl · no dark · button no shadow ·
 *     danger=red-600 · info=dark-green-600 · icon tint-50 · token-only
 *
 * Props: isOpen · onClose · onConfirm · title · message · confirmText · cancelText · variant
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { AlertTriangle, X } from 'lucide-react'

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'ยืนยันการทำรายการ',
  message,
  confirmText = 'ยืนยัน',
  cancelText = 'ยกเลิก',
  variant = 'danger', // 'danger' | 'warning' | 'info'
}) {
  if (!isOpen) return null

  // map variant → DS tokens (icon tint-50 chip + confirm button family)
  const variantStyles = {
    danger: {
      iconBg: 'bg-red-50',
      iconColor: 'text-red-600',
      button: 'bg-red-600 text-neutral-50 hover:bg-red-700',
    },
    warning: {
      iconBg: 'bg-yellow-50',
      iconColor: 'text-yellow-700',
      button: 'bg-yellow-600 text-dark-green-950 hover:bg-yellow-700',
    },
    info: {
      iconBg: 'bg-dark-green-50',
      iconColor: 'text-dark-green-600',
      button: 'bg-dark-green-600 text-neutral-50 hover:bg-dark-green-700',
    },
  }

  const style = variantStyles[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — คลิกเพื่อปิด modal */}
      <div
        className="absolute inset-0 bg-neutral-950/45 transition-opacity"
        onClick={onClose}
      />

      {/* Modal — r-2xl 24px · shadow-xl · border neutral-100 */}
      <div className="relative w-full max-w-md animate-in fade-in zoom-in-95 rounded-3xl border border-neutral-100 bg-white shadow-2xl duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-50 hover:text-neutral-700"
        >
          <X size={18} strokeWidth={1} absoluteStrokeWidth />
        </button>

        <div className="p-6">
          {/* Icon chip */}
          <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${style.iconBg}`}>
            <AlertTriangle size={24} strokeWidth={1} absoluteStrokeWidth className={style.iconColor} />
          </div>

          {/* Content */}
          <h3 className="mb-2 text-lg font-bold text-neutral-900">{title}</h3>
          <p className="text-sm leading-relaxed text-neutral-500">{message}</p>

          {/* Actions — cancel (ghost neutral) + confirm (variant family · no shadow) */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg bg-neutral-50 px-4 py-2.5 text-sm font-bold text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors ${style.button}`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
