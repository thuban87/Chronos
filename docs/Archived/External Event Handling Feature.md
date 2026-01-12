# External Event Handling - Feature Specification

**Feature Start Date:** January 8, 2026
**Status:** COMPLETE ✓
**Current Phase:** Phase 7 - Complete
**Depends On:** Phase 11 (Safety Net) - Complete

---

## Session Workflow Instructions

**IMPORTANT:** Sessions working on this feature must follow this workflow:

1. **Work on a task** (e.g., 1.1)
2. **Immediately check off the task** in this document when complete
3. **Move to the next task** (e.g., 1.2)
4. **Repeat** until phase is complete
5. **Present test actions** to user for verification
6. **Debug as needed** based on user feedback
7. **Only after testing passes:** Update Handoff Log and other documentation

**DO NOT** batch task checkoffs at the end. Check off each task as you complete it.

**DO NOT** update Handoff Log or ADR Priority List until the phase is tested and confirmed working.

---

## Overview

External Event Handling determines what Chronos does when it can't find a calendar event where it expects it (404 error). This happens when users move or delete events directly in Google Calendar.

### The Problem

Currently, when Chronos detects a 404:
1. It assumes the event was accidentally deleted
2. It recreates the event on the original calendar
3. If user moved the event intentionally, they now have duplicates

### The Solution

Give users control over this behavior with three options:
- **Ask me each time** (default): Queue for review, user decides per-event
- **Sever link**: Stop tracking the task, don't recreate
- **Recreate event**: Current behavior, assume deletion was accidental

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default behavior | Ask me each time | Consistent with Safety Net philosophy |
| Severed task tracking | Store task IDs in plugin data | Vault stays read-only |
| Recovery path | Edit title/date/time | Creates new task ID, syncs fresh |
| Reconnection | Not supported | We don't know where old event went |

---

## Data Structures

### New Setting

```typescript
interface ChronosSettings {
  // ... existing settings
  externalEventBehavior: 'ask' | 'sever' | 'recreate';  // default: 'ask'
}
```

### New Sync Data

```typescript
interface ChronosSyncData {
  // ... existing data
  severedTaskIds: string[];           // Task IDs to permanently skip
  pendingSeverances: PendingSeverance[];  // Queued for review (ask mode)
}
```

### Pending Severance Interface

```typescript
interface PendingSeverance {
  id: string;                  // Unique ID for this pending item
  taskId: string;              // The Chronos task ID
  eventId: string;             // Google Calendar event ID (now missing)
  calendarId: string;          // Calendar where event was expected
  calendarName: string;        // Human-readable calendar name

  // For display
  eventTitle: string;
  eventDate: string;
  eventTime?: string;
  sourceFile: string;

  // Metadata
  detectedAt: string;          // ISO timestamp when 404 was detected
  originalTaskLine: string;    // For reference
}
```

---

## Implementation Phases

### Phase 1: Foundation (Data & Setting)
**Goal:** Add setting and data structures, no behavior change yet

- [x] 1.1 Add `externalEventBehavior` to `ChronosSettings` interface (default: 'ask')
- [x] 1.2 Add `externalEventBehavior` to `DEFAULT_SETTINGS`
- [x] 1.3 Add `severedTaskIds` array to `ChronosSyncData` interface
- [x] 1.4 Add `pendingSeverances` array to `ChronosSyncData` interface
- [x] 1.5 Add `PendingSeverance` interface to `syncManager.ts`
- [x] 1.6 Add helper methods: `addSeveredTaskId()`, `isSevered()`, `removeSeveredTaskId()`
- [x] 1.7 Add helper methods: `addPendingSeverance()`, `getPendingSeverances()`, `removePendingSeverance()`, `clearPendingSeverances()`
- [x] 1.8 Build and verify no errors

**Phase 1 Test:**
- Build succeeds
- No runtime errors on load
- Setting defaults work (check via console or settings inspection)

---

### Phase 2: Settings UI
**Goal:** Add dropdown to settings with descriptions and warnings

- [x] 2.1 Add "External Event Handling" section header (h3) in settings
- [x] 2.2 Add description text explaining the feature
- [x] 2.3 Add dropdown with three options: "Ask me each time", "Sever link (stop tracking)", "Recreate event"
- [x] 2.4 Add warning text below dropdown explaining implications
- [x] 2.5 Add note about recovery: "Severed tasks can sync again if you edit the title, date, or time"
- [x] 2.6 Add CSS styling for the section
- [x] 2.7 Build and verify no errors

**Phase 2 Test:**
- Settings UI displays correctly
- Dropdown changes persist after reload
- Warning text is visible and clear

---

### Phase 3: Sync Logic Integration
**Goal:** Handle 404s based on setting, skip severed tasks

- [x] 3.1 In task scanning/filtering, skip tasks where `isSevered(taskId)` returns true
- [x] 3.2 Locate where 404s are currently handled for unchanged events
- [x] 3.3 Add switch based on `externalEventBehavior` setting:
  - 'recreate': Keep current behavior (add to toCreate)
  - 'sever': Call `addSeveredTaskId()`, remove sync record
  - 'ask': Call `addPendingSeverance()`, remove sync record
- [x] 3.4 For 'ask' mode: Don't add to toCreate (will be handled after review)
- [x] 3.5 Build and verify no errors

**Phase 3 Test:**
- Set to 'recreate': Move event in Google Calendar → event recreated (current behavior)
- Set to 'sever': Move event in Google Calendar → no recreation, task ignored on future syncs
- Set to 'ask': Move event in Google Calendar → nothing happens yet (queued, no modal yet)

---

### Phase 4: Status Bar Indicator
**Goal:** Show pending severance count in status bar

- [x] 4.1 Add status bar item for pending severances (similar to pending deletions)
- [x] 4.2 Show count only when > 0
- [x] 4.3 Use appropriate icon/emoji (suggestion: `🔗 3 disconnected` or `⚡ 3 moved`)
- [x] 4.4 Make status bar item clickable (will open modal in Phase 5)
- [x] 4.5 Build and verify no errors

**Phase 4 Test:**
- Set to 'ask' mode
- Move event in Google Calendar
- Run sync
- Status bar shows pending count
- Count disappears when pendingSeverances is empty

---

### Phase 5: Review Modal
**Goal:** Create modal for reviewing pending severances

- [x] 5.1 Create `src/severanceReviewModal.ts` file
- [x] 5.2 Create `SeveranceReviewModal` class extending Modal
- [x] 5.3 Display list of pending severances with event details (title, date, calendar, source file)
- [x] 5.4 Add per-item "Sever Link" button
- [x] 5.5 Add per-item "Recreate Event" button
- [x] 5.6 Add batch "Sever All" button
- [x] 5.7 Add batch "Recreate All" button
- [x] 5.8 Add explanatory text at top of modal
- [x] 5.9 Add note about recovery path (edit title/date/time to re-sync)
- [x] 5.10 Wire up status bar click to open modal
- [x] 5.11 Add command: "Chronos: Review disconnected events"
- [x] 5.12 Import modal in main.ts
- [x] 5.13 Build and verify no errors

**Phase 5 Test:**
- Status bar click opens modal
- Command palette command opens modal
- Modal displays pending severances correctly
- Empty state shown when no pending items

---

### Phase 6: Modal Actions
**Goal:** Implement the actual sever/recreate logic from modal

- [x] 6.1 Implement `onSever` callback: add to severedTaskIds, remove from pendingSeverances
- [x] 6.2 Implement `onRecreate` callback: create event via API, record sync, remove from pendingSeverances
- [x] 6.3 Implement `onSeverAll` callback: batch sever all pending
- [x] 6.4 Implement `onRecreateAll` callback: batch recreate all pending
- [x] 6.5 After each action, refresh modal or close if empty
- [x] 6.6 Save settings after modifications
- [x] 6.7 Update status bar count after actions
- [x] 6.8 Build and verify no errors

**Phase 6 Test:**
- Click "Sever Link" → task added to severedTaskIds, removed from pending
- Click "Recreate Event" → new event created in Google Calendar, sync record added
- Verify severed task doesn't sync on next sync cycle
- Verify recreated task syncs normally going forward

---

### Phase 7: Polish & Documentation - COMPLETE ✓
**Goal:** CSS styling, sync history logging, documentation

- [x] 7.1 Add CSS styling for SeveranceReviewModal (similar to DeletionReviewModal)
- [x] 7.2 Add 'sever' operation type to sync log
- [x] 7.3 Log severances to sync history
- [x] 7.4 Update README.md with External Event Handling section
- [x] 7.5 Update docs/Handoff Log.md with phase summary
- [x] 7.6 Update docs/ADR Priority List - Chronos.md with Phase 12
- [x] 7.7 Add section to docs/SAFETY-NET.md or create separate doc
- [x] 7.8 Build and final verification

**Phase 7 Test:**
- Modal styling looks consistent with rest of plugin
- Sync history shows sever operations
- All documentation is accurate and complete

---

## UI Mockups

### Settings Section

```
─────────────────────────────────────────────────────────
External Event Handling
─────────────────────────────────────────────────────────

When Chronos can't find an event on its expected calendar
(e.g., you moved or deleted it in Google Calendar):

[Ask me each time ▾]

Options:
• Ask me each time - Review each case and decide
• Sever link - Stop tracking, don't recreate
• Recreate event - Assume accidental, recreate event

Note: Severed tasks won't sync again unless you edit the
title, date, or time. Editing creates a new event - it
won't reconnect to the moved one.
─────────────────────────────────────────────────────────
```

### Review Modal

```
┌─────────────────────────────────────────────────────────┐
│  ⚡ 3 Disconnected Events              [Sever All]      │
│                                                         │
│  These events couldn't be found on their expected       │
│  calendar. They may have been moved or deleted in       │
│  Google Calendar.                                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ "Team Standup"                                    │ │
│  │  📅 Jan 15, 2026 9:00 AM                         │ │
│  │  📆 Expected on: Work Calendar                    │ │
│  │  📄 Source: Daily Notes/2026-01-15.md            │ │
│  │                                                   │ │
│  │  [Sever Link]  [Recreate Event]                  │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Note: Severed tasks can sync again if you edit the    │
│  title, date, or time in your notes.                   │
│                                                         │
│  [Recreate All]                                         │
└─────────────────────────────────────────────────────────┘
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `main.ts` | Setting, status bar, modal triggers, callbacks |
| `src/syncManager.ts` | Interfaces, helper methods, skip severed tasks |
| `src/severanceReviewModal.ts` | NEW - Review modal |
| `styles.css` | Modal and settings styling |
| `README.md` | Documentation |

---

## Testing Checklist

### Phase 1-2 Tests (Foundation)
- [ ] Build succeeds with new types
- [ ] Settings UI displays correctly
- [ ] Setting persists after reload

### Phase 3 Tests (Sync Logic)
- [ ] 'recreate' mode: 404 → event recreated
- [ ] 'sever' mode: 404 → task ID added to severedTaskIds, no recreation
- [ ] 'ask' mode: 404 → added to pendingSeverances, no immediate action
- [ ] Severed task is skipped on subsequent syncs

### Phase 4-5 Tests (UI)
- [ ] Status bar shows pending count
- [ ] Status bar hidden when count = 0
- [ ] Modal opens from status bar click
- [ ] Modal opens from command palette
- [ ] Modal displays event details correctly

### Phase 6 Tests (Actions)
- [ ] "Sever Link" adds to severedTaskIds
- [ ] "Recreate Event" creates event in Google Calendar
- [ ] Batch operations work correctly
- [ ] Status bar updates after actions
- [ ] Severed tasks remain ignored on future syncs

### Phase 7 Tests (Polish)
- [ ] CSS styling consistent
- [ ] Sync history shows sever operations
- [ ] Documentation is complete and accurate

---

## Edge Cases to Consider

| Scenario | Expected Behavior |
|----------|-------------------|
| Multiple 404s in one sync | All queued (ask) or all processed (sever/recreate) |
| Task edited while in pending queue | New task ID, old pending item becomes stale |
| User severs then edits task | New task ID, syncs as new event |
| Calendar deleted entirely | All events on that calendar 404, all queued/processed |
| Offline when trying to recreate | Use existing retry queue mechanism |

---

## Session Log

*(Sessions should add entries here after each phase is tested and confirmed)*

---

## Next Session Prompt

```
Chronos Plugin - Phase 12: External Event Handling (Phases 5-7)

**Directory:** C:\Users\bwales\projects\obsidian-plugins\Chronos
**Branch:** feature/phase-11.1-deletion-security (already exists, continue on it)

**IMPORTANT:** Read these docs first:
1. docs/External Event Handling Feature.md (THIS FEATURE - read Phase 5 tasks)
2. src/deletionReviewModal.ts (similar pattern to follow for severance modal)
3. CLAUDE.md (project conventions)

**Current Status:**
- Phases 1-4: COMPLETE
- Phase 5: Review Modal - NOT STARTED
- Phase 6: Modal Actions - NOT STARTED
- Phase 7: Polish & Docs - NOT STARTED

**What's already done:**
- Settings with dropdown (ask/sever/recreate)
- Data structures (PendingSeverance, severedTaskIds)
- Sync logic that queues severances or auto-severs based on setting
- Status bar showing pending severance count
- Placeholder openSeveranceReviewModal() method

**Your task:** Implement Phase 5 (Review Modal)

Phase 5 tasks:
- 5.1 Create src/severanceReviewModal.ts file
- 5.2 Create SeveranceReviewModal class extending Modal
- 5.3 Display list of pending severances with event details
- 5.4-5.7 Add per-item and batch action buttons
- 5.8-5.9 Add explanatory text and recovery note
- 5.10 Wire up status bar click to open modal
- 5.11 Add command: "Chronos: Review disconnected events"
- 5.12 Import modal in main.ts
- 5.13 Build and verify

**Workflow:**
1. Work on task 5.1
2. Check off 5.1 in the feature doc immediately
3. Continue through all Phase 5 tasks
4. Present test actions to user
5. Debug as needed
6. Continue to Phase 6 if time permits

**DO NOT:**
- Batch checkoffs at end of phase
- Update Handoff Log until all phases complete
- Skip reading the existing DeletionReviewModal for patterns

The modal should look similar to DeletionReviewModal but with:
- "Sever Link" and "Recreate Event" buttons per item
- "Sever All" and "Recreate All" batch buttons
- Note about recovery: edit title/date/time to re-sync
```

---

## Known Issues

| Issue | Status | Description |
|-------|--------|-------------|
| Edit-back edge case | Open | When a severed task is edited to a new time, then edited back to original time, the task remains severed instead of syncing as new. **Workaround:** Edit to a time different from the original. |
| Status bar count drift | Open | Status bar may show stale count after extensive testing. Reloading Obsidian fixes it. |

---

## Features Implemented (Session Summary)

- **Strict Time Sync setting** - Detects when Google event time differs from Obsidian task time
- **SeveranceReviewModal** - UI for reviewing disconnected events with Sever/Recreate actions
- **Sever behavior** - Keeps sync records for reconciliation, marks as severed
- **Recreate behavior** - Creates new event via proper API with datetime
- **Overlap prevention** - Severed tasks don't trigger orphan deletion prompts
