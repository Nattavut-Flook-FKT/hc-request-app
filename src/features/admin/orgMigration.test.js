/** orgMigration.test.js — รัน: node --test src/features/admin/ */
import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateOrg, migrateGrants } from './orgMigration.js'

test('PX: Section เดิมขึ้นเป็นแผนก, แผนกเดิมขึ้นเป็น Division', () => {
  assert.deepEqual(
    migrateOrg({ division: 'Support Function', department: 'People Experience', section: 'Talent Acquisition' }),
    { division: 'People Experience', department: 'Talent Acquisition', section: '' },
  )
})

test('PX ที่ไม่มี section → แผนกคงเดิม เปลี่ยนแค่ Division', () => {
  assert.deepEqual(migrateOrg({ department: 'Finance & Accounting' }), { division: 'Finance & Accounting' })
})

test('Strategy / Innovation / Customer Success ย้าย Division', () => {
  assert.deepEqual(migrateOrg({ division: 'Support Function', department: 'Strategy' }), { division: 'AI Transformation & Strategy' })
  assert.deepEqual(migrateOrg({ division: 'Support Function', department: 'Customer Success' }), { division: 'Customer Success' })
})

test('Operation → Operations ทั้ง division และ businessUnit (แถวจาก Sheets)', () => {
  assert.deepEqual(migrateOrg({ division: 'Operation', department: 'Logistic' }), { division: 'Operations' })
  assert.deepEqual(migrateOrg({ department: 'Logistics', businessUnit: 'Operation' }), { businessUnit: 'Operations' })
})

test('แถวจาก Sheets: businessUnit = Support Function → Division ใหม่', () => {
  assert.deepEqual(
    migrateOrg({ department: 'People Experience', businessUnit: 'Support Function' }),
    { division: 'People Experience', businessUnit: 'People Experience' },
  )
})

test('เคสที่ไม่เกี่ยว → ไม่แตะ (รันซ้ำได้)', () => {
  assert.deepEqual(migrateOrg({ division: 'Commercial', department: 'Marketing', businessUnit: 'Commercial' }), {})
  assert.deepEqual(migrateOrg({ division: 'People Experience', department: 'Talent Acquisition', section: '' }), {})
})

test('grant: Head of Support Function ได้ทุกสายที่แตกออก · grant แผนก PX ย้ายเป็น grant Division', () => {
  const r = migrateGrants(
    { 'People Experience': 'px@x.co', 'Marketing': ['mk@x.co'] },
    { 'Support Function': ['head@x.co'], 'Operation': ['ops@x.co'] },
  )
  assert.deepEqual(r.deptManagers, { 'Marketing': ['mk@x.co'] })
  assert.deepEqual(r.divisionManagers['People Experience'], ['head@x.co', 'px@x.co'])
  assert.deepEqual(r.divisionManagers['AI Transformation & Strategy'], ['head@x.co'])
  assert.deepEqual(r.divisionManagers['Operations'], ['ops@x.co'])
  assert.equal(r.divisionManagers['Support Function'], undefined)
})
