# Chronos - Project Summary

**Purpose:** Provide full project context for Claude Code sessions.
**Version:** 0.0.0 (Pre-Development)
**Last Updated:** January 3, 2026

**Note:** For current state and next steps, see `Handoff Log.md` first. This document covers the "what and why" - the Handoff Log covers the "where we are now."

---

## What Is Chronos?

Chronos is an Obsidian plugin that syncs tasks with Google Calendar. It solves the problem of unreliable in-app reminders by offloading notification delivery to Google's infrastructure.

**Primary Use Case:** ADHD users who need reliable, cross-device reminders that work even when Obsidian is closed.

**Name Origin:** Chronos is the Greek god of time - fitting for a calendar/reminder plugin.

---

## Why Build This?

Existing Obsidian reminder solutions have critical limitations:

| Solution | Problem |
|----------|---------|
| Obsidian Reminder plugin | Must have Obsidian open; easy to miss notifications |
| Google Calendar plugin | Outdated/stale; limited functionality |
| Manual calendar entry | Friction; defeats purpose of centralized task management |

**Chronos solves this by:**
- Syncing tasks to Google Calendar automatically
- Letting Google handle notification delivery
- Working across all devices (phone, desktop, watch)
- Not requiring Obsidian to be open

---

## Core Features (MVP)

### 1. Google Calendar Authentication
- OAuth 2.0 flow with localhost callback
- Secure token storage in plugin data
- Automatic token refresh

### 2. Task Parsing (Tasks Plugin Format)
Parse tasks with dates and times:
```markdown
- [ ] Call dentist 📅 2026-01-05 ⏰ 14:00
```

**Required:** Date (`📅`) AND time (`⏰`)
**Ignored:** Tasks without time (these are due dates, not appointments)

### 3. Calendar Event Creation
- Create events in user-selected Google Calendar
- Set configurable reminder times (e.g., 30 min, 10 min before)
- Configurable default event duration

### 4. Change Detection & Sync
- Interval-based sync (default: 10 minutes)
- Detect task edits → update calendar event
- Detect task completion → delete calendar event
- Detect task deletion → delete calendar event

### 5. Duplicate Prevention
- Hash-based task identification
- Store task→event mapping in plugin data
- Never create duplicate events for same task

---

## Feature Roadmap (Post-MVP)

| Feature | Value | Complexity |
|---------|-------|------------|
| Two-way sync (Calendar → Obsidian) | High | High |
| Daily agenda sidebar view | High | Medium |
| Date-only tasks as all-day events | Medium | Low |
| Multi-calendar support (tag-based routing) | Medium | Medium |
| Per-task reminder overrides | Medium | Low |
| Recurring event support | Medium | High |
| Sync status indicator | Low | Low |
| Manual sync command | Low | Low |

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Sync direction | One-way (Obsidian → Calendar) | Simplicity, Obsidian as source of truth |
| Task format | Tasks plugin syntax | User already uses it, well-documented |
| Sync trigger | Interval (10 min default) | Handles rapid edits, avoids API spam |
| Auth method | OAuth 2.0 + localhost callback | Secure, standard, good UX |
| Duplicate handling | Plugin data store + content hash | Invisible to user, enables change detection |
| Reminders | Google Calendar native | Works when Obsidian closed, cross-device |

See `docs/ADR-001-Architecture.md` for full architectural decisions.

---

## Development Approach

Build incrementally with testing at each phase:

1. **Phase 1:** Plugin scaffold, settings UI, Google OAuth flow
2. **Phase 2:** Task parsing (Tasks plugin format)
3. **Phase 3:** Calendar event creation
4. **Phase 4:** Change detection & event updates
5. **Phase 5:** Completed/deleted task handling
6. **Phase 6:** Polish (error handling, status indicators, edge cases)

**Current Status:** Pre-development (planning phase)

---

## Environment

- **Development:** Windows 11 PC
- **Source code:** TBD (likely `C:\Users\bwales\projects\obsidian-plugins\chronos\`)
- **Deploy target:** `G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\`
- **Test vault:** Brad's main vault (~300 files)
- **Build:** TypeScript + esbuild (same setup as TagForge)

---

## Dependencies

### Required
- Google Calendar API (v3)
- Google OAuth 2.0

### Development
- Obsidian Plugin API
- TypeScript
- esbuild

### Google Cloud Console Setup Required
1. Create project in Google Cloud Console
2. Enable Google Calendar API
3. Configure OAuth consent screen
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download credentials JSON

---

## Reference

- Obsidian Plugin API: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- Google Calendar API: https://developers.google.com/calendar/api/v3/reference
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Tasks Plugin Docs: https://publish.obsidian.md/tasks/
- Sample plugin template: https://github.com/obsidianmd/obsidian-sample-plugin
- TagForge (sibling project): `C:\Users\bwales\projects\obsidian-plugins\tagforge\`
