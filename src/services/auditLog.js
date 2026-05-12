/**
 * auditLog.js — Audit Log Service (บริการบันทึกประวัติการดำเนินการ)
 * ─────────────────────────────────────────────────────────────────────────────
 * บริการนี้ใช้สำหรับบันทึก Audit Log ทุกครั้งที่มีการดำเนินการกับ HC Request
 * เช่น การส่งคำขอ (Submit), การเปลี่ยนสถานะ (StatusChange), การมอบหมายงาน (Assign)
 * หรือการยกเลิกคำขอ (Cancel) โดยข้อมูลจะถูกเก็บใน Firestore collection 'hc_logs'
 *
 * Functions exported:
 *   - logAudit: บันทึก audit entry ลงใน Firestore collection 'hc_logs'
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/**
 * บันทึก Audit Log ลง Firestore hc_logs
 *
 * Records an audit log entry to the 'hc_logs' Firestore collection.
 * Each entry captures who did what action on which request, including
 * optional before/after status values for change-tracking purposes.
 *
 * @param {Object} params              - พารามิเตอร์ทั้งหมดสำหรับ audit entry
 * @param {string} params.requestId    - Firestore doc ID ของ HC Request / The Firestore document ID of the HC Request
 * @param {string} params.action       - ประเภทการดำเนินการ: 'Submit' | 'StatusChange' | 'Assign' | 'Cancel'
 *                                       Action type: 'Submit' | 'StatusChange' | 'Assign' | 'Cancel'
 * @param {string} params.by           - email ของผู้ดำเนินการ / Email of the user who performed the action
 * @param {string} params.byName       - ชื่อของผู้ดำเนินการ / Display name of the user who performed the action
 * @param {string} [params.fromStatus] - สถานะก่อนเปลี่ยน (เฉพาะ StatusChange) / Status before the change (StatusChange only)
 * @param {string} [params.toStatus]   - สถานะหลังเปลี่ยน (เฉพาะ StatusChange) / Status after the change (StatusChange only)
 * @param {string} [params.position]   - ตำแหน่งงานของ request / Job position of the request
 * @param {string} [params.department] - แผนกของ request / Department of the request
 * @param {string} [params.note]       - หมายเหตุเพิ่มเติม (ถ้ามี) / Optional note or comment
 * @returns {Promise<void>} ไม่คืนค่า — ถ้า error จะ log ไว้เท่านั้น ไม่ throw
 *                          Returns nothing — errors are caught and logged silently
 */
export async function logAudit({ requestId, action, by, byName, fromStatus, toStatus, position, department, note }) {
  try {
    // เพิ่ม document ใหม่เข้าไปใน collection 'hc_logs'
    // ใช้ serverTimestamp() เพื่อให้เวลาตรงกับ Firestore server ไม่ใช่ client
    // Add a new document to the 'hc_logs' collection.
    // serverTimestamp() ensures the timestamp is set by the Firestore server clock,
    // not the client, avoiding clock skew issues.
    await addDoc(collection(db, 'hc_logs'), {
      requestId,
      action,
      by,
      byName,
      fromStatus: fromStatus ?? null,   // null ถ้าไม่ได้ส่งมา / null if not provided
      toStatus:   toStatus   ?? null,   // null ถ้าไม่ได้ส่งมา / null if not provided
      position:   position   ?? '',     // '' ถ้าไม่ได้ส่งมา / empty string if not provided
      department: department ?? '',     // '' ถ้าไม่ได้ส่งมา / empty string if not provided
      note:       note       ?? '',     // '' ถ้าไม่ได้ส่งมา / empty string if not provided
      timestamp: serverTimestamp(),     // เวลา server ณ ขณะบันทึก / Server-side timestamp at write time
    })
  } catch (error) {
    // ไม่ throw error เพื่อไม่ให้ขัดจังหวะ flow หลักของแอป
    // Errors are swallowed here so that audit failures do not interrupt the main app flow
    console.error('[auditLog] failed:', error)
  }
}
