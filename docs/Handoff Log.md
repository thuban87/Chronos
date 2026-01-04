# Chronos Handoff Log

**Last Updated:** January 4, 2026
**Current Phase:** Active Development - Phases 7-9 Complete
**Current Branch:** feature/phase-9-qol-upgrades-2
**Version:** 0.1.0

---

## Session: January 4, 2026 (Session 8) - Phase 8 Complete: Multi-Calendar Support

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

## Session: January 3, 2026 (Session 6) - Phase 9 Complete: Sync Log & Reminder Override

### Session Summary

Completed Phase 9 with sync history logging and per-task reminder override. Also fixed calendar color display in agenda sidebar and added timezone abbreviations.

### What Was Done

| Item | Details |
|------|---------|
| **Bug Fix: Calendar Colors** | |
| Calendar color fallback | Events now use calendar's default color when no individual color set |
| Added getCalendarColor() | Fetches selected calendar's background color |
| Reload on calendar change | Colors refresh when user changes target calendar |
| **Timezone Abbreviations** | |
| Updated dropdown | All timezones now show abbreviations (e.g., "America/Chicago (CST/CDT)") |
| **Sync Log/History (Phase 9.1)** | |
| SyncLogEntry interface | Type, timestamp, task title, file path, success/error |
| Log in SyncManager | Stores last 100 operations, newest first |
| SyncLogModal | Shows history with icons, timestamps, error messages |
| Clear log button | User can clear history |
| Command | "Chronos: View sync history" |
| **Per-Task Reminder Override (Phase 9.2)** | |
| 🔔 syntax parsing | Parse `🔔 30,10` or `🔔 5` from task lines |
| reminderMinutes field | Added to ChronosTask interface |
| Event creation updated | Uses task-specific reminders when set |
| Stripped from title | 🔔 markers removed from event title |

### Files Modified

| File | Changes |
|------|---------|
| `src/syncManager.ts` | Added SyncLogEntry interface, syncLog array, logOperation(), getSyncLog(), clearSyncLog() |
| `src/taskParser.ts` | Added reminderMinutes field, REMINDER_PATTERN, parsing logic |
| `src/agendaView.ts` | Added calendarColor, getCalendarColor dependency, reloadColors() |
| `main.ts` | SyncLogModal, logging calls in syncTasks, reminder override in event creation, timezone abbreviations |
| `styles.css` | Sync log modal styles |
| `CLAUDE.md` | Added 🔔 syntax documentation |
| `docs/ADR Priority List - Chronos.md` | Phase 9 marked complete |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Log limit | 100 entries | Balance between history and storage |
| Reminder syntax | 🔔 30,10 | Matches emoji pattern, comma-separated is clear |
| Log display | Newest first | Most relevant operations at top |

### Testing Notes

- View sync history: Ctrl+P → "Chronos: View sync history"
- Test custom reminders: Create task with `🔔 5` for 5-minute reminder
- Verify calendar colors in agenda sidebar

---

## Session: January 3, 2026 (Session 5) - Phase 7 Complete: Agenda Sidebar & Timezone

### Session Summary

Completed Phase 7 with the agenda sidebar (from previous session) and the timezone setting. Users can now view all their Google Calendar events in a sidebar and explicitly configure their timezone.

### What Was Done

| Item | Details |
|------|---------|
| **Daily Agenda Sidebar (Phase 7.1)** | |
| Agenda ItemView | New `src/agendaView.ts` with sidebar view showing day's events |
| Day navigation | Prev/next buttons, clickable date to return to today |
| Event colors | Fetches Google Calendar color palette, applies to event cards |
| Event links | Google Calendar link (prominent) + source note link (for Chronos tasks) |
| Auto-refresh | Configurable interval (default 10 min) |
| Command | "Chronos: Toggle today's agenda sidebar" |
| **Timezone Setting (Phase 7.2)** | |
| Timezone dropdown | Added to Sync Settings section |
| System Local option | Uses `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| IANA timezones | 35+ common timezones organized by region (Americas, Europe, Asia, Pacific, UTC) |
| Live refresh | Agenda sidebar refreshes when timezone changed |

### Files Created/Modified

| File | Changes |
|------|---------|
| `src/agendaView.ts` | NEW - Sidebar ItemView for daily agenda |
| `src/googleCalendar.ts` | Added listEvents(), getEventColors(), colorId/backgroundColor to GoogleEvent |
| `main.ts` | View registration, fetchEventsForDate(), timezone dropdown in settings, agenda refresh interval setting |
| `styles.css` | Agenda sidebar styling |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Agenda shows ALL events | Not just Chronos-synced | Users want to see their full day at a glance |
| Timezone list | 35 common IANA zones | Balance between comprehensive and not overwhelming |
| System Local default | Yes | Most users want events in their local time |

### Testing Notes

- Toggle sidebar: Ctrl+P → "Chronos: Toggle today's agenda sidebar"
- Change timezone in Settings → Chronos → Sync Settings → Timezone
- Verify events display in correct timezone
- Verify new events are created with correct timezone

---

## Session: January 3, 2026 (Session 4) - Security & Performance Improvements

### Session Summary

Security and performance session addressing concerns from Gemini code review. Major change: switched from embedded OAuth credentials to user-provided credentials (each user creates their own Google Cloud project). Also optimized vault scanning to use metadataCache for better performance on large vaults.

### What Was Done

| Item | Details |
|------|---------|
| **Security: User-Provided OAuth Credentials** | |
| Removed embedded secrets | Deleted hardcoded CLIENT_ID and CLIENT_SECRET from googleAuth.ts |
| Added credential settings | New fields in settings for user's own Client ID and Client Secret |
| Updated GoogleAuth class | Now accepts credentials via constructor, has updateCredentials() method |
| Settings UI flow | Credentials section with setup instructions, Connect button appears after both entered |
| Auto-refresh fix | Settings page refreshes when both credentials entered (UX improvement) |
| README setup guide | Full step-by-step Google Cloud project setup (5 sections) |
| **Performance: metadataCache Optimization** | |
| Added fileHasTasks() method | Uses metadataCache to check if file has checkboxes before reading |
| Optimized scanVault() | Skips files without tasks entirely, only reads files that might have sync-eligible tasks |
| **Documentation** | |
| Privacy section updated | Added token storage warning about not syncing data.json |
| Setup guide | Complete Google Cloud setup instructions in README |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Credential approach | User-provided (not embedded) | ToS compliance, no shared quota, matches other Obsidian Google plugins |
| metadataCache usage | Quick filter before file read | Major performance win for vaults with many non-task files |
| Client Secret field | Password type input | Some obscurity in settings UI |

### Files Modified

| File | Changes |
|------|---------|
| `src/googleAuth.ts` | Removed hardcoded credentials, added constructor with credentials, added updateCredentials() and hasCredentials() methods |
| `main.ts` | Added googleClientId/googleClientSecret to settings, added hasCredentials() and getAuthCredentials() helpers, new renderCredentialsSection() in settings UI |
| `src/taskParser.ts` | Added fileHasTasks() using metadataCache, updated scanVault() to skip files without tasks |
| `styles.css` | Added .chronos-credentials-desc and .chronos-credentials-warning styles |
| `README.md` | Complete rewrite of Setup section with Google Cloud instructions, updated Privacy section |

### Why User-Provided Credentials?

Gemini's review raised concerns about embedded OAuth secrets. Research revealed:
- Google docs say desktop apps "cannot keep secrets" (client_secret is optional for installed apps)
- However, Google ToS still requires treating credentials as confidential
- Other Obsidian Google plugins (obsidian-google-calendar) require user-provided credentials
- User-provided approach eliminates: quota sharing, liability risk, credential theft concerns

### Performance Impact

**Before:** Every sync reads every markdown file in vault
**After:** Uses metadataCache to check for tasks first, only reads files that have checkboxes

For a vault with 1,000 notes where 50 have tasks: reads 50 files instead of 1,000.

### Known Issues / Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| EditorSuggest `@cal` trigger | Low | Revisit for marketplace release |
| Credential flow UX | Low | User tested and working, but may need refinement based on feedback |

### Testing Notes

- User successfully migrated using same Google Cloud project
- Sync data preserved after re-authentication
- New user flow needs testing with brother (scheduled)

---

## Session: January 3, 2026 (Session 3) - Phases 4, 5, 6 Implementation

### Session Summary

Major implementation session completing all MVP phases. Plugin now has full sync infrastructure with duplicate prevention, task lifecycle management (completion/deletion handling), and polished UX including status bar, offline queue, and redesigned task overview modal.

### What Was Done

| Item | Details |
|------|---------|
| **Phase 4: Sync Infrastructure** | |
| Task ID generation | Hash-based (file path + title + date) |
| Sync data structure | Task ID → Event ID mapping with content hash |
| Content hashing | Detect task changes for updates |
| Change detection | Compare current vs synced state |
| Event update API | Update existing events when tasks change |
| Interval-based sync | Auto-sync every N minutes (configurable) |
| External deletion detection | Recreate events deleted in Google Calendar |
| **Phase 5: Task Lifecycle** | |
| Completion behavior setting | Delete or mark events as completed |
| Mark complete feature | Appends "- Completed MM-DD-YYYY, HH:mm" to event title |
| Delete on complete | Removes event from calendar |
| Orphan cleanup | Delete events when tasks are deleted from vault |
| **Phase 6: Polish & UX** | |
| Console log cleanup | Removed debug logging |
| Error notifications | Actionable messages with directions |
| Status bar indicator | Shows synced count, pending, last sync time |
| Offline queue | Failed operations queued and auto-retried |
| README.md | Full user documentation |
| LICENSE | MIT License |
| Task overview modal | Redesigned with 3 sections (unsynced/synced/completed) |
| AI task format docs | Updated CLAUDE.md and created GEMINI.md |

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Task ID stability | Hash of filePath + title + date | Survives line number changes |
| Completion default | Mark as completed (keep event) | Historical record preferred |
| External deletion | Recreate events | Ensures tasks always have reminders |
| Offline retry limit | 5 attempts | Prevents infinite retry loops |

### Files Created/Modified

| File | Purpose |
|------|---------|
| `src/syncManager.ts` | NEW - Task tracking, content hashing, offline queue |
| `main.ts` | Sync logic, status bar, improved modal |
| `src/googleCalendar.ts` | Added eventExists, markEventCompleted methods |
| `src/taskParser.ts` | Added includeCompleted parameter |
| `styles.css` | Collapsible sections, sort controls, status styling |
| `README.md` | NEW - Full user documentation |
| `LICENSE` | NEW - MIT License |
| `CLAUDE.md` | Added task format section for AI assistants |
| `GEMINI.md` | NEW - Task format for Gemini AI |

### Known Issues / Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| EditorSuggest `@cal` trigger | Low | Revisit for marketplace release |
| Accidental completion edge case | Low | Unchecking creates duplicate (user can delete manually) |
| OAuth verification | Required | Need to verify with Google before public release |

### Resolved Issues

| Item | Resolution |
|------|------------|
| Duplicate events on re-sync | Fixed - Task ID tracking prevents duplicates |
| Debug console.logs | Removed |
| Offline handling | Implemented - Queue with auto-retry |

---

## Next Session Prompt

```
Chronos - Active Development

**Directory:** C:\Users\bwales\projects\obsidian-plugins\Chronos
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\
**GitHub:** https://github.com/thuban87/Chronos (public)
**Current branch:** feature/phase-9-qol-upgrades-2 (or main after merge)
**Version:** 0.1.0

**Docs:**
- docs\Handoff Log.md - START HERE for context
- docs\ADR-001-Architecture.md - Core architecture
- docs\ADR Priority List - Chronos.md - Feature roadmap
- CLAUDE.md - Working guidelines + task format
- README.md - User documentation with Google Cloud setup

**CURRENT STATE: PHASES 7, 8 & 9 COMPLETE**

All planned phases complete:
- User-provided OAuth credentials (each user creates own Google Cloud project)
- Task parsing (📅 dates, ⏰ times, 🚫 no-sync, 🔔 custom reminders)
- Event creation (timed and all-day)
- Duplicate prevention with content hashing
- Change detection and event updates
- Automatic interval-based sync
- External deletion detection (recreates events)
- Task completion handling (mark or delete)
- Orphan cleanup (deleted tasks)
- Status bar with sync info
- Offline queue with auto-retry
- Performance optimized (metadataCache)
- Daily agenda sidebar with day navigation and event colors
- Timezone setting (System Local + 35 IANA timezones with abbreviations)
- Sync log/history modal (batched by sync run, collapsible cards)
- Per-task reminder override (🔔 30,10 syntax + modal UI)
- Custom reminders UI in date/time modal (toggle + 2 input fields)
- Multi-calendar support (tag → calendar mappings in settings)

**READY FOR:**
- Beta testing (BRAT)
- README updates for multi-calendar feature
- "Maybe Someday" features if desired

**Build & Deploy:**
npm run build → Reload Obsidian (Ctrl+P → "Reload app without saving")

**Test Commands:**
- Ctrl+P → "Chronos: Toggle today's agenda sidebar"
- Ctrl+P → "Chronos: View sync history"
- Ctrl+P → "Chronos: Scan vault for sync-eligible tasks"
- Ctrl+P → "Chronos: Sync tasks to Google Calendar now"
- Ctrl+P → "Chronos: Insert date/time for task" (or Ctrl+Shift+D)
- Click status bar to sync
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
```

---

## Archived Sessions

### Session: January 3, 2026 (Session 2) - Phases 1-3 Implementation

Major implementation session. Completed Phases 1, 2, and 3 - plugin now has working OAuth, task parsing, and calendar event creation.

**What Was Done:**
- Project scaffold (TypeScript + esbuild)
- OAuth 2.0 flow with localhost callback
- Task parsing (dates, times, no-sync marker)
- All-day events for date-only tasks
- Calendar API client
- Calendar selection in settings
- Manual sync command
- Event creation with reminders

### Session: January 3, 2026 (Session 1) - Project Planning

Initial planning session. Discussed plugin concept, evaluated difficulty, made architectural decisions, and created project documentation.

**What Was Done:**
- Concept discussion and difficulty assessment (8-16 hours for MVP)
- Chose Tasks plugin syntax (`📅`, `⏰`)
- Chose interval-based sync (10 min) over on-save
- Decided on plugin data store with content hashing for duplicates
- Created all project documentation

**Key Decisions:**
- Name: Chronos (Greek god of time)
- Sync direction: One-way (Obsidian → Google)
- Reminders: Google Calendar native
- Time zone: User configurable (system local default)
