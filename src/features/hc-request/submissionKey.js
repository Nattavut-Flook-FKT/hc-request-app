/**
 * submissionKey.js — idempotency key ของการยื่นคำขอ 1 ครั้ง
 * ─────────────────────────────────────────────────────────────────────────────
 * ปัญหาที่แก้: user ยื่นแล้วเจอ error → กดยื่นซ้ำๆ → เกิดเคสซ้ำใน Firestore/Sheets
 * วิธี: จอง docId ฝั่ง client ครั้งเดียวต่อ "การกรอกฟอร์ม 1 ครั้ง" แล้ว setDoc ด้วย id เดิม
 *      กดซ้ำ = เขียนทับ doc เดิม ไม่เพิ่มเคส
 *
 * แยกออกมาจาก HCRequestForm เพื่อ test lifecycle ได้ (bug ที่นี่ = เคสทับกัน/เคสซ้ำ)
 * ดู submissionKey.test.js — รันด้วย `node --test src/features/hc-request/`
 */

/** state เริ่มต้น + state หลัง commit สำเร็จ (ครั้งต่อไปต้องได้ docId ใหม่) */
export const CLEARED = Object.freeze({ docId: null, hcId: null })

/**
 * reserveSubmission — คืน key ที่จะใช้ยื่นครั้งนี้
 * @param {{docId: string|null, hcId: string|null}} current key ปัจจุบัน
 * @param {() => string} genId ตัวสร้าง doc id ใหม่ (Firestore doc().id)
 * @returns key เดิมถ้ายังจองค้างอยู่ (= retry) หรือ key ใหม่ถ้าเพิ่งเริ่ม
 */
export function reserveSubmission(current, genId) {
  return current.docId ? current : { docId: genId(), hcId: null }
}
