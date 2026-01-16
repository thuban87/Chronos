# Implementation Guide: Multi-Calendar Agenda & Event Import

**Feature:** View multiple calendars in agenda + import events to Obsidian files
**Complexity:** Medium
**Estimated Effort:** 4-6 hours
**Dependencies:** None (builds on existing agenda sidebar)

---

## Overview

This is two related features:

1. **Multi-Calendar Agenda View:** Show events from multiple calendars in the agenda sidebar (not just the Chronos-synced calendar)

2. **Import Events to File:** Insert today's agenda into the current note as markdown links to Google Calendar events

---

# Part A: Multi-Calendar Agenda View

## Current State

- Agenda sidebar exists (Phase 7)
- Shows events from the default/synced calendar only
- Already fetches calendar list for settings dropdown
- Day navigation works

## Implementation Steps

### Step A1: Update Settings

**File:** `main.ts` (ChronosSettings)

```typescript
interface ChronosSettings {
    // ... existing

    /** Calendar IDs to show in agenda view (empty = just default calendar) */
    agendaCalendarIds: string[];
}

const DEFAULT_SETTINGS: ChronosSettings = {
    // ... existing
    agendaCalendarIds: [],  // Empty means just the synced calendar
};
```

---

### Step A2: Add Agenda Calendar Selection UI

**File:** `main.ts` (settings tab)

Add a section for selecting which calendars appear in the agenda:

```typescript
// ===== Agenda View Settings =====
containerEl.createEl('h3', { text: 'Agenda View' });

new Setting(containerEl)
    .setName('Calendars to display')
    .setDesc('Select which calendars to show in the agenda sidebar. Your synced calendar is always included.');

// Show checkboxes for each available calendar
const calendarCheckboxContainer = containerEl.createDiv({ cls: 'chronos-calendar-checkboxes' });

if (this.plugin.calendarList && this.plugin.calendarList.length > 0) {
    for (const cal of this.plugin.calendarList) {
        const isDefaultCalendar = cal.id === this.plugin.settings.googleCalendarId;
        const isChecked = isDefaultCalendar ||
            this.plugin.settings.agendaCalendarIds.includes(cal.id);

        const row = calendarCheckboxContainer.createDiv({ cls: 'chronos-calendar-checkbox-row' });

        const checkbox = row.createEl('input', {
            type: 'checkbox',
            attr: {
                id: `agenda-cal-${cal.id}`,
                checked: isChecked ? 'checked' : undefined,
                disabled: isDefaultCalendar ? 'disabled' : undefined  // Can't uncheck default
            }
        });

        const label = row.createEl('label', {
            text: cal.summary + (isDefaultCalendar ? ' (synced calendar)' : ''),
            attr: { for: `agenda-cal-${cal.id}` }
        });

        // Color indicator
        if (cal.backgroundColor) {
            const colorDot = row.createSpan({ cls: 'chronos-calendar-color-dot' });
            colorDot.style.backgroundColor = cal.backgroundColor;
        }

        if (!isDefaultCalendar) {
            checkbox.addEventListener('change', async () => {
                if (checkbox.checked) {
                    if (!this.plugin.settings.agendaCalendarIds.includes(cal.id)) {
                        this.plugin.settings.agendaCalendarIds.push(cal.id);
                    }
                } else {
                    this.plugin.settings.agendaCalendarIds =
                        this.plugin.settings.agendaCalendarIds.filter(id => id !== cal.id);
                }
                await this.plugin.saveSettings();
            });
        }
    }
} else {
    calendarCheckboxContainer.createEl('p', {
        text: 'Connect to Google Calendar to see available calendars.',
        cls: 'chronos-muted'
    });
}
```

---

### Step A3: Update Agenda Fetching

**File:** `main.ts` or wherever agenda fetching lives

Modify the agenda data fetching to query multiple calendars:

```typescript
/**
 * Fetch events from multiple calendars for the agenda view
 */
async fetchAgendaEvents(date: Date): Promise<AgendaEvent[]> {
    const allEvents: AgendaEvent[] = [];

    // Always include the default synced calendar
    const calendarIds = [this.settings.googleCalendarId];

    // Add any additional selected calendars
    for (const id of this.settings.agendaCalendarIds) {
        if (!calendarIds.includes(id)) {
            calendarIds.push(id);
        }
    }

    // Fetch from each calendar
    for (const calendarId of calendarIds) {
        try {
            const events = await this.googleCalendar.listEventsForDate(calendarId, date);

            // Add calendar info to each event for display
            const calendarInfo = this.calendarList?.find(c => c.id === calendarId);
            for (const event of events) {
                allEvents.push({
                    ...event,
                    calendarId,
                    calendarName: calendarInfo?.summary || 'Unknown',
                    calendarColor: calendarInfo?.backgroundColor || '#4285f4',
                });
            }
        } catch (error) {
            console.error(`Failed to fetch events from calendar ${calendarId}:`, error);
            // Continue with other calendars
        }
    }

    // Sort by start time
    allEvents.sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
    });

    return allEvents;
}
```

---

### Step A4: Update Agenda Display

Show which calendar each event is from (color dot or label):

```typescript
// When rendering an event in the agenda:
const eventEl = container.createDiv({ cls: 'chronos-agenda-event' });

// Calendar color indicator
const colorDot = eventEl.createSpan({ cls: 'chronos-calendar-dot' });
colorDot.style.backgroundColor = event.calendarColor;

// Event time
const timeEl = eventEl.createSpan({ cls: 'chronos-agenda-time' });
timeEl.textContent = formatTime(event);

// Event title
const titleEl = eventEl.createSpan({ cls: 'chronos-agenda-title' });
titleEl.textContent = event.summary;

// Optionally show calendar name on hover
eventEl.setAttribute('title', `${event.summary} (${event.calendarName})`);
```

---

### Step A5: Add CSS

```css
.chronos-calendar-checkboxes {
    margin: 10px 0;
    padding: 10px;
    background: var(--background-secondary);
    border-radius: 5px;
}

.chronos-calendar-checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
}

.chronos-calendar-checkbox-row input[type="checkbox"] {
    margin: 0;
}

.chronos-calendar-color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
}

.chronos-calendar-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 6px;
    flex-shrink: 0;
}
```

---

# Part B: Import Events to File

## Overview

Add a command to insert today's (or the currently viewed day's) agenda into the active note as markdown.

## Output Format

```markdown
## Agenda for January 8, 2026

- 09:00 - [Team standup](https://calendar.google.com/calendar/event?eid=abc123)
- 10:30 - [Client call](https://calendar.google.com/calendar/event?eid=xyz789)
- All day - [Project deadline](https://calendar.google.com/calendar/event?eid=def456)
```

## Implementation Steps

### Step B1: Add Command

**File:** `main.ts`

```typescript
this.addCommand({
    id: 'import-agenda-to-file',
    name: 'Import agenda to current file',
    editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.importAgendaToEditor(editor);
    }
});
```

---

### Step B2: Implement Import Logic

```typescript
async importAgendaToEditor(editor: Editor): Promise<void> {
    // Get the date to import (could be today or the agenda view's current date)
    const importDate = this.agendaCurrentDate || new Date();

    // Fetch events from selected calendars
    const events = await this.fetchAgendaEvents(importDate);

    if (events.length === 0) {
        new Notice('No events found for this day');
        return;
    }

    // Format the output
    const lines: string[] = [];
    const dateStr = importDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    lines.push(`## Agenda for ${dateStr}`);
    lines.push('');

    for (const event of events) {
        const timeStr = this.formatEventTime(event);
        const link = event.htmlLink || '#';
        const title = event.summary || 'Untitled';

        lines.push(`- ${timeStr} - [${title}](${link})`);
    }

    lines.push('');

    // Insert at cursor position
    const cursor = editor.getCursor();
    editor.replaceRange(lines.join('\n'), cursor);

    new Notice(`Imported ${events.length} event${events.length === 1 ? '' : 's'}`);
}

private formatEventTime(event: AgendaEvent): string {
    if (event.start.date) {
        // All-day event
        return 'All day';
    }

    if (event.start.dateTime) {
        const date = new Date(event.start.dateTime);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    return '';
}
```

---

### Step B3: Add Settings for Import Format

Optional: Let users customize the import format.

```typescript
interface ChronosSettings {
    // ... existing

    /** Format for imported agenda */
    agendaImportFormat: 'list' | 'table' | 'simple';

    /** Include calendar name in import */
    agendaImportIncludeCalendar: boolean;
}
```

**List format (default):**
```markdown
- 09:00 - [Team standup](link)
```

**Table format:**
```markdown
| Time | Event | Calendar |
|------|-------|----------|
| 09:00 | [Team standup](link) | Work |
```

**Simple format (no links):**
```markdown
- 09:00 - Team standup
- 10:30 - Client call
```

---

### Step B4: Add Quick Import via Agenda Sidebar

Add a button to the agenda sidebar for quick import:

```typescript
// In agenda sidebar render:
const importBtn = headerEl.createEl('button', {
    text: '📋',
    cls: 'chronos-agenda-import-btn',
    attr: { title: 'Import to current file' }
});

importBtn.addEventListener('click', async () => {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
        await this.importAgendaToEditor(activeView.editor);
    } else {
        new Notice('Open a note to import agenda');
    }
});
```

---

## Testing Checklist

### Multi-Calendar Agenda
- [ ] Default calendar always shows in agenda
- [ ] Additional calendars can be selected in settings
- [ ] Events from multiple calendars appear sorted by time
- [ ] Calendar color dots display correctly
- [ ] Unselecting a calendar removes its events from agenda
- [ ] Errors fetching one calendar don't break others

### Import to File
- [ ] Command appears in command palette
- [ ] Events insert at cursor position
- [ ] All-day events format correctly
- [ ] Timed events format correctly
- [ ] Links work (open Google Calendar)
- [ ] Empty day shows notice
- [ ] Multiple calendars included if selected

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No events on day | Show "No events" notice |
| Calendar not accessible | Skip it, show events from others |
| Event has no title | Use "Untitled" |
| Event has no link | Use "#" as placeholder |
| Very long event title | Don't truncate (let markdown wrap) |
| All-day multi-day event | Show on each day it spans |

---

## Future Enhancements

### Multi-Calendar Agenda
- **Week view:** Show a week at a glance
- **Filter by calendar:** Toggle calendars on/off in the sidebar itself
- **Create event:** Button to create event on selected calendar

### Import Feature
- **Date picker:** Import any day, not just current
- **Template support:** User-defined import format
- **Append mode:** Add to existing agenda section vs. insert at cursor
- **Two-way linking:** Import as tasks that sync back (complex!)
- **Daily note integration:** Auto-import agenda to daily note on creation
