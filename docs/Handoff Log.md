# Chronos Handoff Log

**Last Updated:** January 12, 2026
**Current Phase:** Phase 19 PLANNED - Multi-PC Sync Conflict Resolution  
**Current Branch:** main (feature branch: fix/multi-pc-sync)
**Version:** 1.5.1

---

## Next Session Prompt

> Start a new branch `fix/multi-pc-sync` from main. Implement Phase 19: Multi-PC Sync Conflict Resolution following the implementation guide at `docs/Multi-PC Sync - Implementation Guide.md`. Begin with Phase 1 (Machine Identity) and Phase 2 (Sync Record Versioning) as they are non-breaking foundation work. The goal is to prevent sync conflicts when using Chronos across multiple machines.

---

## Session: January 12, 2026 - API Optimization + Orphan Bug Fix + Multi-PC Sync Planning

### Fix 1: API Call Optimization (COMPLETE)

Reduced excessive Google Calendar API calls by ~83%.

| Component | Change |
|-----------|--------|
| **Cache-first `getCalendarNameById`** | Check `calendarNameCache` before API call |
| **1-hour throttle on unchanged verification** | Auto-sync only; manual sync bypasses |
| **forceVerify parameter** | Added to `syncTasks()` to control verification |

**Impact:** With 97 events, reduced from ~14,000 to ~2,300 `Events.Get` calls/day.

**Branch:** `fix/api-handling` → merged to main

---

### Fix 2: Completed Tasks Mislabeled as Orphans (COMPLETE)

Fixed bug where completing a task triggered Safety Net orphan detection.

**Root Cause:** `computeMultiCalendarSyncDiff()` only received uncompleted tasks, so completed task sync IDs appeared as orphans.

**Fix:** Added `completedTaskIds` parameter to `computeMultiCalendarSyncDiff()` to exclude them from orphan detection.

| File | Changes |
|------|---------|
| `src/syncManager.ts` | Added `completedTaskIds: Set<string>` parameter, exclude from `potentialOrphans` |
| `main.ts` | Build completed task IDs set before diff, pass to function |

**Branch:** `fix/mislabeled-orphans` → merged to main

---

### Feature: Multi-PC Sync Conflict Resolution (PLANNED)

Identified architectural gap when using Chronos across multiple machines with cloud-synced vaults.

**Problem:** `data.json` sync records are shared via cloud sync, but without a "base state" cache, machines can't detect when another machine has made changes.

**Solution:** Implement 3-way merge conflict detection:
- Store "Base State" in `localStorage` (local to each machine)
- Compare Base vs Remote (`data.json`) vs Local (markdown)
- Use last-write-wins for resolution

**Implementation Guide:** `docs/Multi-PC Sync - Implementation Guide.md`

---

### Files Modified This Session

| File | Changes |
|------|---------|
| `main.ts` | Cache-first getCalendarNameById, forceVerify param, completedTaskIds passing |
| `src/syncManager.ts` | completedTaskIds param in computeMultiCalendarSyncDiff |
| `docs/ADR Priority List - Chronos.md` | Added fixed bugs, API throttle limitation |

---

## Session: January 11, 2026 - Recurring Task Succession Implementation

### Feature: Recurring Task Succession (COMPLETE)

Fixed the duplicate calendar event bug when completing recurring tasks with Tasks plugin. Feature is opt-in via settings toggle.

#### What Was Built

| Component | Description |
|-----------|-------------|
| **Enable toggle** | `enableRecurringTasks` setting with confirmation modal |
| **UI gating** | DateTimeModal hides "Repeat" dropdown when toggle OFF |
| **RRULE gating** | buildChangeSet sets recurrenceRule to null when toggle OFF |
| **Succession gating** | computeMultiCalendarSyncDiff skips Third Reconciliation Pass when toggle OFF |
| **Third Reconciliation Pass** | Detects successor tasks and migrates sync records |
| **migrateRecurringSyncRecord()** | Transfers eventId from orphan to successor |
| **PendingSuccessorCheck** | Data structure for deferred successor matching |
| **SeriesDisconnectionModal** | Modal when no successor found (delete/keep options) |
| **RecurrenceChangeModal** | Modal when recurrence pattern changes |
| **Emoji order fix** | Chronos emojis before 📅, then 🔁 (Tasks plugin compatibility) |
| **Modal text fix** | Correct Tasks plugin settings path |

#### Behavior Summary

| Toggle | Modal Recurrence | 🔁 Creates RRULE | Succession Logic |
|--------|------------------|------------------|------------------|
| OFF    | Hidden           | No (single event)| Disabled (new events each time) |
| ON     | Visible          | Yes              | Enabled (migrates records) |

#### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | Insert command emoji order fix, enableRecurringTasks setting, DateTimeModal parameter |
| `src/dateTimeModal.ts` | enableRecurrence parameter, conditional recurrence UI display |
| `src/syncManager.ts` | recurrenceRule in SyncedTaskInfo, PendingSuccessorCheck, Third Reconciliation Pass, migrateRecurringSyncRecord(), enableRecurringTasks gating |
| `src/recurrenceParser.ts` | parseWeeklyByday() for Tasks plugin normalized format |
| `src/recurringEnableModal.ts` | **NEW** - Warning modal for enabling recurring tasks |
| `src/seriesDisconnectionModal.ts` | **NEW** - Modal for orphaned recurring tasks |
| `src/recurrenceChangeModal.ts` | **NEW** - Modal for recurrence pattern changes |
| `styles.css` | CSS for new modals |
| `docs/ADR Priority List - Chronos.md` | Phase 18 marked COMPLETE |

---

#### Notes

- `task-starting-soon` and `task-now` only fire during agenda refresh (not real-time)
- Other plugins can use `getSyncedTasks()` to build their own timers if needed
- Tags are stored during sync and available in AgendaTaskEvent

---

### Feature 2: Recurring Task Succession (PLANNED - NOT IMPLEMENTED)

Identified and documented a bug where completing a recurring task creates duplicate Google Calendar events.

#### The Problem

1. Task with 🔁 syncs to Google as recurring event (RRULE)
2. User completes task → Tasks plugin creates new instance with next date
3. Chronos sees new task → creates ANOTHER recurring event
4. Result: Duplicate recurring series in Google Calendar

#### The Solution (Designed, Not Yet Implemented)

Add a "Third Reconciliation Pass" in `computeMultiCalendarSyncDiff()` to detect when a new task is the "successor" to a completed recurring task, and transfer the sync record instead of creating a new event.

**Key components:**
- Store `recurrenceRule` in SyncedTaskInfo (not just `isRecurring` boolean)
- Match successor by: same title + same time + same file + has recurrence + future date
- Deferred check (2 sync cycles) to handle race condition with Tasks plugin
- Modal for disconnected series (no successor found)
- Modal for significant recurrence pattern changes

#### Implementation Guide

Full implementation details documented in:
**`docs/Recurring Task Succession - Implementation Guide.md`**

This guide includes:
- Step-by-step implementation instructions
- Code snippets for all changes
- New modal designs
- Testing checklist
- Edge case handling

---

### Git Commit Suggestion (Event System)

```
feat: Add event system for inter-plugin communication

- Add ChronosEvents class with typed event emitter (src/events.ts)
- Emit sync lifecycle events: sync-start, sync-complete
- Emit task events: task-created, task-updated, task-completed, task-deleted
- Emit agenda events: agenda-refresh, task-starting-soon, task-now
- Add public API: getSyncedTasks(), getSyncedTask(), isConnected(), getDefaultCalendarId()
- Export types (ChronosEvents, ChronosEventPayloads, AgendaTaskEvent, ChronosTask, SyncedTaskInfo)
- Add tags field to AgendaTaskEvent and SyncedTaskInfo for tag-based filtering
```

---

## Session: January 9, 2026 - Exclusion Rules (Rules Manager)

### Feature Overview

Allow users to exclude folders and files from sync via settings, solving the case where users have files full of dated tasks they never want synced (templates, archives, reference notes).

### What Was Built

| Component | Description |
|-----------|-------------|
| **Excluded Folders** | Settings UI to add folders (excludes all subfolders) |
| **Excluded Files** | Settings UI to add specific files |
| **Folder Autocomplete** | Type-ahead suggester showing vault folders |
| **File Autocomplete** | Type-ahead suggester showing markdown files |
| **Synced Task Modal** | Shown when excluding locations with already-synced tasks |
| **Keep/Delete Options** | User chooses to keep events in calendar or delete them |
| **Path Normalization** | Handles spaces, slashes, Windows/Unix path differences |

### Settings Added

| Setting | Description |
|---------|-------------|
| `excludedFolders` | Array of folder paths to exclude from sync |
| `excludedFiles` | Array of file paths to exclude from sync |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Path matching | Normalized comparison | Handles spaces, different slash styles |
| Already-synced tasks | Modal with options | User decides: keep or delete events |
| Autocomplete | Custom suggester | Easier than typing full paths |
| Folder exclusion | Includes subfolders | Matches user expectation |

### Files Modified/Created

| File | Changes |
|------|---------|
| `main.ts` | Settings fields, exclusion UI, suggesters, modal handling |
| `src/taskParser.ts` | `isExcludedByFolder()`, `isExcludedByFile()`, `normalizePath()` |
| `src/exclusionModal.ts` | **NEW** - Modal for Keep/Delete choice |
| `styles.css` | Exclusion list, suggester dropdown, modal styles |

### Testing Verified

- Folder exclusion with/without spaces ✓
- File exclusion with/without spaces ✓
- Nested folder exclusion ✓
- Autocomplete for both folders and files ✓
- Modal appears for already-synced tasks ✓

---

## Session: January 9, 2026 - Multi-Calendar Agenda & Event Import

### Feature Overview

Two related features for the agenda sidebar:

1. **Multi-Calendar Agenda View:** Show events from multiple calendars in the agenda sidebar (not just the synced calendar)
2. **Import Events to File:** Insert the day's agenda into the current note as markdown

### What Was Built

| Component | Description |
|-----------|-------------|
| **Multi-Calendar Selection** | Settings UI with checkboxes for each available calendar |
| **Calendar Color Dots** | Each event shows a color dot indicating its source calendar |
| **Select All / Clear All** | Quick actions to select/deselect all calendars |
| **Import Command** | "Chronos: Import agenda to current file" command |
| **Import Button** | 📋 button in agenda sidebar header for quick import |
| **Three Import Formats** | List (with links), Table, and Simple (no links) |
| **Format Setting** | User can choose preferred import format in settings |

### Settings Added

| Setting | Description |
|---------|-------------|
| `agendaCalendarIds` | Array of calendar IDs to show in agenda |
| `agendaImportFormat` | 'list' \| 'table' \| 'simple' format for imports |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default calendar | NOT always shown | User can uncheck all calendars, shows empty state |
| API calls | One per selected calendar per day | Minimizes API usage |
| Calendar name display | Hover tooltip only | Keeps UI clean |
| Import date source | Agenda's current date | More useful than always today |

### Import Format Examples

**List (default):**
```markdown
## Agenda for Thursday, January 9, 2026

- 09:00 AM - [Team standup](https://calendar.google.com/...)
- 02:00 PM - [Client call](https://calendar.google.com/...)
```

**Table:**
```markdown
## Agenda for Thursday, January 9, 2026

| Time | Event |
|------|-------|
| 09:00 AM | [Team standup](link) |
```

**Simple:**
```markdown
## Agenda for Thursday, January 9, 2026

- 09:00 AM - Team standup
- 02:00 PM - Client call
```

### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | Settings interface, AgendaViewDeps, fetchAgendaEventsForDate(), importAgendaToEditor(), import command, settings UI |
| `src/agendaView.ts` | AgendaEvent interface, multi-calendar support, import button, color dots, updated deps interface |
| `styles.css` | Calendar checkbox UI, color dots, import button, empty state hint |

### Testing Checklist

- [ ] Settings: Calendar checkboxes load and save correctly
- [ ] Settings: Select All / Clear All work
- [ ] Settings: Import format dropdown works
- [ ] Agenda: Shows events from multiple selected calendars
- [ ] Agenda: Calendar color dots display correctly
- [ ] Agenda: Empty state shows "No calendars selected" when none checked
- [ ] Agenda: Hover on event shows calendar name
- [ ] Import: Command appears in palette
- [ ] Import: Button in agenda works
- [ ] Import: Uses agenda's current date (not always today)
- [ ] Import: All three formats work correctly
- [ ] Import: Links open Google Calendar

### Git Commit Suggestion

```
feat: Multi-calendar agenda view and event import

- Add calendar selection checkboxes in settings
- Display events from multiple calendars with color dots
- Add import command and button to insert agenda into notes
- Support three import formats: list, table, simple
- Calendar name shown on hover for each event
```

---

## Session: January 9, 2026 - Recurring Events Feature COMPLETE

### Feature Overview

Recurring Events allows users to create recurring calendar events using the Tasks plugin `🔁` syntax. The feature includes a modal UI for selecting recurrence patterns and special handling for completed recurring tasks.

### What Was Built

| Component | Description |
|-----------|-------------|
| **Recurrence Parser** | `src/recurrenceParser.ts` - Converts `🔁` syntax to Google RRULE format |
| **Task Parsing** | Parse recurrence text and convert to RRULE in task scanning |
| **Calendar Integration** | Pass RRULE to Google Calendar API for event creation/update |
| **Modal UI** | Recurrence picker with frequency dropdown, interval input, weekday selector |
| **Date Picker** | Changed date input from text field to native date picker |
| **Recurring Delete Modal** | Options for handling completed recurring tasks |
| **Smart Completion Handling** | Different behavior for Safety Net ON vs OFF |
| **Sync Info Tracking** | Store `isRecurring` flag in sync data for reliable detection |

### Syntax Examples

```markdown
- [ ] Daily standup 📅 2026-01-15 ⏰ 09:00 🔁 every day
- [ ] Weekly review 📅 2026-01-15 ⏰ 14:00 🔁 every week
- [ ] Biweekly sync 📅 2026-01-15 ⏰ 10:00 🔁 every 2 weeks
- [ ] MWF workout 📅 2026-01-15 ⏰ 07:00 🔁 every monday, wednesday, friday
```

### Supported Patterns

| Pattern | Example |
|---------|---------|
| Simple frequency | `every day`, `every week`, `every month`, `every year` |
| With interval | `every 2 days`, `every 3 weeks`, `every 6 months` |
| Single weekday | `every monday`, `every friday` |
| Multiple weekdays | `every monday, wednesday, friday` |

### Completed Recurring Task Handling

**Critical Issue Solved:** Modifying a recurring event's title in Google Calendar breaks the recurrence series.

**Safety Net ON (Default):**
- Recurring task completed → Released from sync tracking
- Calendar events stay intact (future reminders continue)
- No API calls made to Google Calendar

**Safety Net OFF:**
- Shows RecurringDeleteModal with options:
  - **Delete All Events**: Deletes entire series
  - **Keep Events (Recommended)**: Release from tracking, calendar intact
  - **Delete Next Instance**: Disabled (complex Google API - future enhancement)

### Files Created/Modified

| File | Changes |
|------|---------|
| `src/recurrenceParser.ts` | **NEW** - Parse 🔁 syntax to RRULE |
| `src/recurringDeleteModal.ts` | **NEW** - Modal for completed recurring tasks |
| `src/taskParser.ts` | Added RECURRENCE_PATTERN, recurrenceText/recurrenceRule fields |
| `src/googleCalendar.ts` | Added recurrence array to event body, CreateEventParams |
| `src/batchApi.ts` | Added recurrenceRule to ChangeSetOperation, PendingRecurringCompletion |
| `src/syncManager.ts` | Pass recurrence through, special handling for recurring completions, isRecurring in SyncedTaskInfo |
| `src/dateTimeModal.ts` | Added recurrence picker UI, changed date input to date picker |
| `main.ts` | Handle recurring completions, show modal, build recurrence syntax |
| `styles.css` | Styles for recurrence UI, weekday buttons, recurring delete modal |

### Testing Results

| Test | Result |
|------|--------|
| `🔁 every week` creates weekly recurring event | ✅ Pass |
| `🔁 every 2 weeks` creates biweekly event | ✅ Pass |
| `🔁 every monday, wednesday, friday` creates MWF schedule | ✅ Pass |
| Modal generates correct recurrence syntax | ✅ Pass |
| Safety Net ON: Calendar unchanged on completion | ✅ Pass |
| Safety Net OFF: Modal appears with options | ✅ Pass |
| "Keep Events" releases from tracking | ✅ Pass |
| "Delete All Events" deletes series | ✅ Pass |
| Recurrence stripped from event title | ✅ Pass |
| Date picker works correctly | ✅ Pass |

### Known Limitations

| Limitation | Notes |
|------------|-------|
| `when done` patterns | Not supported (completion-triggered recurrence) |
| `every month on the 15th` | Deferred to future |
| Delete single instance | Requires Google exception API - deferred |
| End date / count | Not implemented |

### Git Commit Suggestion

```
feat: Recurring Events with modal UI and smart completion handling

- Add recurrence parser for 🔁 syntax to Google RRULE conversion
- Support: every day/week/month/year, intervals, weekdays
- Add recurrence picker to date/time modal
- Change date input to native date picker
- Smart handling for completed recurring tasks:
  - Safety Net ON: Release from tracking, keep calendar events
  - Safety Net OFF: Show modal with delete/keep options
- Store isRecurring flag in sync data for reliable detection
- Add RecurringDeleteModal for completion choices
```

---

## Session: January 9, 2026 - Custom Duration Feature COMPLETE

### Feature Overview

Custom Duration allows users to specify per-task event duration using the `⏱️` emoji syntax, overriding the default duration setting.

### What Was Built

| Component | Description |
|-----------|-------------|
| **Duration Parsing** | Parse `⏱️ 2h`, `⏱️ 30m`, `⏱️ 1h30m`, `⏱️ 45` formats |
| **Task-Specific Duration** | Each task can have its own duration |
| **Modal UI** | Custom duration toggle with hours/minutes inputs |
| **CSS Styling** | Duration input styling matching reminder inputs |

### Syntax Examples

```markdown
- [ ] Long meeting 📅 2026-01-15 ⏰ 14:00 ⏱️ 2h
- [ ] Quick call 📅 2026-01-15 ⏰ 10:00 ⏱️ 15m
- [ ] Workshop 📅 2026-01-15 ⏰ 09:00 ⏱️ 1h30m
- [ ] Plain minutes 📅 2026-01-15 ⏰ 11:00 ⏱️ 45
```

### Files Modified

| File | Changes |
|------|---------|
| `src/taskParser.ts` | Added DURATION_PATTERN, durationMinutes to ParseResult and ChronosTask, parsing logic |
| `src/syncManager.ts` | Updated buildChangeSet() to use task.durationMinutes for all operation types |
| `src/dateTimeModal.ts` | Added customDuration toggle, durationHours/durationMinutes inputs |
| `main.ts` | Updated modal result handler to insert ⏱️ syntax |
| `styles.css` | Added .chronos-duration-* styles |

### Testing Results

| Test | Result |
|------|--------|
| `⏱️ 2h` creates 2-hour event | ✅ Pass |
| `⏱️ 30m` creates 30-minute event | ✅ Pass |
| `⏱️ 1h30m` creates 90-minute event | ✅ Pass |
| `⏱️ 45` creates 45-minute event | ✅ Pass |
| Task without ⏱️ uses default duration | ✅ Pass |
| Duration stripped from event title | ✅ Pass |
| Modal inserts correct syntax | ✅ Pass |

---

## Session: January 9, 2026 - Phase 12 COMPLETE: External Event Handling

### Feature Overview

External Event Handling determines what Chronos does when it detects a 404 for a calendar event (meaning the event was moved or deleted in Google Calendar). Users can choose to be asked each time, automatically sever the link, or automatically recreate events.

### What Was Built

| Component | Description |
|-----------|-------------|
| **External Event Behavior Setting** | Dropdown with 3 options: Ask me each time, Sever link, Recreate event |
| **Pending Severances Queue** | Events awaiting user review (when in 'ask' mode) |
| **Status Bar Indicator** | Shows pending severance count, click to review |
| **SeveranceReviewModal** | Review each disconnected event with Sever/Recreate buttons |
| **Strict Time Sync Setting** | Detects when Google event time differs from Obsidian task |
| **Sever Operation Logging** | Severances appear in sync history with 🔗 icon |
| **Reconciliation-Safe Severing** | Severed tasks keep sync records for edit detection |
| **Auto-Unsever on Edit** | Editing a severed task clears the severance and creates new event |

### Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | Data structures, settings, helper methods | ✓ Complete |
| Phase 2 | Settings UI with dropdown and descriptions | ✓ Complete |
| Phase 3 | Sync logic integration for 404 handling | ✓ Complete |
| Phase 4 | Status bar indicator for pending severances | ✓ Complete |
| Phase 5 | Review modal with per-item actions | ✓ Complete |
| Phase 6 | Modal action callbacks (sever/recreate) | ✓ Complete |
| Phase 7 | Polish, CSS, sync logging, documentation | ✓ Complete |

### Files Created

| File | Purpose |
|------|---------|
| `src/severanceReviewModal.ts` | Modal for reviewing disconnected events |

### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | Settings, status bar, modal integration, callbacks, logging |
| `src/syncManager.ts` | PendingSeverance interface, severed task tracking, reconciliation |
| `styles.css` | SeveranceReviewModal styling |
| `README.md` | External Event Handling documentation |
| `docs/SAFETY-NET.md` | Added External Event Handling section |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default behavior | Ask me each time | Consistent with Safety Net philosophy |
| Severed task storage | Keep sync record with flag | Enables reconciliation on edit |
| Recovery path | Edit title/date/time | Changes task ID, syncs fresh |
| Orphan handling | Severed tasks silently removed | No deletion prompts for severed tasks |

### Known Issues

| Issue | Status | Description |
|-------|--------|-------------|
| Edit-back edge case | Open | When severed task is edited to new time, then back to original, task remains severed. Workaround: edit to different time. |

---

## Session: January 5-8, 2026 - Phase 11 COMPLETE: Safety Net Deletion Protection

### Feature Overview

Safety Net intercepts calendar deletions and requires user approval before executing. Protects against accidental data loss from deleted task lines, calendar rerouting, and other scenarios where events would be automatically removed.

### What Was Built

| Component | Description |
|-----------|-------------|
| **Pending Deletions Queue** | Deletions are queued instead of executing immediately |
| **Status Bar Indicator** | Shows pending count, click to open review modal |
| **Deletion Review Modal** | Per-item Delete/Keep/Restore buttons, batch operations |
| **Task Restore Modal** | Copy original task line to clipboard for re-pasting |
| **Fresh Start Integration** | Paired delete+create display with calendar flow visualization |
| **Risk Indicators** | 👥 attendees, 📹 conference link, 📝 custom description |
| **High-Risk Styling** | Red border and background for events with valuable data |
| **Recently Deleted Recovery** | Event snapshots stored for 30 days, restore creates new event |
| **Power User Mode** | Toggle to disable Safety Net for experienced users |
| **Warning Modals** | Fresh Start warning, Power User warning |

### Implementation Phases

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | Data structures, safeMode setting, status bar | ✓ Complete |
| Phase 2 | Deletion review modal, task restore modal | ✓ Complete |
| Phase 3 | Fresh Start integration, calendar rerouting warnings | ✓ Complete |
| Phase 4 | Event details fetching, risk indicators | ✓ Complete |
| Phase 5 | Recently deleted section, event restore from snapshots | ✓ Complete |
| Phase 6 | Audit trail, Power User mode, documentation | ✓ Complete |

### Files Created

| File | Purpose |
|------|---------|
| `src/deletionReviewModal.ts` | Main review interface for pending deletions |
| `src/taskRestoreModal.ts` | Task line recovery via copy-to-clipboard |
| `src/freshStartWarningModal.ts` | Warning when enabling Fresh Start mode |
| `src/powerUserWarningModal.ts` | Warning when disabling Safe Mode |
| `src/eventRestoreModal.ts` | Restore deleted event from snapshot |
| `docs/SAFETY-NET.md` | Comprehensive user documentation |

### Files Modified

| File | Changes |
|------|---------|
| `main.ts` | Safety Net settings, modals, status bar, deletion handling |
| `src/syncManager.ts` | PendingDeletion/DeletedEventRecord interfaces, buildChangeSet safeMode param |
| `src/batchApi.ts` | DivertedDeletion interface, calendar grouping for batches |
| `src/googleCalendar.ts` | getEvent() method, expanded GoogleEvent interface |
| `styles.css` | All Safety Net UI styling |
| `README.md` | Safety Net documentation section |

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default mode | Safe Mode ON | Protect users by default |
| Completed task deletes | No Safety Net | Explicit user action (checkbox + setting) |
| Task restoration | Copy to clipboard | Simple, reconnects via same task ID on next sync |
| Event restoration | New event from snapshot | Best effort recovery with clear limitations |
| Risk detection | Attendees, conference, description | Most valuable data that can't be recreated |

### User-Facing Features

1. **Status bar shows pending count** - Click to review
2. **Review modal** - See what's being deleted and why
3. **Per-item actions** - Delete Event, Keep Event, Restore
4. **Batch actions** - Delete All, Keep All
5. **Risk warnings** - Visual indicators for high-value events
6. **Task recovery** - Copy original task line to paste back
7. **Event recovery** - Restore from 30-day snapshot history
8. **Settings** - Safe Mode toggle with Power User option

### Documentation

- README.md updated with Safety Net section
- `docs/SAFETY-NET.md` created with full user guide
- `docs/Safety Net Feature.md` contains development handoff log

---

## Session: January 4, 2026 (Session 11) - Phase 10 COMPLETE: Batch API Calls

### Session Summary

Implemented batch API calls for Google Calendar operations, dramatically improving sync performance. Instead of 100 sequential requests taking 30-50 seconds, syncing 100 events now completes in 2-5 seconds with a single batch request.

### What Was Done

| Item | Status | Details |
|------|--------|---------|
| **New File: src/batchApi.ts** | ✅ Complete | |
| BatchCalendarApi class | Done | Handles batch request building and response parsing |
| Multipart MIME body builder | Done | Constructs proper `multipart/mixed` requests |
| Batch response parser | Done | Parses multipart responses, maps to operation IDs |
| Chunking (50 ops/batch) | Done | Splits large syncs into multiple batches |
| **ChangeSet Pattern** | ✅ Complete | |
| ChangeSet interface | Done | Collects all operations before batching |
| ChangeSetOperation interface | Done | Unified representation of create/update/delete/move/complete/get |
| buildChangeSet() in SyncManager | Done | Converts diff + completed tasks → ChangeSet |
| **Refactored syncTasks()** | ✅ Complete | |
| Collect-then-batch pattern | Done | All operations collected first, then batched together |
| Pre-fetch for updates | Done | Batch GET for events needing existing data |
| Existence verification batched | Done | Unchanged events verified via batch GET |
| Result processing | Done | Maps batch results back to operations, updates sync records |
| **Smart Retry** | ✅ Complete | |
| 500/503 detection | Done | Recognizes server errors |
| 5-second wait | Done | Pauses before retry |
| Single retry | Done | Retries once, then fails gracefully |
| **Helper Methods** | ✅ Complete | |
| executeBatchWithRetry() | Done | Wraps batch execution with smart retry |
| logOperationFromBatch() | Done | Logs operation results from batch responses |
| isRetryableStatusCode() | Done | Checks if HTTP status is retryable |

### Performance Improvement

| Scenario | Before (Sequential) | After (Batch) |
|----------|---------------------|---------------|
| 10 events | ~3-5 seconds | <1 second |
| 50 events | ~15-25 seconds | ~1-2 seconds |
| 100 events | ~30-50 seconds | ~2-5 seconds |

### Files Modified/Created

| File | Changes |
|------|---------|
| `src/batchApi.ts` | NEW - BatchCalendarApi, ChangeSet, batch building/parsing |
| `src/syncManager.ts` | Added buildChangeSet() method, imported batchApi types |
| `main.ts` | Imported batchApi, added batchApi property, refactored syncTasks(), added helper methods |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Batch size | 50 operations | Safe margin below Google's 100 limit |
| Retry strategy | 5s wait, single retry | Matches existing offline pattern |
| Pre-fetch approach | Batch GET before batch PUT | Preserves user edits on updates |
| Existence check | Batch GET for unchanged | Avoids N sequential existence checks |

### Technical Notes

- All operation types (create, update, delete, move, complete) are batched together
- Operations that need existing event data (updates, completes) trigger a preliminary batch GET
- Failed operations are queued for retry using existing PendingOperation system
- Smart retry only triggers on 500/503 server errors, not on individual operation failures

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
Chronos - Phase 18: Recurring Task Succession

**Directory:** C:\Users\bwales\projects\obsidian-plugins\Chronos
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\
**GitHub:** https://github.com/thuban87/Chronos (public)
**Current branch:** main
**Version:** 1.5.0

**CRITICAL: Read these docs FIRST before writing any code:**
1. `docs/Handoff Log.md` - Current state and recent changes
2. `docs/ADR Priority List - Chronos.md` - Phase 18 requirements
3. `docs/Recurring Task Succession - Implementation Guide.md` - DETAILED IMPLEMENTATION PLAN

---

## Your Task: Implement Phase 18 - Recurring Task Succession

There's a HIGH PRIORITY BUG: When a user completes a recurring task, duplicate Google Calendar events are created. The Tasks plugin creates a new task instance, and Chronos syncs it as a new recurring series.

**The solution is fully designed and documented.** Your job is to implement it following the guide.

---

## The Problem

1. Task with 🔁 syncs to Google as recurring event (RRULE)
2. User completes task → Tasks plugin creates new instance below
3. Chronos sees new task → creates ANOTHER recurring event
4. Result: Duplicate recurring series

## The Solution (Summary)

Add a "Third Reconciliation Pass" in `computeMultiCalendarSyncDiff()` that:
1. Detects when a new task is the "successor" to a completed recurring task
2. Matches by: same title + same time + same file + has recurrence + future date
3. Transfers the sync record (same eventId) instead of creating new event
4. Defers check for 2 sync cycles to handle race condition with Tasks plugin
5. Shows modal if no successor found (user chooses: delete series or keep)

---

## Key Files to Modify/Create

| File | Action |
|------|--------|
| `src/syncManager.ts` | Add recurrenceRule to SyncedTaskInfo, add pendingSuccessorChecks queue, add third reconciliation pass |
| `src/seriesDisconnectionModal.ts` | **CREATE** - Modal for disconnected series |
| `src/recurrenceChangeModal.ts` | **CREATE** - Modal for pattern changes |
| `main.ts` | Add processPendingSuccessorChecks(), wire up modals |
| `styles.css` | Add modal styles |

---

## Prerequisites

User must change Tasks plugin setting: new tasks appear BELOW completed tasks (not above).

---

## Testing Checklist

1. Create recurring task, sync, complete it
2. Verify NO duplicate event created
3. Verify new task inherits same eventId
4. Test edge cases: rename new task, delete new task, change pattern

---

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
