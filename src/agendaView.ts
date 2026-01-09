import { ItemView, WorkspaceLeaf, Editor } from 'obsidian';
import { GoogleEvent } from './googleCalendar';
import { SyncedTaskInfo } from './syncManager';

export const AGENDA_VIEW_TYPE = 'chronos-agenda-view';

/**
 * An event with calendar metadata for display in the agenda
 */
export interface AgendaEvent extends GoogleEvent {
    calendarId: string;
    calendarName: string;
    calendarColor: string;
}

export interface AgendaViewDeps {
    isAuthenticated: () => boolean;
    hasCalendarsSelected: () => boolean;
    fetchEventsForDate: (date: Date) => Promise<AgendaEvent[]>;
    fetchEventColors: () => Promise<Record<string, string>>;
    getSyncedTasks: () => Record<string, SyncedTaskInfo>;
    getTimeZone: () => string;
    openFile: (filePath: string, lineNumber: number) => Promise<void>;
    importAgendaToEditor: (editor: Editor, date: Date) => Promise<void>;
    getActiveEditor: () => Editor | null;
}

export class AgendaView extends ItemView {
    private deps: AgendaViewDeps;
    private events: AgendaEvent[] = [];
    private isLoading: boolean = false;
    private lastError: string | null = null;
    private refreshIntervalId: number | null = null;
    private refreshIntervalMs: number = 600000; // 10 minutes default
    private currentDate: Date = new Date();
    private colorPalette: Record<string, string> = {};
    private colorsLoaded: boolean = false;

    constructor(leaf: WorkspaceLeaf, deps: AgendaViewDeps) {
        super(leaf);
        this.deps = deps;
        // Reset to today
        this.currentDate = this.getStartOfDay(new Date());
    }

    /**
     * Get the current date being viewed (for import feature)
     */
    getCurrentDate(): Date {
        return this.currentDate;
    }

    getViewType(): string {
        return AGENDA_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Agenda";
    }

    getIcon(): string {
        return 'calendar-clock';
    }

    async onOpen(): Promise<void> {
        await this.loadColors();
        await this.refresh();
        this.startAutoRefresh();
    }

    async onClose(): Promise<void> {
        this.stopAutoRefresh();
    }

    setRefreshInterval(ms: number): void {
        this.refreshIntervalMs = ms;
        // Restart with new interval if already running
        if (this.refreshIntervalId !== null) {
            this.stopAutoRefresh();
            this.startAutoRefresh();
        }
    }

    /**
     * Force reload of colors (e.g., when calendar selection changes)
     */
    reloadColors(): void {
        this.colorsLoaded = false;
    }

    private startAutoRefresh(): void {
        if (this.refreshIntervalId !== null) return;

        this.refreshIntervalId = window.setInterval(() => {
            this.refresh();
        }, this.refreshIntervalMs);
    }

    private stopAutoRefresh(): void {
        if (this.refreshIntervalId !== null) {
            window.clearInterval(this.refreshIntervalId);
            this.refreshIntervalId = null;
        }
    }

    private getStartOfDay(date: Date): Date {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    private async loadColors(): Promise<void> {
        if (this.colorsLoaded) return;

        try {
            if (this.deps.isAuthenticated()) {
                // Load event color palette for custom-colored events
                this.colorPalette = await this.deps.fetchEventColors();
                this.colorsLoaded = true;
            }
        } catch (error) {
            console.error('Chronos: Failed to load colors:', error);
            // Continue without colors
        }
    }

    async refresh(): Promise<void> {
        this.isLoading = true;
        this.lastError = null;
        this.render();

        try {
            if (!this.deps.isAuthenticated()) {
                this.lastError = 'Not connected to Google Calendar';
                this.events = [];
            } else if (!this.deps.hasCalendarsSelected()) {
                // No calendars selected - show empty state, not an error
                this.events = [];
            } else {
                // Load colors if not loaded yet
                if (!this.colorsLoaded) {
                    await this.loadColors();
                }
                this.events = await this.deps.fetchEventsForDate(this.currentDate);
            }
        } catch (error: any) {
            console.error('Chronos: Failed to fetch agenda events:', error);
            this.lastError = error?.message || 'Failed to fetch events';
            this.events = [];
        }

        this.isLoading = false;
        this.render();
    }

    private goToPreviousDay(): void {
        const newDate = new Date(this.currentDate);
        newDate.setDate(newDate.getDate() - 1);
        this.currentDate = newDate;
        this.refresh();
    }

    private goToNextDay(): void {
        const newDate = new Date(this.currentDate);
        newDate.setDate(newDate.getDate() + 1);
        this.currentDate = newDate;
        this.refresh();
    }

    private goToToday(): void {
        this.currentDate = this.getStartOfDay(new Date());
        this.refresh();
    }

    private isToday(): boolean {
        const today = this.getStartOfDay(new Date());
        return this.currentDate.getTime() === today.getTime();
    }

    private render(): void {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('chronos-agenda-container');

        // Header with navigation
        const header = container.createDiv({ cls: 'chronos-agenda-header' });

        // Navigation row
        const navRow = header.createDiv({ cls: 'chronos-agenda-nav-row' });

        const prevBtn = navRow.createEl('button', {
            cls: 'chronos-agenda-nav-btn',
            attr: { 'aria-label': 'Previous day' }
        });
        prevBtn.innerHTML = '‹';
        prevBtn.addEventListener('click', () => this.goToPreviousDay());

        const dateStr = this.currentDate.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });

        const dateLabel = navRow.createEl('span', {
            text: dateStr,
            cls: 'chronos-agenda-date'
        });

        // Make date clickable to go to today if not already on today
        if (!this.isToday()) {
            dateLabel.addClass('chronos-agenda-date-clickable');
            dateLabel.setAttr('aria-label', 'Go to today');
            dateLabel.addEventListener('click', () => this.goToToday());
        }

        const nextBtn = navRow.createEl('button', {
            cls: 'chronos-agenda-nav-btn',
            attr: { 'aria-label': 'Next day' }
        });
        nextBtn.innerHTML = '›';
        nextBtn.addEventListener('click', () => this.goToNextDay());

        // Refresh button row
        const actionRow = header.createDiv({ cls: 'chronos-agenda-action-row' });

        if (!this.isToday()) {
            const todayBtn = actionRow.createEl('button', {
                cls: 'chronos-agenda-today-btn',
                text: 'Today'
            });
            todayBtn.addEventListener('click', () => this.goToToday());
        }

        const refreshBtn = actionRow.createEl('button', {
            cls: 'chronos-agenda-refresh-btn',
            attr: { 'aria-label': 'Refresh agenda' }
        });
        refreshBtn.innerHTML = '↻';
        refreshBtn.addEventListener('click', () => this.refresh());

        // Import button
        const importBtn = actionRow.createEl('button', {
            cls: 'chronos-agenda-import-btn',
            attr: { 'aria-label': 'Import agenda to current file' }
        });
        importBtn.innerHTML = '📋';
        importBtn.addEventListener('click', async () => {
            const editor = this.deps.getActiveEditor();
            if (editor) {
                await this.deps.importAgendaToEditor(editor, this.currentDate);
            } else {
                // No active editor - could show a notice, but the main.ts handler will do that
                await this.deps.importAgendaToEditor(null as any, this.currentDate);
            }
        });

        // Loading state
        if (this.isLoading) {
            container.createDiv({ cls: 'chronos-agenda-loading', text: 'Loading...' });
            return;
        }

        // Error state
        if (this.lastError) {
            const errorDiv = container.createDiv({ cls: 'chronos-agenda-error' });
            errorDiv.createEl('p', { text: this.lastError });
            if (this.lastError.includes('Not connected')) {
                errorDiv.createEl('p', {
                    text: 'Go to Settings → Chronos to connect.',
                    cls: 'chronos-agenda-error-hint'
                });
            }
            return;
        }

        // Empty state - check if no calendars selected vs no events
        if (this.events.length === 0) {
            const emptyDiv = container.createDiv({ cls: 'chronos-agenda-empty' });
            if (!this.deps.hasCalendarsSelected()) {
                emptyDiv.setText('No calendars selected');
                emptyDiv.createEl('p', {
                    text: 'Go to Settings → Chronos → Agenda View to select calendars.',
                    cls: 'chronos-agenda-empty-hint'
                });
            } else {
                const dayLabel = this.isToday() ? 'today' : 'this day';
                emptyDiv.setText(`No events ${dayLabel}`);
            }
            return;
        }

        // Events list
        const eventsList = container.createDiv({ cls: 'chronos-agenda-events' });

        // Build a reverse lookup: eventId → taskInfo (for finding source notes)
        const syncedTasks = this.deps.getSyncedTasks();
        const eventIdToTask: Record<string, SyncedTaskInfo> = {};
        for (const [taskId, info] of Object.entries(syncedTasks)) {
            eventIdToTask[info.eventId] = info;
        }

        for (const event of this.events) {
            this.renderEventCard(eventsList, event, eventIdToTask[event.id]);
        }
    }

    private getEventColor(event: AgendaEvent): string | null {
        // First check if event has a direct background color (individually colored event)
        if (event.backgroundColor) {
            return event.backgroundColor;
        }

        // Then check if we can map the colorId (individually colored event)
        if (event.colorId && this.colorPalette[event.colorId]) {
            return this.colorPalette[event.colorId];
        }

        // Fall back to the calendar's default color
        if (event.calendarColor) {
            return event.calendarColor;
        }

        return null;
    }

    private renderEventCard(
        container: HTMLElement,
        event: AgendaEvent,
        syncInfo?: SyncedTaskInfo
    ): void {
        const card = container.createDiv({ cls: 'chronos-agenda-card' });

        // Add calendar name as tooltip
        card.setAttr('title', event.calendarName);

        // Apply event color as border
        const eventColor = this.getEventColor(event);
        if (eventColor) {
            card.style.borderLeftColor = eventColor;
        }

        // Calendar color dot (for multi-calendar differentiation)
        const colorDot = card.createSpan({ cls: 'chronos-agenda-calendar-dot' });
        colorDot.style.backgroundColor = event.calendarColor || '#4285f4';

        // Time display
        const timeDiv = card.createDiv({ cls: 'chronos-agenda-card-time' });

        if (event.start.date) {
            // All-day event
            timeDiv.setText('All day');
            timeDiv.addClass('chronos-agenda-allday');
        } else if (event.start.dateTime) {
            const startTime = new Date(event.start.dateTime);
            const endTime = event.end.dateTime ? new Date(event.end.dateTime) : null;

            const startStr = startTime.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit'
            });

            if (endTime) {
                const endStr = endTime.toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit'
                });
                timeDiv.setText(`${startStr} - ${endStr}`);
            } else {
                timeDiv.setText(startStr);
            }
        }

        // Event content
        const contentDiv = card.createDiv({ cls: 'chronos-agenda-card-content' });

        // Title (clickable to Google Calendar)
        const titleDiv = contentDiv.createDiv({ cls: 'chronos-agenda-card-title' });

        if (event.htmlLink) {
            const titleLink = titleDiv.createEl('a', {
                text: event.summary,
                href: event.htmlLink,
                cls: 'chronos-agenda-gcal-link'
            });
            titleLink.setAttr('target', '_blank');
            titleLink.setAttr('rel', 'noopener');
        } else {
            titleDiv.setText(event.summary);
        }

        // Source note link (smaller, secondary)
        if (syncInfo) {
            const sourceDiv = contentDiv.createDiv({ cls: 'chronos-agenda-card-source' });
            const sourceLink = sourceDiv.createEl('a', {
                cls: 'chronos-agenda-source-link'
            });

            // Show just the filename, not full path
            const fileName = syncInfo.filePath.split('/').pop() || syncInfo.filePath;
            sourceLink.setText(`📄 ${fileName}:${syncInfo.lineNumber}`);
            sourceLink.setAttr('aria-label', `Open ${syncInfo.filePath} at line ${syncInfo.lineNumber}`);

            sourceLink.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.deps.openFile(syncInfo.filePath, syncInfo.lineNumber);
            });
        }
    }
}
