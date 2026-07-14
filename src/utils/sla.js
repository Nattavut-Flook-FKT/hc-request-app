import { getDepartments } from '../data/orgStructure'

/**
 * slaLimit — เป้าหมาย SLA (วัน) ต่อ request ตามกติกาใหม่:
 *   - สาย Technology Team ทั้งหมด → 45 วัน
 *   - ตำแหน่ง Manager ขึ้นไป (JG9+) → 45 วัน
 *   - ต่ำกว่า Manager → 30 วัน
 * เช็ค department ด้วยเพราะ row เก่าที่ import มาอาจไม่มี field division
 */
const TECH_DEPTS = new Set(getDepartments('Technology Team'))

export function slaLimit(req) {
  if (req?.division === 'Technology Team' || TECH_DEPTS.has(req?.department)) return 45
  const jgNum = parseInt(String(req?.jg || '').replace(/^JG/i, ''), 10)
  return jgNum >= 9 ? 45 : 30
}
