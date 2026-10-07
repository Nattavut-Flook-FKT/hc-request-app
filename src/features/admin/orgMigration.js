/**
 * orgMigration.js — ย้ายข้อมูลเก่าเข้าโครงสร้าง Division ใหม่ (2026-10)
 * Support Function แตกเป็น Customer Success / People Experience / Finance & Accounting / AI Transformation & Strategy
 * และ Operation → Operations — ใช้กับปุ่มใน Admin Tools · รัน: node --test src/features/admin/
 */

/** แผนกที่ขึ้นเป็น Division — Section เดิมกลายเป็นแผนก */
const PROMOTED = ['People Experience', 'Finance & Accounting']
/** แผนกเดิมใต้ Support Function → Division ใหม่ */
const DEPT_TO_DIVISION = {
  'Customer Success': 'Customer Success',
  'Strategy':         'AI Transformation & Strategy',
  'Innovation':       'AI Transformation & Strategy',
}
const OLD_SUPPORT = 'Support Function'
const RENAMED = { 'Operation': 'Operations' }

/** Division ทั้งหมดที่แตกออกจาก Support Function — ใช้ย้าย grant ของ Head of Support Function */
export const SUPPORT_SPLIT = ['Customer Success', 'People Experience', 'Finance & Accounting', 'AI Transformation & Strategy']

/**
 * คืนเฉพาะ field ที่ต้องเปลี่ยน ({} = ไม่ต้องแตะ)
 * ใช้ได้กับ hc_requests / custom_positions / jd_library (field ที่ไม่มีก็ข้าม)
 */
export function migrateOrg(rec) {
  const { division, department, section, businessUnit } = rec
  const next = {}

  let newDivision = RENAMED[division]
  if (PROMOTED.includes(department)) {
    newDivision = department
    // ไม่มี section → คงแผนกเป็นชื่อเดิม (= ชื่อ Division) ไว้ ดีกว่าปล่อยแผนกว่าง
    if (section) { next.department = section; next.section = '' }
  } else if (DEPT_TO_DIVISION[department]) {
    newDivision = DEPT_TO_DIVISION[department]
  }
  if (newDivision && newDivision !== division) next.division = newDivision

  // แถวที่ sync จาก Sheets เก็บชื่อ Division ไว้ใน businessUnit (คอลัมน์ H)
  if (businessUnit === OLD_SUPPORT && newDivision) next.businessUnit = newDivision
  else if (RENAMED[businessUnit]) next.businessUnit = RENAMED[businessUnit]

  return next
}

/**
 * ย้าย grant ผู้จัดการ — คืน { deptManagers, divisionManagers } ฉบับใหม่ทั้ง doc
 * - divisionManagers: Support Function → ทุก Division ที่แตกออกมา · Operation → Operations
 * - deptManagers: key ที่กลายเป็นชื่อ Division (PX / F&A / Customer Success) ย้ายไป divisionManagers
 *   ไม่งั้นผู้จัดการจะเห็นแค่เคสเก่าที่แผนกยังชื่อเดิม ไม่เห็นเคสใหม่ของแผนกย่อย
 * ค่าเป็นอีเมลเดี่ยว (แบบเก่า) หรือ array ก็ได้ — ผลลัพธ์เป็น array เสมอ
 */
export function migrateGrants(deptManagers = {}, divisionManagers = {}) {
  const toList = (v) => [].concat(v ?? []).filter(Boolean)
  const divs = {}
  const add = (div, emails) => { divs[div] = [...new Set([...(divs[div] ?? []), ...toList(emails)])] }

  for (const [div, emails] of Object.entries(divisionManagers)) {
    if (div === OLD_SUPPORT) SUPPORT_SPLIT.forEach((d) => add(d, emails))
    else add(RENAMED[div] ?? div, emails)
  }
  const depts = {}
  for (const [dept, emails] of Object.entries(deptManagers)) {
    if (PROMOTED.includes(dept) || dept === 'Customer Success') add(dept, emails)
    else depts[dept] = emails
  }
  return { deptManagers: depts, divisionManagers: divs }
}
