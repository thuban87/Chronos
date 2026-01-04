# ADR Priority List - Chronos

**Last Updated:** January 4, 2026
**Version:** 0.1.0
**Status:** Active Development - Phase 8 next

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

## Phase 8: Multi-Calendar Support - PENDING

**Goal:** Route tasks to different calendars by tag.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 43 | Tag-to-calendar mapping UI | Pending | Settings UI for mapping tags to calendars |
| 44 | Multi-calendar sync logic | Pending | Pick target calendar based on task tags |
| 45 | Default calendar fallback | Pending | Use default when no tag matches |

**Phase 8 Deliverable:** Tasks tagged #work go to Work calendar, #personal to Personal, etc.

---

## Phase 9: Power User Features - COMPLETE ✓

**Goal:** Transparency and customization for power users.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 46 | Sync log/history | ✓ Complete | Batched by sync run with collapsible cards, summary counts |
| 47 | Per-task reminder override | ✓ Complete | `🔔 30,10` syntax + modal UI with toggle and input fields |

**Additional polish (Session 7):**
- Sync history groups operations by batch with collapsible cards
- Custom reminders UI in date/time modal (toggle + 2 input fields)

**Phase 9 Deliverable:** Users can debug sync issues and customize reminders per-task. ✓

---

## Maybe Someday (Post-BRAT)

Features that are valuable but complex or low priority. May implement based on user demand.

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Two-way sync (Calendar → Obsidian) | High | High | Major feature, needs conflict resolution, refactoring |
| EditorSuggest `@cal` trigger | Medium | Medium | Type-to-insert; hotkey modal works well enough |
| Recurring event support | Medium | High | Parse `🔁` from Tasks plugin |
| Batch operations | Low | Medium | Bulk sync/unsync commands |
| Calendar event colors | Low | Low | Color by tag or priority |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| ~~Debug console.logs~~ | ~~Low~~ | ✓ Fixed - Removed |
| ~~No duplicate prevention~~ | ~~High~~ | ✓ Fixed - Task ID tracking |
| ~~scanVault reads every file~~ | ~~High~~ | ✓ Fixed - Uses metadataCache to skip files without tasks |
| ~~Embedded OAuth credentials~~ | ~~High~~ | ✓ Fixed - User-provided credentials |
| Accidental completion edge case | Low | Unchecking creates duplicate (user can delete manually) |

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
