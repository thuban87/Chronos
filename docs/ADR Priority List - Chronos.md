# ADR Priority List - Chronos

**Last Updated:** January 3, 2026
**Version:** 0.1.0

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

## Phase 4: Sync Infrastructure - PENDING (NEXT)

**Goal:** Plugin can track synced tasks and detect changes.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 19 | Task ID generation | Pending | Hash-based unique identifier |
| 20 | Sync data structure | Pending | Task ID → Event ID mapping |
| 21 | Content hashing | Pending | Detect task text changes |
| 22 | Interval-based sync trigger | Pending | Configurable interval (default 10 min) |
| 23 | Change detection | Pending | Compare current vs last synced state |
| 24 | Event update API call | Pending | Update existing calendar event |

**Phase 4 Deliverable:** Editing a task updates the calendar event on next sync.

---

## Phase 5: Task Lifecycle - PENDING

**Goal:** Handle completed and deleted tasks.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 25 | Completed task detection | Pending | `- [x]` marks task done |
| 26 | Event deletion | Pending | Remove calendar event for completed task |
| 27 | Deleted task detection | Pending | Task ID no longer in vault |
| 28 | Orphan event cleanup | Pending | Delete events for deleted tasks |

**Phase 5 Deliverable:** Completing or deleting a task removes it from calendar.

---

## Phase 6: Polish & UX - PENDING

**Goal:** Production-ready with good error handling.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 29 | Sync status indicator | Pending | Show last sync time, next sync |
| 30 | Manual sync command | ✓ Complete | Force sync via command palette (done in Phase 3) |
| 31 | Error notifications | Partial | Basic notices, needs improvement |
| 32 | Auth expiry handling | Partial | Token refresh works, needs better UX |
| 33 | Offline queue | Pending | Queue changes, sync when back online |
| 34 | Console log cleanup | Pending | Remove debug logs for release |
| 35 | README.md | Pending | User documentation |
| 36 | LICENSE | Pending | MIT License |

**Phase 6 Deliverable:** Plugin is polished and ready for personal use / beta.

---

## Future Possibilities (Post-MVP)

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Two-way sync (Calendar → Obsidian) | High | High | Major feature, needs conflict resolution |
| Daily agenda sidebar | High | Medium | Show today's events in Obsidian |
| ~~Date-only tasks as all-day events~~ | ~~Medium~~ | ~~Low~~ | ✓ Implemented in Phase 2 |
| Multi-calendar support | Medium | Medium | Route tasks to calendars by tag |
| Per-task reminder override | Medium | Low | `🔔 15,5` syntax for custom reminders |
| Recurring event support | Medium | High | Parse `🔁` from Tasks plugin |
| Time zone setting | Low | Low | Explicit zone vs system local |
| Batch operations | Low | Medium | Bulk sync/unsync commands |
| Calendar event colors | Low | Low | Color by tag or priority |
| Sync log/history | Low | Medium | View recent sync operations |
| EditorSuggest `@cal` trigger | Medium | Medium | Type-to-insert date/time (didn't work initially) |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| EditorSuggest `@cal` trigger not working | Low | onTrigger not called on keystrokes - revisit later |
| Debug console.logs in googleCalendar.ts | Low | Remove before release |
| No duplicate prevention | High | Phase 4 will fix - currently re-sync creates duplicates |

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

## Difficulty Estimates (Updated)

| Phase | Estimated Time | Actual Time | Notes |
|-------|---------------|-------------|-------|
| Phase 1 (Foundation + OAuth) | 4-6 hours | ~2 hours | OAuth was smoother than expected |
| Phase 2 (Task Parsing) | 1-2 hours | ~1.5 hours | Added all-day events, no-sync marker |
| Phase 3 (Event Creation) | 2-3 hours | ~1.5 hours | API worked well once scope was fixed |
| Phase 4 (Sync Infrastructure) | 2-3 hours | Pending | |
| Phase 5 (Task Lifecycle) | 1-2 hours | Pending | |
| Phase 6 (Polish) | 2-4 hours | Pending | |
| **Total MVP** | **12-20 hours** | ~5 hours so far | Ahead of schedule |
