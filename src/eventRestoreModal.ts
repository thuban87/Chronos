import { App, Modal, Notice } from 'obsidian';
import { DeletedEventRecord } from './syncManager';

/**
 * Modal for restoring a deleted event from its snapshot
 * Shows limitations warning and handles the restoration
 */
export class EventRestoreModal extends Modal {
    private record: DeletedEventRecord;
    private onRestore: (record: DeletedEventRecord) => Promise<void>;
    private onCancel: () => void;

    constructor(
        app: App,
        record: DeletedEventRecord,
        callbacks: {
            onRestore: (record: DeletedEventRecord) => Promise<void>;
            onCancel: () => void;
        }
    ) {
        super(app);
        this.record = record;
        this.onRestore = callbacks.onRestore;
        this.onCancel = callbacks.onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-event-restore-modal');

        // Title
        contentEl.createEl('h2', { text: `Restore "${this.record.eventTitle}"?` });

        // Explanation
        const explanation = contentEl.createDiv({ cls: 'chronos-restore-explanation' });
        explanation.createEl('p', {
            text: 'A new event will be created with the saved details.'
        });

        // Limitations warning
        const limitationsSection = contentEl.createDiv({ cls: 'chronos-restore-limitations' });
        limitationsSection.createEl('h3', { text: '⚠️ Limitations:' });

        const limitationsList = limitationsSection.createEl('ul', { cls: 'chronos-limitations-list' });
        limitationsList.createEl('li', {
            text: 'New event ID (external links won\'t work)'
        });
        limitationsList.createEl('li', {
            text: 'Attendees are NOT restored (re-invite manually if needed)'
        });
        limitationsList.createEl('li', {
            text: 'Original Zoom/Meet link cannot be restored'
        });

        // Event details preview
        if (this.record.eventSnapshot) {
            const previewSection = contentEl.createDiv({ cls: 'chronos-restore-preview' });
            previewSection.createEl('h4', { text: 'Event details:' });

            const detailsList = previewSection.createDiv({ cls: 'chronos-restore-details' });

            // Date/time
            const snapshot = this.record.eventSnapshot;
            let dateTimeText = '';
            if (snapshot.start.date) {
                dateTimeText = `All-day: ${snapshot.start.date}`;
            } else if (snapshot.start.dateTime) {
                const startDate = new Date(snapshot.start.dateTime);
                dateTimeText = startDate.toLocaleString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                });
            }
            if (dateTimeText) {
                detailsList.createDiv({
                    text: `📅 ${dateTimeText}`,
                    cls: 'chronos-restore-detail'
                });
            }

            // Calendar
            detailsList.createDiv({
                text: `📆 ${this.record.calendarName}`,
                cls: 'chronos-restore-detail'
            });

            // Location if present
            if (snapshot.location) {
                detailsList.createDiv({
                    text: `📍 ${snapshot.location}`,
                    cls: 'chronos-restore-detail'
                });
            }

            // Attendee count if present (note: attendees are NOT restored)
            if (snapshot.attendees && snapshot.attendees.length > 0) {
                detailsList.createDiv({
                    text: `👥 Original had ${snapshot.attendees.length} attendee${snapshot.attendees.length === 1 ? '' : 's'} (not restored)`,
                    cls: 'chronos-restore-detail chronos-restore-detail-warning'
                });
            }
        }

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'chronos-restore-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'chronos-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        const restoreBtn = buttonContainer.createEl('button', {
            text: 'Restore Event',
            cls: 'chronos-btn-primary'
        });
        restoreBtn.addEventListener('click', async () => {
            restoreBtn.disabled = true;
            restoreBtn.textContent = 'Restoring...';
            cancelBtn.disabled = true;

            try {
                await this.onRestore(this.record);
                this.close();
            } catch (error) {
                console.error('Failed to restore event:', error);
                restoreBtn.disabled = false;
                restoreBtn.textContent = 'Restore Event';
                cancelBtn.disabled = false;
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
