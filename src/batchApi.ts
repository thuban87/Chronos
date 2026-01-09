import { requestUrl } from 'obsidian';
import { ChronosTask } from './taskParser';

const BATCH_ENDPOINT = 'https://www.googleapis.com/batch/calendar/v3';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_BATCH_SIZE = 50; // Google allows 100, but 50 is safer for complex operations

/**
 * Types of operations that can be batched
 */
export type BatchOperationType = 'create' | 'update' | 'delete' | 'move' | 'complete' | 'get';

/**
 * A single operation in the changeset
 */
export interface ChangeSetOperation {
    /** Unique ID for this operation (used to match responses) */
    id: string;
    /** Type of operation */
    type: BatchOperationType;
    /** Calendar ID for the operation */
    calendarId: string;
    /** Event ID (for update/delete/move/complete/get) */
    eventId?: string;
    /** Destination calendar (for move operations) */
    destinationCalendarId?: string;
    /** Task data (for create/update) */
    task?: ChronosTask;
    /** Duration in minutes (for create/update) */
    durationMinutes?: number;
    /** Reminder minutes (for create/update) */
    reminderMinutes?: number[];
    /** Timezone (for create/update) */
    timeZone?: string;
    /** Pre-fetched event data for updates (to preserve user edits) */
    existingEventData?: any;
    /** Recurrence rule (RRULE format without prefix) */
    recurrenceRule?: string | null;
}

/**
 * Result of a single operation in the batch
 */
export interface BatchOperationResult {
    /** Operation ID (matches ChangeSetOperation.id) */
    id: string;
    /** HTTP status code */
    status: number;
    /** Whether the operation succeeded */
    success: boolean;
    /** Response body (parsed JSON) */
    body?: any;
    /** Error message if failed */
    error?: string;
}

/**
 * Result of executing a batch
 */
export interface BatchResult {
    /** Results for each operation */
    results: BatchOperationResult[];
    /** Whether all operations succeeded */
    allSucceeded: boolean;
    /** Whether the entire batch failed (server error) */
    batchFailed: boolean;
    /** HTTP status of the batch request itself */
    batchStatus?: number;
    /** Error message if batch failed */
    batchError?: string;
}

/**
 * Handles batched requests to Google Calendar API
 */
export class BatchCalendarApi {
    private getAccessToken: () => Promise<string | null>;

    constructor(getAccessToken: () => Promise<string | null>) {
        this.getAccessToken = getAccessToken;
    }

    /**
     * Execute a batch of operations
     * @param operations The operations to execute
     * @returns Results for each operation
     */
    async executeBatch(operations: ChangeSetOperation[]): Promise<BatchResult> {
        if (operations.length === 0) {
            return { results: [], allSucceeded: true, batchFailed: false };
        }

        const token = await this.getAccessToken();
        if (!token) {
            return {
                results: [],
                allSucceeded: false,
                batchFailed: true,
                batchError: 'Not authenticated',
            };
        }

        // Group operations by calendar ID - Google batch API requires same calendar per batch
        const opsByCalendar = new Map<string, ChangeSetOperation[]>();
        for (const op of operations) {
            const calId = op.calendarId;
            if (!opsByCalendar.has(calId)) {
                opsByCalendar.set(calId, []);
            }
            opsByCalendar.get(calId)!.push(op);
        }

        const allResults: BatchOperationResult[] = [];
        let anyBatchFailed = false;
        let batchStatus: number | undefined;
        let batchError: string | undefined;

        // Execute batches per calendar
        for (const [calendarId, calOps] of opsByCalendar) {
            // Split into chunks of MAX_BATCH_SIZE
            const chunks = this.chunkArray(calOps, MAX_BATCH_SIZE);

            for (const chunk of chunks) {
                const result = await this.executeSingleBatch(chunk, token);

                if (result.batchFailed) {
                    anyBatchFailed = true;
                    batchStatus = result.batchStatus;
                    batchError = result.batchError;
                    // Continue to other calendars even if one fails
                } else {
                    allResults.push(...result.results);
                }
            }
        }

        return {
            results: allResults,
            allSucceeded: !anyBatchFailed && allResults.every(r => r.success),
            batchFailed: anyBatchFailed,
            batchStatus,
            batchError,
        };
    }

    /**
     * Execute a single batch request (up to MAX_BATCH_SIZE operations)
     */
    private async executeSingleBatch(
        operations: ChangeSetOperation[],
        token: string
    ): Promise<BatchResult> {
        const boundary = `batch_chronos_${Date.now()}`;
        const body = this.buildBatchBody(operations, boundary);

        try {
            const response = await requestUrl({
                url: BATCH_ENDPOINT,
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': `multipart/mixed; boundary=${boundary}`,
                },
                body,
            });

            // Check for batch-level failure
            if (response.status >= 500) {
                return {
                    results: [],
                    allSucceeded: false,
                    batchFailed: true,
                    batchStatus: response.status,
                    batchError: `Server error: ${response.status}`,
                };
            }

            if (response.status !== 200) {
                return {
                    results: [],
                    allSucceeded: false,
                    batchFailed: true,
                    batchStatus: response.status,
                    batchError: `Batch request failed: ${response.status}`,
                };
            }

            // Parse the multipart response
            const results = this.parseBatchResponse(response.text, operations);

            return {
                results,
                allSucceeded: results.every(r => r.success),
                batchFailed: false,
            };
        } catch (error: any) {
            // Network error or other failure
            return {
                results: [],
                allSucceeded: false,
                batchFailed: true,
                batchError: error?.message || String(error),
            };
        }
    }

    /**
     * Build the multipart MIME body for a batch request
     */
    private buildBatchBody(operations: ChangeSetOperation[], boundary: string): string {
        const parts: string[] = [];

        for (const op of operations) {
            const part = this.buildOperationPart(op);
            parts.push(`--${boundary}\r\nContent-Type: application/http\r\nContent-ID: ${op.id}\r\n\r\n${part}`);
        }

        return parts.join('\r\n') + `\r\n--${boundary}--`;
    }

    /**
     * Build a single HTTP request part for an operation
     */
    private buildOperationPart(op: ChangeSetOperation): string {
        switch (op.type) {
            case 'create':
                return this.buildCreatePart(op);
            case 'update':
                return this.buildUpdatePart(op);
            case 'delete':
                return this.buildDeletePart(op);
            case 'move':
                return this.buildMovePart(op);
            case 'complete':
                return this.buildCompletePart(op);
            case 'get':
                return this.buildGetPart(op);
            default:
                throw new Error(`Unknown operation type: ${op.type}`);
        }
    }

    /**
     * Build CREATE operation part
     */
    private buildCreatePart(op: ChangeSetOperation): string {
        const eventBody = this.buildEventBody(op);
        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events`;
        const bodyJson = JSON.stringify(eventBody);

        return `POST ${path} HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${bodyJson.length}\r\n\r\n${bodyJson}`;
    }

    /**
     * Build UPDATE (PUT) operation part
     */
    private buildUpdatePart(op: ChangeSetOperation): string {
        const eventBody = this.buildEventBodyForUpdate(op);
        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events/${encodeURIComponent(op.eventId!)}`;
        const bodyJson = JSON.stringify(eventBody);

        return `PUT ${path} HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${bodyJson.length}\r\n\r\n${bodyJson}`;
    }

    /**
     * Build DELETE operation part
     */
    private buildDeletePart(op: ChangeSetOperation): string {
        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events/${encodeURIComponent(op.eventId!)}`;
        return `DELETE ${path} HTTP/1.1\r\n\r\n`;
    }

    /**
     * Build MOVE operation part (POST with destination parameter)
     */
    private buildMovePart(op: ChangeSetOperation): string {
        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events/${encodeURIComponent(op.eventId!)}/move?destination=${encodeURIComponent(op.destinationCalendarId!)}`;
        return `POST ${path} HTTP/1.1\r\n\r\n`;
    }

    /**
     * Build COMPLETE operation part (PATCH to update summary)
     */
    private buildCompletePart(op: ChangeSetOperation): string {
        // We need the existing event data to build the completed title
        const existingTitle = op.existingEventData?.summary || '(Unknown task)';

        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const completionStr = `${month}-${day}-${year}, ${hours}:${minutes}`;

        const bodyJson = JSON.stringify({
            summary: `${existingTitle} - Completed ${completionStr}`,
        });

        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events/${encodeURIComponent(op.eventId!)}`;
        return `PATCH ${path} HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${bodyJson.length}\r\n\r\n${bodyJson}`;
    }

    /**
     * Build GET operation part (for fetching event data before update)
     */
    private buildGetPart(op: ChangeSetOperation): string {
        const path = `/calendar/v3/calendars/${encodeURIComponent(op.calendarId)}/events/${encodeURIComponent(op.eventId!)}`;
        return `GET ${path} HTTP/1.1\r\n\r\n`;
    }

    /**
     * Build event body for CREATE operations
     */
    private buildEventBody(op: ChangeSetOperation): object {
        const task = op.task!;
        const description = `Source: ${task.filePath}\nLine: ${task.lineNumber}\n\nSynced by Chronos for Obsidian`;

        let event: Record<string, unknown>;

        if (task.isAllDay) {
            const endDate = new Date(task.datetime);
            endDate.setDate(endDate.getDate() + 1);

            event = {
                summary: task.title,
                description,
                start: { date: task.date },
                end: { date: this.formatDate(endDate) },
                reminders: {
                    useDefault: false,
                    overrides: (op.reminderMinutes || []).map(min => ({
                        method: 'popup',
                        minutes: min,
                    })),
                },
            };
        } else {
            const startDateTime = task.datetime;
            const endDateTime = new Date(startDateTime.getTime() + (op.durationMinutes || 30) * 60 * 1000);

            event = {
                summary: task.title,
                description,
                start: {
                    dateTime: this.formatDateTime(startDateTime),
                    timeZone: op.timeZone,
                },
                end: {
                    dateTime: this.formatDateTime(endDateTime),
                    timeZone: op.timeZone,
                },
                reminders: {
                    useDefault: false,
                    overrides: (op.reminderMinutes || []).map(min => ({
                        method: 'popup',
                        minutes: min,
                    })),
                },
            };
        }

        // Add recurrence if present
        if (op.recurrenceRule) {
            event.recurrence = [`RRULE:${op.recurrenceRule}`];
        }

        return event;
    }

    /**
     * Build event body for UPDATE operations, preserving user-edited fields
     */
    private buildEventBodyForUpdate(op: ChangeSetOperation): object {
        const task = op.task!;
        const existingEvent = op.existingEventData || {};

        // Check if description was user-edited
        const chronosSignature = 'Synced by Chronos for Obsidian';
        const isDescriptionUserEdited = existingEvent.description &&
            !existingEvent.description.includes(chronosSignature);

        const description = isDescriptionUserEdited
            ? existingEvent.description
            : `Source: ${task.filePath}\nLine: ${task.lineNumber}\n\n${chronosSignature}`;

        // Start with existing event to preserve fields like location, attendees, colorId
        const updatedEvent: any = {
            ...existingEvent,
            summary: task.title,
            description,
            reminders: {
                useDefault: false,
                overrides: (op.reminderMinutes || []).map(min => ({
                    method: 'popup',
                    minutes: min,
                })),
            },
        };

        // Update start/end times
        if (task.isAllDay) {
            const endDate = new Date(task.datetime);
            endDate.setDate(endDate.getDate() + 1);

            updatedEvent.start = { date: task.date };
            updatedEvent.end = { date: this.formatDate(endDate) };
        } else {
            const startDateTime = task.datetime;
            const endDateTime = new Date(startDateTime.getTime() + (op.durationMinutes || 30) * 60 * 1000);

            updatedEvent.start = {
                dateTime: this.formatDateTime(startDateTime),
                timeZone: op.timeZone,
            };
            updatedEvent.end = {
                dateTime: this.formatDateTime(endDateTime),
                timeZone: op.timeZone,
            };
        }

        // Update recurrence - add if present, remove if not
        if (op.recurrenceRule) {
            updatedEvent.recurrence = [`RRULE:${op.recurrenceRule}`];
        } else {
            delete updatedEvent.recurrence;
        }

        return updatedEvent;
    }

    /**
     * Parse the multipart MIME response from a batch request
     */
    private parseBatchResponse(responseText: string, operations: ChangeSetOperation[]): BatchOperationResult[] {
        const results: BatchOperationResult[] = [];

        // Extract boundary from response
        const boundaryMatch = responseText.match(/--batch[^\r\n]+/);
        if (!boundaryMatch) {
            // Fallback: try to parse as single response or return empty
            return operations.map(op => ({
                id: op.id,
                status: 500,
                success: false,
                error: 'Could not parse batch response',
            }));
        }

        const boundary = boundaryMatch[0];
        const parts = responseText.split(boundary).filter(p => p.trim() && p.trim() !== '--');

        // Create a map of operation IDs for quick lookup
        const opMap = new Map(operations.map(op => [op.id, op]));

        for (const part of parts) {
            // Extract Content-ID
            const contentIdMatch = part.match(/Content-ID:\s*response-([^\r\n]+)/i);
            const contentId = contentIdMatch ? contentIdMatch[1].trim() : null;

            // Extract HTTP status line
            const statusMatch = part.match(/HTTP\/1\.1\s+(\d+)/);
            const status = statusMatch ? parseInt(statusMatch[1], 10) : 500;

            // Extract JSON body (everything after double CRLF after headers)
            let body: any = null;
            let error: string | undefined;

            const bodyMatch = part.match(/\r\n\r\n({[\s\S]*})/);
            if (bodyMatch) {
                try {
                    body = JSON.parse(bodyMatch[1]);
                } catch {
                    // Body isn't JSON, that's okay for some responses (like DELETE 204)
                }
            }

            // Check for error in body
            if (body?.error) {
                error = body.error.message || JSON.stringify(body.error);
            }

            const success = status >= 200 && status < 300;

            if (contentId) {
                results.push({
                    id: contentId,
                    status,
                    success,
                    body,
                    error: success ? undefined : (error || `HTTP ${status}`),
                });
            }
        }

        // For any operations that didn't get a response, mark as failed
        for (const op of operations) {
            if (!results.find(r => r.id === op.id)) {
                results.push({
                    id: op.id,
                    status: 500,
                    success: false,
                    error: 'No response received for operation',
                });
            }
        }

        return results;
    }

    /**
     * Split an array into chunks of a given size
     */
    private chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    /**
     * Format date as YYYY-MM-DD
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Format datetime as ISO string (without timezone suffix)
     */
    private formatDateTime(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = '00';

        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }
}

/**
 * Information about a deletion diverted to the pending queue (Safety Net)
 */
export interface DivertedDeletion {
    /** The task ID being deleted */
    taskId: string;
    /** Google Calendar event ID */
    eventId: string;
    /** Calendar ID */
    calendarId: string;
    /** Event title (from sync info) */
    eventTitle: string;
    /** Event date (from sync info) */
    eventDate: string;
    /** Event time (from sync info) */
    eventTime?: string | null;
    /** Source file path */
    sourceFile: string;
    /** Why this deletion was queued */
    reason: 'orphaned' | 'freshStart';
    /** Human-readable reason detail */
    reasonDetail: string;
    /** Reconstructed task line for restore feature */
    originalTaskLine: string;
    /** For freshStart: info about the new event being created */
    linkedCreate?: {
        newCalendarId: string;
        task: ChangeSetOperation;
    };
}

/**
 * Information about a recurring task completion that needs user input (Safety Net OFF)
 */
export interface PendingRecurringCompletion {
    /** The task ID */
    taskId: string;
    /** Google Calendar event ID */
    eventId: string;
    /** Calendar ID */
    calendarId: string;
    /** Task title */
    taskTitle: string;
    /** The full task object */
    task: any;
    /** Sync info for the task */
    syncInfo: any;
}

/**
 * Builds a ChangeSet from sync diff results
 * This is the "collect" phase before batching
 */
export interface ChangeSet {
    /** All operations to be performed */
    operations: ChangeSetOperation[];
    /** Operations that need existing event data fetched first (for updates/completes) */
    needsEventData: ChangeSetOperation[];
    /** Deletions diverted to pending queue for user approval (Safety Net) */
    divertedDeletions: DivertedDeletion[];
    /** Recurring task completions that need user input (Safety Net OFF only) */
    pendingRecurringCompletions: PendingRecurringCompletion[];
}

/**
 * Helper to generate unique operation IDs
 */
let operationCounter = 0;
export function generateOperationId(prefix: string): string {
    return `${prefix}_${Date.now()}_${++operationCounter}`;
}
