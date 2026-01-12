import { App, Modal } from 'obsidian';
import { PendingSuccessorCheck } from './syncManager';

/**
 * Modal shown when a recurring task cannot find its successor.
 * Gives user options to delete the calendar series or keep it.
 */
export class SeriesDisconnectionModal extends Modal {
    private check: PendingSuccessorCheck;
    private onDeleteSeries: () => void;
    private onKeepSeries: () => void;

    constructor(
        app: App,
        check: PendingSuccessorCheck,
        onDeleteSeries: () => void,
        onKeepSeries: () => void
    ) {
        super(app);
        this.check = check;
        this.onDeleteSeries = onDeleteSeries;
        this.onKeepSeries = onKeepSeries;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-series-disconnection-modal');

        contentEl.createEl('h2', { text: '🔁 Recurring Task Missing Successor' });

        // Description
        const desc = contentEl.createDiv({ cls: 'chronos-series-desc' });
        desc.createEl('p', {
            text: `Chronos tracked a recurring task "${this.check.title}" but couldn't find its next instance.`
        });
        desc.createEl('p', {
            text: 'This might happen if:'
        });
        const reasons = desc.createEl('ul');
        reasons.createEl('li', { text: 'You deleted the recurring task entirely' });
        reasons.createEl('li', { text: 'Tasks plugin didn\'t create the next instance' });
        reasons.createEl('li', { text: 'You modified the task so it no longer matches' });

        // Task details
        const detailsDiv = contentEl.createDiv({ cls: 'chronos-series-details' });
        detailsDiv.createEl('p', {
            text: `📋 Task: ${this.check.title}`
        });
        detailsDiv.createEl('p', {
            text: `📅 Last date: ${this.check.originalDate}`
        });
        if (this.check.time) {
            detailsDiv.createEl('p', {
                text: `⏰ Time: ${this.check.time}`
            });
        }
        detailsDiv.createEl('p', {
            text: `📄 File: ${this.check.filePath}`
        });

        // Question
        contentEl.createEl('p', {
            text: 'What would you like to do with the Google Calendar event?',
            cls: 'chronos-series-question'
        });

        // Options
        const options = contentEl.createDiv({ cls: 'chronos-series-options' });

        // Option 1: Delete Series
        const deleteOption = options.createDiv({ cls: 'chronos-series-option' });
        const deleteBtn = deleteOption.createEl('button', {
            text: '🗑️ Delete Calendar Event',
            cls: 'mod-warning'
        });
        deleteOption.createEl('p', {
            text: 'The recurring event will be removed from Google Calendar.',
            cls: 'chronos-series-option-desc'
        });

        // Option 2: Keep Series
        const keepOption = options.createDiv({ cls: 'chronos-series-option' });
        const keepBtn = keepOption.createEl('button', {
            text: '📆 Keep Calendar Event'
        });
        keepOption.createEl('p', {
            text: 'The event stays on your calendar. Chronos will stop tracking it.',
            cls: 'chronos-series-option-desc'
        });

        // Event handlers
        deleteBtn.addEventListener('click', () => {
            this.onDeleteSeries();
            this.close();
        });

        keepBtn.addEventListener('click', () => {
            this.onKeepSeries();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
