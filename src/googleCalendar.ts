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
}

export interface CreateEventParams {
    task: ChronosTask;
    calendarId: string;
    durationMinutes: number;
    reminderMinutes: number[];
    timeZone: string;
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
     */
    async updateEvent(calendarId: string, eventId: string, params: CreateEventParams): Promise<GoogleEvent> {
        const token = await this.getAccessToken();
        if (!token) {
            throw new Error('Not authenticated');
        }

        const event = this.buildEventBody(params);

        const response = await requestUrl({
            url: `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(event),
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
     * Build the event body for Google Calendar API
     */
    private buildEventBody(params: CreateEventParams): object {
        const { task, durationMinutes, reminderMinutes, timeZone } = params;

        const description = `Source: ${task.filePath}\nLine: ${task.lineNumber}\n\nSynced by Chronos for Obsidian`;

        if (task.isAllDay) {
            // All-day event uses date (not dateTime)
            // End date should be the next day for single-day events
            const endDate = new Date(task.datetime);
            endDate.setDate(endDate.getDate() + 1);

            return {
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

            return {
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
