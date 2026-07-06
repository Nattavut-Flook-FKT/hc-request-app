/**
 * exportExcel.js — Export helpers (Excel .xlsx + CSV)
 * ─────────────────────────────────────────────────────────────────────────────
 * ใช้ SheetJS (xlsx) ที่ติดตั้งอยู่แล้วในโปรเจกต์
 *   exportWorkbook(filename, sheets) → ไฟล์ .xlsx หลาย sheet
 *   exportCSV(filename, aoa)         → ไฟล์ .csv (UTF-8 BOM ให้ Excel/Sheets อ่านภาษาไทยได้)
 *
 * แต่ละ sheet/aoa เป็น "array of arrays" (แถว × คอลัมน์) เช่น
 *   [['Header A','Header B'], ['row1a','row1b'], ...]
 */
import * as XLSX from 'xlsx'
import { escapeCSV } from './reportUtils'

/**
 * Export หลาย sheet เป็นไฟล์ Excel เดียว
 * @param {string} filename ชื่อไฟล์ (เติม .xlsx ให้อัตโนมัติถ้าไม่มี)
 * @param {Array<{name: string, aoa: any[][]}>} sheets
 */
export function exportWorkbook(filename, sheets) {
  const wb = XLSX.utils.book_new()
  sheets.forEach(({ name, aoa }) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa || [[]])
    // จำกัดชื่อ sheet ที่ 31 ตัวอักษร + ตัดอักขระต้องห้ามของ Excel ( : \ / ? * [ ] )
    const safeName = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  })
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  XLSX.writeFile(wb, name)
}

/**
 * Export array-of-arrays เดียวเป็นไฟล์ CSV (UTF-8 BOM)
 * @param {string} filename ชื่อไฟล์ (เติม .csv ให้อัตโนมัติถ้าไม่มี)
 * @param {any[][]} aoa
 */
export function exportCSV(filename, aoa) {
  const csv = '﻿' + aoa.map(row => row.map(escapeCSV).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** timestamp สั้นๆ สำหรับใส่ในชื่อไฟล์ (YYYY-MM-DD) */
export function dateStamp() {
  return new Date().toISOString().slice(0, 10)
}
