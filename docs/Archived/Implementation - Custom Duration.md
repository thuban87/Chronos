# Implementation Guide: Custom Event Duration

**Feature:** Allow users to specify custom duration per task
**Complexity:** Low
**Estimated Effort:** 1-2 hours
**Dependencies:** None

---

## Overview

Currently all events use the default duration setting (e.g., 30 minutes). This feature adds syntax to specify duration per task, similar to how custom reminders work with `🔔`.

### Proposed Syntax

```markdown
- [ ] Long meeting 📅 2026-01-15 ⏰ 14:00 ⏱️ 2h
- [ ] Quick call 📅 2026-01-15 ⏰ 10:00 ⏱️ 15m
- [ ] Workshop 📅 2026-01-15 ⏰ 09:00 ⏱️ 1h30m
```

**Supported formats:**
- `⏱️ 2h` - 2 hours (120 minutes)
- `⏱️ 30m` - 30 minutes
- `⏱️ 1h30m` - 1 hour 30 minutes (90 minutes)
- `⏱️ 90` - 90 minutes (plain number = minutes)

---

## Implementation Steps

### Step 1: Update Task Parser

**File:** `src/taskParser.ts`

1. Add duration pattern (after line 55):

```typescript
// Duration pattern: ⏱️ followed by hours/minutes (e.g., ⏱️ 2h, ⏱️ 30m, ⏱️ 1h30m)
const DURATION_PATTERN = /⏱️\s*(?:(\d+)h)?(?:(\d+)m?)?/;
```

2. Add to `STRIP_PATTERNS` array (around line 58):

```typescript
/⏱️\s*(?:\d+h)?(?:\d+m?)?/g,    // Duration
```

3. Add `durationMinutes` to `ParseResult` interface:

```typescript
interface ParseResult {
    // ... existing fields
    durationMinutes: number | null;
}
```

4. Add `durationMinutes` to `ChronosTask` interface:

```typescript
export interface ChronosTask {
    // ... existing fields
    /** Custom duration in minutes (null = use default) */
    durationMinutes: number | null;
}
```

5. Parse duration in `parseLine()` method (after reminder parsing, ~line 130):

```typescript
// Extract custom duration (e.g., ⏱️ 2h or ⏱️ 30m or ⏱️ 1h30m)
const durationMatch = line.match(DURATION_PATTERN);
if (durationMatch) {
    const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
    const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
    const totalMinutes = (hours * 60) + minutes;
    if (totalMinutes > 0) {
        result.durationMinutes = totalMinutes;
    }
}
```

6. Initialize `durationMinutes: null` in the result object.

7. Pass `durationMinutes` through in `scanFile()` when creating `ChronosTask` objects.

---

### Step 2: Update Sync Manager

**File:** `src/syncManager.ts`

1. Update `buildChangeSet()` to use task-specific duration:

In the CREATE operations section (~line 821):

```typescript
// Use task-specific duration or fall back to default
const taskDuration = task.durationMinutes || defaultDurationMinutes;
operations.push({
    id: generateOperationId('create'),
    type: 'create',
    calendarId: targetCalendarId,
    task,
    durationMinutes: taskDuration,  // Changed from defaultDurationMinutes
    reminderMinutes,
    timeZone,
});
```

Apply the same pattern to UPDATE and REROUTE operations.

---

### Step 3: Update Date/Time Modal (Optional Enhancement)

**File:** `src/dateTimeModal.ts`

Add a duration input field similar to the custom reminders UI:

1. Add duration toggle and input
2. When enabled, show a simple input for hours/minutes
3. Insert `⏱️ Xh` or `⏱️ Xm` syntax into the task line

This is optional - power users can type the syntax directly.

---

### Step 4: Update Documentation

**Files to update:**
- `CLAUDE.md` - Add duration syntax to task format section
- `README.md` - Add duration to feature list and syntax reference

**Example addition to CLAUDE.md:**

```markdown
### Custom Duration
Override default event duration with ⏱️:
- [ ] Long meeting 📅 2026-01-15 ⏰ 14:00 ⏱️ 2h
- [ ] Quick sync 📅 2026-01-15 ⏰ 10:00 ⏱️ 15m
```

---

## Testing Checklist

- [ ] `⏱️ 2h` creates 2-hour event
- [ ] `⏱️ 30m` creates 30-minute event
- [ ] `⏱️ 1h30m` creates 90-minute event
- [ ] `⏱️ 45` creates 45-minute event (plain number)
- [ ] Task without ⏱️ uses default duration
- [ ] Duration is stripped from event title
- [ ] Duration displays correctly in task scan modal
- [ ] Updating duration triggers event update on next sync

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `⏱️ 0m` | Ignore, use default |
| `⏱️ 0h30m` | 30 minutes |
| `⏱️ 24h` | 24 hours (1440 minutes) - allow it |
| Multiple ⏱️ | First one wins |
| All-day event with ⏱️ | Duration ignored (all-day events don't have duration) |

---

## Future Enhancements

- EditorSuggest for `⏱️` that shows duration picker
- Duration presets in settings (e.g., "Meeting: 1h", "Call: 30m")
- Display duration in agenda sidebar
