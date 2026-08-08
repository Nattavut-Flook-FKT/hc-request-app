# [พัก] Slack DM ส่วนตัวถึง Manager

ฟีเจอร์นี้ถูก **ถอดออกจาก `gas/Code.gs` แล้ว** — ไฟล์ในเครื่องตอนนี้ตรงกับ deployment `@56` เป๊ะ
เก็บไว้ที่นี่เพื่อกู้กลับได้ ไม่ต้องไปขุด git

| | |
|---|---|
| Commit ต้นทาง | `0521149` — feat: Slack DM ส่วนตัวถึง Manager เมื่อเคสถึง milestone สำคัญ |
| สถานะ | เคยอยู่ใน git แต่ **ไม่เคย deploy** ขึ้น production เลย (v48–55 ตรงกับ commit ก่อนหน้า) |
| วันที่พัก | 9 ส.ค. 2026 |
| เหตุผล | ตอน deploy `updateFields` (`@56`) เจอว่า commit นี้จะติดขึ้น production ไปด้วย → ตัดออกก่อน |

---

## ทำอะไร

เมื่อสถานะเคสเปลี่ยนเป็น **Offering / Onboarding / Rejected / Closed** → DM ส่วนตัวใน Slack
ถึง Manager เจ้าของเคส (นอกเหนือจากห้องกลาง `SLACK_UPDATES` ที่แจ้งทุกสถานะเหมือนเดิม)

แปลง email → Slack user ID ผ่าน `users.lookupByEmail` แล้ว cache 6 ชม. กันยิงซ้ำ
ไม่มี `SLACK_BOT_TOKEN` หรือหา email ไม่เจอใน workspace → ข้ามเงียบๆ ไม่ทำให้ status update พัง

## ต้องตั้งค่าก่อนใช้

Script Property: `SLACK_BOT_TOKEN` = Bot User OAuth Token (`xoxb-...`)
ต้องสร้าง Slack App เอง — Bot scopes: `users:read.email`, `chat:write`

## ฝั่งแอปยังพร้อมอยู่

`sendStatusUpdate()` ยังส่ง `requesterEmail` ไปกับ query param อยู่แล้ว (harmless — GAS ปัจจุบันไม่อ่าน)
กู้ฝั่ง GAS อย่างเดียวก็ทำงานได้เลย ไม่ต้องแตะ React

---

## วิธีกู้กลับ

```bash
git show 0521149 -- gas/Code.gs | git apply
```

หรือแปะ 4 ชิ้นข้างล่างกลับเข้าไปเอง

### 1. Config — ต่อท้าย `var CEO_EMAIL = ...` (ราว บรรทัด 403)

```js
// SLACK_BOT_TOKEN — Bot User OAuth Token (xoxb-...) สำหรับ DM ส่วนตัวถึง Manager
// ต้องสร้าง Slack App เอง (Bot scopes: users:read.email, chat:write) — ว่างเปล่า = ข้าม DM เงียบๆ
var SLACK_BOT_TOKEN     = _props.getProperty('SLACK_BOT_TOKEN')     || ''
// DM_MILESTONES — สถานะที่จะ DM ส่วนตัวถึง Manager (แค่จุดสำคัญ กันสแปม)
var DM_MILESTONES       = ['Offering', 'Onboarding', 'Rejected', 'Closed']
```

### 2. `slackStatusUpdate()` — ต่อท้าย `sendSlack_(SLACK_UPDATES, ...)` ก่อนปิดฟังก์ชัน

```js
  // ── DM ส่วนตัวถึง Manager เจ้าของเคส เฉพาะ milestone สำคัญ (กันสแปมทุกสถานะ) ──
  if (extra.requesterEmail && DM_MILESTONES.indexOf(newStatus) !== -1) {
    slackDMManager_(extra.requesterEmail, '👋 เคสของคุณอัพเดต\n' + lines.slice(1).join('\n'))
  }
```

### 3. ฟังก์ชันใหม่ — วางก่อน `function sendSlack_(...)`

```js
// slackDMManager_ — แปลง email → Slack user ID (cache 6ชม. กัน lookupByEmail ซ้ำ) แล้ว DM ส่วนตัว
// ต้องมี SLACK_BOT_TOKEN (Bot scopes: users:read.email, chat:write) ไม่งั้นข้ามเงียบๆ
// email ที่หาไม่เจอใน workspace (เช่น external) ก็ข้ามเงียบๆ เหมือนกัน — ไม่ทำให้ status update พัง
function slackDMManager_(email, text) {
  if (!SLACK_BOT_TOKEN || !email) return
  try {
    var cache = CacheService.getScriptCache()
    var key = 'slackuid_' + email
    var userId = cache.get(key)
    if (!userId) {
      var lookup = UrlFetchApp.fetch(
        'https://slack.com/api/users.lookupByEmail?email=' + encodeURIComponent(email),
        { headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN }, muteHttpExceptions: true }
      )
      var data = JSON.parse(lookup.getContentText())
      if (!data.ok) { Logger.log('[slackDMManager_] lookup fail: ' + data.error); return }
      userId = data.user.id
      cache.put(key, userId, 21600) // 6 ชม.
    }
    UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { Authorization: 'Bearer ' + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: userId, text: text }),
      muteHttpExceptions: true,
    })
  } catch (err) { Logger.log('[slackDMManager_] EXCEPTION: ' + err.message) }
}
```

### 4. `doGet_()` action `updateStatus` — 2 จุด

อ่าน param (ต่อท้ายบรรทัด `const itEmail = ...`):

```js
      const requesterEmail = e.parameter.requesterEmail || null   // อีเมล Manager เจ้าของเคส — ใช้ DM ส่วนตัวตอน milestone สำคัญเท่านั้น
```

ส่งเข้า `slackStatusUpdate()` (เพิ่มใน object `extra` ต่อจาก `startDate: alertStartDate,`):

```js
        requesterEmail: requesterEmail,
```

---

## ก่อน deploy รอบหน้า

`clasp push` จาก `gas/` เขียนทับ HEAD ของ Apps Script ทั้งไฟล์
เช็คก่อนเสมอว่าในไฟล์ไม่มีของที่ยังไม่อยากขึ้น production:

```bash
grep -n "slackDMManager_\|DM_MILESTONES\|SLACK_BOT_TOKEN" gas/Code.gs
```

ได้ผลลัพธ์ = ฟีเจอร์นี้กลับมาแล้ว จะขึ้น production ถ้า push
