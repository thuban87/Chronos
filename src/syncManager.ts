import { ChronosTask } from './taskParser';

/**
 * A log entry for sync operations
 */
export interface SyncLogEntry {
    /** Timestamp of the operation */
    timestamp: string;
    /** Batch ID to group operations from the same sync run */
    batchId: string;
    /** Type of operation */
    type: 'create' | 'update' | 'delete' | 'complete' | 'recreate' | 'error';
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
        };
        // Ensure arrays exist (for backwards compatibility)
        if (!this.syncData.pendingOperations) {
            this.syncData.pendingOperations = [];
        }
        if (!this.syncData.syncLog) {
            this.syncData.syncLog = [];
        }
    }

    /**
     * Generate a stable Task ID from a task
     * ID is based on file path + title + date to identify the "concept" of a task
     * This means the same task keeps its ID even if lines shift
     */
    generateTaskId(task: ChronosTask): string {
        const input = `${task.filePath}|${task.title}|${task.date}`;
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
}
