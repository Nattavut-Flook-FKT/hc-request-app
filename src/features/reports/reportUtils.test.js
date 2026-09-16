/**
 * reportUtils.test.js — รัน: node --test src/features/reports/
 * เทสว่านาฬิกา SLA หยุดจริงตอนพักเคส (OnHold) และตอนเคสจบ
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeSLADays } from './reportUtils.js'

const DAY = 86400000
const ago = d => new Date(Date.now() - d * DAY)

/** สร้าง req ปลอม — createdAt = กี่วันที่แล้ว, history = [[status, กี่วันที่แล้ว], ...] */
const req = (createdDaysAgo, history = []) => ({
  createdAt: ago(createdDaysAgo),
  statusHistory: history.map(([status, d]) => ({ status, changedAt: ago(d).toISOString() })),
})

test('กด On hold แล้วนาฬิกาหยุด — ไม่เดินต่อหลังพัก', () => {
  // เปิดเคส 30 วันที่แล้ว, พักไว้ตอนวันที่ 20 → ต้องได้ 10 วัน ไม่ใช่ 30
  assert.equal(computeSLADays(req(30, [['OnHold', 20]])), 10)
})

test('ปลด On hold กลับมาหาต่อ → นาฬิกาเดินต่อจากที่ค้างไว้ ไม่นับช่วงพัก', () => {
  // เปิด 30 วันที่แล้ว → พักวันที่ 20 (สะสม 10) → กลับมา Recruiting วันที่ 5 (เดินอีก 5)
  assert.equal(computeSLADays(req(30, [['OnHold', 20], ['Recruiting', 5]])), 15)
})

test('เคสจบแล้ว (Rejected / NoShow) นาฬิกาต้องหยุด ไม่วิ่งค้างตลอดไป', () => {
  assert.equal(computeSLADays(req(30, [['Rejected', 20]])), 10)
  assert.equal(computeSLADays(req(30, [['NoShow', 20]])), 10)
})

test('เคสที่ยังหาอยู่จริง นาฬิกาต้องเดินถึงวันนี้', () => {
  assert.equal(computeSLADays(req(30, [['Recruiting', 25]])), 30)
})

test('ส่งไม้ต่อ Offering แล้วนาฬิกา TA หยุด (ของเดิม ห้ามพัง)', () => {
  assert.equal(computeSLADays(req(30, [['Offering', 20]])), 10)
})

test('ผู้สมัครหลุดหลัง Onboarding → เริ่มนับรอบใหม่ ไม่เอาเวลารอบเก่ามาบวก', () => {
  // เปิด 60 วัน → Onboarding วันที่ 40 (สะสม 20) → หลุด กลับมา Recruiting วันที่ 10
  assert.equal(computeSLADays(req(60, [['Onboarding', 40], ['Recruiting', 10]])), 10)
})
