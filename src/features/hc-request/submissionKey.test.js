/**
 * submissionKey.test.js — รัน: node --test src/features/hc-request/
 * เทส lifecycle ของ idempotency key ตามที่ HCRequestForm.handleSubmit ใช้จริง
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { reserveSubmission, CLEARED } from './submissionKey.js'

// ตัวสร้าง id ปลอม — เลียนแบบ Firestore doc().id ที่สุ่มใหม่ทุกครั้งที่เรียก
function fakeIdGen() {
  let n = 0
  return () => `doc${++n}`
}

test('กดยื่นซ้ำหลังพลาด → ได้ docId เดิม (ไม่เกิดเคสซ้ำ)', () => {
  const genId = fakeIdGen()
  let key = reserveSubmission(CLEARED, genId)   // กดครั้งที่ 1 → พัง (ยังไม่ commit)
  key = reserveSubmission(key, genId)           // กดย้ำครั้งที่ 2
  key = reserveSubmission(key, genId)           // กดย้ำครั้งที่ 3
  assert.equal(key.docId, 'doc1')
})

test('hcId ที่ generate แล้วถูก reuse ตอนกดซ้ำ → ไม่กิน running number เพิ่ม', () => {
  const genId = fakeIdGen()
  const key = reserveSubmission(CLEARED, genId)
  key.hcId = 'REQ-2026-500'                     // handleSubmit เขียนกลับหลัง generateHCID
  const retry = reserveSubmission(key, genId)
  assert.equal(retry.hcId, 'REQ-2026-500')
})

test('ยื่นสำเร็จแล้วยื่นใบใหม่ → ได้ docId ใหม่ (ห้ามทับใบก่อน)', () => {
  const genId = fakeIdGen()
  const first = reserveSubmission(CLEARED, genId)
  const second = reserveSubmission(CLEARED, genId) // handleSubmit เคลียร์เป็น CLEARED หลัง setDoc
  assert.notEqual(second.docId, first.docId)
})

test('CLEARED ไม่ถูก mutate ข้ามการยื่น (ไม่งั้นใบถัดไปจะทับใบเดิม)', () => {
  const genId = fakeIdGen()
  const key = reserveSubmission(CLEARED, genId)
  key.hcId = 'REQ-2026-501'
  assert.deepEqual(CLEARED, { docId: null, hcId: null })
})
