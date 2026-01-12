# Chronos Recurring Tasks - Feature Brief

**Last Updated:** January 11, 2026  
**Status:** COMPLETE (Phase 18)  
**Toggle:** `enableRecurringTasks` in Chronos settings (OFF by default)

---

## Overview

Chronos now supports recurring task sync with Google Calendar via the Tasks plugin's `🔁` emoji syntax. This is an **opt-in feature** controlled by a settings toggle.

---

## How It Works

### Toggle OFF (Default)
- **DateTimeModal**: "Repeat" dropdown is hidden
- **🔁 emoji**: Ignored during sync - no RRULE sent to Google
- **Calendar events**: Single events only (no recurrence)
- **Task completion**: New task instance → new calendar event each time

### Toggle ON
- **DateTimeModal**: "Repeat" dropdown visible (daily, weekly, monthly, yearly)
- **🔁 emoji**: Parsed to RRULE and sent to Google Calendar
- **Calendar events**: Recurring events with proper RRULE
- **Task completion**: Succession logic migrates sync record to next instance (prevents duplicates)

---

## Task Format

```markdown
- [ ] Task title ⏰ 14:00 🔔 30,5 ⏱️ 1hr 📅 2026-01-15 🔁 every day
```

**Emoji order matters for Tasks plugin compatibility:**
1. Chronos emojis first: `⏰` (time), `🔔` (reminders), `⏱️` (duration), `🚫` (no-sync)
2. Date: `📅 YYYY-MM-DD`
3. Recurrence: `🔁 pattern`

---

## Supported Recurrence Patterns

| Pattern | RRULE |
|---------|-------|
| `every day` | `FREQ=DAILY` |
| `every 2 days` | `FREQ=DAILY;INTERVAL=2` |
| `every week` | `FREQ=WEEKLY` |
| `every week on Monday` | `FREQ=WEEKLY;BYDAY=MO` |
| `every Monday, Wednesday` | `FREQ=WEEKLY;BYDAY=MO,WE` |
| `every month` | `FREQ=MONTHLY` |
| `every year` | `FREQ=YEARLY` |

---

## Succession Logic (Toggle ON only)

When a recurring task is completed:
1. Tasks plugin creates a new task instance with the next date
2. Chronos detects this as a "successor" (same title, file, time, later date)
3. Sync record (including eventId) is **migrated** to the successor
4. No new calendar event is created - the existing recurring event continues

**If no successor found:** User sees `SeriesDisconnectionModal` with options to delete or keep the calendar event.

---

## Data Structures

### SyncedTaskInfo (extended)
```typescript
interface SyncedTaskInfo {
    // ... existing fields ...
    isRecurring?: boolean;      // Whether this is a recurring task
    recurrenceRule?: string;    // RRULE string (e.g., "FREQ=DAILY")
}
```

### PendingSuccessorCheck
```typescript
interface PendingSuccessorCheck {
    orphanId: string;
    title: string;
    originalDate: string;
    time: string | null;
    filePath: string;
    recurrenceRule: string;
    eventId: string;
    calendarId: string;
    createdAt: string;
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/recurrenceParser.ts` | Converts `🔁` text to RRULE |
| `src/syncManager.ts` | Third Reconciliation Pass, migration logic |
| `src/dateTimeModal.ts` | Modal with recurrence dropdown |
| `src/recurringEnableModal.ts` | Warning modal when enabling feature |
| `src/seriesDisconnectionModal.ts` | Modal when successor not found |
| `src/recurrenceChangeModal.ts` | Modal when pattern changes |

---

## Settings

```typescript
interface ChronosSettings {
    // ... other settings ...
    enableRecurringTasks: boolean;  // Default: false
}
```

Access via: `this.settings.enableRecurringTasks`

---

## Events Emitted

When recurring tasks sync, the standard Chronos events fire:
- `task-created` - New recurring task synced
- `task-updated` - Recurring task updated
- `task-completed` - Recurring task completed (before succession)

The `ChronosTask` in event payloads includes:
```typescript
{
    recurrenceText: string | null;  // Original "every day" text
    recurrenceRule: string | null;  // Parsed "FREQ=DAILY" RRULE
}
```

---

## Important Notes

1. **Tasks plugin required**: Must be configured with "Next recurrence appears on the line below"
2. **One-way sync**: Obsidian → Google only (no import from Google)
3. **RRULE comparison**: Uses exact string match for pattern change detection
4. **Toggle gating**: All recurrence functionality disabled when toggle OFF
