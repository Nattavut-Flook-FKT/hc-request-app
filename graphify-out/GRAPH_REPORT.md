# Graph Report - hc-request-app  (2026-07-16)

## Corpus Check
- 91 files · ~472,232 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 818 nodes · 1117 edges · 58 communities (52 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `69038df2`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]
- [[_COMMUNITY_Community 44|Community 44]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]

## God Nodes (most connected - your core abstractions)
1. `toDate()` - 16 edges
2. `db` - 15 edges
3. `แผนย้าย hc-request-app: Firebase → Supabase (+ ประเมิน Next.js)` - 14 edges
4. `getOfferingDate()` - 10 edges
5. `Senior Frontend` - 10 edges
6. `Senior Backend` - 10 edges
7. `Code Reviewer` - 10 edges
8. `getClient()` - 9 edges
9. `FrontendScaffolder` - 8 edges
10. `ComponentGenerator` - 8 edges

## Surprising Connections (you probably didn't know these)
- `monthLabelOf()` --calls--> `toDate()`  [EXTRACTED]
  src/components/Reports/OnboardingReport.jsx → src/utils/reportUtils.js
- `slaDays()` --calls--> `computeSLADays()`  [EXTRACTED]
  src/components/Dashboard/ReportPanel.jsx → src/utils/reportUtils.js
- `RequestRow()` --calls--> `slaLimit()`  [EXTRACTED]
  src/components/Manager/ManagerRequestsView.jsx → src/utils/sla.js
- `HCRequestForm()` --calls--> `getEmployeesByDepartment()`  [EXTRACTED]
  src/components/Forms/HCRequestForm.jsx → src/services/sheetsData.js
- `AddLibraryModal()` --calls--> `getDepartments()`  [EXTRACTED]
  src/pages/JDFilesPage.jsx → src/data/orgStructure.js

## Import Cycles
- None detected.

## Communities (58 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (49): downloadCSV(), slaDays(), STATUS_DOT, TABS, YEARS, monthLabelOf(), ONBOARD_STATUS, ACTIVE (+41 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (31): dependencies, firebase, lucide-react, react, react-dom, react-router-dom, @supabase/supabase-js, tailwindcss-animate (+23 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (26): 1. Pr Analyzer, 1. Setup and Configuration, 2. Code Quality Checker, 2. Run Quality Checks, 3. Implement Best Practices, 3. Review Report Generator, Best Practices Summary, Code Quality (+18 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (26): 1. Api Scaffolder, 1. Setup and Configuration, 2. Database Migration Tool, 2. Run Quality Checks, 3. Api Load Tester, 3. Implement Best Practices, Api Design Patterns, Backend Security Practices (+18 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (26): 1. Component Generator, 1. Setup and Configuration, 2. Bundle Analyzer, 2. Run Quality Checks, 3. Frontend Scaffolder, 3. Implement Best Practices, Best Practices Summary, Code Quality (+18 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Coding Standards, Common Patterns, Conclusion, Further Reading (+12 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Common Antipatterns, Common Patterns, Conclusion, Further Reading (+12 more)

### Community 7 - "Community 7"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Common Patterns, Conclusion, Frontend Best Practices, Further Reading (+12 more)

### Community 8 - "Community 8"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Common Patterns, Conclusion, Further Reading, Guidelines (+12 more)

### Community 9 - "Community 9"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Api Design Patterns, Code Organization, Common Patterns, Conclusion, Further Reading (+12 more)

### Community 10 - "Community 10"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Backend Security Practices, Code Organization, Common Patterns, Conclusion, Further Reading (+12 more)

### Community 11 - "Community 11"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Code Review Checklist, Common Patterns, Conclusion, Further Reading (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Common Patterns, Conclusion, Database Optimization Guide, Further Reading (+12 more)

### Community 13 - "Community 13"
Cohesion: 0.10
Nodes (20): Anti-Pattern 1, Anti-Pattern 2, Anti-Patterns to Avoid, Code Organization, Common Patterns, Conclusion, Further Reading, Guidelines (+12 more)

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (18): Context, Phase 0 — เตรียมสภาพแวดล้อม (1–2 วัน · เสี่ยงต่ำ), Phase 1 — Schema + RLS + สคริปต์ย้ายข้อมูล (3–4 วัน · เสี่ยงกลาง), Phase 2 — สลับ Auth (2–3 วัน · เสี่ยงกลาง-สูง — จุดเสี่ยงสุดของงาน), Phase 3 — เขียน data layer ใหม่ (4–6 วัน · เสี่ยงกลาง แต่เป็นงาน mechanical), Phase 4 — วัน Cutover (1 วัน · เสี่ยงสูงแต่ย้อนกลับได้เต็มรูป), Phase 5 — Realtime + เก็บกวาด integration (2–3 วัน · เสี่ยงต่ำ-กลาง), Phase 6 — ปิดระบบเก่า (0.5–1 วัน · เสี่ยงต่ำ) (+10 more)

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (11): ALL_STATUSES, buildHistoryEntry(), getDaysOpen(), HISTORY_TAB_STATUSES, shortName(), SLABadge(), STATUS_CONFIG, STATUS_TABS (+3 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (8): STAT_CONFIG, ACTIVE_STATUSES, STATUS_CFG, STATUS_ORDER, MONTH_TH, ACTIVE_STATUSES, EXCLUDED_STATUSES, TABS

### Community 17 - "Community 17"
Cohesion: 0.14
Nodes (13): MaintenancePage(), RoleGuard(), RoleSwitcher(), AdminToolsPage, AllRequestsPage, AuditLogPage, CustomPositionsPage, DashboardPage (+5 more)

### Community 18 - "Community 18"
Cohesion: 0.16
Nodes (13): currentUserName(), debouncedStatusCall(), _pending, reportClientError(), sendDeleteToSheets(), sendMaintenanceAlert(), sendPendingApprovalAlert(), sendStatusUpdate() (+5 more)

### Community 19 - "Community 19"
Cohesion: 0.16
Nodes (10): getJGLabel(), HQ_JG_LEVELS, OPERATION_JG_LEVELS, DEPARTMENTS, getTrackConfigByDepartment(), HYBRID_DEPARTMENT_PREFIXES, INITIAL_FORM, matchesDepartmentPrefix() (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.18
Nodes (9): bool, str, CodeQualityChecker, main(), Main class for code quality checker functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.18
Nodes (9): bool, str, FrontendScaffolder, main(), Main class for frontend scaffolder functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 22 - "Community 22"
Cohesion: 0.18
Nodes (9): bool, str, ApiLoadTester, main(), Main class for api load tester functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 23 - "Community 23"
Cohesion: 0.18
Nodes (9): bool, str, ApiScaffolder, main(), Main class for api scaffolder functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (9): bool, str, BundleAnalyzer, main(), Main class for bundle analyzer functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 25 - "Community 25"
Cohesion: 0.18
Nodes (9): bool, str, ComponentGenerator, main(), Main class for component generator functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 26 - "Community 26"
Cohesion: 0.18
Nodes (9): bool, str, DatabaseMigrationTool, main(), Main class for database migration tool functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 27 - "Community 27"
Cohesion: 0.18
Nodes (9): bool, str, main(), PrAnalyzer, Main class for pr analyzer functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation (+1 more)

### Community 28 - "Community 28"
Cohesion: 0.18
Nodes (9): bool, str, main(), Main class for review report generator functionality, Execute the main functionality, Validate the target path exists and is accessible, Perform the main analysis or operation, Generate and display the report (+1 more)

### Community 29 - "Community 29"
Cohesion: 0.18
Nodes (6): STATUS_CONFIG, app, auth, db, firebaseConfig, googleProvider

### Community 30 - "Community 30"
Cohesion: 0.18
Nodes (8): computeSLA(), getPipelineIndex(), HIDDEN_STATUSES, HISTORY_STATUSES, PipelineTrack(), RequestRow(), STAGES, STATUS

### Community 31 - "Community 31"
Cohesion: 0.25
Nodes (7): DIVISIONS, getBusinessUnits(), getDepartments(), getSections(), ORG_STRUCTURE, HCRequestForm(), TECH_DEPTS

### Community 32 - "Community 32"
Cohesion: 0.27
Nodes (6): getDivisionByDepartment(), AddLibraryModal(), EditLibraryModal(), getPositionsByDepartment(), deleteJDFile(), uploadJDLibraryFile()

### Community 33 - "Community 33"
Cohesion: 0.31
Nodes (10): ExpandedDetail(), ALLOWED_TYPES, CV_ALLOWED_TYPES, deleteCVFile(), getClient(), getCVSignedUrl(), getJDSignedUrl(), listJDFiles() (+2 more)

### Community 34 - "Community 34"
Cohesion: 0.29
Nodes (9): add_image(), callout_box(), header(), สร้างสไลด์คู่มือ TA — ใช้รูปจริงจาก Web App, กล่อง callout สีเหลือง, ใส่รูปพร้อม border shadow, rect(), screenshot_frame() (+1 more)

### Community 35 - "Community 35"
Cohesion: 0.27
Nodes (4): DEPT_RENAME_MAP, syncAllToSheets(), syncBatchToSheets(), syncFromSheets()

### Community 36 - "Community 36"
Cohesion: 0.22
Nodes (8): dependencies, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access, executeAs

### Community 37 - "Community 37"
Cohesion: 0.22
Nodes (8): Aesthetic Direction, Anti-References, Brand Personality, Design Context, Design Principles, HC Request System - Design Context, References, Users

### Community 38 - "Community 38"
Cohesion: 0.36
Nodes (7): add_card(), add_header_bar(), add_pill(), add_rect(), add_section_label(), add_text(), สร้างสไลด์คู่มือสำหรับ TA Team — HC Request System

### Community 39 - "Community 39"
Cohesion: 0.22
Nodes (5): ADMIN_GROUPS, MANAGER_GROUPS, ROLE_LABEL, TA_GROUPS, SLIDES

### Community 40 - "Community 40"
Cohesion: 0.25
Nodes (7): 1. What Is This, CLAUDE.md — HC Request App, DS Rules, DS Version Check (run every session before working), FKT Design Guidelines — Freshket CI Branding & Product System, Project Info, Set Up a CLAUDE.md for Your Project

### Community 41 - "Community 41"
Cohesion: 0.25
Nodes (7): dependencies, firebase-admin, firebase-functions, engines, node, main, name

### Community 42 - "Community 42"
Cohesion: 0.25
Nodes (7): firestore, rules, hosting, headers, ignore, public, rewrites

### Community 43 - "Community 43"
Cohesion: 0.32
Nodes (6): DEPT_MAINDATA_MAP, resolveDeptNames(), SECTION_MAINDATA_MAP, fetchSheetsData(), getDepartmentByEmail(), getEmployeesByDepartment()

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (3): STATUS_COLOR, STATUS_MAP, TYPE_MAP

### Community 46 - "Community 46"
Cohesion: 0.47
Nodes (3): VALID_ROLES, grantedKeys(), grantEmails()

### Community 48 - "Community 48"
Cohesion: 0.50
Nodes (3): admin, ALLOWED_ORIGINS, { onRequest }

### Community 49 - "Community 49"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + Vite

## Knowledge Gaps
- **348 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+343 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `db` connect `Community 29` to `Community 32`, `Community 35`, `Community 45`, `Community 46`, `Community 15`, `Community 17`, `Community 19`, `Community 30`, `Community 31`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `getJDSignedUrl()` connect `Community 33` to `Community 32`, `Community 19`, `Community 30`, `Community 15`?**
  _High betweenness centrality (0.001) - this node is a cross-community bridge._
- **What connects `สร้างสไลด์คู่มือสำหรับ TA Team — HC Request System`, `สร้างสไลด์คู่มือ TA — ใช้รูปจริงจาก Web App`, `กล่อง callout สีเหลือง` to the rest of the system?**
  _397 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.062456140350877196 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.0625 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._