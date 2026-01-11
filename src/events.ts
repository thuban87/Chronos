import { ChronosTask } from './taskParser';
import { SyncedTaskInfo } from './syncManager';

/**
 * Event payload types for Chronos events
 */
export interface ChronosEventPayloads {
    // Sync lifecycle events
    'sync-start': { timestamp: Date };
    'sync-complete': {
        timestamp: Date;
        created: number;
        updated: number;
        deleted: number;
        completed: number;
        errors: number;
    };

    // Task sync events
    'task-created': { task: ChronosTask; eventId: string; calendarId: string };
    'task-updated': { task: ChronosTask; eventId: string; calendarId: string };
    'task-completed': { task: ChronosTask; eventId: string; calendarId: string };
    'task-deleted': { taskId: string; eventId: string; calendarId: string; title: string };

    // Agenda view events
    'agenda-refresh': { date: Date; events: AgendaTaskEvent[] };
    'task-starting-soon': { task: AgendaTaskEvent; minutesUntilStart: number };
    'task-now': { task: AgendaTaskEvent };
}

/**
 * Simplified task info for agenda events
 */
export interface AgendaTaskEvent {
    title: string;
    date: string;
    time: string | null;
    filePath: string;
    lineNumber: number;
    eventId?: string;
    calendarId?: string;
    isAllDay: boolean;
    /** Tags from the original task (e.g., ['#work', '#switchboard/math']) */
    tags: string[];
}

/**
 * Event listener function type
 */
type EventListener<T> = (payload: T) => void;

/**
 * Simple typed EventEmitter for Chronos plugin events
 * Allows other plugins to subscribe to Chronos events
 *
 * Usage from another plugin:
 * ```typescript
 * const chronos = app.plugins.plugins['chronos'];
 * if (chronos?.events) {
 *     chronos.events.on('task-created', (payload) => {
 *         console.log('Task created:', payload.task.title);
 *     });
 * }
 * ```
 */
export class ChronosEvents {
    private listeners: Map<string, Set<EventListener<any>>> = new Map();

    /**
     * Subscribe to an event
     * @returns Unsubscribe function
     */
    on<K extends keyof ChronosEventPayloads>(
        event: K,
        listener: EventListener<ChronosEventPayloads[K]>
    ): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Return unsubscribe function
        return () => this.off(event, listener);
    }

    /**
     * Subscribe to an event (fires only once)
     */
    once<K extends keyof ChronosEventPayloads>(
        event: K,
        listener: EventListener<ChronosEventPayloads[K]>
    ): () => void {
        const wrapper = (payload: ChronosEventPayloads[K]) => {
            this.off(event, wrapper);
            listener(payload);
        };
        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof ChronosEventPayloads>(
        event: K,
        listener: EventListener<ChronosEventPayloads[K]>
    ): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.delete(listener);
        }
    }

    /**
     * Emit an event to all listeners
     */
    emit<K extends keyof ChronosEventPayloads>(
        event: K,
        payload: ChronosEventPayloads[K]
    ): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            for (const listener of eventListeners) {
                try {
                    listener(payload);
                } catch (error) {
                    console.error(`Chronos: Error in event listener for '${event}':`, error);
                }
            }
        }
    }

    /**
     * Remove all listeners (call on plugin unload)
     */
    removeAllListeners(): void {
        this.listeners.clear();
    }

    /**
     * Get count of listeners for an event (useful for debugging)
     */
    listenerCount<K extends keyof ChronosEventPayloads>(event: K): number {
        return this.listeners.get(event)?.size ?? 0;
    }
}
