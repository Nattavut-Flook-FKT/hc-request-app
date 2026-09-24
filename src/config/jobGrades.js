// HQ Job Grade levels (from JG.xlsx — HQ track)
export const HQ_JG_LEVELS = [
  { value: 'JG14', label: 'JG14 — Chief Executive Officer' },
  { value: 'JG13', label: 'JG13 — C-Level' },
  { value: 'JG12', label: 'JG12 — Vice President' },
  { value: 'JG11', label: 'JG11 — Head of Department' },
  { value: 'JG10', label: 'JG10 — Senior Manager / Associate Director' },
  { value: 'JG9',  label: 'JG9 — Manager / Lead' },
  { value: 'JG8',  label: 'JG8 — Assistant Manager / Team Lead' },
  { value: 'JG7',  label: 'JG7 — Senior Supervisor / Senior Specialist' },
  { value: 'JG6',  label: 'JG6 — Supervisor / Specialist' },
  { value: 'JG5',  label: 'JG5 — Senior Officer / Executive' },
  { value: 'JG4',  label: 'JG4 — Officer' },
  { value: 'JG3',  label: 'JG3 — Staff / Assistant' },
  { value: 'JG0',  label: 'JG0 — Contract Staff' },
  { value: 'Internship', label: 'Internship' },
]

// ── Helper ────────────────────────────────────────────────────────────────────
// คืน label เต็มของ JG เช่น 'JG7 — Senior Supervisor / Senior Specialist'
// ระดับต่างกันตาม track (JG9 HQ = Manager / Lead · OPERATION = Manager) → ส่ง orgTrack มาด้วยถ้ารู้
// ไม่ส่ง = ลอง HQ ก่อนแล้วค่อย OPERATION (พฤติกรรมเดิม) · ไม่เจอเลยคืนค่าเดิม
export function getJGLabel(jg, orgTrack) {
  if (!jg) return ''
  const lists = orgTrack === 'OPERATION' ? [OPERATION_JG_LEVELS, HQ_JG_LEVELS] : [HQ_JG_LEVELS, OPERATION_JG_LEVELS]
  const found = lists[0].find((l) => l.value === jg) || lists[1].find((l) => l.value === jg)
  return found ? found.label : jg
}

// Operation Job Grade levels (from JG.xlsx — Operation track)
export const OPERATION_JG_LEVELS = [
  { value: 'JG14', label: 'JG14 — CEO' },
  { value: 'JG13', label: 'JG13 — C-Level' },
  { value: 'JG12', label: 'JG12 — Vice President' },
  { value: 'JG11', label: 'JG11 — Head of Department' },
  { value: 'JG10', label: 'JG10 — Senior Manager' },
  { value: 'JG9', label: 'JG9 — Manager' },
  { value: 'JG8', label: 'JG8 — Assistant Manager' },
  { value: 'JG7', label: 'JG7 — Senior Supervisor' },
  { value: 'JG6', label: 'JG6 — Supervisor II' },
  { value: 'JG5', label: 'JG5 — Supervisor I' },
  { value: 'JG4', label: 'JG4 — Leader' },
  { value: 'JG3', label: 'JG3 — Senior Master' },
  { value: 'JG2', label: 'JG2 — Master' },
  { value: 'JG1', label: 'JG1 — Staff (Monthly)' },
  { value: 'JG0', label: 'JG0 — Staff (Daily)' },
  { value: 'Internship', label: 'Internship' },
]
