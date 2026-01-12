# Implementation Guide: Recurring Events

**Feature:** Sync Tasks plugin recurrence to Google Calendar recurring events
**Status:** COMPLETE
**Completed:** January 9, 2026

---

## Overview

The Tasks plugin supports recurrence with `🔁` syntax. This feature translates that to Google Calendar's RRULE format so recurring tasks become recurring calendar events.

### Syntax Mapping (Implemented)

| Tasks Plugin | Google RRULE | Status |
|-------------|--------------|--------|
| `🔁 every day` | `RRULE:FREQ=DAILY` | ✅ |
| `🔁 every week` | `RRULE:FREQ=WEEKLY` | ✅ |
| `🔁 every month` | `RRULE:FREQ=MONTHLY` | ✅ |
| `🔁 every year` | `RRULE:FREQ=YEARLY` | ✅ |
| `🔁 every 2 days` | `RRULE:FREQ=DAILY;INTERVAL=2` | ✅ |
| `🔁 every 2 weeks` | `RRULE:FREQ=WEEKLY;INTERVAL=2` | ✅ |
| `🔁 every 3 months` | `RRULE:FREQ=MONTHLY;INTERVAL=3` | ✅ |
| `🔁 every Monday` | `RRULE:FREQ=WEEKLY;BYDAY=MO` | ✅ |
| `🔁 every Monday, Wednesday, Friday` | `RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR` | ✅ |
| `🔁 every month on the 15th` | `RRULE:FREQ=MONTHLY;BYMONTHDAY=15` | ⏳ Future |
| `🔁 every month on the last day` | `RRULE:FREQ=MONTHLY;BYMONTHDAY=-1` | ⏳ Future |

---

## Files Modified/Created

| File | Changes |
|------|---------|
| `src/recurrenceParser.ts` | **NEW** - Parses Tasks plugin syntax to Google RRULE |
| `src/taskParser.ts` | Added RECURRENCE_PATTERN, recurrenceText/recurrenceRule fields |
| `src/googleCalendar.ts` | Added recurrence array to event creation/update |
| `src/batchApi.ts` | Added recurrenceRule to ChangeSetOperation |
| `src/syncManager.ts` | Pass recurrence through, special handling for completed recurring tasks |
| `src/recurringDeleteModal.ts` | **NEW** - Modal for completed recurring task choices |
| `src/dateTimeModal.ts` | Added recurrence picker UI (frequency, interval, weekdays) |
| `main.ts` | Handle recurring completions, show modal, build recurrence syntax |
| `styles.css` | Styles for recurrence UI and modal |

---

## Completed Task Handling (Critical)

**Problem:** Modifying a recurring event's title in Google Calendar breaks the recurrence series.

**Solution:** Different handling based on Safety Net setting:

### Safety Net ON (Default)
- Recurring task completed → Released from sync tracking
- Calendar events stay intact (future occurrences continue)
- No API calls made to Google Calendar
- User's calendar reminders continue working

### Safety Net OFF
- Shows `RecurringDeleteModal` with options:
  - **Delete All Events**: Deletes the entire recurring series
  - **Keep Events (Recommended)**: Releases from tracking, calendar stays intact
  - **Delete Next Instance**: Disabled (requires complex Google exception handling)

### Implementation Details
- `SyncedTaskInfo` now stores `isRecurring: boolean` flag
- Completed task detection checks BOTH `task.recurrenceRule` AND `syncInfo.isRecurring`
- This handles cases where 🔁 syntax might be removed from task line

---

## Modal UI

### Date/Time Modal Recurrence Picker
- Frequency dropdown: Does not repeat, Daily, Weekly, Monthly, Yearly
- Interval input: "Every N days/weeks/months/years"
- Weekday selector (for Weekly): Circular buttons for S M T W T F S
- Generates syntax like `🔁 every week` or `🔁 every monday, wednesday, friday`

### Recurring Delete Modal
- Appears when completing a recurring task (Safety Net OFF only)
- Three options with clear descriptions
- "Delete Next Instance" disabled with "Coming soon" note

---

## Testing Results

### Basic Patterns
- [x] `🔁 every day` creates daily recurring event
- [x] `🔁 every week` creates weekly recurring event
- [x] `🔁 every month` creates monthly recurring event
- [x] `🔁 every year` creates yearly recurring event

### Intervals
- [x] `🔁 every 2 days` creates event repeating every 2 days
- [x] `🔁 every 2 weeks` creates biweekly event
- [x] `🔁 every 3 months` creates quarterly event

### Weekdays
- [x] `🔁 every Monday` creates weekly on Monday
- [x] `🔁 every Monday, Wednesday, Friday` creates MWF schedule

### Completed Task Handling
- [x] Safety Net ON: Calendar unchanged, task released from tracking
- [x] Safety Net OFF: Modal appears with delete/keep options
- [x] "Keep Events" releases from tracking without modifying calendar
- [x] "Delete All Events" deletes the entire series

### Edge Cases
- [x] Non-recurring task still works (no 🔁)
- [x] Unrecognized pattern syncs as non-recurring with warning
- [x] Recurrence text stripped from event title
- [x] Modal UI generates correct syntax

---

## Known Limitations

| Limitation | Notes |
|------------|-------|
| `when done` patterns | Not supported - completion-triggered recurrence is complex |
| `every month on the Nth` | Deferred to future enhancement |
| `every month on the last [weekday]` | Deferred to future enhancement |
| Delete single instance | Requires Google Calendar exception handling - deferred |
| End date / count | Not implemented (`until`, `x10` patterns) |

---

## Future Enhancements

### Phase 2 Patterns
- `every month on the 15th` → `FREQ=MONTHLY;BYMONTHDAY=15`
- `every month on the last day` → `FREQ=MONTHLY;BYMONTHDAY=-1`
- `every month on the first Monday` → `FREQ=MONTHLY;BYDAY=1MO`

### Advanced Features
- End date support: `🔁 every week until 2026-06-01`
- Count support: `🔁 every day x10` (10 occurrences)
- Delete single instance (Google Calendar exception API)
- Exception dates: Handle edits to individual instances
