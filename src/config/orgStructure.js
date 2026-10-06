// ─── โครงสร้างองค์กร จาก Organization Chart ───
// Division > Department > Section > Business Unit

export const ORG_STRUCTURE = {
  'CEO Office': {
    'Strategic Finance': {},
    'Corporate Lawyer': {},
    'Procurement': {},
    'Executive Driver': {},
  },
  'Commercial': {
    'Marketing': {
      'Campaign Management': [],
      'Communication Management': [],
      'Performance Management': [],
      'Creative Production': [],
    },
    'Commercial Excellence': {
      'Commercial Operations': ['Order Management', 'Commercial Process Optimization', 'Sales Coordinator'],
      'Commercial Enablement': [],
    },
    'Key Account Management': {},
    'Portfolio Management': {},
    'Sales Management': {
      'Sales Representative': [],
      'City Expansion': [],
    },
    'Merchandising': {
      'Dry Grocery': [],
      'Non Food & Beverage': [],
      'Vegetable & Fruits': [],
      'Meat & Eggs': [],
      'Fish & Seafood': [],
      'Processed Food': [],
      'Pricing': [],
      'Merchandising Coordinator': [],
    },
  },
  // Support Function เดิมแตกออกเป็น Division ของตัวเอง (2026-10) — Section เดิมของ PX / F&A ขึ้นมาเป็นแผนก
  // ข้อมูลเก่าย้ายด้วยปุ่ม "ย้ายโครงสร้าง Division" ใน Admin Tools (src/features/admin/orgMigration.js)
  'Customer Success': {
    'Customer Success': {},
  },
  'People Experience': {
    'Compensation & Benefits': {},
    'Talent Acquisition': {},
    'People Business Partner': {},
    'Organization & Development': {},
    'People Information Systems & IT': {},
    'Safety': {},
  },
  'Finance & Accounting': {
    'Collection and Credit Control': {},
    'Account Receivable': {},
    'Treasury': {},
    'Account Payable': {},
    'General Ledger': {},
  },
  'Technology Team': {
    'Software Development': {
      'Software Engineer': [],
      'Infrastructure': [],
      'Application Support': [],
      'Quality Assurance Engineer': [],
    },
    'Data Team': {
      'Data Engineer': [],
      'Data Analyst': [],
      'Data Scientist': [],
    },
    'Product': {
      'Product Owner': [],
      'Product Design': [],
    },
  },
  'AI Transformation & Strategy': {
    'Strategy': {},
    'Innovation': {},
  },
  'Operations': {
    'Operations Support': {
      'Operations Excellence': [],
      'Operations Engineer': [],
      'Warehouse Training': [],
    },
    'Logistic': {
      'Fleet & Hub': [],
      'Dispatcher': [],
      'Logistics Planner': [],
    },
    'Supply Chain as a Service': {
      'Sales Management': [],
      'Key Account Management': [],
      'Solution Design & Implementation': [],
    },
    'Supply Chain & Operation Strategy': {
      'Supply Planning & Replenishment': [],
      'Quality Control': [],
      'Processing Center': [],
    },
    'Distribution Center': {
      'ANR': ['DC', 'Inventory'],
      'LKB': ['DC', 'Inventory'],
      'IYR': ['DC', 'Inventory'],
    },
  },
}

// helper: ดึง list divisions
export const DIVISIONS = Object.keys(ORG_STRUCTURE)

// helper: ดึง departments ของ division
export function getDepartments(division) {
  if (!division) return []
  return Object.keys(ORG_STRUCTURE[division] || {})
}

// helper: ดึง sections ของ department
export function getSections(division, department) {
  if (!division || !department) return []
  return Object.keys(ORG_STRUCTURE[division]?.[department] || {})
}

// helper: ดึง business units ของ section
export function getBusinessUnits(division, department, section) {
  if (!division || !department || !section) return []
  return ORG_STRUCTURE[division]?.[department]?.[section] || []
}

// helper: หา division จากชื่อ department (reverse lookup)
// ใช้ตอน auto-fill department จาก Manager profile เพื่อตั้ง division ด้วย
export function getDivisionByDepartment(department) {
  if (!department) return ''
  for (const [division, depts] of Object.entries(ORG_STRUCTURE)) {
    if (department in depts) return division
  }
  return ''
}
