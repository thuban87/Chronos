# Chronos Handoff Log

**Last Updated:** January 3, 2026
**Current Phase:** Active Development - Phases 7-9
**Current Branch:** main
**Version:** 0.1.0

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

**Directory:** C:\Users\bwales\projects\obsidian-plugins\chronos\
**Deploy to:** G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\
**GitHub:** https://github.com/thuban87/Chronos (public)
**Current branch:** main
**Version:** 0.1.0

**Docs:**
- docs\Handoff Log.md - START HERE for context
- docs\ADR-001-Architecture.md - Core architecture
- docs\ADR Priority List - Chronos.md - Feature roadmap (Phases 7-9 next)
- CLAUDE.md - Working guidelines + task format
- README.md - User documentation with Google Cloud setup

**CURRENT STATE: MVP COMPLETE - CONTINUING DEVELOPMENT**

Core features complete:
- User-provided OAuth credentials (each user creates own Google Cloud project)
- Task parsing (📅 dates, ⏰ times, 🚫 no-sync)
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

**NEXT PHASES TO IMPLEMENT:**
- Phase 7: Daily agenda sidebar + Timezone setting
- Phase 8: Multi-calendar support (tag-based routing)
- Phase 9: Sync log/history + Per-task reminder override

**Build & Deploy:**
npm run build → Reload Obsidian (Ctrl+P → "Reload app without saving")

**Test Commands:**
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
