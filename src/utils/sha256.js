/** sha256Hex — SHA-256 ของ string เป็น hex ตัวเล็ก (Web Crypto)
 *  ใช้เก็บ hash ของ approval token บน hc_requests แทน token ดิบ — firestore.rules เทียบด้วย hashing.sha256() ฝั่งเดียวกัน */
export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
