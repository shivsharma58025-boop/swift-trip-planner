# Implementation Plan: Swift Trip Planner

**Client:** Swift Strips India Pvt. Ltd. (SLTT Group), Jamshedpur, Jharkhand, India  
**Owner:** Satyam (Senior Software Lead)  
**Base:** Swift Strips Plant, Jamshedpur (22.8046° N, 86.2029° E) | Asia/Kolkata (IST)  
**Architecture:** Single Google Sheet + Single Google Apps Script project (bound) + CDN-served single-file Web App (`Index.html`).

---

## 1. System Architecture & Components

```
   ┌──────────────────────────────────────────────────────────────┐
   │                   WHATSAPP / n8n INGESTION                   │
   │  Inbound WhatsApp ──> n8n ──> doPost(e) [Shared Secret]      │
   │  Outbound Alerts  <── n8n <── UrlFetchApp [Webhook URL]      │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │             GOOGLE APPS SCRIPT BACKEND (Bound)              │
   │                                                              │
   │  • Code.gs    : Web endpoints (doGet, doPost), routing, auth │
   │  • Assign.gs  : Deterministic Round-Robin Load Engine        │
   │  • Parser.gs  : Hinglish/English NLP date & intent parsing   │
   │  • Notify.gs  : 15-min cron, milestone alert dispatch        │
   │  • Setup.gs   : Sheet initialization, validation, seed data  │
   │  • Tests.gs   : Self-contained test suite & simulation runs  │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                 GOOGLE SHEET (10 TABS)                       │
   │  Trips, Staff, Destinations, Stations, Leave, Config,        │
   │  Inbox, Alerts, Log, Preview                                 │
   └──────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │              CLIENT-SIDE WEB APP (Index.html)                │
   │  • Authenticated via `?key=ViewKey`                          │
   │  • Mapbox GL JS v3 (3D Satellite + Sky) + Leaflet 2D Fallback│
   │  • Hero Card (Next Train Trip live countdown)                │
   │  • Calendar Grid + KPIs + Filterable Trip List + Details      │
   │  • Auto-refresh (60s) + Offline/Stale cache resilience       │
   │  • Zero PNR / Phone exposure in public DOM or payload        │
   └──────────────────────────────────────────────────────────────┘
```

---

## 2. Key Design & Technical Decisions

1. **Deterministic Round-Robin Fair Assignment (`Assign.gs`)**:
   - **Formula:** $\text{WeightedLoad} = \sum (\text{Destination.Weight} \times \text{TripDays})$ for the month of `StartDate`.
   - **Filter chain:** Active staff == TRUE $\rightarrow$ Not on leave for any day in $[StartDate, EndDate]$ $\rightarrow$ No overlapping non-cancelled trip $\rightarrow$ Skip Sundays/Holidays (unless `Priority == Urgent`).
   - **Selection:** Candidate with lowest $\text{WeightedLoad}$ in the target month.
   - **Tie-breakers:** 
     1. Longest time elapsed since last non-cancelled trip end date.
     2. Sheet order.
   - **New Joiner rule:** Assigned month's mean weighted load of active staff so they smoothly enter rotation without unfair pileup.
   - **Reschedule / Cancellation:** Dynamic recalculation; if rescheduled and current assignee remains eligible, preserve assignee.
   - **Manual override:** Writing to `AssignedTo` with `OverrideReason` marks `AssignMode=MANUAL` and is logged.
   - **Concurrency:** Wrapped in `LockService.getScriptLock()` with batch reads/writes.

2. **Inbound WhatsApp Message Parsing (`Parser.gs`)**:
   - Supports natural English and Hinglish tokens (`aaj`, `kal`, `parso`, `somwar`, `urgent`, `delv`, etc.).
   - Regex-based date extraction supporting: relative days, weekdays, `DD-MMM`, `DD/MM`, `DD MMM`.
   - Normalizes destinations: `kolkata` / `calcutta` / `howrah` $\rightarrow$ Kolkata; `haldia` $\rightarrow$ Haldia; `port` / `dock` $\rightarrow$ Kolkata Port / Haldia Dock.
   - Strict formula sanitization: stripping leading `=`, `+`, `-`, `@`.

3. **Status Flow & Role Permissions**:
   - Admin/Coordinator: Direct creation + auto-allotment (`Status: Assigned`).
   - Staff role: Creates trip in `Pending approval` status; notifies coordinator; no auto-allotment until approved.
   - Status transitions: `Pending approval` $\rightarrow$ `Planned` / `Assigned` $\rightarrow$ `In Transit` $\rightarrow$ `Reached` $\rightarrow$ `Delivered` $\rightarrow$ `Returned` (or `Cancelled` / `Needs reassignment`).
   - Staff report "Can't go": marks `Needs reassignment`, alerts coordinator; no blind auto-allotment.

4. **Security & Data Privacy**:
   - PNR numbers and phone numbers are strictly stripped in `getPublicData()` before returning payload to `Index.html`.
   - `ViewKey` query parameter verification on `doGet`.
   - Shared secret authentication in `doPost(e)` header or payload.
   - Phone rate limiting (20 requests/phone/hour) tracked in script cache / inbox.

5. **Front-End & 3D Visualization (`Index.html`)**:
   - Mapbox GL JS v3 with satellite-streets style, 3D digital elevation terrain, sky atmosphere, 60° pitch, animated dashed rail arcs from Tatanagar Jn to destination stations.
   - Automatic fallback to Leaflet with Esri World Imagery if token is empty or WebGL fails.
   - Integrated Mock Mode (`google.script.run` dev-mock) toggleable for zero-dependency local browser preview and verification.

---

## 3. Detailed Task List

- [ ] **Task 1: Setup & Data Modeling (`Setup.gs`)**
  - Tab definitions: `Trips`, `Staff`, `Destinations`, `Stations`, `Leave`, `Config`, `Inbox`, `Alerts`, `Log`, `Preview`.
  - Column validations, dropdowns, conditional formatting rules, seed data (4 staff, TATA/HWH/SRC/KGP stations, coordinates, weights).
  - Custom UI menu: "Trip Planner" with all required administrative actions.
- [ ] **Task 2: Assignment Engine (`Assign.gs`)**
  - Load calculation with weights ($1.0$, $1.2$, $1.3$, etc.), leave checks, overlap collision detection.
  - Round-robin selection, tie-breaker handling, new joiner leveling.
  - Manual override handling and re-assignment on cancel/reschedule.
  - Locking via `LockService` and bulk Sheet I/O.
- [ ] **Task 3: Parser & Inbound WhatsApp Gateway (`Parser.gs`, `Code.gs`)**
  - Hinglish and English date/destination/action parser.
  - `doPost` endpoint with shared secret verification, deduplication (`messageId`), rate limiting.
  - Role-based branching (Admin/Coordinator vs Staff), command handling ("Booked...", "Departed", "Can't go").
  - Leading character sanitization (`=`, `+`, `-`, `@`).
- [ ] **Task 4: Notification & Cron Engine (`Notify.gs`)**
  - 15-minute time-driven trigger for train departure milestones (24h, 3h, 1h).
  - Ticket unbooked alert (24h prior), arrival + 2h follow-up check.
  - De-duplication via hidden `Alerts` tab, retry backoff, webhook payload formatting.
- [ ] **Task 5: Web UI (`Index.html`) & Public API (`Code.gs`)**
  - `doGet` serving `Index.html` with `ViewKey` protection.
  - Sanitized `getPublicData()` endpoint omitting PNR and Staff Phone numbers.
  - Hero card with live countdown, Today/Tomorrow timeline, rotation monitor, monthly KPI bars & donuts.
  - Mapbox GL JS 3D satellite visualization + Leaflet 2D fallback.
  - Calendar month grid, quick search, interactive trip modal, dark/light theme toggle, 60s auto-refresh.
- [ ] **Task 6: Test Suite, Simulation & Verification (`Tests.gs` & Local Verification)**
  - Unit and integration tests covering engine rotation, tie breaks, parser edge cases, injection safety, deduplication.
  - 45-trip 3-month fairness simulation verifying load variance $\le 1$ weight unit.
  - Browser-executable local verification file with mock `google.script.run`.
- [ ] **Task 7: Documentation & Deliverables (`SETUP.md`)**
  - 10-step copy-paste setup guide for non-developers.
  - n8n workflow JSON, WhatsApp template definitions, rollback instructions.
  - 1-page real-message test script and 5-line staff fairness explanation.
