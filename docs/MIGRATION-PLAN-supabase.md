# แผนย้าย hc-request-app: Firebase → Supabase (+ ประเมิน Next.js)

## Context

แอปตอนนี้ใช้ Firebase (Firestore + Auth + Hosting) เป็นหลัก และใช้ Supabase เฉพาะ Storage (ไฟล์ JD/CV)
เจ้าของระบบอยากรวมทุกอย่างไว้ที่ Supabase ที่เดียว และถามเพิ่มว่าถ้าเปลี่ยน Vite → Next.js ด้วยจะเป็นยังไง
แผนนี้เป็น **roadmap สำหรับอนาคต** — ยังไม่ลงมือทำทันที

### สิ่งที่สำรวจพบ (ยืนยันจากโค้ดจริงแล้ว)

- **Firestore collections:** `hc_requests` (ตัวหลัก — มี array fields `statusHistory`/`cvFiles` ที่แก้ด้วย arrayUnion), `users` (doc ID = email, role: admin/ta/manager/pending), `settings`, `hc_logs` (append-only), `custom_positions`, `jd_library`, `counters/hcId_{YYYY}` (เลขรัน HCID แบบ atomic transaction)
- **Firebase features:** Google OAuth (จำกัด @freshket.co), onSnapshot realtime 5 จุด, serverTimestamp, runTransaction, writeBatch, firestore.rules (role-based), Hosting
- **ไฟล์ที่ import firestore: 15 ไฟล์** + auth อีก 3 ไฟล์
- **Integration ภายนอก:** GAS (Google Apps Script 74KB) sync สองทางกับ Google Sheets + Slack alert — GAS คุยกับแอปผ่าน HTTP เท่านั้น ไม่รู้จัก Firestore โดยตรง
- **จุดสำคัญ:** path ไฟล์ใน Supabase Storage ใช้ Firestore doc ID เป็น prefix (`{docId}/{timestamp}_{file}`) → **ต้องเก็บ ID เดิมไว้ตอนย้าย ห้ามเปลี่ยนเป็น UUID ใหม่** ไม่งั้นลิงก์ไฟล์พังหมด

---

## คำแนะนำหลัก (TL;DR)

1. **ทำเฉพาะ Firebase → Supabase / ไม่แนะนำย้ายไป Next.js** (เหตุผลท้ายเอกสาร)
2. เก็บ Firestore doc ID เดิมเป็น `text` primary key (รักษาลิงก์ไฟล์ Storage)
3. `statusHistory` / `cvFiles` เก็บเป็น **JSONB** ไม่แตกเป็นตารางลูก (อ่านพร้อม parent เสมอ, ปริมาณน้อย)
4. Cutover แบบ **big-bang ทีละเฟส + เปิด maintenance mode** (มี flag อยู่แล้วใน `settings`) — ไม่ทำ dual-write เพราะซับซ้อนเกินไปสำหรับ dev คนเดียว
5. **คง Firebase Hosting ไว้ก่อน** (Vite SPA บน Firebase Hosting คุยกับ Supabase ได้ปกติ) ย้ายไป Cloudflare Pages ทีหลังถ้าอยากออกจาก Firebase 100%
6. รวมงาน ≈ **14–19 วัน** (dev คนเดียว + AI ช่วย)

---

## Phase 0 — เตรียมสภาพแวดล้อม (1–2 วัน · เสี่ยงต่ำ)

- เปิด Supabase Auth → Google provider บนโปรเจค Supabase เดิม (ตัวที่ใช้ Storage อยู่ — ไม่ต้องสร้างใหม่)
- ตั้ง Google OAuth app เป็น **Internal** (Workspace) = ด่านแรกของ domain gate @freshket.co
- สร้าง staging project สำหรับซ้อม
- เขียน DDL + RLS เป็น migration file เก็บใน repo (`supabase/migrations/`)

**Rollback:** ไม่มีอะไรต้อง rollback — ยังไม่แตะ prod

## Phase 1 — Schema + RLS + สคริปต์ย้ายข้อมูล (3–4 วัน · เสี่ยงกลาง)

### ตารางหลัก (โครง DDL)

```sql
create table profiles (              -- เดิม: users collection
  email text primary key,           -- คง doc ID เดิม (email)
  user_id uuid unique references auth.users(id),
  display_name text,
  role text not null default 'pending' check (role in ('admin','ta','manager','pending')),
  created_at timestamptz default now()
);

create table hc_requests (
  id text primary key default gen_random_uuid()::text,  -- คง Firestore ID เดิม
  hc_id text unique not null,
  status text not null default 'Open',
  requester_email text not null, requester_name text,
  division text, department text, position text, headcount int,
  assigned_to text, assigned_to_name text, assigned_at timestamptz,
  jd_file_path text, jd_file_name text,
  status_history jsonb not null default '[]',
  cv_files jsonb not null default '[]',
  details jsonb not null default '{}',   -- field อื่นๆ ของฟอร์มทั้งหมด → ไม่ต้อง migrate schema เวลาเพิ่ม field
  created_at timestamptz default now(), closed_at timestamptz
);
-- index: requester_email, status, department

-- hc_logs / audit_logs / custom_positions / jd_library / settings: โครงเดียวกัน (id text PK + jsonb)

-- เลขรัน HCID: แทน runTransaction ฝั่ง client ทั้งหมด
create table hc_counters (year int primary key, value int not null default 0);
create function next_hcid() returns text ...  -- UPDATE..RETURNING = atomic, client แค่ rpc('next_hcid')
```

**หลักการ:** ยกเป็น column เฉพาะ field ที่ใช้ filter/sort (status, department, requester_email, hc_id, วันที่) — ที่เหลือโยนลง `details` JSONB

### RLS (แปลงจาก firestore.rules)

- helper functions: `current_email()`, `is_freshket()`, `my_role()` (ต้องเป็น `security definer` กัน RLS recursion), `is_admin()`, `is_ta()`
- `profiles`: อ่าน = freshket / แก้ = admin / **ตัด self-create ออก** → ใช้ trigger `on auth.users insert` สร้าง profile role='pending' อัตโนมัติ (ปิดช่อง privilege escalation ถาวร)
- `hc_requests`: อ่าน/สร้าง/แก้ = freshket, ลบ = admin
- `hc_logs`: append-only ด้วยการ**ไม่สร้าง update policy เลย**
- `hc_counters`: ไม่มี policy = ไม่มีใครแตะตรงได้ เข้าผ่าน `next_hcid()` เท่านั้น (ปลอดภัยกว่า rules เดิม)
- domain gate 3 ชั้น: OAuth Internal + trigger ปฏิเสธ email นอก @freshket.co + `is_freshket()` ในทุก policy

### สคริปต์ย้ายข้อมูล (`scripts/migrate/`)

- `export.js` — firebase-admin อ่านทุก collection → NDJSON (แปลง Timestamp → ISO, camelCase → snake_case, field ที่ไม่มี column → `details`)
- `import.js` — supabase-js (service role key) `upsert` ทีละ 500 → **รันซ้ำได้ (idempotent)**
- `verify.js` — เทียบจำนวน row, สุ่มเช็ค 10 รายการ field ต่อ field, เช็คว่า `cv_files[].path` / `jd_file_path` ทุกอันมีไฟล์จริงใน Storage, seed `hc_counters` จาก max(hc_id)
- **ซ้อมครบวงจรบน staging ด้วยข้อมูล export จริง = เงื่อนไขผ่านเฟสนี้**

## Phase 2 — สลับ Auth (2–3 วัน · เสี่ยงกลาง-สูง — จุดเสี่ยงสุดของงาน)

- แทน `onAuthStateChanged` + Google popup (App.jsx, Login.jsx, Sidebar.jsx, PendingApprovalPage.jsx) ด้วย `supabase.auth.onAuthStateChange` + `signInWithOAuth({provider:'google', options:{queryParams:{hd:'freshket.co'}}})`
- ไม่ต้องย้าย password (OAuth ล้วน) — import profiles ก่อนได้เลย, trigger เติม `user_id` ตอน login ครั้งแรก
- role resolution: อ่าน `profiles` ผ่าน RLS แทน `users/{email}.role`
- **โบนัสความปลอดภัย:** เพิ่ม Storage policies (ตอนนี้ bucket เปิดด้วย anon key เปล่าๆ) — อ่าน/upload = freshket, ลบ = ta/admin

**Rollback:** โค้ดเฟสนี้ deploy พร้อม Phase 4 เท่านั้น — rollback = ไม่ deploy

## Phase 3 — เขียน data layer ใหม่ (4–6 วัน · เสี่ยงกลาง แต่เป็นงาน mechanical)

แก้ 15 ไฟล์ที่ import firestore จุดหนักคือ:

| ไฟล์ | งาน |
|---|---|
| `RequestTable.jsx` (~1,500 บรรทัด) | arrayUnion/arrayRemove → RPC `append_status` / `add_cv_file` / `remove_cv_file` (~1.5 วัน) |
| `HCRequestForm.jsx` | generateHCID transaction → `rpc('next_hcid')` + insert |
| `webhook.js` `syncFromSheets` | writeBatch → `upsert` batch (ฝั่ง GAS ไม่ต้องแตะ) |
| `ImportPage.jsx` | writeBatch(400) → upsert batch |
| ที่เหลือ (pages, auditLog, StatsListener, ManagerRequestsView, App.jsx) | แปลง query ตรงไปตรงมา |

**เทคนิค:** สร้าง `src/services/db.js` เป็น layer บางๆ ที่ mimic call shape เดิม → diff ต่อหน้าจอเล็กลง แปลงทีละหน้าเทสกับ staging ได้
Realtime ช่วงนี้ใช้ polling/refresh ชั่วคราวได้ (ทำจริงใน Phase 5)

## Phase 4 — วัน Cutover (1 วัน · เสี่ยงสูงแต่ย้อนกลับได้เต็มรูป)

1. ประกาศ + เปิด maintenance mode (flag เดิมใน `settings` — แอปเก่า block write ทันที)
2. รัน export → import → verify กับ Supabase production (ซ้อมมาแล้ว)
3. Deploy build ใหม่ขึ้น **Firebase Hosting เดิม** (เปลี่ยนแค่ JS bundle)
4. Smoke test กับ user จริง 3 role: login, ยื่นคำขอ (HCID + upload JD + webhook + audit log), เปลี่ยนสถานะ, upload CV, Sheets sync, Slack alert
5. ปิด maintenance
6. ตั้ง firestore.rules เป็น **read-only ทั้งหมด** → Firestore กลายเป็น snapshot แช่แข็ง เก็บไว้ 30 วัน

**Rollback:** redeploy build เก่า + คืน rules เดิม — ข้อมูล Firestore อยู่ครบ ณ จุด freeze แถวที่เขียนเข้า Supabase ระหว่างนั้น (internal tool วันละไม่กี่รายการ) คีย์ใหม่มือได้ในไม่กี่นาที

## Phase 5 — Realtime + เก็บกวาด integration (2–3 วัน · เสี่ยงต่ำ-กลาง)

- `alter publication supabase_realtime add table hc_requests, profiles, settings;`
- แปลง onSnapshot 5 จุด → `postgres_changes` ด้วย pattern **"event เป็นสัญญาณ → refetch ทั้ง query"** (พฤติกรรมเหมือน onSnapshot เดิมเป๊ะ เลี่ยง gotcha เรื่อง DELETE payload มีแค่ PK / RLS กับ realtime / token refresh)
- ลบ Cloud Function `gasProxy` (ยืนยันแล้วว่า frontend ไม่ได้ใช้)
- **แนะนำเพิ่ม:** Supabase Edge Function `gas-relay` เก็บ `GAS_SECRET` ฝั่ง server (ตอนนี้ secret หลุดไปกับ bundle ใน browser ผ่าน `VITE_GAS_SECRET`) — ครึ่งวัน
- **ไม่ต้องเขียน GAS 74KB ใหม่** — มันคุย HTTP กับแอป ไม่รู้จัก DB ข้างหลัง

## Phase 6 — ปิดระบบเก่า (0.5–1 วัน · เสี่ยงต่ำ)

- ครบ 30 วันเงียบ: export Firestore เก็บถาวร (NDJSON), ลบ Cloud Function, ถอด `firebase` ออกจาก package.json (bundle เล็กลง ~110KB gzip), ลบข้อมูล Firestore
- Hosting: จะคง Firebase Hosting ต่อ (ฟรี ไม่เกี่ยวกับ DB) หรือย้าย Cloudflare Pages (ย้าย security headers จาก firebase.json ไปด้วย) ก็ได้

---

## ส่วน B — Next.js: **ไม่แนะนำ** (หรือ "ยังไม่ใช่ตอนนี้ และไม่ควรทำพร้อมกัน")

เหตุผลตรงๆ:
- ทุกหน้าเป็น stateful + auth-gated + realtime → ใน Next.js ทุกอย่างต้องเป็น `'use client'` = ได้ SPA เหมือนเดิมแต่เพิ่ม server ที่ต้องดูแล
- Internal tool ภาษาไทย ไม่มี SEO ไม่มีหน้า public → SSR ไม่มีประโยชน์
- react-router-dom 7 → App Router = churn ล้วนๆ 11 หน้า + env `VITE_` → `NEXT_PUBLIC_`
- ประโยชน์จริง 2 อย่างของ Next.js ถูกทดแทนหมด: ซ่อน GAS secret → Edge Function (ครึ่งวัน), server-side auth → RLS บังคับที่ DB อยู่แล้ว
- **ถ้าจะทำจริงๆ:** ทำหลังย้าย DB เสร็จเป็นโปรเจคแยก — **ห้ามทำสองอย่างพร้อมกัน** เพราะจะทำลาย rollback story (redeploy build เก่ากลับไปหา Firestore ไม่ได้อีก)

---

## สรุปแรงงาน + ความเสี่ยง

| Phase | งาน | วัน | เสี่ยง |
|---|---|---|---|
| 0 | ตั้งค่า Auth provider, DDL, staging | 1–2 | ต่ำ |
| 1 | Schema + RLS + สคริปต์ย้าย + ซ้อม staging | 3–4 | กลาง |
| 2 | สลับ Supabase Auth + Storage policies | 2–3 | กลาง-สูง |
| 3 | เขียน data layer ใหม่ (15 ไฟล์) | 4–6 | กลาง |
| 4 | วัน cutover | 1 | สูง (ย้อนได้) |
| 5 | Realtime + Edge Function + ลบ gasProxy | 2–3 | ต่ำ-กลาง |
| 6 | ปิดระบบเก่า | 0.5–1 | ต่ำ |
| **รวม** | | **≈ 14–19 วัน** | |

**ความเสี่ยงหลักที่ต้อง test เจาะจง:**
1. Auth edge cases — flow role=pending และ role resolution ที่พึ่ง `sheetsData.js` fallback → ทดสอบครบ 4 role บน staging
2. Doc shape drift ใน `hc_requests` เก่า (field งอกตามกาลเวลา) → `details` JSONB + verify script รับมือ
3. `syncFromSheets` เขียนข้อมูลเก่าจาก Sheets ทับข้อมูลใหม่หลัง cutover → re-test HCID matching
4. Realtime token refresh → แก้ด้วย pattern refetch-on-event

## ไฟล์สำคัญ (จุดที่งานหนักสุด)

- `src/components/Dashboard/RequestTable.jsx` — data-layer surface ใหญ่สุด (arrayUnion, status flow, CV files)
- `src/components/Forms/HCRequestForm.jsx` — HCID transaction → RPC
- `src/App.jsx` — Auth + maintenance listener
- `src/services/webhook.js` — syncFromSheets + GAS secret
- `firestore.rules` — source of truth สำหรับแปลงเป็น RLS

## Verification (ต่อเฟส)

- Phase 1: รัน export→import→verify บน staging กับข้อมูล prod จริง — row count ตรง, spot-check ผ่าน, ไฟล์ Storage ครบ
- Phase 2–3: เทสทุกหน้า × 4 role บน staging (login, CRUD, upload, sync)
- Phase 4: smoke test checklist กับ user จริงก่อนปิด maintenance
- Phase 5: เปิด 2 browser เทส realtime — แก้สถานะฝั่งหนึ่ง อีกฝั่งต้องเห็นภายในไม่กี่วินาที
