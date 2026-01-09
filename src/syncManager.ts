import { ChronosTask } from './taskParser';
import { ChangeSet, ChangeSetOperation, DivertedDeletion, generateOperationId } from './batchApi';

/**
 * A log entry for sync operations
 */
export interface SyncLogEntry {
    /** Timestamp of the operation */
    timestamp: string;
    /** Batch ID to group operations from the same sync run */
    batchId: string;
    /** Type of operation */
    type: 'create' | 'update' | 'delete' | 'complete' | 'recreate' | 'move' | 'sever' | 'error';
    /** Task title or description */
    taskTitle: string;
    /** Source file path */
    filePath?: string;
    /** Whether the operation succeeded */
    success: boolean;
    /** Error message if failed */
    errorMessage?: string;
}

/**
 * A pending operation that failed and needs to be retried
 */
export interface PendingOperation {
    /** Type of operation */
    type: 'create' | 'update' | 'delete' | 'complete';
    /** Task ID for reference */
    taskId: string;
    /** Task data (for create/update) */
    taskData?: {
        title: string;
        date: string;
        time: string | null;
        filePath: string;
        lineNumber: number;
        rawText: string;
        isAllDay: boolean;
    };
    /** Event ID (for update/delete/complete) */
    eventId?: string;
    /** Calendar ID */
    calendarId: string;
    /** When this operation was queued */
    queuedAt: string;
    /** Number of retry attempts */
    retryCount: number;
}

/**
 * A pending deletion awaiting user approval (Safety Net)
 */
export interface PendingDeletion {
    /** Unique ID for this pending item */
    id: string;
    /** The Chronos task ID */
    taskId: string;
    /** Google Calendar event ID */
    eventId: string;
    /** Which calendar the event is on */
    calendarId: string;

    // For display
    /** Event title */
    eventTitle: string;
    /** Event date (YYYY-MM-DD) */
    eventDate: string;
    /** Event time (HH:mm) or null for all-day */
    eventTime?: string | null;
    /** Which file the task was in */
    sourceFile: string;

    // Why is this being deleted?
    /** Reason for deletion */
    reason: 'orphaned' | 'freshStart';
    /** Human-readable reason detail */
    reasonDetail?: string;

    // For task line restoration
    /** The reconstructed task line for copy/paste */
    originalTaskLine: string;

    // For freshStart - linked creation info
    linkedCreate?: {
        newCalendarId: string;
        newCalendarName: string;
        task: ChronosTask;
    };

    // For event restoration (stores event details)
    eventSnapshot?: {
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
        colorId?: string;
        attendees?: Array<{ email: string; displayName?: string }>;
        conferenceData?: unknown;
    };

    // Risk indicators (populated from event snapshot)
    hasAttendees?: boolean;
    hasCustomDescription?: boolean;
    hasConferenceLink?: boolean;

    /** When this deletion was queued */
    queuedAt: string;
}

/**
 * A record of a deleted event (for historical recovery)
 */
export interface DeletedEventRecord {
    /** Unique ID */
    id: string;
    /** Event title */
    eventTitle: string;
    /** Event date */
    eventDate: string;
    /** Calendar name */
    calendarName: string;
    /** Calendar ID */
    calendarId: string;
    /** When the deletion was confirmed */
    deletedAt: string;
    /** How the deletion was confirmed */
    confirmedBy: 'user' | 'auto';

    // For event restoration
    eventSnapshot?: {
        summary: string;
        description?: string;
        location?: string;
        start: { dateTime?: string; date?: string; timeZone?: string };
        end: { dateTime?: string; date?: string; timeZone?: string };
        reminders?: { useDefault: boolean; overrides?: Array<{ method: string; minutes: number }> };
        colorId?: string;
        attendees?: Array<{ email: string; displayName?: string }>;
    };

    /** When this record expires (for auto-prune) */
    expiresAt: string;
}

/**
 * A pending severance awaiting user review (when externalEventBehavior = 'ask')
 */
export interface PendingSeverance {
    /** Unique ID for this pending item */
    id: string;
    /** The Chronos task ID */
    taskId: string;
    /** Google Calendar event ID (now missing/moved) */
    eventId: string;
    /** Calendar where event was expected */
    calendarId: string;
    /** Human-readable calendar name */
    calendarName: string;

    // For display
    /** Event title */
    eventTitle: string;
    /** Event date (YYYY-MM-DD) */
    eventDate: string;
    /** Event time (HH:mm) or undefined for all-day */
    eventTime?: string;
    /** Which file the task is in */
    sourceFile: string;

    /** ISO timestamp when 404 was detected */
    detectedAt: string;
    /** Original task line for reference */
    originalTaskLine: string;
}

/**
 * Information about a synced task stored in plugin data
 */
export interface SyncedTaskInfo {
    /** Google Calendar event ID */
    eventId: string;
    /** Hash of the task content for change detection */
    contentHash: string;
    /** Calendar ID the event was created in */
    calendarId: string;
    /** When this task was last synced */
    lastSyncedAt: string;
    /** Original file path (for reference) */
    filePath: string;
    /** Original line number (for reference) */
    lineNumber: number;
    /** Task title (for reconciliation when line numbers change) */
    title?: string;
    /** Task date (for reconciliation when line numbers change) */
    date?: string;
    /** Task time (for reconciliation - distinguishes same-title tasks at different times) */
    time?: string | null;
    /** Whether this task has been severed (won't sync unless edited) */
    severed?: boolean;
    /** Content hash at time of severance (to detect edits) */
    severedContentHash?: string;
}

/**
 * Sync data stored in plugin data
 */
export interface ChronosSyncData {
    /** Map of Task ID → Synced Task Info */
    syncedTasks: Record<string, SyncedTaskInfo>;
    /** ISO timestamp of last sync operation */
    lastSyncAt: string | null;
    /** Queue of operations that failed and need to be retried */
    pendingOperations: PendingOperation[];
    /** Log of recent sync operations */
    syncLog: SyncLogEntry[];
    /** Pending deletions awaiting user approval (Safety Net) */
    pendingDeletions: PendingDeletion[];
    /** Recently deleted events for historical recovery */
    recentlyDeleted: DeletedEventRecord[];
    /** Task IDs that have been severed (won't sync again unless edited) */
    severedTaskIds: string[];
    /** Pending severances awaiting user review (ask mode) */
    pendingSeverances: PendingSeverance[];
}

/**
 * Result of comparing current tasks with synced state
 */
export interface SyncDiff {
    /** Tasks that need to be created (not synced before) */
    toCreate: ChronosTask[];
    /** Tasks that need to be updated (content changed) */
    toUpdate: { task: ChronosTask; eventId: string }[];
    /** Tasks that haven't changed (skip) */
    unchanged: ChronosTask[];
    /** Task IDs that no longer exist in vault (for future cleanup) */
    orphaned: string[];
}

/**
 * Result of multi-calendar sync diff - includes target calendar per task
 */
export interface MultiCalendarSyncDiff {
    /** Tasks that need to be created (never synced before), with their target calendar */
    toCreate: { task: ChronosTask; targetCalendarId: string }[];
    /** Tasks that need to be updated (content changed, same calendar) */
    toUpdate: { task: ChronosTask; eventId: string; calendarId: string }[];
    /** Tasks that need to be rerouted (calendar changed due to tag or default change) */
    toReroute: { task: ChronosTask; eventId: string; oldCalendarId: string; newCalendarId: string }[];
    /** Tasks that haven't changed */
    unchanged: { task: ChronosTask; calendarId: string }[];
    /** Task IDs that no longer exist in vault */
    orphaned: string[];
    /** Warnings generated during diff computation */
    warnings: string[];
}

/**
 * Manages sync state between Obsidian tasks and Google Calendar events
 */
export class SyncManager {
    private syncData: ChronosSyncData;
    private static MAX_LOG_ENTRIES = 100;

    constructor(syncData?: ChronosSyncData) {
        this.syncData = syncData || {
            syncedTasks: {},
            lastSyncAt: null,
            pendingOperations: [],
            syncLog: [],
            pendingDeletions: [],
            recentlyDeleted: [],
        };
        // Ensure arrays exist (for backwards compatibility)
        if (!this.syncData.pendingOperations) {
            this.syncData.pendingOperations = [];
        }
        if (!this.syncData.syncLog) {
            this.syncData.syncLog = [];
        }
        if (!this.syncData.pendingDeletions) {
            this.syncData.pendingDeletions = [];
        }
        if (!this.syncData.recentlyDeleted) {
            this.syncData.recentlyDeleted = [];
        }
    }

    /**
     * Generate a stable Task ID from a task
     * ID is based on file path + title + date + time to identify a task
     * Using title (not line number) means moving/reorganizing tasks is stable
     * Trade-off: renaming a task changes the ID, but reconciliation catches it by line number
     * Note: task.title is already stripped of tags by taskParser, so tag changes don't affect ID
     * Including time allows multiple same-named events on the same day (e.g., "Focus block" at different times)
     */
    generateTaskId(task: ChronosTask): string {
        // Use title instead of line number so moving tasks doesn't change the ID
        // This ensures reorganizing notes (adding lines above, moving tasks) is stable
        // Renaming a task changes the ID, but reconciliation matches by line number
        // Include time to differentiate same-title tasks at different times on the same day
        const input = `${task.filePath}|${task.title}|${task.date}|${task.time || 'allday'}`;
        return this.simpleHash(input);
    }

    /**
     * Generate a content hash for change detection
     * Includes the full raw text so any change (time, markers, etc.) is detected
     */
    generateContentHash(task: ChronosTask): string {
        return this.simpleHash(task.rawText);
    }

    /**
     * Simple string hash function
     * Uses djb2 algorithm - fast and good distribution for our use case
     */
    private simpleHash(str: string): string {
        let hash = 5381;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash) + str.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Convert to hex string, ensure positive
        return (hash >>> 0).toString(16);
    }

    /**
     * Compare current tasks with synced state to determine what actions are needed
     */
    computeSyncDiff(currentTasks: ChronosTask[], calendarId: string): SyncDiff {
        const diff: SyncDiff = {
            toCreate: [],
            toUpdate: [],
            unchanged: [],
            orphaned: [],
        };

        // Track which synced task IDs we've seen
        const seenTaskIds = new Set<string>();

        for (const task of currentTasks) {
            const taskId = this.generateTaskId(task);
            const contentHash = this.generateContentHash(task);
            seenTaskIds.add(taskId);

            const existing = this.syncData.syncedTasks[taskId];

            if (!existing) {
                // Never synced before
                diff.toCreate.push(task);
            } else if (existing.contentHash !== contentHash) {
                // Content has changed - need to update
                diff.toUpdate.push({ task, eventId: existing.eventId });
            } else if (existing.calendarId !== calendarId) {
                // Calendar changed - treat as new (old event in different calendar)
                diff.toCreate.push(task);
            } else {
                // No changes
                diff.unchanged.push(task);
            }
        }

        // Find orphaned entries (synced tasks no longer in vault)
        for (const taskId of Object.keys(this.syncData.syncedTasks)) {
            if (!seenTaskIds.has(taskId)) {
                diff.orphaned.push(taskId);
            }
        }

        return diff;
    }

    /**
     * Compare current tasks with synced state, supporting per-task calendar routing
     * @param currentTasks All uncompleted tasks
     * @param getTargetCalendar Function that returns target calendar and optional warning for a task
     */
    computeMultiCalendarSyncDiff(
        currentTasks: ChronosTask[],
        getTargetCalendar: (task: ChronosTask) => { calendarId: string; warning?: string }
    ): MultiCalendarSyncDiff {
        const diff: MultiCalendarSyncDiff = {
            toCreate: [],
            toUpdate: [],
            toReroute: [],
            unchanged: [],
            orphaned: [],
            warnings: [],
        };

        // Track which synced task IDs we've seen
        const seenTaskIds = new Set<string>();
        // Track task info for duplicate detection
        const taskIdToInfo = new Map<string, { title: string; filePath: string; lineNumber: number }>();

        for (const task of currentTasks) {
            const taskId = this.generateTaskId(task);
            const contentHash = this.generateContentHash(task);

            // Skip severed tasks (external event handling - user chose to stop tracking)
            // Pass content hash to enable auto-unsever when task is edited
            if (this.isSevered(taskId, contentHash)) {
                continue;
            }

            // Check for duplicate task IDs (same title + date + file)
            if (seenTaskIds.has(taskId)) {
                const existingInfo = taskIdToInfo.get(taskId);
                diff.warnings.push(
                    `⚠️ Duplicate task detected: "${task.title}" on ${task.date} in ${task.filePath}` +
                    (existingInfo ? ` (conflicts with line ${existingInfo.lineNumber})` : '') +
                    `. Only one will sync correctly. Consider renaming one of the tasks.`
                );
                continue; // Skip the duplicate
            }

            seenTaskIds.add(taskId);
            taskIdToInfo.set(taskId, { title: task.title, filePath: task.filePath, lineNumber: task.lineNumber });

            // Get target calendar for this specific task
            const { calendarId: targetCalendarId, warning } = getTargetCalendar(task);
            if (warning) {
                diff.warnings.push(warning);
            }

            const existing = this.syncData.syncedTasks[taskId];

            if (!existing) {
                // Never synced before
                diff.toCreate.push({ task, targetCalendarId });
            } else if (existing.calendarId !== targetCalendarId) {
                // Target calendar changed (due to tag change or default calendar change)
                // This needs to be rerouted based on the user's routing behavior setting
                diff.toReroute.push({
                    task,
                    eventId: existing.eventId,
                    oldCalendarId: existing.calendarId,
                    newCalendarId: targetCalendarId
                });
            } else if (existing.contentHash !== contentHash) {
                // Content has changed - need to update in same calendar
                diff.toUpdate.push({ task, eventId: existing.eventId, calendarId: existing.calendarId });
            } else {
                // No changes
                diff.unchanged.push({ task, calendarId: existing.calendarId });
            }
        }

        // Find orphaned entries (synced tasks no longer in vault)
        // Include severed tasks - they need to participate in reconciliation
        // (so if the task is edited, we can detect it and unsever)
        const potentialOrphans: string[] = [];
        for (const taskId of Object.keys(this.syncData.syncedTasks)) {
            if (!seenTaskIds.has(taskId)) {
                potentialOrphans.push(taskId);
            }
        }

        // FIRST RECONCILIATION PASS: Match by filePath + lineNumber ONLY
        // This handles: renames, date changes, time changes (anything edited on the same line)
        // With title-based IDs, editing any ID component creates a "new" task and "orphans" the old one
        // We reconcile them by matching on line number to convert to an UPDATE
        const reconciledOrphans = new Set<string>();
        const reconciledNewTasks = new Set<number>(); // indices into diff.toCreate

        for (const orphanId of potentialOrphans) {
            const orphanInfo = this.syncData.syncedTasks[orphanId];

            // Skip if orphan doesn't have lineNumber stored (old entries before this feature)
            if (!orphanInfo.lineNumber) {
                continue;
            }

            // Try to find a matching new task in the same file on the same line
            for (let i = 0; i < diff.toCreate.length; i++) {
                if (reconciledNewTasks.has(i)) continue; // Already matched

                const newTask = diff.toCreate[i].task;
                const targetCalendarId = diff.toCreate[i].targetCalendarId;

                // Match by: same file, same line number (date/time/title can all change)
                // This catches: renames, rescheduling, time changes - anything edited in place
                if (newTask.filePath === orphanInfo.filePath &&
                    newTask.lineNumber === orphanInfo.lineNumber) {
                    // Found a match! This task was edited in place, not deleted+created
                    reconciledOrphans.add(orphanId);
                    reconciledNewTasks.add(i);

                    // Generate new task ID (based on new title/date/time) and migrate the sync entry
                    const newTaskId = this.generateTaskId(newTask);
                    const newContentHash = this.generateContentHash(newTask);

                    // Check if the old task was severed - if so, editing clears the severance
                    const wasSevered = orphanInfo.severed || this.isSevered(orphanId);

                    // Migrate: copy sync info to new ID, delete old ID
                    // Update all stored info to match the new task
                    // Clear severed flag - editing a task "resets" the severance
                    this.syncData.syncedTasks[newTaskId] = {
                        ...orphanInfo,
                        title: newTask.title,
                        date: newTask.date,
                        time: newTask.time,
                        severed: false, // Clear severed on edit
                    };
                    delete this.syncData.syncedTasks[orphanId];

                    // Also clear from legacy severedTaskIds if it was there
                    if (wasSevered) {
                        this.removeSeveredTaskId(orphanId);
                        // Severed tasks need new events (the old eventId is stale)
                        // Clear the eventId so it's treated as new
                        this.syncData.syncedTasks[newTaskId].eventId = '';
                        diff.toCreate.push({ task: newTask, targetCalendarId });
                    } else {
                        // Determine what action to take based on calendar and content changes
                        if (orphanInfo.calendarId !== targetCalendarId) {
                            // Calendar changed - needs rerouting
                            diff.toReroute.push({
                                task: newTask,
                                eventId: orphanInfo.eventId,
                                oldCalendarId: orphanInfo.calendarId,
                                newCalendarId: targetCalendarId
                            });
                        } else if (orphanInfo.contentHash !== newContentHash) {
                            // Content changed - needs update
                            diff.toUpdate.push({
                                task: newTask,
                                eventId: orphanInfo.eventId,
                                calendarId: orphanInfo.calendarId
                            });
                        } else {
                            // Content hash is the same - no actual changes needed
                            diff.unchanged.push({
                                task: newTask,
                                calendarId: orphanInfo.calendarId
                            });
                        }
                    }

                    break; // Found match, move to next orphan
                }
            }
        }

        // SECOND RECONCILIATION PASS: Match by title+date+time (catches cross-file moves)
        // Only process orphans that weren't matched in the first pass
        for (const orphanId of potentialOrphans) {
            if (reconciledOrphans.has(orphanId)) continue; // Already matched

            const orphanInfo = this.syncData.syncedTasks[orphanId];

            // Skip if orphan doesn't have title/date stored
            if (!orphanInfo.title || !orphanInfo.date) {
                continue;
            }

            // Try to find a matching new task with same title+date+time (any file)
            for (let i = 0; i < diff.toCreate.length; i++) {
                if (reconciledNewTasks.has(i)) continue; // Already matched

                const newTask = diff.toCreate[i].task;
                const targetCalendarId = diff.toCreate[i].targetCalendarId;

                // Match by: same title, same date, same time (file can be different - cross-file move)
                // Time comparison: both null (all-day) or both equal
                const timeMatches = (newTask.time === orphanInfo.time) ||
                    (newTask.time === null && orphanInfo.time === null);

                if (newTask.title === orphanInfo.title &&
                    newTask.date === orphanInfo.date &&
                    timeMatches) {

                    // Found a match! This task moved to a different file
                    reconciledOrphans.add(orphanId);
                    reconciledNewTasks.add(i);

                    // Generate new task ID and migrate the sync entry
                    const newTaskId = this.generateTaskId(newTask);
                    const newContentHash = this.generateContentHash(newTask);

                    // Check if the old task was severed - if so, editing clears the severance
                    const wasSevered = orphanInfo.severed || this.isSevered(orphanId);

                    // Migrate: copy sync info to new ID with updated file/line info
                    // Clear severed flag - editing a task "resets" the severance
                    this.syncData.syncedTasks[newTaskId] = {
                        ...orphanInfo,
                        filePath: newTask.filePath,
                        lineNumber: newTask.lineNumber,
                        severed: false, // Clear severed on edit
                    };
                    delete this.syncData.syncedTasks[orphanId];

                    // Also clear from legacy severedTaskIds if it was there
                    if (wasSevered) {
                        this.removeSeveredTaskId(orphanId);
                        // Severed tasks need new events (the old eventId is stale)
                        this.syncData.syncedTasks[newTaskId].eventId = '';
                        diff.toCreate.push({ task: newTask, targetCalendarId });
                    } else {
                        // Determine what action to take based on calendar and content changes
                        if (orphanInfo.calendarId !== targetCalendarId) {
                            // Calendar changed - needs rerouting
                            diff.toReroute.push({
                                task: newTask,
                                eventId: orphanInfo.eventId,
                                oldCalendarId: orphanInfo.calendarId,
                                newCalendarId: targetCalendarId
                            });
                        } else if (orphanInfo.contentHash !== newContentHash) {
                            // Content changed - needs update
                            diff.toUpdate.push({
                                task: newTask,
                                eventId: orphanInfo.eventId,
                                calendarId: orphanInfo.calendarId
                            });
                        } else {
                            // No content changes - just moved files
                            diff.unchanged.push({
                                task: newTask,
                                calendarId: orphanInfo.calendarId
                            });
                        }
                    }

                    break; // Found match, move to next orphan
                }
            }
        }

        // Remove reconciled items from their original lists
        diff.toCreate = diff.toCreate.filter((_, i) => !reconciledNewTasks.has(i));

        // Add remaining (unreconciled) orphans to the orphaned list
        for (const orphanId of potentialOrphans) {
            if (!reconciledOrphans.has(orphanId)) {
                const syncInfo = this.syncData.syncedTasks[orphanId];
                // Severed tasks that weren't reconciled = user deleted the task after severing
                // Silently remove them (don't trigger deletion prompts)
                if (syncInfo?.severed) {
                    delete this.syncData.syncedTasks[orphanId];
                    this.removeSeveredTaskId(orphanId);
                    continue;
                }
                diff.orphaned.push(orphanId);
            }
        }

        return diff;
    }

    /**
     * Record that a task was synced (created or updated)
     */
    recordSync(task: ChronosTask, eventId: string, calendarId: string): void {
        const taskId = this.generateTaskId(task);
        const contentHash = this.generateContentHash(task);

        this.syncData.syncedTasks[taskId] = {
            eventId,
            contentHash,
            calendarId,
            lastSyncedAt: new Date().toISOString(),
            filePath: task.filePath,
            lineNumber: task.lineNumber,
            title: task.title,
            date: task.date,
            time: task.time,
        };
    }

    /**
     * Remove a synced task record (when task is deleted/completed)
     */
    removeSync(taskId: string): void {
        delete this.syncData.syncedTasks[taskId];
    }

    /**
     * Get sync info for a task ID
     */
    getSyncInfo(taskId: string): SyncedTaskInfo | undefined {
        return this.syncData.syncedTasks[taskId];
    }

    /**
     * Update the stored line number for a synced task
     * Used when a task moves within a file but is otherwise unchanged
     * This ensures future renames can be reconciled correctly
     */
    updateSyncLineNumber(taskId: string, newLineNumber: number): void {
        const syncInfo = this.syncData.syncedTasks[taskId];
        if (syncInfo) {
            syncInfo.lineNumber = newLineNumber;
        }
    }

    /**
     * Update the last sync timestamp
     */
    updateLastSyncTime(): void {
        this.syncData.lastSyncAt = new Date().toISOString();
    }

    /**
     * Get the last sync timestamp
     */
    getLastSyncTime(): string | null {
        return this.syncData.lastSyncAt;
    }

    /**
     * Get the current sync data (for persistence)
     */
    getSyncData(): ChronosSyncData {
        return this.syncData;
    }

    /**
     * Get count of synced tasks
     */
    getSyncedTaskCount(): number {
        return Object.keys(this.syncData.syncedTasks).length;
    }

    /**
     * Add a failed operation to the pending queue
     */
    queueOperation(operation: Omit<PendingOperation, 'queuedAt' | 'retryCount'>): void {
        // Check if this operation is already queued (by taskId and type)
        const existingIndex = this.syncData.pendingOperations.findIndex(
            op => op.taskId === operation.taskId && op.type === operation.type
        );

        const fullOperation: PendingOperation = {
            ...operation,
            queuedAt: new Date().toISOString(),
            retryCount: 0,
        };

        if (existingIndex >= 0) {
            // Update existing operation
            this.syncData.pendingOperations[existingIndex] = fullOperation;
        } else {
            this.syncData.pendingOperations.push(fullOperation);
        }
    }

    /**
     * Get all pending operations
     */
    getPendingOperations(): PendingOperation[] {
        return [...this.syncData.pendingOperations];
    }

    /**
     * Remove a pending operation (after successful retry)
     */
    removePendingOperation(taskId: string, type: string): void {
        this.syncData.pendingOperations = this.syncData.pendingOperations.filter(
            op => !(op.taskId === taskId && op.type === type)
        );
    }

    /**
     * Increment retry count for an operation
     */
    incrementRetryCount(taskId: string, type: string): void {
        const op = this.syncData.pendingOperations.find(
            o => o.taskId === taskId && o.type === type
        );
        if (op) {
            op.retryCount++;
        }
    }

    /**
     * Remove operations that have exceeded max retries
     */
    pruneFailedOperations(maxRetries: number = 5): PendingOperation[] {
        const failed = this.syncData.pendingOperations.filter(op => op.retryCount >= maxRetries);
        this.syncData.pendingOperations = this.syncData.pendingOperations.filter(
            op => op.retryCount < maxRetries
        );
        return failed;
    }

    /**
     * Get count of pending operations
     */
    getPendingOperationCount(): number {
        return this.syncData.pendingOperations.length;
    }

    /**
     * Generate a unique batch ID for grouping sync operations
     */
    generateBatchId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    }

    /**
     * Add an entry to the sync log
     */
    logOperation(entry: Omit<SyncLogEntry, 'timestamp'>, batchId?: string): void {
        const fullEntry: SyncLogEntry = {
            ...entry,
            timestamp: new Date().toISOString(),
            batchId: batchId || entry.batchId || this.generateBatchId(),
        };

        // Add to beginning (newest first)
        this.syncData.syncLog.unshift(fullEntry);

        // Trim to max entries
        if (this.syncData.syncLog.length > SyncManager.MAX_LOG_ENTRIES) {
            this.syncData.syncLog = this.syncData.syncLog.slice(0, SyncManager.MAX_LOG_ENTRIES);
        }
    }

    /**
     * Get the sync log
     */
    getSyncLog(): SyncLogEntry[] {
        return this.syncData.syncLog;
    }

    /**
     * Clear the sync log
     */
    clearSyncLog(): void {
        this.syncData.syncLog = [];
    }

    /**
     * Build a ChangeSet from sync diff results
     * This collects all operations before batching
     *
     * @param safeMode - When true, orphaned and freshStart deletions are diverted for user approval
     */
    buildChangeSet(
        diff: MultiCalendarSyncDiff,
        completedTasks: { task: ChronosTask; syncInfo: SyncedTaskInfo }[],
        eventRoutingBehavior: 'preserve' | 'keepBoth' | 'freshStart',
        completedTaskBehavior: 'delete' | 'markComplete',
        defaultDurationMinutes: number,
        defaultReminderMinutes: number[],
        timeZone: string,
        safeMode: boolean = true
    ): ChangeSet {
        const operations: ChangeSetOperation[] = [];
        const needsEventData: ChangeSetOperation[] = [];
        const divertedDeletions: DivertedDeletion[] = [];

        // 1. CREATE operations (new tasks)
        for (const { task, targetCalendarId } of diff.toCreate) {
            const reminderMinutes = task.reminderMinutes || defaultReminderMinutes;
            const taskDuration = task.durationMinutes || defaultDurationMinutes;
            operations.push({
                id: generateOperationId('create'),
                type: 'create',
                calendarId: targetCalendarId,
                task,
                durationMinutes: taskDuration,
                reminderMinutes,
                timeZone,
            });
        }

        // 2. UPDATE operations (content changed, same calendar)
        // These need existing event data to preserve user edits
        for (const { task, eventId, calendarId } of diff.toUpdate) {
            const reminderMinutes = task.reminderMinutes || defaultReminderMinutes;
            const taskDuration = task.durationMinutes || defaultDurationMinutes;
            const op: ChangeSetOperation = {
                id: generateOperationId('update'),
                type: 'update',
                calendarId,
                eventId,
                task,
                durationMinutes: taskDuration,
                reminderMinutes,
                timeZone,
            };
            operations.push(op);
            needsEventData.push(op); // Mark for pre-fetch
        }

        // 3. REROUTE operations (calendar changed)
        for (const { task, eventId, oldCalendarId, newCalendarId } of diff.toReroute) {
            const reminderMinutes = task.reminderMinutes || defaultReminderMinutes;

            if (eventRoutingBehavior === 'preserve') {
                // Move the event - no deletion, no diversion needed
                operations.push({
                    id: generateOperationId('move'),
                    type: 'move',
                    calendarId: oldCalendarId,
                    eventId,
                    destinationCalendarId: newCalendarId,
                    task,
                });
            } else if (eventRoutingBehavior === 'keepBoth') {
                // Create new event (old one stays dormant) - no deletion, no diversion needed
                const taskDuration = task.durationMinutes || defaultDurationMinutes;
                operations.push({
                    id: generateOperationId('create'),
                    type: 'create',
                    calendarId: newCalendarId,
                    task,
                    durationMinutes: taskDuration,
                    reminderMinutes,
                    timeZone,
                });
            } else if (eventRoutingBehavior === 'freshStart') {
                // Delete old, create new - DIVERT if safeMode
                const taskId = this.generateTaskId(task);
                const syncInfo = this.getSyncInfo(taskId);
                const taskDuration = task.durationMinutes || defaultDurationMinutes;

                if (safeMode && syncInfo) {
                    // Divert the deletion for user approval
                    const createOp: ChangeSetOperation = {
                        id: generateOperationId('create'),
                        type: 'create',
                        calendarId: newCalendarId,
                        task,
                        durationMinutes: taskDuration,
                        reminderMinutes,
                        timeZone,
                    };

                    divertedDeletions.push({
                        taskId,
                        eventId,
                        calendarId: oldCalendarId,
                        eventTitle: syncInfo.title || task.title,
                        eventDate: syncInfo.date || task.date,
                        eventTime: syncInfo.time,
                        sourceFile: syncInfo.filePath,
                        reason: 'freshStart',
                        reasonDetail: `Calendar changed - tag or default calendar updated`,
                        originalTaskLine: this.reconstructTaskLine(syncInfo),
                        linkedCreate: {
                            newCalendarId,
                            task: createOp,
                        },
                    });
                } else {
                    // No safeMode - execute immediately
                    operations.push({
                        id: generateOperationId('delete'),
                        type: 'delete',
                        calendarId: oldCalendarId,
                        eventId,
                    });
                    operations.push({
                        id: generateOperationId('create'),
                        type: 'create',
                        calendarId: newCalendarId,
                        task,
                        durationMinutes: taskDuration,
                        reminderMinutes,
                        timeZone,
                    });
                }
            }
        }

        // 4. COMPLETED task operations
        // Note: Completed task deletions are NOT diverted - user explicitly:
        //   1. Checked the checkbox (explicit action)
        //   2. Chose "delete" mode in settings (explicit preference)
        for (const { task, syncInfo } of completedTasks) {
            if (completedTaskBehavior === 'delete') {
                operations.push({
                    id: generateOperationId('delete'),
                    type: 'delete',
                    calendarId: syncInfo.calendarId,
                    eventId: syncInfo.eventId,
                    task,
                });
            } else {
                // Mark complete - needs existing event data for the title
                const op: ChangeSetOperation = {
                    id: generateOperationId('complete'),
                    type: 'complete',
                    calendarId: syncInfo.calendarId,
                    eventId: syncInfo.eventId,
                    task,
                };
                operations.push(op);
                needsEventData.push(op);
            }
        }

        // 5. ORPHANED task operations (deleted from vault) - DIVERT if safeMode
        for (const taskId of diff.orphaned) {
            const syncInfo = this.getSyncInfo(taskId);
            if (syncInfo) {
                if (safeMode) {
                    // Divert the deletion for user approval
                    divertedDeletions.push({
                        taskId,
                        eventId: syncInfo.eventId,
                        calendarId: syncInfo.calendarId,
                        eventTitle: syncInfo.title || 'Untitled',
                        eventDate: syncInfo.date || 'unknown',
                        eventTime: syncInfo.time,
                        sourceFile: syncInfo.filePath,
                        reason: 'orphaned',
                        reasonDetail: `Task line deleted from ${syncInfo.filePath}`,
                        originalTaskLine: this.reconstructTaskLine(syncInfo),
                    });
                } else {
                    // No safeMode - execute immediately
                    operations.push({
                        id: generateOperationId('delete'),
                        type: 'delete',
                        calendarId: syncInfo.calendarId,
                        eventId: syncInfo.eventId,
                    });
                }
            }
        }

        return { operations, needsEventData, divertedDeletions };
    }

    // =====================
    // Safety Net: Pending Deletions
    // =====================

    /**
     * Add a pending deletion for user review
     */
    addPendingDeletion(deletion: PendingDeletion): void {
        // Check if this deletion is already queued (by taskId)
        const existingIndex = this.syncData.pendingDeletions.findIndex(
            d => d.taskId === deletion.taskId
        );

        if (existingIndex >= 0) {
            // Update existing
            this.syncData.pendingDeletions[existingIndex] = deletion;
        } else {
            this.syncData.pendingDeletions.push(deletion);
        }
    }

    /**
     * Get all pending deletions
     */
    getPendingDeletions(): PendingDeletion[] {
        return [...this.syncData.pendingDeletions];
    }

    /**
     * Get count of pending deletions
     */
    getPendingDeletionCount(): number {
        return this.syncData.pendingDeletions.length;
    }

    /**
     * Remove a pending deletion by ID
     */
    removePendingDeletion(id: string): void {
        this.syncData.pendingDeletions = this.syncData.pendingDeletions.filter(
            d => d.id !== id
        );
    }

    /**
     * Clear all pending deletions
     */
    clearPendingDeletions(): void {
        this.syncData.pendingDeletions = [];
    }

    /**
     * Move a pending deletion to the recently deleted list
     * Called when user confirms a deletion
     */
    confirmDeletion(pendingId: string, calendarName: string): DeletedEventRecord | null {
        const pending = this.syncData.pendingDeletions.find(d => d.id === pendingId);
        if (!pending) return null;

        // Create a deleted record
        const deletedRecord: DeletedEventRecord = {
            id: this.generateBatchId(), // Reuse for unique ID
            eventTitle: pending.eventTitle,
            eventDate: pending.eventDate,
            calendarName,
            calendarId: pending.calendarId,
            deletedAt: new Date().toISOString(),
            confirmedBy: 'user',
            eventSnapshot: pending.eventSnapshot,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        };

        // Add to recently deleted
        this.syncData.recentlyDeleted.push(deletedRecord);

        // Remove from pending
        this.removePendingDeletion(pendingId);

        return deletedRecord;
    }

    // =====================
    // Safety Net: Recently Deleted
    // =====================

    /**
     * Get all recently deleted events
     */
    getRecentlyDeleted(): DeletedEventRecord[] {
        return [...this.syncData.recentlyDeleted];
    }

    /**
     * Remove a recently deleted record by ID
     */
    removeRecentlyDeleted(id: string): void {
        this.syncData.recentlyDeleted = this.syncData.recentlyDeleted.filter(
            r => r.id !== id
        );
    }

    /**
     * Prune expired recently deleted records (older than 30 days)
     */
    pruneExpiredDeletions(): number {
        const now = new Date().toISOString();
        const before = this.syncData.recentlyDeleted.length;
        this.syncData.recentlyDeleted = this.syncData.recentlyDeleted.filter(
            r => r.expiresAt > now
        );
        return before - this.syncData.recentlyDeleted.length;
    }

    /**
     * Reconstruct a task line from sync info
     * Used for the "Restore" feature in Safety Net
     */
    reconstructTaskLine(syncInfo: SyncedTaskInfo): string {
        let line = `- [ ] ${syncInfo.title || 'Untitled'} 📅 ${syncInfo.date || 'unknown'}`;
        if (syncInfo.time) {
            line += ` ⏰ ${syncInfo.time}`;
        }
        return line;
    }

    /**
     * Generate a unique ID for pending deletions
     */
    generatePendingDeletionId(): string {
        return 'pd_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }

    // ========== Severed Tasks (External Event Handling) ==========

    /**
     * Add a task ID to the severed list (won't sync again unless edited)
     */
    addSeveredTaskId(taskId: string): void {
        if (!this.syncData.severedTaskIds) {
            this.syncData.severedTaskIds = [];
        }
        if (!this.syncData.severedTaskIds.includes(taskId)) {
            this.syncData.severedTaskIds.push(taskId);
        }
    }

    /**
     * Check if a task ID has been severed
     * Checks both the legacy severedTaskIds array and the sync record's severed flag
     * If currentContentHash is provided, auto-unsevers if content has changed since severance
     */
    isSevered(taskId: string, currentContentHash?: string): boolean {
        // Check sync record first (new method)
        const syncInfo = this.syncData.syncedTasks[taskId];
        if (syncInfo?.severed) {
            // If we have a current content hash, check if it changed since severance
            if (currentContentHash && syncInfo.severedContentHash) {
                if (currentContentHash !== syncInfo.severedContentHash) {
                    // Content changed! Auto-unsever this task
                    this.clearSevered(taskId);
                    return false;
                }
            }
            return true;
        }
        // Fall back to legacy array check (backward compatibility)
        // BUT: if task is in legacy array but has no sync record, it means:
        // - The task was severed
        // - Then edited (reconciliation migrated the sync record to a new ID)
        // - Then edited back to original (ID matches again, but sync record is gone)
        // In this case, allow it to sync as a NEW task
        if (this.syncData.severedTaskIds && this.syncData.severedTaskIds.includes(taskId)) {
            if (!syncInfo) {
                // No sync record = task was edited away and back, clean up legacy entry
                this.removeSeveredTaskId(taskId);
                return false;
            }
            return true;
        }
        return false;
    }

    /**
     * Remove a task ID from the severed list (allow it to sync again)
     * Clears both the sync record flag and the legacy array entry
     */
    removeSeveredTaskId(taskId: string): void {
        // Clear from sync record
        const syncInfo = this.syncData.syncedTasks[taskId];
        if (syncInfo) {
            syncInfo.severed = false;
        }
        // Clear from legacy array
        if (this.syncData.severedTaskIds) {
            this.syncData.severedTaskIds = this.syncData.severedTaskIds.filter(
                id => id !== taskId
            );
        }
    }

    /**
     * Mark a task as severed in its sync record (keeps the record for reconciliation)
     * Stores the current content hash so we can detect edits later
     */
    markSevered(taskId: string): void {
        const syncInfo = this.syncData.syncedTasks[taskId];
        if (syncInfo) {
            syncInfo.severed = true;
            // Store content hash at time of severance for edit detection
            syncInfo.severedContentHash = syncInfo.contentHash;
        }
        // Also add to legacy array for backward compatibility
        this.addSeveredTaskId(taskId);
    }

    /**
     * Clear severed flag from a sync record (used during reconciliation)
     */
    clearSevered(taskId: string): void {
        const syncInfo = this.syncData.syncedTasks[taskId];
        if (syncInfo) {
            syncInfo.severed = false;
            syncInfo.severedContentHash = undefined;
        }
        // Also remove from legacy array
        this.removeSeveredTaskId(taskId);
    }

    // ========== Pending Severances (for 'ask' mode) ==========

    /**
     * Add a pending severance for user review
     */
    addPendingSeverance(severance: PendingSeverance): void {
        if (!this.syncData.pendingSeverances) {
            this.syncData.pendingSeverances = [];
        }
        // Check if already queued by taskId
        const existingIndex = this.syncData.pendingSeverances.findIndex(
            s => s.taskId === severance.taskId
        );

        if (existingIndex >= 0) {
            // Update existing
            this.syncData.pendingSeverances[existingIndex] = severance;
        } else {
            this.syncData.pendingSeverances.push(severance);
        }
    }

    /**
     * Get all pending severances
     */
    getPendingSeverances(): PendingSeverance[] {
        return this.syncData.pendingSeverances || [];
    }

    /**
     * Remove a pending severance by ID
     */
    removePendingSeverance(id: string): void {
        if (!this.syncData.pendingSeverances) {
            return;
        }
        this.syncData.pendingSeverances = this.syncData.pendingSeverances.filter(
            s => s.id !== id
        );
    }

    /**
     * Clear all pending severances
     */
    clearPendingSeverances(): void {
        this.syncData.pendingSeverances = [];
    }

    /**
     * Generate a unique ID for pending severances
     */
    generatePendingSeveranceId(): string {
        return 'ps_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
    }
}
