# ADR-001: Chronos Core Architecture

**Status:** Accepted
**Date:** January 3, 2026
**Last Updated:** January 3, 2026

---

## Context

Building an Obsidian plugin that syncs tasks with Google Calendar. The plugin needs to:
1. Parse tasks with dates/times from Obsidian notes (Tasks plugin format)
2. Authenticate with Google Calendar via OAuth 2.0
3. Create calendar events from those tasks
4. Detect changes to synced tasks and update calendar events
5. Set reminders on calendar events so Google handles notifications

**Problem Being Solved:** Existing Obsidian reminder plugins require Obsidian to be open and are easy to miss. By syncing to Google Calendar, users get:
- Notifications on phone even when Obsidian is closed
- Cross-device reminders
- Integration with existing calendar workflow

---

## Decisions

### 1. Sync Direction: One-Way (Obsidian → Google Calendar)

**Decision:** MVP will only sync FROM Obsidian TO Google Calendar. Not bidirectional.

**Rationale:**
- Dramatically reduces complexity
- Avoids conflict resolution logic
- Obsidian remains the source of truth
- Two-way sync can be added post-MVP if needed

**Trade-off:** Changes made in Google Calendar won't reflect in Obsidian. Users must edit tasks in Obsidian to update events.

---

### 2. Task Format: Tasks Plugin Syntax

**Decision:** Parse tasks using the Obsidian Tasks plugin format.

**Format:**
```markdown
- [ ] Call dentist 📅 2026-01-05 ⏰ 14:00
- [ ] Submit report 📅 2026-01-10
```

**Rationale:**
- User already uses Tasks plugin
- Well-documented, standardized format
- Emoji-based markers are unambiguous to parse
- Time component (`⏰`) is optional - dateless reminders still work

**Parsing Rules:**
- `📅 YYYY-MM-DD` - Due date (required for sync)
- `⏰ HH:mm` - Time (optional, defaults to configurable default time)
- `✅ YYYY-MM-DD` - Completion date (task completed, skip or delete event)
- Task must be uncompleted (`- [ ]`) to sync

---

### 3. Sync Trigger: Interval-Based (Default 10 minutes)

**Decision:** Sync on a configurable interval, not on file save.

**Rationale:**
- Handles rapid edits gracefully (user edits task 5 times in 2 minutes, only 1 API call)
- Batches multiple changes efficiently
- More forgiving of connectivity issues
- Avoids API rate limiting concerns

**Trade-off:** Changes don't appear instantly in calendar. Acceptable for reminder use case.

**Alternatives Considered:**
- On-save: Rejected due to rapid edit scenarios causing duplicate/stale events
- Manual only: Rejected as too much friction for ADHD use case

---

### 4. Duplicate Handling: Plugin Data Store with Content Hashing

**Decision:** Store mapping of tasks to calendar events in plugin data, including a hash of the task content.

**Storage Structure:**
```json
{
  "syncedTasks": {
    "unique-task-id-123": {
      "eventId": "google_calendar_event_abc123",
      "filePath": "Tasks/Work.md",
      "lineNumber": 15,
      "contentHash": "sha256-of-task-text",
      "lastSyncedDate": "2026-01-05",
      "lastSyncedTime": "14:00",
      "lastSyncedAt": "2026-01-03T10:30:00Z"
    }
  }
}
```

**Rationale:**
- Enables detection of changed tasks (hash mismatch → update event)
- Enables detection of deleted tasks (task ID no longer in vault → delete event)
- Invisible to user (no markers in task text)
- Same pattern as TagForge's tag tracking

**Task ID Generation:**
- Hash of: file path + original task text (at first sync)
- Stored in plugin data, not in the file

---

### 5. Authentication: OAuth 2.0 with Local Callback Server

**Decision:** Use OAuth 2.0 with a localhost redirect URI.

**Flow:**
1. User clicks "Connect to Google Calendar" in settings
2. Plugin spawns local HTTP server on random available port
3. Opens browser to Google OAuth consent screen
4. User authorizes, Google redirects to `http://localhost:{port}/callback`
5. Plugin captures auth code, exchanges for tokens
6. Stores refresh token securely in plugin data
7. Shuts down local server

**Rationale:**
- Standard OAuth flow, most secure option
- Refresh tokens enable long-lived sessions
- No need for user to copy-paste codes

**Alternatives Considered:**
- Copy-paste code flow: Uglier UX, but fallback if localhost fails
- API key only: Not possible for user data access

**Security:**
- Refresh token stored in Obsidian's plugin data (encrypted at rest by OS)
- Access tokens kept in memory only, refreshed as needed
- Consent screen shows exactly what permissions are requested

---

### 6. Calendar Selection: Single Calendar (Configurable)

**Decision:** Sync all tasks to a single user-selected Google Calendar.

**Rationale:**
- Simplest UX - one dropdown to pick calendar
- Users can create a dedicated "Obsidian Tasks" calendar if desired
- Multi-calendar support can be added later (tag-based routing)

**Future Enhancement:** Allow mapping tags to different calendars (e.g., `#work` → Work Calendar, `#personal` → Personal Calendar).

---

### 7. Event Reminders: Google Calendar Native

**Decision:** Set reminders on the calendar event itself, letting Google handle notification delivery.

**Implementation:**
```typescript
const event = {
  summary: 'Call dentist',
  start: { dateTime: '2026-01-05T14:00:00-05:00' },
  end: { dateTime: '2026-01-05T14:30:00-05:00' },
  reminders: {
    useDefault: false,
    overrides: [
      { method: 'popup', minutes: 30 },
      { method: 'popup', minutes: 10 }
    ]
  }
}
```

**Rationale:**
- Google handles notification delivery across all devices
- Works even when Obsidian is closed
- Works on phone, desktop, smartwatch
- No plugin code needed for actual reminders

**Configuration:**
- Default reminder times configurable in settings (e.g., `[30, 10]` = 30 min and 10 min before)
- Reminder method configurable (popup, email, or both)

---

### 8. Event Duration: Configurable Default

**Decision:** Events have a configurable default duration (e.g., 30 minutes).

**Rationale:**
- Google Calendar requires both start and end time
- Most tasks don't have explicit duration
- User can set sensible default (30 min, 1 hour, etc.)

**Future Enhancement:** Parse duration from task text (e.g., `⏱️ 1h`).

---

### 9. Scope: All Notes with Time-Based Tasks

**Decision:** Sync any task that has a time component (`⏰`), regardless of folder.

**Rationale:**
- Simple rule: if it has a time, it's important enough to remind
- User controls what gets synced by adding/removing time markers
- No folder configuration needed

**Filtering:**
- Only uncompleted tasks (`- [ ]`)
- Must have date (`📅`) - dateless tasks ignored
- Must have time (`⏰`) - date-only tasks ignored (these are "due dates" not "appointments")

**Future Enhancement:** Option to sync date-only tasks as all-day events.

---

### 10. Completed Task Handling: Delete Event

**Decision:** When a task is marked complete (`- [x]`), delete the corresponding calendar event.

**Rationale:**
- Keeps calendar clean
- Completed tasks don't need reminders
- Simple, predictable behavior

**Alternative Considered:** Mark event as "completed" somehow - rejected because Google Calendar events don't have completion status.

---

### 11. CSS Naming: chronos- Prefix

**Decision:** All CSS classes prefixed with `chronos-`.

**Rationale:**
- Avoids conflicts with Obsidian core styles
- Avoids conflicts with other plugins
- Short but distinctive

---

### 12. Time Zone: User Configurable

**Decision:** Let the user choose their time zone in settings, with system local as default.

**Rationale:**
- Marketplace release means supporting users in various time zones
- Some users travel or work across zones
- System local is sensible default for most users

**Implementation:**
- Settings dropdown with common time zones
- "Use system time zone" option (default)
- Store as IANA time zone string (e.g., `America/New_York`)

---

### 13. Event Content Format: Task as Title, Note as Description

**Decision:** Calendar event structure:
- **Event title (summary):** The task text itself
- **Event description:** The note/file the task lives in

**Example:**
```
Title: Call dentist
Description: Source: Tasks/Health.md
Start: 2026-01-05 14:00
End: 2026-01-05 14:30
```

**Rationale:**
- Title should be scannable in calendar view
- Description provides context without cluttering the title
- Users can click through to find the source note if needed

---

### 14. Google Cloud Project: Dedicated Project for Chronos

**Decision:** Create a new Google Cloud project specifically for Chronos, separate from other projects.

**Rationale:**
- Clean separation of concerns
- Easier quota/billing tracking
- Marketplace release requires own OAuth consent screen
- Avoids polluting other projects with Chronos-specific config

**Setup Required:**
1. Create new project in Google Cloud Console
2. Enable Google Calendar API
3. Configure OAuth consent screen (external, for marketplace)
4. Create OAuth 2.0 credentials (Desktop app type)
5. Store Client ID and Client Secret securely

---

## Consequences

### Positive
- Users get reliable, cross-device reminders without Obsidian running
- Simple mental model: add time to task → appears in calendar
- Leverages Google's notification infrastructure
- Interval-based sync prevents API abuse and handles rapid edits
- One-way sync eliminates conflict complexity

### Negative
- Requires Google account and OAuth setup
- Changes in Google Calendar don't sync back
- Initial OAuth setup is a UX hurdle
- Depends on external service (Google)

### Risks
- Google API changes could break integration
- OAuth token expiration edge cases
- Rate limiting if user has many tasks

### Mitigations
- Use official Google API client library
- Implement robust token refresh logic
- Batch API calls where possible
- Clear error messages for auth failures

---

## Related Decisions

- ADR-002 (future): Two-Way Sync Implementation
- ADR-003 (future): Multi-Calendar Routing

---

## Open Questions for Implementation

1. ~~**Time zone handling:** Use local time zone or explicit zone in task?~~ → **RESOLVED:** User configurable with system local as default (Decision 12)
2. ~~**Event title format:** Just task text, or include source note name?~~ → **RESOLVED:** Task = title, Note = description (Decision 13)
3. **Conflict detection:** What if user manually creates event with same title/time?
4. **Offline handling:** Queue changes when offline, sync when back online?
