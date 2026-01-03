import { ChronosTask } from './taskParser';

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

    constructor(syncData?: ChronosSyncData) {
        this.syncData = syncData || {
            syncedTasks: {},
            lastSyncAt: null,
        };
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
}
