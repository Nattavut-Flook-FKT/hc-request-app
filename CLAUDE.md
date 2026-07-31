# CLAUDE.md — HC Request App

## Project Info

- **FKT Design Guidelines:** /Users/flook/FKT-WORKSPACE/FKT Design Guidelines
- **DS Version:** v1.0
- **Stack:** React 19 + Vite + Tailwind CSS + Firebase (Firestore/Hosting) + react-router-dom 7
- **Platform:** WEB

---

## Dev Flow — ทำตามนี้ทุกงานแก้โค้ด ไม่ต้องถาม

Trunk เดียวคือ `main` · ไม่มี `develop` · **ห้าม commit ลง `main` ตรงๆ**

### 1. เลือก branch จากไฟล์ที่จะแก้

| ไฟล์ที่แตะ | branch |
|---|---|
| `src/features/<x>/` | `hcr/feature/<x>` |
| `src/components/ui/` · `src/components/app-shell/` | `hcr/feature/ui-shell` |
| `src/libs/` · `src/config/` · `src/utils/` · `functions/` · `gas/` · `firestore.rules` · config ราก (`vite`, `tailwind`, `.github/`) | `hcr/chore/platform` |
| bug ที่กระทบหลายโมดูล | `hcr/fix/<slug>` |

- แตะหลายโฟลเดอร์ → เลือก branch ตาม feature ที่เป็นหัวใจของงาน **ไม่แตกหลาย branch ต่อ 1 งาน**
- feature branch มีไว้ล่วงหน้าแล้ว: `auth` `hc-request` `ceo-approval` `dashboard` `manager` `reports` `admin` `it-onboarding` `jd-files` `audit-log` `ui-shell` + `hcr/chore/platform`

เข้า branch (sync `main` ก่อนเสมอ เพราะ branch ที่สร้างล่วงหน้าอาจแช่ commit เก่า):

```bash
git checkout main && git pull && git checkout hcr/feature/<x> && git merge main
```

### 2. Test local ก่อน commit — ห้ามข้าม

1. `npm run build` — ตัวจับ import พังตัวจริง (alias `@/` ต้อง resolve ครบ) **ต้องผ่าน**
2. `npm run lint` — baseline **619 errors** เป็นของเดิมทั้งหมด · กฎคือ **ห้ามเพิ่มจาก 619** ไม่ต้องไปแก้ของเดิม
3. เปิด preview (`.claude/launch.json` → `hc-request-app`, port 5173) แล้วกดผ่าน route ที่แก้ · เช็ค console error = 0
4. แก้ไฟล์ใน `src/` เสร็จ → `graphify update .`

Route ทั้งหมด: `/dashboard` `/request` `/reports` `/all-requests` `/my-cases` `/my-requests` `/jd-files` `/audit-log` `/users` `/custom-positions` `/admin-tools` `/import` `/it-onboarding`

### 3. Deploy

**ห้าม deploy จากเครื่อง** (`firebase deploy` ด้วยมือ) — merge เข้า `main` = deploy prod อัตโนมัติผ่าน `.github/workflows/deploy.yml`

merge เข้า `main` ได้เมื่อครบ 3 ข้อ: build ผ่าน · lint ไม่เกิน 619 · กดผ่าน route ที่แก้แล้ว
→ แปลว่า **merge/push `main` = deploy prod ต้องขออนุมัติ user ก่อนทุกครั้ง ห้ามทำเอง**

```bash
git checkout main && git pull && git merge --no-ff hcr/feature/<x> && git push origin main
```

หลัง Actions เขียวแล้วอยากปักหมุด rollback: `git tag prod-$(date +%F) && git push --tags`

---

## DS Version Check (run every session before working)

1. Read `/Users/flook/FKT-WORKSPACE/FKT Design Guidelines/VERSION.md` → find line `Current: vX.X`
2. Compare with **DS Version** in this file
3. **Match** → skip, read §DS Rules below
4. **Mismatch or missing** → read `/Users/flook/FKT-WORKSPACE/FKT Design Guidelines/AI-Design-Rules.md`
   then **overwrite §DS Rules in this file + update DS Version to match**

---

## DS Rules

# FKT Design Guidelines — Freshket CI Branding & Product System

> Freshket's design principles for Product · Dev · Content teams
> AI must read this file before starting any work

---

## 1. What Is This

**FKT Design Guidelines** is the rule set, spec, and component library that governs how every Freshket product looks and behaves — from CI Branding down to Product UI.

All files in this folder are ordered for AI consumption — no prior design knowledge required.

### Set Up a CLAUDE.md for Your Project

Copy this template as `CLAUDE.md` in your project and fill in `[...]` values.

```markdown
# CLAUDE.md — [Project Name]

## Project Info

- **FKT Design Guidelines:** [absolute path to this folder]
- **DS Version:** v1.0
- **Stack:** [e.g. Next.js 14 + MUI v5 / Flutter / React Native]
- **Platform:** [WEB / APP / BOTH]

---

## DS Version Check (run every session before working)

1. Read `[path]/VERSION.md` → find line `Current: vX.X`
2. Compare with **DS Version** in this file
3. **Match** → skip, read §DS Rules below
4. **Mismatch or missing** → read `[path]/AI-Design-Rules.md`
   then **overwrite §DS Rules in this file + update DS Version to match**

---

## DS Rules

**Result:** AI auto-updates its rules whenever the Design team releases a new version — no manual work needed on your side.

### Ad-hoc Usage (no CLAUDE.md)

```
Read all files in [this path] in order, then help me build [component/page].
```

---

## 2. Assets — Logo & Font

> **Hard rule:** Never use a placeholder logo or any other font — always use files from this folder.

```
assets/
├── logo/
│   ├── freshket-original.svg   ← on white / neutral bg (default)
│   ├── freshket-black.svg      ← on light bg where original lacks contrast
│   └── freshket-white.svg      ← on dark / brand bg (dark-green-600)
└── font/
    ├── NotoSansThai-VariableFont_wdth,wght.ttf   ← Web (variable · recommended)
    ├── OFL.txt                                    ← License
    └── static/
        ├── NotoSansThai-Regular.ttf   ← weight 400
        └── NotoSansThai-Bold.ttf      ← weight 700
```

### Logo — Choose by Background

| Variant                 | Use when                                         |
| ----------------------- | ------------------------------------------------ |
| `freshket-original.svg` | White · neutral-50 · general bg                  |
| `freshket-black.svg`    | Light bg where original contrast is insufficient |
| `freshket-white.svg`    | Dark bg · `dark-green-600` · brand surface       |

### Font — Noto Sans Thai

DS uses only **2 weights** — do not import others.

| File                              | Weight   | Used for                          |
| --------------------------------- | -------- | --------------------------------- |
| `NotoSansThai-Regular.ttf`        | 400      | Body, placeholder, secondary text |
| `NotoSansThai-Bold.ttf`           | 700      | Label, heading, CTA text          |
| `NotoSansThai-VariableFont...ttf` | Variable | Web CSS `font-weight: 400 / 700`  |

**Web CSS:**

```css
@font-face {
  font-family: "Noto Sans Thai";
  src: url("assets/font/NotoSansThai-VariableFont_wdth,wght.ttf")
    format("truetype");
  font-weight: 100 900;
}
```

**React Native:**

```
assets/font/static/NotoSansThai-Regular.ttf  →  fontFamily: 'NotoSansThai-Regular'
assets/font/static/NotoSansThai-Bold.ttf     →  fontFamily: 'NotoSansThai-Bold'
```

---

## 3. File Index — Atomic Design Structure

> **Atoms → Molecules → Organisms** — read small-to-large when looking up tokens ·
> read large-to-small when searching for a pattern (see §6 Workflow)

### Atoms — Tokens (always read first)

| File                           | Topic                                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `01-colors.md`                 | Full palette · token names · hex values · semantic alias     |
| `02-typography.md`             | Font · sizes · weights · hierarchy · text rules              |
| `03-spacing-shadows-radius.md` | Spacing · shadow · radius · border · focus states · disabled |

### Molecules — Components

| File                   | Topic                                                   | Context                    |
| ---------------------- | ------------------------------------------------------- | -------------------------- |
| `04-icon.md`           | Icon library (Lucide) · size · strokeWidth · color rule | Any component with icons   |
| `05-button.md`         | Button types · sizes · states                           | Any component with actions |
| `06-badge-chip.md`     | Badge · Chip · Status indicator                         | —                          |
| `07-input.md`          | Input field · Search · Password · OTP · Number          | Forms, dialogs             |
| `08-checkbox.md`       | Checkbox · Radio · Toggle                               | Forms                      |
| `09-dropdown.md`       | Dropdown · Select · Multi-select                        | Forms                      |
| `10-otp.md`            | OTP input 6-digit · states                              | Auth flow                  |
| `11-qty-adjuster.md`   | Quantity adjuster (+ / –)                               | Cart, order                |
| `12-card.md`           | Card · hover · shadow · border rule                     | Content blocks             |
| `13-section-header.md` | Section header · Panel header · Empty state             | Every page                 |
| `14-modal.md`          | Modal · Dialog · Bottom sheet · ConfirmModal            | Action confirmation        |
| `15-datepicker.md`     | Date picker · Date range picker                         | Filters, booking           |
| `16-toast.md`          | Toast · Snackbar notification                           | Feedback                   |
| `17-table.md`          | Data table · Pagination · Sorting · 2-Layer expand      | List views                 |
| `18-navigation.md`     | Top nav · Sidebar · Bottom tab · Breadcrumb             | Page structure             |
| `19-layout-grid.md`    | Grid · Breakpoints · Z-index · Spacing scale            | Layout                     |
| `20-page-layout.md`    | Page shells (Portal, Auth, Full-page)                   | —                          |

### Organisms — Widgets (ready-made patterns · lift and use)

| File            | Topic                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `21-widgets.md` | Auth card · PageLoader · Filter bar · BulkBar · FilterPanel · ExpandRow · InlineEditCell · Publish Modal · Pricing Data Viz |

### Guidelines

| File                   | Topic                                               |
| ---------------------- | --------------------------------------------------- |
| `22-ux-writing.md`     | Wording rules · placeholder · error · button labels |
| `23-mobile-ux.md`      | Mobile-specific UX rules                            |
| `24-app-guidelines.md` | React Native / Flutter guidelines                   |
| `25-handoff-to-dev.md` | How to hand off design to dev                       |

---

## 4. Design Foundation

### 4 Visual Pillars

1. **Soft** — high radius · diffused shadow · smooth transitions
2. **Modern** — clean geometry · functional minimalism · not overly trendy
3. **Clear** — obvious hierarchy · clear states · 1 CTA per viewport
4. **Clean** — 80% whitespace · no gradients · no decoration noise

> Every decision must pass all 4 pillars simultaneously — if it conflicts with any one, revisit before committing.

### 5 Key Rules

1. **Color** — only use colors defined in `01-colors.md`
2. **Font weight** — 400 or 700 only · nothing in between
3. **Icon** — strokeWidth = 1 on every icon at every size
4. **Search input** — radius = 8px same as regular input · not pill
5. **Text** — sentence case always · no ALL CAPS

### Source of Truth

**FKT Design Guidelines is the highest source of truth** — products must always follow the spec.

When code conflicts with spec:

1. **Default → fix code to match spec** (code is wrong · spec is right)
2. **If code pattern is genuinely better** → mark `[PROPOSED]` + log in EDIT_LOG.md → stored for future DS reference only (Design team pulls when ready — no approval loop)

---

## 5. AI Development Rules

### Token Naming

- **Format:** `{family}-{stop}` only — e.g. `dark-green-600`, `neutral-900`
- **No food theme names** (Pandan, Rice, Kaffir Lime, etc.) in code or comments

### Token Resolution Precedence

1. **L2 Semantic Alias** first — `bg-brand`, `text-primary`, `focus-ring`, `border-default` from `01-colors.md`
2. **L1 Primitive** — if no alias, pull from main palette
3. **Physical Spec** — radius, shadow, spacing from `03-spacing-shadows-radius.md`

### Contrast & Text-on-Tint

- **Tinted bg** — text = same family stop -900 · use -950 only if -900 fails WCAG
- **Yellow bg** — `yellow-950` for normal text · `yellow-900` for large text
- **White/light surface** — `text-primary` = `neutral-900`
- **Brand surface** (`dark-green-600`) — text = `neutral-50`

### Focus States

- **Selectable** (input, button, checkbox) — `dark-green-600` border 1.5px + focus-ring halo · `:focus-visible` only
- **Content Surface** (card) — `shadow-lg + translateY(-2px)` only · no color ring

### Action Color Hierarchy

- **Tier 1 (Primary)** — `dark-green-600` · 1 per viewport always
- **Tier 2 (Secondary)** — badge / category chip / promo
- **Tier 3 (Tertiary)** — ghost button / link

### Critical Constraints

| Forbidden                            | Reason                            |
| ------------------------------------ | --------------------------------- |
| Gradient / Dark Mode                 | Conflicts with Pillar 2+4         |
| Pixel values outside 4px base scale  | Breaks spacing system             |
| letter-spacing ≠ normal              | DS typography rule                |
| Color ring on Content Surface card   | Conflicts with Pillar 4           |
| neutral-200+ as page background      | Conflicts with Pillar 4           |
| Hardcoded hex values                 | Always use tokens                 |
| Shadow on Primary button             | DS-#059                           |
| More than 1 Primary CTA per viewport | Conflicts with Pillar 3           |
| font-size < 12px                     | Except Caption2                   |
| Pure white `#FFFFFF` as text         | Use `neutral-50` instead          |
| Opacity to reduce text hierarchy     | Use a lighter color token instead |
| Font weight other than 400 / 700     | Binary weight rule                |
| ALL CAPS / textTransform uppercase   | Sentence case always              |
| strokeWidth ≠ 1 on icons             | DS icon rule                      |

### Cross-Platform (DS-#112)

| Property   | Web                           | React Native              |
| ---------- | ----------------------------- | ------------------------- |
| Spacing    | `"16px"`                      | `16` (unitless)           |
| Radius     | `"8px"`                       | `8`                       |
| Shadow     | `box-shadow` string           | `SHADOW_*` spread object  |
| Font       | `fontWeight: "700"`           | `fontFamily: "Font-Bold"` |
| Focus ring | `:focus-visible + box-shadow` | `onFocus/onBlur` state    |

### Portal UI Standards

**PageLoader**

- Container: fixed · inset 0 · bg `neutral-50` · flex column · center
- Logo: `freshket-original.svg` · width 120px
- Dots: 3 circles · 7×7px · r-pill · bg `dark-green-600` · gap 8px
- Animation: scale 0.6→1→0.6 · opacity 0.35→1→0.35 · 1.2s ease-in-out · stagger +0.2s per dot

**Auth Card**

- Container: width 100% · maxWidth 480px · bg white · r-lg · shadow-xl
- Border: 1px `rgba(230,233,235,0.60)`
- Padding: 20px (mobile) · 48px (desktop)
- Gap between sections: 32px

**Mobile**

- Viewport: `100dvh` always · never use `100vh`
- Phone field: input mode = telephone
- Email field: auto-capitalize off · auto-correct off

---

## 6. AI Workflow — Atomic Design Process

> Core rule: every value (color · spacing · shadow · radius · typography) must come from spec — **no guessing, no relying on memory**

---

### Phase 0 — Understand the 4 Visual Pillars

Before doing anything, review the Pillars against this specific task:

- How much **Soft** does this need? (radius · shadow level)
- Where does **Clear** matter most? (CTA · hierarchy)
- What might break **Clean**? (unnecessary decoration)

---

### Phase 1 — Organism · Look for a Widget first

Open `21-widgets.md` — Widgets are ready-made patterns already validated against DS.

```
Matches a Widget → use it directly, don't re-compose
No match / unsure → go to Phase 2
```

Available widgets: Auth card · PageLoader · Filter bar · BulkBar · FilterPanel · ExpandRow · InlineEditCell · Publish Modal · Pricing Data Viz

---

### Phase 2 — Molecule · Compose from Components

Read the relevant component spec(s) and compose:

| Need                              | Read                   |
| --------------------------------- | ---------------------- |
| Card, product card, info card     | `12-card.md`           |
| Any button type                   | `05-button.md`         |
| Input, search, password, textarea | `07-input.md`          |
| Badge, chip, status               | `06-badge-chip.md`     |
| Checkbox, radio, toggle           | `08-checkbox.md`       |
| Navigation bar, header, sidebar   | `18-navigation.md`     |
| Icon                              | `04-icon.md`           |
| Toast, Snackbar                   | `16-toast.md`          |
| Modal, Dialog, Bottom Sheet       | `14-modal.md`          |
| Dropdown, Select                  | `09-dropdown.md`       |
| Data table                        | `17-table.md`          |
| Date picker                       | `15-datepicker.md`     |
| OTP input                         | `10-otp.md`            |
| QTY stepper                       | `11-qty-adjuster.md`   |
| Page layout shell                 | `20-page-layout.md`    |
| Section header, empty state       | `13-section-header.md` |
| Layout grid, breakpoints          | `19-layout-grid.md`    |

```
All components covered → compose per spec
Some parts missing from spec → go to Phase 3 for those parts only
```

---

### Phase 3 — Atom · Build from Tokens + Universal Principles

Use only for parts that no Widget or Component covers.

1. Read tokens: `01-colors.md` · `02-typography.md` · `03-spacing-shadows-radius.md`
2. Design using 4 Visual Pillars + design universals (proximity · alignment · contrast · repetition)
3. Mark `[PROPOSED — not in spec yet]` every time

---

### Phase 4 — Build Manifest (never skip)

Declare before writing any code:

```
Widget:     [name or "none found"]
Components: [list + spec file]
Key tokens: [color · radius · shadow · typography]
[PROPOSED]: [anything being built from scratch, if any]
```

---

### Phase 5 — Verify before sending for Review

Check against full DS spec before handing to user:

- ✓ Meets the brief
- ✓ All values from spec — none invented
- ✓ Passes 4 Visual Pillars
- ✓ All `[PROPOSED]` flags present + logged in EDIT_LOG.md

---

### Phase 6 — Send for User Review

Deliver with clear labelling:

- Which parts come from spec
- Which parts are `[PROPOSED]`

---

### Phase 7 — Log Revision (if user revises after review)

Every time the user requests a change after review → log in **REVISION_LOG.md** immediately:

| Date | Point changed | From | To  | User's reason |
| ---- | ------------- | ---- | --- | ------------- |

> Store only — do not push for promotion · Design team (Aesthetic Frontier) pulls what it needs when ready.

---

## 7. DS Audit Workflow

Use when verifying that an implemented screen/component matches the spec.

**A1** — Read relevant spec (Widget → Component → Tokens)

**A2** — Compare actual UI against spec point by point: color · typography · radius · shadow · spacing · behavior

**A3** — List every deviation:

| Point | Value in code | Value in spec | Spec ref |
| ----- | ------------- | ------------- | -------- |

**A4** — Each deviation has exactly 2 options:

| Type                        | Action                                                    |
| --------------------------- | --------------------------------------------------------- |
| Fix in code                 | Update code to match spec (always the default)            |
| PROPOSED (genuinely better) | Mark `[PROPOSED]` + log in EDIT_LOG · Design team reviews |

**A5** — Report to user for a decision on each item

---

## 8. Logging

### EDIT_LOG.md — Track edits during build

Log every time the user requests an edit before review:

| Date | File edited | Detail | Reason |
| ---- | ----------- | ------ | ------ |

### USAGE_LOG.md — Track feature → component usage

Log every time a new feature is built:

| Feature | Component | DS File ref | Implemented file | Notes |
| ------- | --------- | ----------- | ---------------- | ----- |

### REVISION_LOG.md — Track revisions after user review

Log every time the user revises after review (Phase 7):

| Date | Feature / Page | Point changed | From | To  | Reason |
| ---- | -------------- | ------------- | ---- | --- | ------ |

> **Never push for promotion** — Design team (Aesthetic Frontier) handles that when ready.

---

_FKT Design Guidelines 2026 · Read the spec · no need to maintain the spec_
