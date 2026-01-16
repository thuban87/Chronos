# Safety Net - Deletion Protection System

Safety Net is Chronos's built-in protection against accidental data loss. When enabled (the default), Chronos requires your explicit approval before deleting any calendar events.

## Why Safety Net Exists

When syncing tasks to Google Calendar, there are several scenarios where Chronos needs to delete events:

1. **You delete a task line** - The calendar event becomes "orphaned"
2. **You change a task's tag** (with Fresh Start mode) - The old event needs to be deleted before creating a new one on the target calendar
3. **You switch your default calendar** (with Fresh Start mode) - Events need to move to the new calendar

In all these cases, deletion could result in losing valuable data that was added directly in Google Calendar:
- Meeting attendees and RSVPs
- Zoom/Meet links attached to events
- Custom descriptions you added
- Location information
- Any edits made outside Obsidian

Safety Net ensures you're always aware of what's being deleted and gives you the opportunity to recover.

## How It Works

### 1. Pending Deletions Queue

When a deletion is triggered, Chronos doesn't delete immediately. Instead:

- The deletion is added to a **pending queue**
- The status bar shows: `🗑️ 3 pending` (or however many)
- Events stay on your calendar until you approve deletion

### 2. Review Modal

Click the pending count in the status bar (or use command `Chronos: Review pending deletions`) to open the review modal:

```
┌─────────────────────────────────────────────────────────┐
│  3 Pending Deletions                    [Delete All]    │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ "Call Mom"                       Jan 15, 2:00 PM  │ │
│  │  📅 Work Calendar                                 │ │
│  │  Reason: Task line deleted                        │ │
│  │  [Restore]  [Keep Event]  [Delete Event]          │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  [Keep All]                                             │
└─────────────────────────────────────────────────────────┘
```

### 3. Your Options

For each pending deletion:

| Button | What It Does |
|--------|--------------|
| **Delete Event** | Confirms deletion - removes the event from Google Calendar |
| **Keep Event** | Keeps the calendar event, but stops Chronos from tracking it |
| **Restore** | Opens a modal to help you restore the task to your notes |

Batch operations:

| Button | What It Does |
|--------|--------------|
| **Delete All** | Confirms all pending deletions |
| **Keep All** | Keeps all events, stops tracking them |

## High-Risk Indicators

When an event has valuable data that would be lost, Chronos shows warning icons:

| Icon | Meaning |
|------|---------|
| 👥5 | Event has 5 attendees |
| 📹 | Event has a video conference link |
| 📝 | Event has a custom description |

High-risk events are highlighted with a red border to catch your attention.

## Task Restoration

If you accidentally deleted a task line and want to recover it:

1. Click **Restore** on the pending deletion
2. A modal shows the exact task line to paste back:
   ```
   - [ ] Call Mom 📅 2026-01-15 ⏰ 14:00
   ```
3. Click **Copy to Clipboard**
4. Paste it back into your notes
5. Click **Done - I've pasted it back**

After the next sync, Chronos will reconnect the task to the existing calendar event - no harm, no foul.

## Fresh Start Mode

When you have Fresh Start mode enabled for calendar routing, tag or calendar changes trigger a delete-and-recreate cycle. Safety Net intercepts these too:

```
┌─────────────────────────────────────────────────────────┐
│ 🔄 "Team Standup" → Calendar Change                     │
│    Old: Work Calendar (will be DELETED)                 │
│    New: Personal Calendar (will be CREATED)             │
│                                                         │
│    ⚠️ This event has:                                   │
│    • 5 attendees                                        │
│    • Zoom meeting link                                  │
│                                                         │
│    [Keep Original]  [Delete & Recreate]                 │
└─────────────────────────────────────────────────────────┘
```

- **Keep Original**: Keeps the old event, doesn't create a new one
- **Delete & Recreate**: Deletes old event, creates fresh one on new calendar

## Power User Mode

If you're comfortable with automatic deletions and don't need the safety net:

1. Go to **Settings → Chronos → Safety Net**
2. Toggle off **Safe Mode**
3. A warning modal will explain what you're disabling
4. Click **Enable Power User Mode**

In Power User mode:
- Deletions happen immediately during sync
- No pending queue or review modal
- The status bar won't show pending deletion counts

You can re-enable Safe Mode at any time.

## Recently Deleted Events

Even after deletion, you have a recovery option:

1. Open **Sync History** (command palette or settings)
2. Expand the **Recently Deleted** section
3. Find the event you want to restore
4. Click **Restore Event**

### Limitations

Restored events are NEW events created from saved snapshots:
- New event ID (external links won't work)
- Attendees are NOT automatically re-invited
- Original Zoom/Meet links cannot be restored
- You'll need to manually set up any integrations

Records are automatically pruned after 30 days.

## External Event Handling

When you move or delete events directly in Google Calendar, Chronos needs to know what to do on the next sync. By default (before Phase 12), Chronos would recreate the event - but this could create duplicates if you moved the event intentionally.

### External Event Behavior Setting

In **Settings → Chronos → External Event Handling**, choose how Chronos handles events it can't find (404):

| Option | What Happens |
|--------|--------------|
| **Ask me each time** (default) | Event is queued for review. Status bar shows count. You decide per-event. |
| **Sever link** | The task is "severed" from sync. It won't sync again unless you edit it. |
| **Recreate event** | Event is recreated on the original calendar (old behavior). |

### Review Modal

When using "Ask me each time" mode:

1. Chronos detects a missing event (404)
2. The event is added to the pending severances queue
3. Status bar shows: `🔗 3 disconnected` (or however many)
4. Click to open the review modal

For each disconnected event, you can:
- **Sever Link**: Stop tracking this task (won't sync unless edited)
- **Recreate Event**: Create a new event on the original calendar

Batch operations:
- **Sever All**: Sever all pending events at once
- **Recreate All**: Recreate all pending events at once

### Severed Tasks

When a task is severed:
- The sync record is kept (for reconciliation)
- The task won't sync on future syncs
- The sync history shows it as "🔗 Severed"

### Recovery Path

To sync a severed task again, edit its **title**, **date**, or **time**. This changes the task ID, allowing it to sync as a fresh event. Note: this creates a NEW event - it doesn't reconnect to the moved one.

---

## Settings Reference

### Safe Mode (default: ON)

When enabled, all deletions require your approval via the review modal.

### Event Routing Behavior

How Chronos handles events when tasks change calendars:

| Mode | Behavior |
|------|----------|
| **Preserve** | Moves events between calendars (no deletion) |
| **Keep Both** | Creates new event, leaves old one dormant |
| **Fresh Start** | Deletes old event, creates new one (Safety Net applies) |

### When Task Is Completed

What happens when you check off a task:

| Setting | Behavior |
|---------|----------|
| **Mark as completed** | Appends completion date to event title |
| **Delete from calendar** | Removes the event (Safety Net does NOT apply - this is an explicit action) |

## FAQ

### Why doesn't Safety Net apply to completed tasks?

Checking off a task is an explicit, deliberate action. You're telling Obsidian "I'm done with this." The deletion (if you have that setting enabled) is a natural consequence of your action.

Safety Net is designed for accidental scenarios - like when you accidentally delete a line while editing.

### Can I disable Safety Net for just one sync?

Not currently. You either have Safe Mode on or off. If you need to do a one-time bulk deletion, temporarily disable Safe Mode, run the sync, then re-enable it.

### What if I have 100 pending deletions?

The review modal supports batch operations. Click **Delete All** to approve them all at once, or **Keep All** to dismiss them.

### Will pending deletions sync eventually?

No. Pending deletions wait indefinitely until you review them. Your calendar events are safe until you make a decision.
