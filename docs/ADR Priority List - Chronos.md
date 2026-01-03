# ADR Priority List - Chronos

**Last Updated:** January 3, 2026
**Version:** 0.0.0 (Pre-Development)

---

## Phase 1: Foundation - PENDING

**Goal:** Plugin loads, has settings, can authenticate with Google.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 1 | Plugin scaffold & build setup | Pending | TypeScript, esbuild, manifest.json |
| 2 | Settings infrastructure | Pending | Settings class, data persistence |
| 3 | Settings UI tab | Pending | Basic configuration interface |
| 4 | Google Cloud Console setup | Pending | Project, OAuth consent, credentials |
| 5 | OAuth 2.0 implementation | Pending | Localhost callback server |
| 6 | Token storage & refresh | Pending | Secure storage in plugin data |
| 7 | "Connect to Google" button | Pending | Settings UI trigger for OAuth flow |
| 8 | Connection status display | Pending | Show connected account in settings |

**Phase 1 Deliverable:** User can connect their Google account and plugin stores tokens.

---

## Phase 2: Task Parsing - PENDING

**Goal:** Plugin can find and parse tasks with dates/times.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 9 | Tasks plugin format parser | Pending | Parse `📅 YYYY-MM-DD ⏰ HH:mm` |
| 10 | Vault-wide task scanning | Pending | Find all qualifying tasks |
| 11 | Task data structure | Pending | Internal representation of parsed tasks |
| 12 | Filtering logic | Pending | Only uncompleted, has date AND time |

**Phase 2 Deliverable:** Plugin can list all sync-eligible tasks in vault.

---

## Phase 3: Calendar Event Creation - PENDING

**Goal:** Plugin can create events in Google Calendar.

| Order | Feature | Status | Notes |
|-------|---------|--------|-------|
| 13 | Google Calendar API client | Pending | Initialize with auth tokens |
| 14 | Calendar list fetch | Pending | Get user's calendars for selection |
| 15 | Calendar selection setting | Pending | Dropdown in settings UI |
| 16 | Event creation | Pending | Create event from task data |
| 17 | Reminder configuration | Pending | Default reminder times setting |
| 18 | Event duration setting | Pending | Default duration (e.g., 30 min) |

**Phase 3 Deliverable:** Tasks with times appear in Google Calendar with reminders.

---

## Phase 4: Sync Infrastructure - PENDING

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
| 30 | Manual sync command | Pending | Force sync via command palette |
| 31 | Error notifications | Pending | User-friendly error messages |
| 32 | Auth expiry handling | Pending | Prompt to re-auth if tokens invalid |
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
| Date-only tasks as all-day events | Medium | Low | Setting to include `📅` without `⏰` |
| Multi-calendar support | Medium | Medium | Route tasks to calendars by tag |
| Per-task reminder override | Medium | Low | `🔔 15,5` syntax for custom reminders |
| Recurring event support | Medium | High | Parse `🔁` from Tasks plugin |
| Time zone setting | Low | Low | Explicit zone vs system local |
| Batch operations | Low | Medium | Bulk sync/unsync commands |
| Calendar event colors | Low | Low | Color by tag or priority |
| Sync log/history | Low | Medium | View recent sync operations |

---

## Technical Debt / Known Issues

| Item | Priority | Status |
|------|----------|--------|
| *None yet - project not started* | - | - |

---

## Development Notes

- **Environment:** Windows 11
- **Source code:** TBD (likely `C:\Users\bwales\projects\obsidian-plugins\chronos\`)
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\`
- **Sibling project:** TagForge (`C:\Users\bwales\projects\obsidian-plugins\tagforge\`)
- **Build:** TypeScript + esbuild (copy setup from TagForge)

---

## Reference Material

- **Tasks Plugin Docs:** https://publish.obsidian.md/tasks/
- **Google Calendar API:** https://developers.google.com/calendar/api/v3/reference
- **Google OAuth 2.0:** https://developers.google.com/identity/protocols/oauth2
- **Obsidian Plugin API:** https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- **Sample plugin:** https://github.com/obsidianmd/obsidian-sample-plugin

---

## Difficulty Estimates

| Phase | Estimated Time | Notes |
|-------|---------------|-------|
| Phase 1 (Foundation + OAuth) | 4-6 hours | OAuth is the tricky part |
| Phase 2 (Task Parsing) | 1-2 hours | Straightforward regex |
| Phase 3 (Event Creation) | 2-3 hours | Once auth works, API is easy |
| Phase 4 (Sync Infrastructure) | 2-3 hours | Data structures + change detection |
| Phase 5 (Task Lifecycle) | 1-2 hours | Builds on Phase 4 |
| Phase 6 (Polish) | 2-4 hours | Error handling, edge cases |
| **Total MVP** | **12-20 hours** | Realistic estimate |
