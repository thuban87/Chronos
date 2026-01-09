import { App, Modal, Notice } from 'obsidian';
import { PendingSeverance } from './syncManager';

/**
 * Modal for reviewing pending severances (External Event Handling)
 * When events are moved/deleted externally and user chose "Ask me each time"
 */
export class SeveranceReviewModal extends Modal {
    private pendingSeverances: PendingSeverance[];
    private onSever: (severance: PendingSeverance) => Promise<void>;
    private onRecreate: (severance: PendingSeverance) => Promise<void>;
    private onSeverAll: () => Promise<void>;
    private onRecreateAll: () => Promise<void>;

    constructor(
        app: App,
        pendingSeverances: PendingSeverance[],
        callbacks: {
            onSever: (severance: PendingSeverance) => Promise<void>;
            onRecreate: (severance: PendingSeverance) => Promise<void>;
            onSeverAll: () => Promise<void>;
            onRecreateAll: () => Promise<void>;
        }
    ) {
        super(app);
        this.pendingSeverances = pendingSeverances;
        this.onSever = callbacks.onSever;
        this.onRecreate = callbacks.onRecreate;
        this.onSeverAll = callbacks.onSeverAll;
        this.onRecreateAll = callbacks.onRecreateAll;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-severance-review-modal');
        this.renderContent();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Re-render the modal content (called after actions)
     */
    refresh(updatedSeverances: PendingSeverance[]): void {
        this.pendingSeverances = updatedSeverances;
        this.renderContent();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        const count = this.pendingSeverances.length;

        // Header
        const header = contentEl.createDiv({ cls: 'chronos-severance-header' });
        if (count === 0) {
            header.createEl('h2', { text: 'No Disconnected Events' });
            contentEl.createEl('p', {
                text: 'All clear! No events are awaiting review.',
                cls: 'chronos-severance-empty'
            });
            return;
        }

        header.createEl('h2', { text: `🔗 ${count} Disconnected Event${count === 1 ? '' : 's'}` });

        // Explanatory text
        const explanation = contentEl.createDiv({ cls: 'chronos-severance-explanation' });
        explanation.createEl('p', {
            text: "These events couldn't be found on their expected calendar. They may have been moved or deleted in Google Calendar."
        });

        // Batch buttons
        const batchButtons = contentEl.createDiv({ cls: 'chronos-severance-batch-buttons' });

        const severAllBtn = batchButtons.createEl('button', {
            text: 'Sever All',
            cls: 'chronos-btn-secondary'
        });
        const recreateAllBtn = batchButtons.createEl('button', {
            text: 'Recreate All',
            cls: 'chronos-btn-primary'
        });

        severAllBtn.onclick = async () => {
            severAllBtn.disabled = true;
            severAllBtn.textContent = 'Processing...';
            recreateAllBtn.disabled = true;

            try {
                await this.onSeverAll();
                this.close();
            } catch (error) {
                console.error('Sever All failed:', error);
                severAllBtn.disabled = false;
                severAllBtn.textContent = 'Sever All';
                recreateAllBtn.disabled = false;
            }
        };

        recreateAllBtn.onclick = async () => {
            recreateAllBtn.disabled = true;
            recreateAllBtn.textContent = 'Processing...';
            severAllBtn.disabled = true;

            try {
                await this.onRecreateAll();
                this.close();
            } catch (error) {
                console.error('Recreate All failed:', error);
                recreateAllBtn.disabled = false;
                recreateAllBtn.textContent = 'Recreate All';
                severAllBtn.disabled = false;
            }
        };

        // List of events
        const list = contentEl.createDiv({ cls: 'chronos-severance-list' });

        for (const severance of this.pendingSeverances) {
            this.renderSeveranceItem(list, severance);
        }

        // Recovery note at bottom
        const recoveryNote = contentEl.createDiv({ cls: 'chronos-severance-recovery-note' });
        recoveryNote.createEl('p', {
            text: '💡 Severed tasks can sync to Google Calendar again if you edit the title, date, or time in your notes. This creates a new event - it won\'t reconnect to the moved one.'
        });
    }

    /**
     * Render a single severance item with details and action buttons
     */
    private renderSeveranceItem(container: HTMLElement, severance: PendingSeverance): void {
        const item = container.createDiv({ cls: 'chronos-severance-item' });

        // Event details
        const details = item.createDiv({ cls: 'chronos-severance-details' });

        // Title
        const titleEl = details.createEl('div', { cls: 'chronos-severance-title' });
        titleEl.textContent = `"${severance.eventTitle}"`;

        // Date/Time
        const dateTimeEl = details.createEl('div', { cls: 'chronos-severance-datetime' });
        let dateTimeText = `📅 ${this.formatDate(severance.eventDate)}`;
        if (severance.eventTime) {
            dateTimeText += ` ${this.formatTime(severance.eventTime)}`;
        }
        dateTimeEl.textContent = dateTimeText;

        // Calendar
        const calendarEl = details.createEl('div', { cls: 'chronos-severance-calendar' });
        calendarEl.textContent = `📆 Expected on: ${severance.calendarName}`;

        // Source file
        const sourceEl = details.createEl('div', { cls: 'chronos-severance-source' });
        sourceEl.textContent = `📄 Source: ${severance.sourceFile}`;

        // Action buttons
        const actions = item.createDiv({ cls: 'chronos-severance-actions' });

        const severBtn = actions.createEl('button', {
            text: 'Sever Link',
            cls: 'chronos-btn-secondary'
        });
        const recreateBtn = actions.createEl('button', {
            text: 'Recreate Event',
            cls: 'chronos-btn-primary'
        });

        severBtn.onclick = async () => {
            severBtn.disabled = true;
            recreateBtn.disabled = true;
            severBtn.textContent = 'Processing...';

            try {
                await this.onSever(severance);
                // Item will be removed and modal refreshed by callback
            } catch (error) {
                console.error('Sever failed:', error);
                severBtn.disabled = false;
                recreateBtn.disabled = false;
                severBtn.textContent = 'Sever Link';
            }
        };

        recreateBtn.onclick = async () => {
            recreateBtn.disabled = true;
            severBtn.disabled = true;
            recreateBtn.textContent = 'Processing...';

            try {
                await this.onRecreate(severance);
                // Item will be removed and modal refreshed by callback
            } catch (error) {
                console.error('Recreate failed:', error);
                recreateBtn.disabled = false;
                severBtn.disabled = false;
                recreateBtn.textContent = 'Recreate Event';
            }
        };
    }

    /**
     * Format date for display (YYYY-MM-DD -> more readable format)
     */
    private formatDate(dateStr: string): string {
        try {
            const date = new Date(dateStr + 'T00:00:00');
            return date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    }

    /**
     * Format time for display (HH:mm -> more readable format)
     */
    private formatTime(timeStr: string): string {
        try {
            const [hours, minutes] = timeStr.split(':').map(Number);
            const date = new Date();
            date.setHours(hours, minutes, 0, 0);
            return date.toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch {
            return timeStr;
        }
    }
}
