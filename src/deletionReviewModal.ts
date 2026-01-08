import { App, Modal, Notice } from 'obsidian';
import { PendingDeletion } from './syncManager';

/**
 * Modal for reviewing pending deletions (Safety Net)
 * Simple list format - event name on left, type badge on right
 */
export class DeletionReviewModal extends Modal {
    private pendingDeletions: PendingDeletion[];
    private onDelete: (deletion: PendingDeletion) => Promise<void>;
    private onKeep: (deletion: PendingDeletion) => void;
    private onRestore: (deletion: PendingDeletion) => void;
    private onDeleteAll: () => Promise<void>;
    private onKeepAll: () => void;
    private getCalendarName: (calendarId: string) => string;
    private onDeleteAndRecreate: (deletion: PendingDeletion) => Promise<void>;
    private onKeepOriginal: (deletion: PendingDeletion) => void;

    constructor(
        app: App,
        pendingDeletions: PendingDeletion[],
        callbacks: {
            onDelete: (deletion: PendingDeletion) => Promise<void>;
            onKeep: (deletion: PendingDeletion) => void;
            onRestore: (deletion: PendingDeletion) => void;
            onDeleteAll: () => Promise<void>;
            onKeepAll: () => void;
            getCalendarName: (calendarId: string) => string;
            onDeleteAndRecreate?: (deletion: PendingDeletion) => Promise<void>;
            onKeepOriginal?: (deletion: PendingDeletion) => void;
        }
    ) {
        super(app);
        this.pendingDeletions = pendingDeletions;
        this.onDelete = callbacks.onDelete;
        this.onKeep = callbacks.onKeep;
        this.onRestore = callbacks.onRestore;
        this.onDeleteAll = callbacks.onDeleteAll;
        this.onKeepAll = callbacks.onKeepAll;
        this.getCalendarName = callbacks.getCalendarName;
        this.onDeleteAndRecreate = callbacks.onDeleteAndRecreate || callbacks.onDelete;
        this.onKeepOriginal = callbacks.onKeepOriginal || callbacks.onKeep;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-deletion-review-modal');
        this.renderContent();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    private renderContent(): void {
        const { contentEl } = this;
        contentEl.empty();

        const count = this.pendingDeletions.length;

        // Header
        const header = contentEl.createDiv({ cls: 'chronos-deletion-header' });
        if (count === 0) {
            header.createEl('h2', { text: 'No Pending Deletions' });
            contentEl.createEl('p', {
                text: 'All clear! No deletions are waiting for review.',
                cls: 'chronos-deletion-empty'
            });
            return;
        }

        header.createEl('h2', { text: `${count} Pending Deletion${count === 1 ? '' : 's'}` });

        // Batch buttons
        const batchButtons = contentEl.createDiv({ cls: 'chronos-deletion-batch-buttons' });

        const deleteAllBtn = batchButtons.createEl('button', {
            text: 'Delete All',
            cls: 'chronos-btn-danger'
        });
        const keepAllBtn = batchButtons.createEl('button', {
            text: 'Keep All',
            cls: 'chronos-btn-secondary'
        });

        deleteAllBtn.onclick = async () => {
            deleteAllBtn.disabled = true;
            deleteAllBtn.textContent = 'Processing...';
            keepAllBtn.disabled = true;

            try {
                await this.onDeleteAll();
                this.close();
            } catch (error) {
                console.error('Delete All failed:', error);
                deleteAllBtn.disabled = false;
                deleteAllBtn.textContent = 'Delete All';
                keepAllBtn.disabled = false;
            }
        };

        keepAllBtn.onclick = () => {
            this.onKeepAll();
            this.close();
        };

        // Simple list of events
        const list = contentEl.createDiv({ cls: 'chronos-deletion-simple-list' });

        for (const deletion of this.pendingDeletions) {
            this.renderSimpleItem(list, deletion);
        }
    }

    /**
     * Render a simple list item: [Title] [Date/Time] [Badge] + risk indicators
     */
    private renderSimpleItem(container: HTMLElement, deletion: PendingDeletion): void {
        const isFreshStart = deletion.reason === 'freshStart';
        const isHighRisk = deletion.hasAttendees || deletion.hasCustomDescription || deletion.hasConferenceLink;

        const row = container.createDiv({
            cls: `chronos-deletion-row ${isHighRisk ? 'chronos-deletion-row-high-risk' : ''}`
        });

        // Left side: title (truncated)
        const titleSpan = row.createEl('span', { cls: 'chronos-deletion-row-title' });
        const truncatedTitle = deletion.eventTitle.length > 35
            ? deletion.eventTitle.substring(0, 32) + '...'
            : deletion.eventTitle;
        titleSpan.textContent = truncatedTitle;
        titleSpan.title = deletion.eventTitle; // Full title on hover

        // Middle: date/time
        const dateTimeSpan = row.createEl('span', { cls: 'chronos-deletion-row-datetime' });
        let dateTimeText = deletion.eventDate;
        if (deletion.eventTime) {
            dateTimeText += ` ${deletion.eventTime}`;
        }
        dateTimeSpan.textContent = dateTimeText;

        // Risk indicators section
        if (isHighRisk) {
            const riskContainer = row.createEl('span', { cls: 'chronos-deletion-row-risks' });

            if (deletion.hasAttendees) {
                const attendeeCount = deletion.eventSnapshot?.attendees?.length || 0;
                const attendeeIcon = riskContainer.createEl('span', {
                    cls: 'chronos-risk-icon',
                    attr: { title: `${attendeeCount} attendee${attendeeCount === 1 ? '' : 's'}` }
                });
                attendeeIcon.textContent = `👥${attendeeCount}`;
            }

            if (deletion.hasConferenceLink) {
                const confIcon = riskContainer.createEl('span', {
                    cls: 'chronos-risk-icon',
                    attr: { title: 'Has video conference link' }
                });
                confIcon.textContent = '📹';
            }

            if (deletion.hasCustomDescription) {
                const descIcon = riskContainer.createEl('span', {
                    cls: 'chronos-risk-icon',
                    attr: { title: 'Has custom description' }
                });
                descIcon.textContent = '📝';
            }
        }

        // Right side: badge
        const badge = row.createEl('span', {
            cls: isFreshStart ? 'chronos-deletion-row-badge chronos-badge-move' : 'chronos-deletion-row-badge chronos-badge-orphan'
        });
        badge.textContent = isFreshStart ? 'Move' : 'Orphan';
    }
}
