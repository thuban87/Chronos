import { requestUrl, RequestUrlResponse } from 'obsidian';
import { ChronosTask } from './taskParser';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleCalendar {
    id: string;
    summary: string;
    primary?: boolean;
    backgroundColor?: string;
}

export interface GoogleEvent {
    id: string;
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    htmlLink?: string;
    status?: string;
    colorId?: string;
    backgroundColor?: string;
    reminders?: {
        useDefault: boolean;
        overrides?: Array<{ method: string; minutes: number }>;
    };
    attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>;
    conferenceData?: {
        entryPoints?: Array<{ entryPointType: string; uri?: string; label?: string }>;
        conferenceSolution?: { name?: string };
    };
    recurrence?: string[];
}

export interface CreateEventParams {
    task: ChronosTask;
    calendarId: string;
    durationMinutes: number;
    reminderMinutes: number[];
    timeZone: string;
    recurrenceRule?: string | null;
}

export class GoogleCalendarApi {
    private getAccessToken: () => Promise<string | null>;

    constructor(getAccessToken: () => Promise<string | null>) {
        this.getAccessToken = getAccessToken;
    }

    /**
     * Fetch all calendars the user has access to
     */
    async listCalendars(): Promise<GoogleCalendar[]> {
        const token = await this.getAccessToken();

        if (!token) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await requestUrl({
                url: `${CALENDAR_API_BASE}/users/me/calendarList`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.status !== 200) {
                console.error('Chronos: calendarList error response:', response.json);
                throw new Error(`Failed to fetch calendars: ${response.status}`);
            }

            const calendars: GoogleCalendar[] = response.json.items.map((cal: any) => ({
                id: cal.id,
                summary: cal.summary,
                primary: cal.primary || false,
                backgroundColor: cal.backgroundColor,
            }));

            // Sort: primary first, then alphabetically
            calendars.sort((a, b) => {
                if (a.primary && !b.primary) return -1;
                if (!a.primary && b.primary) return 1;
                return a.summary.localeCompare(b.summary);
            });

            return calendars;
        } catch (error) {
            console.error('Chronos: listCalendars error:', error);
            throw error;
        }
    }

    /**
     * Fetch events for a specific date range
     * @param calendarId The calendar to fetch from
     * @param timeMin Start of range (inclusive)
     * @param timeMax End of range (exclusive)
     * @param timeZone IANA timezone string
     */
    async listEvents(calendarId: string, timeMin: Date, timeMax: Date, timeZone: string): Promise<GoogleEvent[]> {
        const token = await this.getAccessToken();

        if (!token) {
            throw new Error('Not authenticated');
        }

        try {
            // Format dates as RFC3339
            const timeMinStr = timeMin.toISOString();
            const timeMaxStr = timeMax.toISOString();

            const params = new URLSearchParams({
                timeMin: timeMinStr,
                timeMax: timeMaxStr,
                timeZone: timeZone,
                singleEvents: 'true', // Expand recurring events
                orderBy: 'startTime',
                maxResults: '250', // Reasonable limit for a day
            });

            const response = await requestUrl({
                url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.status !== 200) {
                console.error('Chronos: listEvents error response:', response.json);
                throw new Error(`Failed to fetch events: ${response.status}`);
            }

            const events: GoogleEvent[] = (response.json.items || [])
                .filter((event: any) => event.status !== 'cancelled')
                .map((event: any) => ({
                    id: event.id,
                    summary: event.summary || '(No title)',
                    description: event.description,
                    start: event.start,
                    end: event.end,
                    htmlLink: event.htmlLink,
                    status: event.status,
                    colorId: event.colorId,
                    backgroundColor: event.backgroundColor,
                }));

            return events;
        } catch (error) {
            console.error('Chronos: listEvents error:', error);
            throw error;
        }
    }

    /**
     * Fetch the color palette for Google Calendar
     * Returns a map of colorId -> background color
     */
    async getEventColors(): Promise<Record<string, string>> {
        const token = await this.getAccessToken();

        if (!token) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await requestUrl({
                url: `${CALENDAR_API_BASE}/colors`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.status !== 200) {
                throw new Error(`Failed to fetch colors: ${response.status}`);
            }

            const colorMap: Record<string, string> = {};

            // Event colors
            if (response.json.event) {
                for (const [id, color] of Object.entries(response.json.event)) {
                    colorMap[id] = (color as any).background;
                }
            }

            return colorMap;
        } catch (error) {
            console.error('Chronos: getEventColors error:', error);
            // Return empty map on error - we'll fall back to default colors
            return {};
        }
    }

    /**
     * Create a calendar event from a Chronos task
     */
    async createEvent(params: CreateEventParams): Promise<GoogleEvent> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const event = this.buildEventBody(params);

        const response = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(params.calendarId)}/events`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
        });

        if (response.status !== 200) {
            throw new Error(`Failed to create event: ${response.status}`);
        }

        return response.json;
    }

    /**
     * Update an existing calendar event
     * Preserves user-edited fields (description, location, attendees) while updating Chronos-managed fields
     */
    async updateEvent(calendarId: string, eventId: string, params: CreateEventParams): Promise<GoogleEvent> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        // First, GET the existing event to preserve user edits
        const getResponse = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (getResponse.status !== 200) {
            throw new Error(`Failed to get event for update: ${getResponse.status}`);
        }

        const existingEvent = getResponse.json;

        // Build the updated event body, merging with existing data
        const updatedEvent = this.buildEventBodyForUpdate(params, existingEvent);

        const response = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updatedEvent),
        });

        if (response.status !== 200) {
            throw new Error(`Failed to update event: ${response.status}`);
        }

        return response.json;
    }

    /**
     * Mark an event as completed by updating its title
     */
    async markEventCompleted(calendarId: string, eventId: string, completionTimestamp: Date): Promise<GoogleEvent> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        // First, get the current event
        const getResponse = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (getResponse.status !== 200) {
            throw new Error(`Failed to get event: ${getResponse.status}`);
        }

        const currentEvent = getResponse.json;

        // Format completion timestamp as MM-DD-YYYY, HH:mm
        const month = String(completionTimestamp.getMonth() + 1).padStart(2, '0');
        const day = String(completionTimestamp.getDate()).padStart(2, '0');
        const year = completionTimestamp.getFullYear();
        const hours = String(completionTimestamp.getHours()).padStart(2, '0');
        const minutes = String(completionTimestamp.getMinutes()).padStart(2, '0');
        const completionStr = `${month}-${day}-${year}, ${hours}:${minutes}`;

        // Update title with completion marker
        const updatedTitle = `${currentEvent.summary} - Completed ${completionStr}`;

        // Update the event
        const updateResponse = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                summary: updatedTitle,
            }),
        });

        if (updateResponse.status !== 200) {
            throw new Error(`Failed to update event: ${updateResponse.status}`);
        }

        return updateResponse.json;
    }

    /**
     * Fetch a single event by ID
     * Returns the full event data including attendees, description, conferenceData, etc.
     */
    async getEvent(calendarId: string, eventId: string): Promise<GoogleEvent | null> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await requestUrl({
                url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.status !== 200) {
                return null;
            }

            return response.json;
        } catch {
            // Event doesn't exist or other error
            return null;
        }
    }

    /**
     * Check if an event exists and is not cancelled
     * Google Calendar keeps deleted events with status="cancelled" for a while
     */
    async eventExists(calendarId: string, eventId: string): Promise<boolean> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        try {
            const response = await requestUrl({
                url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            // Check if event is cancelled (deleted in Google Calendar)
            const eventStatus = response.json?.status;
            return response.status === 200 && eventStatus !== 'cancelled';
        } catch {
            // requestUrl throws on non-2xx responses (404 = not found)
            return false;
        }
    }

    /**
     * Delete a calendar event
     */
    async deleteEvent(calendarId: string, eventId: string): Promise<void> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        // 204 No Content is success for DELETE
        if (response.status !== 204 && response.status !== 200) {
            throw new Error(`Failed to delete event: ${response.status}`);
        }
    }

    /**
     * Move an event from one calendar to another
     * This preserves all event details (description, attendees, reminders, etc.)
     * @returns The moved event (now on the destination calendar)
     */
    async moveEvent(sourceCalendarId: string, eventId: string, destinationCalendarId: string): Promise<GoogleEvent> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const params = new URLSearchParams({
            destination: destinationCalendarId,
        });

        const response = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move?${params.toString()}`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        if (response.status !== 200) {
            throw new Error(`Failed to move event: ${response.status}`);
        }

        return response.json;
    }

    /**
     * Build the event body for Google Calendar API
     */
    private buildEventBody(params: CreateEventParams): object {
        const { task, durationMinutes, reminderMinutes, timeZone, recurrenceRule } = params;

        const description = `Source: ${task.filePath}\nLine: ${task.lineNumber}\n\nSynced by Chronos for Obsidian`;

        // Build base event object
        let event: Record<string, unknown>;

        if (task.isAllDay) {
            // All-day event uses date (not dateTime)
            // End date should be the next day for single-day events
            const endDate = new Date(task.datetime);
            endDate.setDate(endDate.getDate() + 1);

            event = {
                summary: task.title,
                description: description,
                start: {
                    date: task.date,
                },
                end: {
                    date: this.formatDate(endDate),
                },
                reminders: {
                    useDefault: false,
                    overrides: reminderMinutes.map(min => ({
                        method: 'popup',
                        minutes: min,
                    })),
                },
            };
        } else {
            // Timed event
            const startDateTime = task.datetime;
            const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

            event = {
                summary: task.title,
                description: description,
                start: {
                    dateTime: this.formatDateTime(startDateTime, timeZone),
                    timeZone: timeZone,
                },
                end: {
                    dateTime: this.formatDateTime(endDateTime, timeZone),
                    timeZone: timeZone,
                },
                reminders: {
                    useDefault: false,
                    overrides: reminderMinutes.map(min => ({
                        method: 'popup',
                        minutes: min,
                    })),
                },
            };
        }

        // Add recurrence if present
        if (recurrenceRule) {
            event.recurrence = [`RRULE:${recurrenceRule}`];
        }

        return event;
    }

    /**
     * Build the event body for an UPDATE, preserving user-edited fields
     * Only updates Chronos-managed fields: summary (title), start, end, reminders, recurrence
     * Preserves: description (if user edited), location, attendees, colorId, etc.
     */
    private buildEventBodyForUpdate(params: CreateEventParams, existingEvent: any): object {
        const { task, durationMinutes, reminderMinutes, timeZone, recurrenceRule } = params;

        // Check if description was user-edited (doesn't contain our signature)
        const chronosSignature = 'Synced by Chronos for Obsidian';
        const isDescriptionUserEdited = existingEvent.description &&
            !existingEvent.description.includes(chronosSignature);

        // If user edited description, keep theirs; otherwise update with new source info
        const description = isDescriptionUserEdited
            ? existingEvent.description
            : `Source: ${task.filePath}\nLine: ${task.lineNumber}\n\n${chronosSignature}`;

        // Start with existing event to preserve all fields (location, attendees, colorId, etc.)
        const updatedEvent: any = {
            ...existingEvent,
            summary: task.title,
            description: description,
            reminders: {
                useDefault: false,
                overrides: reminderMinutes.map(min => ({
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
            const endDateTime = new Date(startDateTime.getTime() + durationMinutes * 60 * 1000);

            updatedEvent.start = {
                dateTime: this.formatDateTime(startDateTime, timeZone),
                timeZone: timeZone,
            };
            updatedEvent.end = {
                dateTime: this.formatDateTime(endDateTime, timeZone),
                timeZone: timeZone,
            };
        }

        // Update recurrence - add if present, remove if not (task is no longer recurring)
        if (recurrenceRule) {
            updatedEvent.recurrence = [`RRULE:${recurrenceRule}`];
        } else {
            // Remove recurrence if task no longer has it
            delete updatedEvent.recurrence;
        }

        return updatedEvent;
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
     * Format datetime as ISO string with timezone
     */
    private formatDateTime(date: Date, timeZone: string): string {
        // Format: 2026-01-15T14:00:00
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = '00';

        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
    }
}
