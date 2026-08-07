// ─── Mapping ชื่อแผนกจาก Org Chart → ชื่อใน Maindata (Google Sheets) ───
// ใช้เพื่อ filter พนักงานตอนเลือก Replacement

export const DEPT_MAINDATA_MAP = {
  // CEO Office Division — Maindata เก็บรวมกันภายใต้ "CEO Office"
  'Strategic Finance':                 ['CEO Office'],
  'Corporate Lawyer':                  ['CEO Office'],
  'Strategy':                          ['CEO Office'],    // Strategy team อาจเก็บใน CEO Office
  'Executive Driver':                  ['CEO Office'],
  // Procurement → ตรงกันใน Maindata แล้ว ไม่ต้อง map

  // Tech รวมกันใน Maindata
  'Software Development':              ['Tech&Product'],
  'Data Team':                         ['Tech&Product'],
  'Product':                           ['Tech&Product'],

  // ชื่อต่างกัน
  'Commercial Excellence':             ['Commercial Operations'],
  'Operations Support':                ['Operations'],
  'Logistic':                          ['Logistics'],

  // Supply Chain & Operation Strategy — รวม Processing Center ด้วย (เป็น Section ใน Maindata)
  'Supply Chain & Operation Strategy': ['Supply Chain & Operation Strategy', 'Processing Center'],

  // Distribution Center แตกตาม Section
  'Distribution Center':               ['Distribution Center-ANR', 'Distribution Center-IYR', 'Distribution Center-LKB'],
}

// Mapping ระดับ Section → Maindata department name
export const SECTION_MAINDATA_MAP = {
  // Distribution Center sections
  'ANR':               'Distribution Center-ANR',
  'LKB':               'Distribution Center-LKB',
  'IYR':               'Distribution Center-IYR',
  // Supply Chain & Operation Strategy sections
  'Processing Center': 'Processing Center',
}

/**
 * ทิศกลับของ resolveDeptNames: ชื่อแบบ Maindata/ข้อมูลเก่า → ชื่อแผนกใน Org Chart
 * ใช้กับ grant ของ Manager (settings/deptManagers) ที่ Admin เลือกจากชื่อแผนกในข้อมูลเก่า
 * เช่น grant 'Distribution Center-LKB' → ['Distribution Center'] ซึ่งมีอยู่จริงใน orgStructure
 * ถ้าไม่รู้จัก → คืนชื่อเดิม (แผนก custom ที่เพิ่มเองก็ยังใช้ได้)
 * @returns {string[]} 1 ชื่อขึ้นไป (เช่น 'Tech&Product' ตรงกับ 3 แผนกใน Org Chart)
 */
export function toOrgDepts(name) {
  if (!name) return []
  const hits = Object.entries(DEPT_MAINDATA_MAP)
    .filter(([dept, alts]) => dept !== name && alts.includes(name))
    .map(([dept]) => dept)
  return hits.length ? hits : [name]
}

/** ทิศกลับของ SECTION_MAINDATA_MAP: 'Distribution Center-LKB' → 'LKB' (ไม่เจอ = '') */
export function toOrgSection(name) {
  return Object.entries(SECTION_MAINDATA_MAP).find(([, v]) => v === name)?.[0] || ''
}

/**
 * แปลงชื่อแผนก (Org Chart) → ชื่อใน Maindata
 * รองรับ section เพื่อ narrow down ตาม section ที่เลือก
 */
export function resolveDeptNames(department, section = '') {
  // ถ้าเลือก Section ที่มีใน SECTION_MAINDATA_MAP → แสดงเฉพาะ section นั้น
  if (section && SECTION_MAINDATA_MAP[section]) {
    return [SECTION_MAINDATA_MAP[section]]
  }

  // ถ้ามี mapping → ใช้ชื่อจาก Maindata
  if (DEPT_MAINDATA_MAP[department]) {
    return DEPT_MAINDATA_MAP[department]
  }

  // ถ้าไม่มี mapping → ใช้ชื่อตรงๆ
  return [department]
}
