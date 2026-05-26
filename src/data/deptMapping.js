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
