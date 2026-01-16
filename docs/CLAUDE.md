---
tags:
  - projects
  - active
  - chronos
---
# CLAUDE.md - Chronos

**Purpose:** Instructions for AI assistants working on the Chronos project.
**Last Updated:** January 3, 2026

---
## Important!

Do not perform any git commands. USer will perform all git commands themselves. Do suggest git commit titles/description when finished with testing and updating documentation, or when asked. Also, remind the user when starting a new task to check github and make sure we're on a new branch.
## What Is Chronos?

Chronos is an Obsidian plugin that syncs tasks with Google Calendar. It parses tasks with dates/times from Obsidian notes (using Tasks plugin format) and creates calendar events with reminders.

**Core Value:** Reliable reminders that work even when Obsidian is closed, across all devices.

---

## Quick Start

1. **Read `docs/Handoff Log.md` FIRST** - This has current state and next steps
2. **Read `docs/ADR-001-Architecture.md`** - Understand key decisions before coding
3. **Check `docs/ADR Priority List - Chronos.md`** - See what phase we're in

---

## Project Structure

```
chronos/
├── CLAUDE.md                    # This file
├── docs/
│   ├── Handoff Log.md           # Session tracking (START HERE)
│   ├── Project Summary.md       # Project overview
│   ├── ADR-001-Architecture.md  # Core architectural decisions
│   └── ADR Priority List - Chronos.md  # Feature roadmap
├── src/                         # Source code (TypeScript)
├── manifest.json                # Obsidian plugin manifest
├── package.json                 # Node dependencies
└── esbuild.config.mjs           # Build configuration
```

---

## Key Technical Decisions (Summary)

| Decision | Choice |
|----------|--------|
| Sync direction | One-way (Obsidian → Google Calendar) |
| Task format | Tasks plugin (`📅 2026-01-05 ⏰ 14:00`) |
| Sync trigger | Interval-based (default 10 min) |
| Auth | OAuth 2.0 with localhost callback |
| Reminders | Google Calendar native (set on event creation) |
| Duplicate handling | Plugin data store with content hashing |

**See `docs/ADR-001-Architecture.md` for full rationale.**

---

## Working With Brad

### ADHD Considerations
- Break tasks into small, concrete steps
- Don't overwhelm with too many options at once
- Be direct - say what you recommend
- Celebrate wins, don't dwell on setbacks

### Development Style
- **Incremental:** Build and test each feature before moving on
- **Document as you go:** Update Handoff Log after each session
- **Test in real vault:** Use Brad's actual vault for testing
- **Learn from TagForge:** Similar patterns apply (settings, data storage, modals)

### Session Handoff Protocol
At the end of each session:
1. Perform and confirm testing before updating any documentation
2. Update `docs/Handoff Log.md` with what was done
3. Update `docs/ADR Priority List - Chronos.md` with completed items
4. Leave a "Next Session Prompt" in the Handoff Log
5. Note any bugs or issues discovered

---

## Common Patterns (From TagForge)

### Settings Storage
```typescript
interface ChronosSettings {
  googleCalendarId: string;
  syncIntervalMinutes: number;
  defaultReminderMinutes: number[];
  defaultEventDurationMinutes: number;
  // ... tokens stored separately for security
}
```

### Data Storage
```typescript
interface ChronosData {
  settings: ChronosSettings;
  syncedTasks: Record<string, SyncedTaskInfo>;
  lastSyncAt: string;
}
```

### Plugin Lifecycle
```typescript
class ChronosPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ChronosSettingTab(this.app, this));
    // Set up sync interval
    // Register commands
  }

  onunload() {
    // Clean up intervals
    // Clean up event listeners
  }
}
```

---

## API Reference

### Google Calendar API
- **Base URL:** `https://www.googleapis.com/calendar/v3`
- **Scopes needed:** `https://www.googleapis.com/auth/calendar.events`
- **Key endpoints:**
  - `GET /users/me/calendarList` - List calendars
  - `POST /calendars/{calendarId}/events` - Create event
  - `PUT /calendars/{calendarId}/events/{eventId}` - Update event
  - `DELETE /calendars/{calendarId}/events/{eventId}` - Delete event

### Tasks Plugin Format
```markdown
- [ ] Task text 🚫 #remind-at-due ⏰ 2:00PM 📅 2026-01-05
      │          │             └── Time (HH:mm)
      │          └── Due date (YYYY-MM-DD)
      └── Uncompleted checkbox

- [x] Completed task 📅 2026-01-05 ✅ 2026-01-04
      │                            └── Completion date
      └── Completed checkbox
```

---

## Build & Deploy

### Commands
```bash
cd [project-directory]
npm install              # First time setup
npm run build            # Production build
npm run dev              # Watch mode
```

### Deploy Target
```
G:\My Drive\IT\Obsidian Vault\My Notebooks\.obsidian\plugins\chronos\
```

### Required Output Files
- `manifest.json`
- `main.js`
- `styles.css` (if any)

### Test Plugin
1. Build (`npm run build`)
2. In Obsidian: Ctrl+P → "Reload app without saving"
3. OR: Settings → Community Plugins → Toggle Chronos off/on

---

## Error Handling Guidelines

### Auth Errors
- Token expired → Attempt refresh → If fails, prompt re-auth
- Invalid credentials → Clear tokens, show "Connect" button
- Network error → Queue operation, retry on next interval

### API Errors
- Rate limited → Back off exponentially
- Event not found → Remove from sync data (was deleted externally)
- Permission denied → Check scopes, prompt re-auth

### User-Facing Errors
- Use Obsidian's `Notice` for transient messages
- Use modal for critical errors requiring action
- Always provide actionable next step

---

## Security Considerations

- **Never log tokens** - Even in debug mode
- **Store refresh token only** - Access tokens in memory
- **Validate all API responses** - Don't trust external data
- **Use HTTPS only** - For all Google API calls
- **Clear tokens on disconnect** - Don't leave stale credentials

---

## Don't Forget

- [ ] Update Handoff Log at end of session
- [ ] Test on mobile (if applicable)
- [ ] Check for console.log statements before release
- [ ] Clean up timeouts/intervals in onunload()
- [ ] Handle offline gracefully
