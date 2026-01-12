# Recurring Task Succession - Implementation Guide

**Created:** January 11, 2026
**Status:** Ready for Implementation
**Priority:** High - Fixes duplicate event bug with recurring tasks

---

## Problem Statement

When a user completes a recurring task in Obsidian, the Tasks plugin creates a new task instance (with the next occurrence date) while Chronos has already created a recurring Google Calendar event (with RRULE). This causes **duplicate events** because:

1. Original task synced to Google as recurring event (RRULE handles future occurrences)
2. Tasks plugin creates NEW Obsidian task with next date
3. Chronos sees new task, creates ANOTHER recurring event
4. Result: Two overlapping recurring series in Google Calendar

### Example

**Before completion:**
```markdown
- [ ] Daily standup 📅 2026-01-12 ⏰ 09:00 🔁 every day
```
(Synced to Google event ID: `abc123` with `RRULE:FREQ=DAILY`)

**After completion (Tasks plugin creates new task below):**
```markdown
- [x] Daily standup 📅 2026-01-12 ⏰ 09:00 🔁 every day ✅ 2026-01-11
- [ ] Daily standup 📅 2026-01-13 ⏰ 09:00 🔁 every day
```

**Current behavior:** Chronos creates NEW recurring event for the second task → duplicates.

**Desired behavior:** Chronos recognizes the second task as the "successor" and transfers the sync record (same event ID `abc123`). No new Google event created.

---

## Solution Overview

### Core Concept

The Google Calendar recurring event is the **series**. Obsidian tasks are **instances** that come and go. When an instance is completed and a new one appears, we transfer our tracking to the new instance without touching Google.

### Implementation Location

Add a **Third Reconciliation Pass** in `computeMultiCalendarSyncDiff()` in `src/syncManager.ts`. This is the correct place because:
- We already have lists of `orphaned` tasks (completed/deleted) and `toCreate` tasks (new)
- Reconciliation passes already exist for renames and cross-file moves
- By the time we reach `buildChangeSet()`, it's too late

### High-Level Flow

```
Sync runs
    ↓
computeMultiCalendarSyncDiff() called
    ↓
Pass 1: In-place edits (same file + line)
Pass 2: Cross-file moves (same title + date + time)
Pass 3: Recurring succession (NEW)
    ↓
For each orphaned recurring task:
    Look for successor in toCreate list
    If found → migrate sync record
    If not found → add to pendingSuccessorCheck queue
    ↓
NEXT sync cycle:
    Check pendingSuccessorCheck queue
    If successor now exists → migrate
    If still not found → show modal (delete series or keep?)
```

---

## Detailed Implementation Steps

### Step 1: Add `recurrenceRule` to `SyncedTaskInfo`

**File:** `src/syncManager.ts`

Currently we only store `isRecurring: boolean`. We need the actual RRULE to detect pattern changes.

```typescript
export interface SyncedTaskInfo {
    // ... existing fields ...

    /** Whether this event was created as recurring */
    isRecurring?: boolean;
    /** The RRULE string (e.g., "FREQ=DAILY" or "FREQ=WEEKLY;BYDAY=MO") */
    recurrenceRule?: string;
}
```

**Also update `recordSync()` to store the rule:**

```typescript
recordSync(task: ChronosTask, eventId: string, calendarId: string): void {
    // ... existing code ...

    this.syncData.syncedTasks[taskId] = {
        // ... existing fields ...
        isRecurring: !!task.recurrenceRule,
        recurrenceRule: task.recurrenceRule || undefined,
    };
}
```

---

### Step 2: Add `pendingSuccessorCheck` Queue

**File:** `src/syncManager.ts`

Add to `ChronosSyncData` interface:

```typescript
export interface ChronosSyncData {
    // ... existing fields ...

    /** Recurring tasks awaiting successor verification (deferred to next sync) */
    pendingSuccessorChecks: PendingSuccessorCheck[];
}
```

Add new interface:

```typescript
export interface PendingSuccessorCheck {
    /** Unique ID for this pending check */
    id: string;
    /** The orphaned task ID (old recurring task) */
    orphanTaskId: string;
    /** Google Calendar event ID */
    eventId: string;
    /** Calendar ID */
    calendarId: string;
    /** Task title (for matching) */
    title: string;
    /** Task time (for matching) */
    time: string | null;
    /** RRULE (for matching and change detection) */
    recurrenceRule: string;
    /** Original task date */
    originalDate: string;
    /** File path (for matching) */
    filePath: string;
    /** When this was queued */
    queuedAt: string;
    /** Number of sync cycles we've waited */
    checkCount: number;
}
```

Add helper methods:

```typescript
addPendingSuccessorCheck(check: PendingSuccessorCheck): void {
    this.syncData.pendingSuccessorChecks.push(check);
}

removePendingSuccessorCheck(id: string): void {
    this.syncData.pendingSuccessorChecks =
        this.syncData.pendingSuccessorChecks.filter(c => c.id !== id);
}

getPendingSuccessorChecks(): PendingSuccessorCheck[] {
    return this.syncData.pendingSuccessorChecks || [];
}

generatePendingSuccessorCheckId(): string {
    return `psc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

**Initialize in constructor:**

```typescript
constructor(existingData?: ChronosSyncData) {
    this.syncData = existingData || {
        // ... existing defaults ...
        pendingSuccessorChecks: [],
    };
    // Ensure array exists for existing data
    if (!this.syncData.pendingSuccessorChecks) {
        this.syncData.pendingSuccessorChecks = [];
    }
}
```

---

### Step 3: Add Third Reconciliation Pass

**File:** `src/syncManager.ts`

In `computeMultiCalendarSyncDiff()`, after the existing reconciliation passes, add:

```typescript
// THIRD RECONCILIATION PASS: Recurring Task Succession
// Matches completed recurring tasks with their successor instances

for (const orphanId of potentialOrphans) {
    // Skip if already reconciled by previous passes
    if (reconciledOrphans.has(orphanId)) continue;

    const orphanInfo = this.syncData.syncedTasks[orphanId];

    // Only process recurring tasks
    if (!orphanInfo?.isRecurring) continue;

    // Try to find a successor in toCreate
    let successorFound = false;

    for (let i = 0; i < diff.toCreate.length; i++) {
        // Skip if already reconciled
        if (reconciledNewTasks.has(i)) continue;

        const candidate = diff.toCreate[i];
        const newTask = candidate.task;

        // Match criteria (strict)
        const titleMatch = newTask.title === orphanInfo.title;
        const timeMatch = newTask.time === orphanInfo.time;
        const sameFile = newTask.filePath === orphanInfo.filePath;
        const hasRecurrence = !!newTask.recurrenceRule || !!newTask.recurrenceText;
        const isFutureDate = newTask.date > (orphanInfo.date || '');

        if (titleMatch && timeMatch && sameFile && hasRecurrence && isFutureDate) {
            // Check if recurrence pattern changed significantly
            const rruleMatch = orphanInfo.recurrenceRule === newTask.recurrenceRule;

            if (!rruleMatch && orphanInfo.recurrenceRule && newTask.recurrenceRule) {
                // Recurrence pattern changed - queue for user decision
                // (handled separately - see Step 6)
                this.queueRecurrencePatternChange(orphanId, orphanInfo, newTask, candidate.calendarId);
                reconciledOrphans.add(orphanId);
                reconciledNewTasks.add(i);
                successorFound = true;
                break;
            }

            // Found valid successor - migrate sync record
            reconciledOrphans.add(orphanId);
            reconciledNewTasks.add(i);
            successorFound = true;

            const newTaskId = this.generateTaskId(newTask);

            // Migrate sync data from old task ID to new task ID
            this.syncData.syncedTasks[newTaskId] = {
                ...orphanInfo,
                filePath: newTask.filePath,
                lineNumber: newTask.lineNumber,
                title: newTask.title,
                date: newTask.date,
                time: newTask.time,
                tags: newTask.tags,
                contentHash: this.generateContentHash(newTask),
                lastSyncedAt: new Date().toISOString(),
                // Keep the original eventId - this is the key!
                eventId: orphanInfo.eventId,
                severed: false,
            };

            // Delete old sync record
            delete this.syncData.syncedTasks[orphanId];

            // Remove from toCreate (it's now "unchanged" - no Google API call needed)
            diff.toCreate.splice(i, 1);

            // Add to unchanged (for existence verification)
            diff.unchanged.push({
                task: newTask,
                calendarId: candidate.calendarId,
            });

            break;
        }
    }

    // No successor found - queue for deferred check
    if (!successorFound && orphanInfo) {
        this.addPendingSuccessorCheck({
            id: this.generatePendingSuccessorCheckId(),
            orphanTaskId: orphanId,
            eventId: orphanInfo.eventId,
            calendarId: orphanInfo.calendarId,
            title: orphanInfo.title || '',
            time: orphanInfo.time || null,
            recurrenceRule: orphanInfo.recurrenceRule || '',
            originalDate: orphanInfo.date || '',
            filePath: orphanInfo.filePath,
            queuedAt: new Date().toISOString(),
            checkCount: 0,
        });

        // DON'T add to orphaned yet - defer decision
        reconciledOrphans.add(orphanId);
    }
}
```

---

### Step 4: Process Pending Successor Checks

**File:** `main.ts` (in `syncTasks()`)

At the beginning of sync, before computing the diff, process any pending successor checks:

```typescript
async syncTasks(silent: boolean = false): Promise<void> {
    // ... existing auth checks ...

    // Process pending successor checks from previous sync
    await this.processPendingSuccessorChecks(batchId);

    // ... rest of existing sync logic ...
}

private async processPendingSuccessorChecks(batchId: string): Promise<void> {
    const pendingChecks = this.syncManager.getPendingSuccessorChecks();
    if (pendingChecks.length === 0) return;

    // Scan vault for current tasks
    const allTasks = await this.taskParser.scanVault(
        true,
        this.settings.excludedFolders,
        this.settings.excludedFiles
    );
    const uncompletedTasks = allTasks.filter(t => !t.isCompleted);

    for (const check of pendingChecks) {
        check.checkCount++;

        // Look for successor
        const successor = uncompletedTasks.find(task =>
            task.title === check.title &&
            task.time === check.time &&
            task.filePath === check.filePath &&
            (task.recurrenceRule || task.recurrenceText) &&
            task.date > check.originalDate
        );

        if (successor) {
            // Found successor - migrate sync record
            const newTaskId = this.syncManager.generateTaskId(successor);
            const oldInfo = this.syncManager.getSyncInfo(check.orphanTaskId);

            if (oldInfo) {
                this.syncManager.migrateRecurringSyncRecord(
                    check.orphanTaskId,
                    newTaskId,
                    successor
                );
            }

            this.syncManager.removePendingSuccessorCheck(check.id);
        } else if (check.checkCount >= 2) {
            // Waited 2 sync cycles, still no successor - show modal
            this.pendingSeriesDisconnections.push(check);
            this.syncManager.removePendingSuccessorCheck(check.id);
        }
        // else: keep in queue for next sync
    }

    // Show modal if we have disconnected series
    if (this.pendingSeriesDisconnections.length > 0) {
        await this.showSeriesDisconnectionModal();
    }

    await this.saveSettings();
}
```

---

### Step 5: Add Series Disconnection Modal

**File:** `src/seriesDisconnectionModal.ts` (NEW FILE)

```typescript
import { App, Modal } from 'obsidian';
import { PendingSuccessorCheck } from './syncManager';

export type SeriesDisconnectionChoice = 'delete' | 'keep';

export class SeriesDisconnectionModal extends Modal {
    private check: PendingSuccessorCheck;
    private onChoice: (choice: SeriesDisconnectionChoice) => void;

    constructor(
        app: App,
        check: PendingSuccessorCheck,
        onChoice: (choice: SeriesDisconnectionChoice) => void
    ) {
        super(app);
        this.check = check;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-series-disconnection-modal');

        contentEl.createEl('h2', { text: 'Recurring Series Disconnected' });

        const infoDiv = contentEl.createDiv({ cls: 'chronos-disconnection-info' });
        infoDiv.createEl('p', {
            text: `The recurring task "${this.check.title}" was completed, but no successor task was found.`
        });
        infoDiv.createEl('p', {
            text: 'This can happen if the Tasks plugin didn\'t create a new instance, or if you deleted/modified it.'
        });

        const detailsDiv = contentEl.createDiv({ cls: 'chronos-disconnection-details' });
        detailsDiv.createEl('p', { text: `Original date: ${this.check.originalDate}` });
        detailsDiv.createEl('p', { text: `File: ${this.check.filePath}` });

        contentEl.createEl('p', {
            text: 'What would you like to do with the Google Calendar recurring series?',
            cls: 'chronos-disconnection-question'
        });

        const buttonContainer = contentEl.createDiv({ cls: 'chronos-disconnection-buttons' });

        const deleteBtn = buttonContainer.createEl('button', {
            text: 'Delete Series',
            cls: 'mod-warning'
        });
        deleteBtn.addEventListener('click', () => {
            this.onChoice('delete');
            this.close();
        });

        const keepBtn = buttonContainer.createEl('button', {
            text: 'Keep Series',
            cls: 'mod-cta'
        });
        keepBtn.addEventListener('click', () => {
            this.onChoice('keep');
            this.close();
        });

        contentEl.createEl('p', {
            text: 'Tip: "Keep Series" lets the calendar events continue. You can manually delete them later if needed.',
            cls: 'chronos-disconnection-hint'
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
```

---

### Step 6: Handle Recurrence Pattern Changes

When the RRULE changes (e.g., `every day` → `every week`), show a different modal:

**File:** `src/recurrenceChangeModal.ts` (NEW FILE)

```typescript
import { App, Modal } from 'obsidian';

export type RecurrenceChangeChoice = 'update' | 'newSeries' | 'keep';

export class RecurrenceChangeModal extends Modal {
    private taskTitle: string;
    private oldPattern: string;
    private newPattern: string;
    private onChoice: (choice: RecurrenceChangeChoice) => void;

    constructor(
        app: App,
        taskTitle: string,
        oldPattern: string,
        newPattern: string,
        onChoice: (choice: RecurrenceChangeChoice) => void
    ) {
        super(app);
        this.taskTitle = taskTitle;
        this.oldPattern = oldPattern;
        this.newPattern = newPattern;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-recurrence-change-modal');

        contentEl.createEl('h2', { text: 'Recurrence Pattern Changed' });

        contentEl.createEl('p', {
            text: `The recurrence pattern for "${this.taskTitle}" has changed:`
        });

        const changeDiv = contentEl.createDiv({ cls: 'chronos-pattern-change' });
        changeDiv.createEl('p', { text: `Old: ${this.oldPattern}` });
        changeDiv.createEl('p', { text: `New: ${this.newPattern}` });

        contentEl.createEl('p', {
            text: 'This is a significant change. How would you like to handle it?'
        });

        const buttonContainer = contentEl.createDiv({ cls: 'chronos-recurrence-buttons' });

        const newSeriesBtn = buttonContainer.createEl('button', {
            text: 'Create New Series (Delete Old)',
            cls: 'mod-warning'
        });
        newSeriesBtn.addEventListener('click', () => {
            this.onChoice('newSeries');
            this.close();
        });

        const keepBothBtn = buttonContainer.createEl('button', {
            text: 'Create New Series (Keep Old)',
        });
        keepBothBtn.addEventListener('click', () => {
            this.onChoice('keep');
            this.close();
        });

        contentEl.createEl('p', {
            text: 'Note: "Keep Old" lets you copy any important details from the old series before deleting it manually.',
            cls: 'chronos-recurrence-hint'
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
```

---

### Step 7: Add Helper Method for Sync Record Migration

**File:** `src/syncManager.ts`

```typescript
/**
 * Migrate a recurring task's sync record to a new task ID
 * Used when Tasks plugin creates a successor instance
 */
migrateRecurringSyncRecord(
    oldTaskId: string,
    newTaskId: string,
    newTask: ChronosTask
): void {
    const oldInfo = this.syncData.syncedTasks[oldTaskId];
    if (!oldInfo) return;

    // Create new record with updated task info but same event ID
    this.syncData.syncedTasks[newTaskId] = {
        ...oldInfo,
        filePath: newTask.filePath,
        lineNumber: newTask.lineNumber,
        title: newTask.title,
        date: newTask.date,
        time: newTask.time,
        tags: newTask.tags,
        contentHash: this.generateContentHash(newTask),
        lastSyncedAt: new Date().toISOString(),
        severed: false,
    };

    // Remove old record
    delete this.syncData.syncedTasks[oldTaskId];
}
```

---

### Step 8: Wire Up Modals in main.ts

**File:** `main.ts`

Add property:
```typescript
pendingSeriesDisconnections: PendingSuccessorCheck[] = [];
```

Add modal handler:
```typescript
private async showSeriesDisconnectionModal(): Promise<void> {
    for (const check of this.pendingSeriesDisconnections) {
        const choice = await new Promise<SeriesDisconnectionChoice>((resolve) => {
            new SeriesDisconnectionModal(this.app, check, resolve).open();
        });

        if (choice === 'delete') {
            // Delete the Google Calendar event
            try {
                await this.calendarApi.deleteEvent(check.calendarId, check.eventId);
                new Notice(`Deleted recurring series: ${check.title}`);
            } catch (error) {
                console.error('Failed to delete series:', error);
                new Notice(`Failed to delete series: ${check.title}`);
            }
        } else {
            // Keep - just release from tracking
            new Notice(`Kept recurring series: ${check.title} (no longer tracked)`);
        }

        // Remove sync record either way
        this.syncManager.removeSyncInfo(check.orphanTaskId);
    }

    this.pendingSeriesDisconnections = [];
    await this.saveSettings();
}
```

---

### Step 9: Add CSS Styles

**File:** `styles.css`

```css
/* Series Disconnection Modal */
.chronos-series-disconnection-modal {
    max-width: 500px;
}

.chronos-disconnection-info {
    margin: 1em 0;
    padding: 1em;
    background: var(--background-secondary);
    border-radius: 4px;
}

.chronos-disconnection-details {
    font-size: 0.9em;
    color: var(--text-muted);
    margin: 1em 0;
}

.chronos-disconnection-question {
    font-weight: 600;
    margin: 1em 0;
}

.chronos-disconnection-buttons {
    display: flex;
    gap: 1em;
    margin: 1em 0;
}

.chronos-disconnection-hint {
    font-size: 0.85em;
    color: var(--text-muted);
    font-style: italic;
}

/* Recurrence Change Modal */
.chronos-recurrence-change-modal {
    max-width: 500px;
}

.chronos-pattern-change {
    margin: 1em 0;
    padding: 1em;
    background: var(--background-secondary);
    border-radius: 4px;
    font-family: monospace;
}

.chronos-recurrence-buttons {
    display: flex;
    flex-direction: column;
    gap: 0.5em;
    margin: 1em 0;
}

.chronos-recurrence-hint {
    font-size: 0.85em;
    color: var(--text-muted);
    font-style: italic;
}
```

---

## Testing Checklist

### Happy Path
- [ ] Create recurring task: `- [ ] Test 📅 2026-01-12 ⏰ 09:00 🔁 every day`
- [ ] Sync → verify single recurring event in Google Calendar
- [ ] Complete task → Tasks plugin creates new instance below
- [ ] Sync → verify NO duplicate event created
- [ ] Check sync data: new task ID has same event ID as old

### Edge Cases
- [ ] Complete recurring task, then RENAME the new instance before sync → modal appears
- [ ] Complete recurring task, then DELETE the new instance → modal appears after 2 syncs
- [ ] Complete recurring task, change TIME on new instance → modal appears
- [ ] Complete recurring task, move new instance to different file → modal appears
- [ ] Change recurrence pattern (every day → every week) → recurrence change modal appears

### Race Condition
- [ ] Complete task and immediately trigger sync → should NOT show modal (deferred check)
- [ ] Wait for next sync cycle → should find successor OR show modal

### User Choices
- [ ] Series Disconnection → "Delete Series" → event deleted from Google
- [ ] Series Disconnection → "Keep Series" → event kept, sync record removed
- [ ] Recurrence Change → "Create New (Delete Old)" → old deleted, new created
- [ ] Recurrence Change → "Create New (Keep Old)" → old kept, new created

---

## Files to Create/Modify Summary

| File | Action | Description |
|------|--------|-------------|
| `src/syncManager.ts` | Modify | Add `recurrenceRule` to SyncedTaskInfo, add `pendingSuccessorChecks` queue, add third reconciliation pass |
| `src/seriesDisconnectionModal.ts` | Create | Modal for disconnected recurring series |
| `src/recurrenceChangeModal.ts` | Create | Modal for significant recurrence pattern changes |
| `main.ts` | Modify | Add `processPendingSuccessorChecks()`, wire up modals |
| `styles.css` | Modify | Add modal styles |

---

## Important Notes

1. **User must change Tasks plugin setting** to create new tasks BELOW completed tasks (not above). This keeps the original task's line number stable for reconciliation.

2. **The deferred check (2 sync cycles)** prevents false positives from race conditions with Tasks plugin.

3. **RRULE comparison** handles normalization (e.g., "every monday" → "every week on Monday" produce same RRULE).

4. **Existing synced recurring tasks** will work - they'll get `recurrenceRule` populated on next sync/update.

5. **No changes to Google Calendar API calls** - we're only changing our local tracking.
