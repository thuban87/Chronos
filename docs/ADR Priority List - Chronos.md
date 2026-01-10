# ADR Priority List - Chronos

**Last Updated:** January 9, 2026
**Version:** 0.1.0
**Status:** Active Development - Phase 16 Complete (Exclusion Rules)

---

## Phase 1: Foundation - COMPLETE ✓

**Goal:** Plugin loads, has settings, can authenticate with Google.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Plugin scaffold & build setup | ✓ Complete | TypeScript, esbuild, manifest.json |
| 2 | Settings infrastructure | ✓ Complete | Settings class, data persistence |
| 3 | Settings UI tab | ✓ Complete | Basic configuration interface |
| 4 | Google Cloud Console setup | ✓ Complete | Project, OAuth consent, credentials |
| 5 | OAuth 2.0 implementation | ✓ Complete | Localhost callback server |
| 6 | Token storage & refresh | ✓ Complete | Secure storage in plugin data |
| 7 | "Connect to Google" button | ✓ Complete | Settings UI trigger for OAuth flow |
| 8 | Connection status display | ✓ Complete | Show connected account in settings |

**Phase 1 Deliverable:** User can connect their Google account and plugin stores tokens. ✓

---

## Phase 2: Task Parsing - COMPLETE ✓

**Goal:** Plugin can find and parse tasks with dates/times.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 9 | Tasks plugin format parser | ✓ Complete | Parse `📅 YYYY-MM-DD ⏰ HH:mm` |
| 10 | Vault-wide task scanning | ✓ Complete | Find all qualifying tasks |
| 11 | Task data structure | ✓ Complete | Internal representation of parsed tasks |
| 12 | Filtering logic | ✓ Complete | Uncompleted, has date, optional time |

**Additional features implemented:**
- All-day events for date-only tasks (no `⏰` required)
- No-sync marker `🚫` to exclude tasks
- Date/time input modal (command palette)
- Click-to-open in task scan modal

**Phase 2 Deliverable:** Plugin can list all sync-eligible tasks in vault. ✓

---

## Phase 3: Calendar Event Creation - COMPLETE ✓

**Goal:** Plugin can create events in Google Calendar.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 13 | Google Calendar API client | ✓ Complete | Initialize with auth tokens |
| 14 | Calendar list fetch | ✓ Complete | Get user's calendars for selection |
| 15 | Calendar selection setting | ✓ Complete | Dropdown in settings UI |
| 16 | Event creation | ✓ Complete | Create event from task data |
| 17 | Reminder configuration | ✓ Complete | Default reminder times setting |
| 18 | Event duration setting | ✓ Complete | Default duration (e.g., 30 min) |

**Additional features implemented:**
- All-day event creation (date-only tasks)
- Manual sync command in command palette
- Event description includes source file path

**Phase 3 Deliverable:** Tasks with times appear in Google Calendar with reminders. ✓

---

## Phase 4: Sync Infrastructure - COMPLETE ✓

**Goal:** Plugin can track synced tasks and detect changes.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 19 | Task ID generation | ✓ Complete | Hash of filePath + title + date |
| 20 | Sync data structure | ✓ Complete | Task ID → Event ID mapping |
| 21 | Content hashing | ✓ Complete | Detect task text changes |
| 22 | Interval-based sync trigger | ✓ Complete | Configurable interval (default 10 min) |
| 23 | Change detection | ✓ Complete | Compare current vs last synced state |
| 24 | Event update API call | ✓ Complete | Update existing calendar event |

**Additional features implemented:**
- External deletion detection (recreates events deleted in Google Calendar)
- SyncManager class for all sync state management

**Phase 4 Deliverable:** Editing a task updates the calendar event on next sync. ✓

---

## Phase 5: Task Lifecycle - COMPLETE ✓

**Goal:** Handle completed and deleted tasks.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 25 | Completed task detection | ✓ Complete | `- [x]` marks task done |
| 26 | Completion behavior setting | ✓ Complete | Delete or mark as completed |
| 27 | Mark complete feature | ✓ Complete | Appends "- Completed MM-DD-YYYY, HH:mm" |
| 28 | Event deletion | ✓ Complete | Remove calendar event option |
| 29 | Deleted task detection | ✓ Complete | Task ID no longer in vault |
| 30 | Orphan event cleanup | ✓ Complete | Delete events for deleted tasks |

**Phase 5 Deliverable:** Completing or deleting a task handles the calendar event appropriately. ✓

---

## Phase 6: Polish & UX - COMPLETE ✓

**Goal:** Production-ready with good error handling.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 31 | Sync status indicator | ✓ Complete | Status bar with synced count, last sync |
| 32 | Manual sync command | ✓ Complete | Force sync via command palette |
| 33 | Error notifications | ✓ Complete | Actionable messages with directions |
| 34 | Auth expiry handling | ✓ Complete | Token refresh with clear UX |
| 35 | Offline queue | ✓ Complete | Queue changes, auto-retry (5 attempts) |
| 36 | Console log cleanup | ✓ Complete | Removed debug logs |
| 37 | README.md | ✓ Complete | Full user documentation |
| 38 | LICENSE | ✓ Complete | MIT License |
| 39 | Task overview modal | ✓ Complete | 3 sections: unsynced/synced/completed |
| 40 | AI task format docs | ✓ Complete | CLAUDE.md and GEMINI.md updated |

**Phase 6 Deliverable:** Plugin is polished and ready for personal use / beta. ✓

---

## Pre-Release Checklist (Future Reference)

For whenever release is considered - no timeline, just reference material:

### OAuth Architecture (Updated Session 4)

**Current Approach:** User-provided credentials

Each user creates their own Google Cloud project and provides their own Client ID and Client Secret. This approach:
- Complies with Google ToS (credentials not publicly shared)
- Eliminates shared API quota concerns
- Matches pattern used by other Obsidian Google plugins (obsidian-google-calendar)
- No OAuth verification needed from plugin developer

**User Setup Requirements:**
- Create Google Cloud project (free)
- Enable Google Calendar API
- Configure OAuth consent screen (can stay in "Testing" mode for personal use)
- Create Desktop app OAuth credentials
- Add themselves as test user (if in Testing mode)

**Trade-off:** More setup friction for users, but better security and no shared liability.

### Plugin Submission Checklist

| Item | Status |
|------|--------|
| User-provided OAuth credentials | ✓ Complete |
| README.md with setup instructions | ✓ Complete |
| LICENSE file (MIT) | ✓ Complete |
| manifest.json version updated | Pending |
| Console.log statements removed | ✓ Complete |
| Performance optimization (metadataCache) | ✓ Complete |
| Tested on Windows | ✓ Complete |
| Tested on Mac | Pending |
| Tested on mobile | Pending |
| Beta testing (BRAT) | Pending |
| Submit PR to obsidian-releases | Pending |

---

## Phase 7: Agenda & Timezone - COMPLETE ✓

**Goal:** Better time display and daily overview.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 41 | Daily agenda sidebar | ✓ Complete | Shows all Google Calendar events (not just Chronos-synced), day navigation, event colors |
| 42 | Time zone setting | ✓ Complete | Dropdown with System Local + 35 common IANA timezones |

**Phase 7 Deliverable:** Users can see today's events at a glance and configure timezone explicitly. ✓

---

## Phase 8: Multi-Calendar & Event Routing - COMPLETE ✓

**Goal:** Route tasks to different calendars by tag, with user control over what happens when routing changes.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 43 | Tag-to-calendar mapping UI | ✓ Complete | Settings UI for adding/removing tag→calendar mappings |
| 44 | Multi-calendar sync logic | ✓ Complete | Each task routes to calendar based on its tags |
| 45 | Default calendar fallback | ✓ Complete | Tasks with no/unmapped tags use default calendar |
| 46 | Case-insensitive tag matching | ✓ Complete | #Work matches #work mappings |
| 47 | Event Routing Behavior modes | ✓ Complete | Preserve (move), Keep Both (duplicate), Fresh Start (delete+create) |
| 48 | Calendar change warning modal | ✓ Complete | Shows event count, mode description, processing time |
| 49 | Reroute failure modal | ✓ Complete | Prompts when source calendar inaccessible |
| 50 | Task ID reconciliation fix | ✓ Complete | Title-based ID + two-pass line/title reconciliation |

**Additional features:**
- Multiple mapped tags warning (uses default calendar with notice)
- Tags stripped from event titles
- Google Calendar moveEvent() API for Preserve mode
- Processing time warning in modal
- Reload warning for mode changes
- Updates preserve user-edited event data (description, location, attendees)
- Duplicate task detection with warning
- Time included in Task ID (allows "Focus block" at different times)

**Phase 8 Deliverable:** Tasks tagged #work go to Work calendar, with user control over what happens when tags/calendars change. ✓

---

## Phase 9: Power User Features - COMPLETE ✓

**Goal:** Transparency and customization for power users.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 51 | Sync log/history | ✓ Complete | Batched by sync run with collapsible cards, summary counts |
| 52 | Per-task reminder override | ✓ Complete | `🔔 30,10` syntax + modal UI with toggle and input fields |

**Additional polish (Session 7):**
- Sync history groups operations by batch with collapsible cards
- Custom reminders UI in date/time modal (toggle + 2 input fields)

**Phase 9 Deliverable:** Users can debug sync issues and customize reminders per-task. ✓

---

## Phase 10: Batch API Calls - COMPLETE ✓

**Goal:** Dramatically improve sync performance for users with many events.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 53 | Batch request builder | ✓ Complete | Multipart MIME body construction in batchApi.ts |
| 54 | Batch response parser | ✓ Complete | Parses multipart response, maps to operation IDs |
| 55 | Refactor sync to collect-then-batch | ✓ Complete | ChangeSet pattern, buildChangeSet() method |
| 56 | Partial failure handling | ✓ Complete | Individual results processed, failures queued for retry |
| 57 | Smart retry (500/503) | ✓ Complete | 5-second wait, single retry on server errors |

**Performance Improvement:**
- Before: 100 events = 100 sequential requests = 30-50 seconds
- After: 100 events = 2 batch requests (50 each) = 2-5 seconds

**Implementation Details:**
- New file: `src/batchApi.ts` with BatchCalendarApi class
- Batch size: 50 operations (safe margin below Google's 100 limit)
- Pre-fetch pattern: Batch GET for events needing existing data (updates, completes)
- Existence verification: Batched GET for unchanged events

**Phase 10 Deliverable:** Large calendar migrations complete in seconds instead of minutes. ✓

---

## Phase 11: Safety Net - COMPLETE ✓

**Goal:** Protect against accidental data loss by requiring approval before deletions.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 58 | Pending deletions queue | ✓ Complete | `pendingDeletions` array in sync data |
| 59 | Status bar indicator | ✓ Complete | Shows count, click to review |
| 60 | Deletion review modal | ✓ Complete | Delete/Keep/Restore per item, batch operations |
| 61 | Task restore modal | ✓ Complete | Copy task line to clipboard for re-pasting |
| 62 | Fresh Start integration | ✓ Complete | Paired delete+create display, warnings |
| 63 | Event details & risk display | ✓ Complete | Fetch attendees, conference links, descriptions |
| 64 | High-risk indicators | ✓ Complete | Visual warnings for events with valuable data |
| 65 | Recently deleted recovery | ✓ Complete | Event snapshots, restore from history |
| 66 | Auto-prune (30 days) | ✓ Complete | Clean up old deletion records |
| 67 | Power User mode | ✓ Complete | Toggle to disable Safety Net |
| 68 | Warning modals | ✓ Complete | Fresh Start warning, Power User warning |

**Key Features:**
- Deletions queue instead of executing immediately (Safe Mode default)
- Review modal with per-item and batch actions
- Risk indicators: 👥 attendees, 📹 conference link, 📝 custom description
- Task line restoration via copy-to-clipboard
- Event restoration from 30-day snapshot history
- Power User mode for experienced users who want automatic deletions

**New Files:**
- `src/deletionReviewModal.ts` - Main review interface
- `src/taskRestoreModal.ts` - Task line recovery
- `src/freshStartWarningModal.ts` - Calendar rerouting warning
- `src/powerUserWarningModal.ts` - Safe Mode disable warning
- `src/eventRestoreModal.ts` - Event snapshot restoration
- `docs/SAFETY-NET.md` - User documentation

**Phase 11 Deliverable:** Users are protected from accidental deletions with full visibility and recovery options. ✓

---

## Phase 12: External Event Handling - COMPLETE ✓

**Goal:** Give users control over what happens when events are moved/deleted in Google Calendar.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 69 | External Event Behavior setting | ✓ Complete | Dropdown: ask/sever/recreate |
| 70 | Pending severances queue | ✓ Complete | `pendingSeverances` array in sync data |
| 71 | Severed task tracking | ✓ Complete | Sync record flag + legacy array |
| 72 | 404 handling in sync logic | ✓ Complete | Routes to ask/sever/recreate based on setting |
| 73 | Status bar indicator | ✓ Complete | Shows pending severance count |
| 74 | Severance review modal | ✓ Complete | Per-item Sever/Recreate, batch actions |
| 75 | Sever operation logging | ✓ Complete | 🔗 icon in sync history |
| 76 | Auto-unsever on edit | ✓ Complete | Editing severed task clears flag, creates new event |

**Key Features:**
- Three behavior modes: Ask me each time (default), Sever link, Recreate event
- Review modal for "ask" mode with per-item and batch actions
- Severed tasks keep sync records for reconciliation
- Editing a severed task's title/date/time creates a fresh sync

**New Files:**
- `src/severanceReviewModal.ts` - Review interface for disconnected events

**Phase 12 Deliverable:** Users have full control over how moved/deleted events are handled. ✓

---

## Phase 13: Custom Duration - COMPLETE ✓

**Goal:** Allow per-task custom durations.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 77 | Duration parsing (`⏱️`) | ✓ Complete | Supports hours/minutes (⏱️ 2h, ⏱️ 30m, ⏱️ 1h30m) |
| 78 | Duration in date/time modal | ✓ Complete | Optional duration field in modal UI |
| 79 | Duration passed to calendar API | ✓ Complete | Creates events with correct end time |

**Phase 13 Deliverable:** Users can set custom durations per-task with ⏱️ syntax. ✓

---

## Phase 14: Recurring Events - COMPLETE ✓

**Goal:** Support recurring calendar events using Tasks plugin 🔁 syntax.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 80 | Recurrence parser | ✓ Complete | `src/recurrenceParser.ts` - Converts 🔁 to RRULE |
| 81 | RRULE integration | ✓ Complete | Pass recurrence rule to Google Calendar API |
| 82 | Modal UI for recurrence | ✓ Complete | Frequency, interval, weekday selector |
| 83 | Recurring delete modal | ✓ Complete | Options for completed recurring tasks |
| 84 | Smart completion handling | ✓ Complete | Different behavior for Safety Net ON vs OFF |
| 85 | Sync info tracking | ✓ Complete | `isRecurring` flag in sync data |

**Supported Patterns:**
- Simple: `every day`, `every week`, `every month`, `every year`
- With interval: `every 2 days`, `every 3 weeks`
- Weekdays: `every monday`, `every monday, wednesday, friday`

**Phase 14 Deliverable:** Recurring events work with 🔁 syntax and handle completion gracefully. ✓

---

## Phase 15: Multi-Calendar Agenda & Import - COMPLETE ✓

**Goal:** Show events from multiple calendars in agenda and import to notes.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 86 | Agenda calendar selection | ✓ Complete | Checkbox UI in settings for each calendar |
| 87 | Multi-calendar fetch | ✓ Complete | Fetches events from all selected calendars |
| 88 | Calendar color dots | ✓ Complete | Each event shows source calendar color |
| 89 | Import command | ✓ Complete | "Import agenda to current file" command |
| 90 | Import button in sidebar | ✓ Complete | 📋 button for quick import |
| 91 | Import format options | ✓ Complete | List, Table, Simple (no links) |

**Key Features:**
- Select/deselect any calendar (including default)
- Color dots distinguish calendar sources
- Calendar name shown on hover
- Import uses agenda's current date
- Three import formats with setting

**Phase 15 Deliverable:** Agenda shows all selected calendars with easy import to notes. ✓

---

## Phase 16: Exclusion Rules - COMPLETE ✓

**Goal:** Allow users to exclude folders/files from sync.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 92 | Exclusion settings | ✓ Complete | `excludedFolders` and `excludedFiles` arrays |
| 93 | Folder exclusion logic | ✓ Complete | Excludes folder and all subfolders |
| 94 | File exclusion logic | ✓ Complete | Excludes specific files with path normalization |
| 95 | Autocomplete inputs | ✓ Complete | Folder/file suggesters with dropdown |
| 96 | Synced task modal | ✓ Complete | Asks Keep/Delete when excluding synced tasks |
| 97 | Path normalization | ✓ Complete | Handles spaces, slashes, case differences |

**Key Features:**
- Folder exclusion includes all subfolders
- Autocomplete for easy path entry
- Modal when excluding already-synced tasks
- Options: Keep events in calendar or delete them
- Works with paths containing spaces

**Phase 16 Deliverable:** Users can exclude folders/files from sync with full control over existing events. ✓

---

## Maybe Someday (Post-BRAT)

Features that are valuable but complex or low priority. May implement based on user demand.

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Two-way sync (Calendar → Obsidian) | High | High | Major feature, needs conflict resolution, refactoring |
| EditorSuggest `@cal` trigger | Medium | Medium | Type-to-insert; hotkey modal works well enough |
| ~~Recurring event support~~ | ~~Medium~~ | ~~High~~ | ✓ Completed in Phase 14 |
| Calendar event colors | Low | Low | Color by tag or priority |
| Glob pattern exclusions | Low | Medium | Support `*.template.md` or `Archive/**` patterns |
| Include-only mode | Low | Medium | Only sync from specific folders (inverse of exclusions) |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| ~~Debug console.logs~~ | ~~Low~~ | ✓ Fixed - Removed |
| ~~No duplicate prevention~~ | ~~High~~ | ✓ Fixed - Task ID tracking |
| ~~scanVault reads every file~~ | ~~High~~ | ✓ Fixed - Uses metadataCache to skip files without tasks |
| ~~Embedded OAuth credentials~~ | ~~High~~ | ✓ Fixed - User-provided credentials |
| ~~Task ID uses line number (wrong)~~ | ~~High~~ | ✓ Fixed - Title-based ID + two-pass reconciliation |
| Accidental completion edge case | Low | Unchecking creates duplicate (user can delete manually) |
| Severed task edit-back edge case | Medium | When severed task is edited, then edited back to original time, reconciliation doesn't detect the change and task remains severed. Workaround: edit to a different time than original. |

---

## Known Limitations

Document these for users:

| Limitation | Explanation |
|------------|-------------|
| Rename + Move = Recreate | Renaming a task AND moving it to a different line simultaneously will delete the old event and create a new one. This is rare and essentially a "new task" anyway. |
| Mode change requires reload | Changing the Event Routing Behavior mode requires reloading Obsidian to take effect. |
| True duplicates not supported | Two tasks with identical title, date, time, and file cannot both sync. First occurrence wins, second is skipped with a warning. |
| Legacy sync data | Tasks synced before Session 10 may lack lineNumber/time fields, causing a one-time delete+create on first edit. Subsequent edits work correctly. |

---

## Development Notes

- **Environment:** Windows 11
- **Source code:** `C:\Users\bwales\projects\obsidian-plugins\chronos\`
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\`
- **GitHub:** https://github.com/thuban87/Chronos (public)
- **Sibling project:** TagForge (`C:\Users\bwales\projects\obsidian-plugins\tagforge\`)
- **Build:** TypeScript + esbuild (copied setup from TagForge)

---

## Reference Material

- **Tasks Plugin Docs:** https://publish.obsidian.md/tasks/
- **Google Calendar API:** https://developers.google.com/calendar/api/v3/reference
- **Google Calendar Batch API:** https://developers.google.com/calendar/api/guides/batch
- **Google OAuth 2.0:** https://developers.google.com/identity/protocols/oauth2
- **Obsidian Plugin API:** https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- **Sample plugin:** https://github.com/obsidianmd/obsidian-sample-plugin

---

## Difficulty Estimates (Final)

| Phase | Estimated Time | Actual Time | Notes |
|-------|---------------|-------------|-------|
| Phase 1 (Foundation + OAuth) | 4-6 hours | ~2 hours | OAuth was smoother than expected |
| Phase 2 (Task Parsing) | 1-2 hours | ~1.5 hours | Added all-day events, no-sync marker |
| Phase 3 (Event Creation) | 2-3 hours | ~1.5 hours | API worked well once scope was fixed |
| Phase 4 (Sync Infrastructure) | 2-3 hours | ~2 hours | External deletion detection added |
| Phase 5 (Task Lifecycle) | 1-2 hours | ~1 hour | Completion options added |
| Phase 6 (Polish) | 2-4 hours | ~2 hours | Modal redesign, offline queue |
| **Total MVP** | **12-20 hours** | **~10 hours** | Completed ahead of schedule |
