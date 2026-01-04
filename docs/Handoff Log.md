# Chronos Handoff Log

**Last Updated:** January 4, 2026
**Current Phase:** Phase 8 Complete - Ready for Phase 10
**Current Branch:** feature/phase-8-qol-upgrades-3
**Version:** 0.1.0

---

## Session: January 4, 2026 (Session 10) - Phase 8 COMPLETE: Task ID Reconciliation Fix

### Session Summary

Fixed the critical Task ID reconciliation system that was causing delete+create instead of updates when editing tasks. Implemented a robust two-pass reconciliation algorithm that handles renames, rescheduling, time changes, cross-file moves, and file renames gracefully. Also added duplicate task detection, and fixed updates to preserve user-edited event data (description, location, attendees).

### What Was Done

| Item | Status | Details |
|------|--------|---------|
| **Task ID Generation** | ✅ Complete | |
| New ID formula | Done | `hash(filePath + title + date + time)` |
| Time included | Done | Allows "Focus block" at different times to sync as separate events |
| **Two-Pass Reconciliation** | ✅ Complete | |
| Pass 1: In-place edits | Done | Match by `filePath + lineNumber` - catches renames, rescheduling, time changes |
| Pass 2: Cross-file moves | Done | Match by `title + date + time` - catches file moves, file renames |
| **Unchanged Task Line Tracking** | ✅ Complete | |
| updateSyncLineNumber() | Done | New method to update stored lineNumber for unchanged tasks |
| Move-then-rename fix | Done | When task moves, lineNumber updates so later renames reconcile correctly |
| **Preserve Event Data on Update** | ✅ Complete | |
| GET before PUT | Done | updateEvent() now fetches existing event first |
| Merge logic | Done | Preserves description (if user-edited), location, attendees, colorId |
| buildEventBodyForUpdate() | Done | New method that merges Chronos fields with user-edited fields |
| **Duplicate Detection** | ✅ Complete | |
| Detection logic | Done | Warns when two tasks have identical title+date+time+file |
| Skip duplicates | Done | First occurrence wins, second skipped with warning |
| **SyncedTaskInfo Updates** | ✅ Complete | |
| Added time field | Done | Stored for reconciliation matching |

### Testing Results

| Test | Result |
|------|--------|
| Rename task (same line) | ✅ UPDATE |
| Reschedule / date change (same line) | ✅ UPDATE |
| Time change (same line) | ✅ UPDATE |
| Move task to different line (same file) | ✅ Unchanged |
| Cross-file move (cut/paste to different note) | ✅ Unchanged |
| File rename | ✅ All tasks unchanged |
| Focus blocks (same title, different times) | ✅ All sync as separate events |
| Preserve description on update | ✅ Preserved |
| Preserve location on update | ✅ Preserved |
| Duplicate task warning | ✅ Warning shown, first wins |
| Move-then-rename (different sync cycles) | ✅ UPDATE |
| Rename AND move (same sync cycle) | ✅ Delete+Create (acceptable) |

### Files Modified

| File | Changes |
|------|---------|
| `src/syncManager.ts` | New generateTaskId() with title+date+time, two-pass reconciliation, updateSyncLineNumber(), time field in SyncedTaskInfo, duplicate detection |
| `src/googleCalendar.ts` | updateEvent() now GETs first and merges, new buildEventBodyForUpdate() method |
| `main.ts` | Update stored lineNumber for unchanged tasks that moved |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task ID components | filePath + title + date + time | Stable for moves, allows same-title events at different times |
| Pass 1 matching | filePath + lineNumber only | Catches all in-place edits regardless of what changed |
| Pass 2 matching | title + date + time | Catches cross-file moves and file renames |
| User-edited description | Preserve if no Chronos signature | Respects user customization |
| Duplicate handling | Warn + skip second | Clear feedback, prevents flickering |
| Acceptable edge case | Rename + move = recreate | Rare, essentially a new task |

### Known Limitations

| Limitation | Details |
|------------|---------|
| Legacy sync data | Tasks synced before this fix may lack lineNumber/time fields, causing one-time delete+create |
| True duplicates | Two tasks with identical title+date+time+file cannot both sync |
| Rename + move (same sync) | Simultaneously changing title AND line results in delete+create |

---

## Session: January 4, 2026 (Session 9) - Phase 8 Continued: Event Routing Behavior

### Session Summary

Implemented event routing behavior feature with three modes (Preserve/Keep Both/Fresh Start) for handling calendar changes. Also fixed several bugs discovered during testing.

### What Was Done

| Item | Status | Details |
|------|--------|---------|
| **Event Routing Behavior** | ✅ Complete | |
| Three routing modes | Done | Preserve (move), Keep Both (duplicate), Fresh Start (delete+create) |
| Settings UI | Done | Dropdown with mode descriptions under "Event Routing Behavior" section |
| Google Calendar moveEvent() | Done | New API method for Preserve mode |
| CalendarChangeWarningModal | Done | Shows when changing default calendar with event count, mode description |
| RerouteFailureModal | Done | Prompts user when source calendar inaccessible (404/403) |
| Processing time warning | Done | Added to calendar change modal with estimated time |
| Reload warning | Done | Note in settings that mode changes require app reload |
| **Bug Fixes** | ✅ Complete | |
| Case-insensitive tag matching | Done | Tags like #Work now match #work mappings |
| Tags stripped from event titles | Done | Added to STRIP_PATTERNS in taskParser |
| Sync log 'move' type | Done | Added icons and labels for move operations |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mode names | Preserve / Keep Both / Fresh Start | User-friendly, descriptive |
| Default mode | Preserve | Best UX - no duplicates, keeps edits |
| Warning placement | On calendar change, not mode toggle | Impact happens at switch time |

---

## Session: January 4, 2026 (Session 8) - Multi-Calendar Support

### Session Summary

Implemented Phase 8 multi-calendar support with tag-based routing. Users can now map specific tags to specific calendars (e.g., #work → Work Calendar). Tasks with mapped tags sync to their designated calendar, while tasks without tags or with unmapped tags use the default calendar.

### What Was Done

| Item | Details |
|------|---------|
| **Settings & Data** | |
| tagCalendarMappings | Added `Record<string, string>` to settings (tag → calendarId) |
| Default calendar | Renamed "Target calendar" to "Default calendar" with updated description |
| **Settings UI** | |
| Mappings list | Shows current mappings with tag, arrow, calendar name, delete button |
| Add mapping | Input for tag, dropdown for calendar, Add button |
| Validation | Normalizes tags to include #, prevents duplicates |
| **Sync Logic** | |
| getTargetCalendarForTask() | Determines target calendar based on task tags |
| computeMultiCalendarSyncDiff() | New method in SyncManager for per-task calendar routing |
| Multi-tag handling | Warning notice + fallback to default if task has multiple mapped tags |
| Tag change behavior | Old event becomes dormant, new event created in new calendar |
| Completed/orphaned tasks | Use their stored calendarId for operations |
| **CSS** | Full styling for mapping UI (list, rows, add section) |

### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | tagCalendarMappings in settings, getTargetCalendarForTask(), updated syncTasks(), renderTagMappings() in settings |
| `src/syncManager.ts` | MultiCalendarSyncDiff interface, computeMultiCalendarSyncDiff() method |
| `styles.css` | Tag mapping UI styles |
| `docs/ADR Priority List - Chronos.md` | Phase 8 marked complete |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Multiple mapped tags | Warning + use default | Clear feedback, safe fallback |
| Tag change behavior | Create new event, old becomes dormant | User agency, matches calendar switch behavior |
| Tag normalization | Always store with # prefix | Consistent matching |

### Testing Notes

1. Settings → Chronos → "Tag-to-Calendar Mappings"
2. Add a mapping: type `#work`, select a calendar, click Add
3. Create a task with the tag: `- [ ] Test task #work 📅 2026-01-15`
4. Sync and verify event goes to mapped calendar
5. Test with multiple mapped tags to see warning

---

## Session: January 4, 2026 (Session 7) - Phase 9 Polish: Custom Reminders Modal & History Batching

### Session Summary

Polished Phase 9 features with improved UX. Added custom reminders UI to the date/time modal (toggle + input fields) so users don't need to type the 🔔 syntax manually. Refactored sync history to display as collapsible batch cards instead of a flat list of 100 entries.

### What Was Done

| Item | Details |
|------|---------|
| **Custom Reminders Modal UI** | |
| Toggle added | "Custom reminders" toggle in date/time modal |
| Input fields | Two number inputs for reminder 1 and reminder 2 (minutes) |
| Auto-insert syntax | Modal inserts `🔔 30,10` when custom reminders enabled |
| CSS styling | New styles for reminder section and inputs |
| **Sync History Batching** | |
| batchId field | Added to SyncLogEntry interface |
| generateBatchId() | Creates unique ID for each sync run |
| Batch grouping | Entries grouped by batchId in modal |
| Collapsible cards | Each batch is a card showing timestamp + summary |
| Summary text | e.g., "Jan 4, 3:45 PM — 3 created, 1 updated" |
| Error highlighting | Batches with failures have red left border |
| Header count | Shows "5 syncs (23 operations)" |

### Files Modified

| File | Changes |
|------|---------|
| `src/syncManager.ts` | Added batchId to SyncLogEntry, generateBatchId(), updated logOperation() |
| `src/dateTimeModal.ts` | Already had customReminders fields from previous session |
| `main.ts` | Generate batchId in syncTasks(), pass to all logOperation() calls, refactored SyncLogModal with batch grouping |
| `styles.css` | Added reminder input styles, batch card styles |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Batch ID format | Timestamp + random suffix | Simple, unique, no collisions |
| Two reminder inputs | Max 2 in modal | Covers 99% of use cases; power users can type syntax for more |
| Batch cards collapsed by default | Yes | Reduces visual noise, click to expand |

### Testing Notes

- Custom reminders: Ctrl+P → "Chronos: Insert date/time for task" → toggle "Custom reminders"
- Sync history: Run a sync, then Ctrl+P → "Chronos: View sync history"
- Old log entries without batchId will group under one "unknown" batch

---

## Next Session Prompt

```
Chronos - Phase 10: Batch API Calls

**Directory:** C:\Users\bwales\projects\obsidian-plugins\Chronos
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\
**GitHub:** https://github.com/thuban87/Chronos (public)
**Current branch:** main (create new feature branch)
**Version:** 0.1.0

**IMPORTANT: Read docs\Handoff Log.md and docs\ADR Priority List - Chronos.md first**

---

## Context

Phase 8 (Multi-Calendar + Event Routing + Task ID Reconciliation) is COMPLETE. All tests passing.

The plugin now handles:
- Tag-based calendar routing (#work → Work calendar)
- Event routing modes (Preserve/Keep Both/Fresh Start)
- Robust task ID reconciliation (renames, rescheduling, moves, file renames all work)
- Preserved user-edited event data (description, location, attendees)
- Duplicate task detection

---

## Phase 10: Batch API Calls

**Goal:** Dramatically improve sync performance for users with many events.

**Why This Matters:**
- Current: 100 events = 100 sequential requests = 30-50 seconds
- With batch: 100 events = 1 request = 2-5 seconds
- Google Calendar API supports up to 100 operations per batch

**Features to Implement:**
1. Batch request builder (multipart MIME body)
2. Batch response parser (multipart MIME response)
3. Refactor sync to collect-then-batch
4. Partial failure handling
5. Basic debugging support

**Reference:** https://developers.google.com/calendar/api/guides/batch

---

## Alternative: Skip to Polish/Release

If batch API feels too complex, could instead focus on:
- Beta testing (BRAT)
- Mac/mobile testing
- README improvements
- Bug fixes from real-world use

**Build & Deploy:**
npm run build → Reload Obsidian (Ctrl+P → "Reload app without saving")
```

---

## Quick Reference

### Development Commands
```bash
cd C:\Users\bwales\projects\obsidian-plugins\chronos
npm run build                    # Production build
npm run dev                      # Watch mode
```

### Required Files in Deploy Directory
- `manifest.json` (REQUIRED)
- `main.js` (REQUIRED)
- `styles.css` (if any styles)
- `data.json` (auto-created by Obsidian)

### Reload Plugin
Ctrl+P → "Reload app without saving" OR toggle plugin off/on

### Task Format
```markdown
- [ ] Timed task 📅 2026-01-15 ⏰ 14:00
- [ ] All-day task 📅 2026-01-15
- [ ] Excluded task 📅 2026-01-15 🚫
- [ ] Custom reminders 📅 2026-01-15 ⏰ 14:00 🔔 60,30,10
- [ ] With tag for routing 📅 2026-01-15 #work
```

---

## Archived Sessions

### Session: January 3, 2026 (Session 6) - Phase 9 Complete: Sync Log & Reminder Override

Completed Phase 9 with sync history logging and per-task reminder override. Also fixed calendar color display in agenda sidebar and added timezone abbreviations.

### Session: January 3, 2026 (Session 5) - Phase 7 Complete: Agenda Sidebar & Timezone

Completed Phase 7 with the agenda sidebar and the timezone setting.

### Session: January 3, 2026 (Session 4) - Security & Performance Improvements

Switched from embedded OAuth credentials to user-provided credentials. Optimized vault scanning with metadataCache.

### Session: January 3, 2026 (Session 3) - Phases 4, 5, 6 Implementation

Completed all MVP phases - sync infrastructure, task lifecycle, and polish.

### Session: January 3, 2026 (Session 2) - Phases 1-3 Implementation

OAuth flow, task parsing, and calendar event creation.

### Session: January 3, 2026 (Session 1) - Project Planning

Initial planning and documentation.
