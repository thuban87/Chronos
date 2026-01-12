import { App, Modal } from 'obsidian';

/**
 * Modal shown when a recurring task's recurrence pattern has changed significantly.
 * Gives user options for how to handle the calendar event.
 */
export class RecurrenceChangeModal extends Modal {
    private taskTitle: string;
    private oldPattern: string;
    private newPattern: string;
    private onCreateNewDeleteOld: () => void;
    private onCreateNewKeepOld: () => void;
    private onCancel: () => void;

    constructor(
        app: App,
        taskTitle: string,
        oldPattern: string,
        newPattern: string,
        onCreateNewDeleteOld: () => void,
        onCreateNewKeepOld: () => void,
        onCancel: () => void
    ) {
        super(app);
        this.taskTitle = taskTitle;
        this.oldPattern = oldPattern;
        this.newPattern = newPattern;
        this.onCreateNewDeleteOld = onCreateNewDeleteOld;
        this.onCreateNewKeepOld = onCreateNewKeepOld;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-recurrence-change-modal');

        contentEl.createEl('h2', { text: '🔄 Recurrence Pattern Changed' });

        // Description
        const desc = contentEl.createDiv({ cls: 'chronos-recurrence-desc' });
        desc.createEl('p', {
            text: `The recurrence pattern for "${this.taskTitle}" has changed.`
        });

        // Pattern comparison
        const patternDiv = contentEl.createDiv({ cls: 'chronos-pattern-comparison' });
        patternDiv.createEl('p', {
            text: `📅 Old: ${this.oldPattern || 'Unknown'}`,
            cls: 'chronos-pattern-old'
        });
        patternDiv.createEl('p', {
            text: `📅 New: ${this.newPattern || 'Unknown'}`,
            cls: 'chronos-pattern-new'
        });

        // Question
        contentEl.createEl('p', {
            text: 'How would you like to handle the Google Calendar event?',
            cls: 'chronos-recurrence-question'
        });

        // Options
        const options = contentEl.createDiv({ cls: 'chronos-recurrence-options' });

        // Option 1: Delete old, create new
        const deleteOldOption = options.createDiv({ cls: 'chronos-recurrence-option' });
        const deleteOldBtn = deleteOldOption.createEl('button', {
            text: '🗑️ Create New (Delete Old)',
            cls: 'mod-cta'
        });
        deleteOldOption.createEl('p', {
            text: 'Delete the old recurring event and create a new one with the new pattern.',
            cls: 'chronos-recurrence-option-desc'
        });

        // Option 2: Keep old, create new
        const keepOldOption = options.createDiv({ cls: 'chronos-recurrence-option' });
        const keepOldBtn = keepOldOption.createEl('button', {
            text: '📆 Create New (Keep Old)'
        });
        keepOldOption.createEl('p', {
            text: 'Create a new event with the new pattern. You\'ll need to manually delete the old one.',
            cls: 'chronos-recurrence-option-desc'
        });

        // Cancel
        const cancelDiv = contentEl.createDiv({ cls: 'chronos-recurrence-cancel' });
        const cancelBtn = cancelDiv.createEl('button', {
            text: 'Cancel',
            cls: 'chronos-btn-secondary'
        });

        // Event handlers
        deleteOldBtn.addEventListener('click', () => {
            this.onCreateNewDeleteOld();
            this.close();
        });

        keepOldBtn.addEventListener('click', () => {
            this.onCreateNewKeepOld();
            this.close();
        });

        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
