/**
 * ConfirmModal.jsx — Reusable confirmation dialog
 * ─────────────────────────────────────────────────────────────────────────────
 * Modal สำหรับขอยืนยันการทำรายการ (เช่น ลบข้อมูล, ยกเลิกคำขอ)
 * รองรับ 3 รูปแบบ (variant) คือ danger, warning, และ info
 * แต่ละ variant มีสีของ icon และปุ่มยืนยันที่แตกต่างกัน
 * คลิก backdrop ด้านหลังจะปิด modal เช่นเดียวกับปุ่ม X
 *
 * Props:
 *   isOpen      {boolean}  เปิด/ปิด modal
 *   onClose     {function} callback เมื่อผู้ใช้ยกเลิกหรือคลิก backdrop
 *   onConfirm   {function} callback เมื่อผู้ใช้กดปุ่มยืนยัน
 *   title       {string}   หัวข้อของ modal (default: 'ยืนยันการทำรายการ')
 *   message     {string}   ข้อความคำถามหรือคำอธิบายรายละเอียด
 *   confirmText {string}   ข้อความบนปุ่มยืนยัน (default: 'ยืนยัน')
 *   cancelText  {string}   ข้อความบนปุ่มยกเลิก (default: 'ยกเลิก')
 *   variant     {string}   รูปแบบสี: 'danger' | 'warning' | 'info' (default: 'danger')
 *
 * Notes:
 *   - render null เมื่อ isOpen=false เพื่อไม่ให้ DOM มี element ที่ไม่จำเป็น
 *   - variantStyles รวม class ของ icon, ปุ่ม, และ border ตาม variant ไว้ในที่เดียว
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

  // map variant → Tailwind classes สำหรับ icon, ปุ่ม, และ border
  const variantStyles = {
    danger: {
      iconBg: 'bg-red-100 dark:bg-red-900/30',
      iconColor: 'text-red-600 dark:text-red-400',
      buttonBg: 'bg-red-600 hover:bg-red-700',
      borderColor: 'border-red-200 dark:border-red-900/30',
    },
    warning: {
      iconBg: 'bg-amber-100 dark:bg-amber-900/30',
      iconColor: 'text-amber-600 dark:text-amber-400',
      buttonBg: 'bg-amber-600 hover:bg-amber-700',
      borderColor: 'border-amber-200 dark:border-amber-900/30',
    },
    info: {
      iconBg: 'bg-emerald-100 dark:bg-emerald-900/30',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      buttonBg: 'bg-[#008065] hover:bg-emerald-700',
      borderColor: 'border-emerald-200 dark:border-emerald-900/30',
    },
  }

  const style = variantStyles[variant]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop — คลิกเพื่อปิด modal */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <X size={18} />
        </button>

        <div className="p-6">
          {/* Icon */}
          <div className={`w-12 h-12 rounded-xl ${style.iconBg} flex items-center justify-center mb-4`}>
            <AlertTriangle size={24} className={style.iconColor} />
          </div>

          {/* Content */}
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
            {title}
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">
            {message}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-bold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 px-4 py-2.5 text-sm font-bold text-white ${style.buttonBg} rounded-xl transition-colors shadow-lg shadow-black/10`}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
