import { App, Modal } from 'obsidian';

export type RecurringDeleteChoice = 'deleteNext' | 'deleteAll' | 'markComplete';

export interface RecurringDeleteResult {
    choice: RecurringDeleteChoice;
}

/**
 * Modal shown when a recurring task is completed (Safety Net OFF)
 * Lets user choose how to handle the recurring calendar event
 */
export class RecurringDeleteModal extends Modal {
    private taskTitle: string;
    private onSubmit: (result: RecurringDeleteResult) => void;

    constructor(
        app: App,
        taskTitle: string,
        onSubmit: (result: RecurringDeleteResult) => void
    ) {
        super(app);
        this.taskTitle = taskTitle;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-recurring-delete-modal');

        contentEl.createEl('h2', { text: 'Recurring Event Completed' });

        const desc = contentEl.createEl('p', { cls: 'chronos-modal-desc' });
        desc.setText(`The task "${this.taskTitle}" is a recurring event. What would you like to do with the calendar events?`);

        // Options container
        const optionsContainer = contentEl.createDiv({ cls: 'chronos-recurring-options' });

        // Option 1: Delete next instance (not yet implemented)
        const option1 = optionsContainer.createDiv({ cls: 'chronos-recurring-option chronos-option-disabled' });
        const btn1 = option1.createEl('button', {
            text: 'Delete Next Instance',
            cls: 'chronos-option-btn',
            attr: { disabled: 'true' }
        });
        option1.createEl('p', {
            text: 'Coming soon: Delete only the next occurrence while keeping future instances.',
            cls: 'chronos-option-desc'
        });

        // Option 2: Delete all
        const option2 = optionsContainer.createDiv({ cls: 'chronos-recurring-option' });
        const btn2 = option2.createEl('button', {
            text: 'Delete All Events',
            cls: 'chronos-option-btn mod-warning'
        });
        option2.createEl('p', {
            text: 'Delete the entire recurring series from the calendar.',
            cls: 'chronos-option-desc'
        });
        btn2.addEventListener('click', () => {
            this.onSubmit({ choice: 'deleteAll' });
            this.close();
        });

        // Option 3: Keep events (release from sync)
        const option3 = optionsContainer.createDiv({ cls: 'chronos-recurring-option' });
        const btn3 = option3.createEl('button', {
            text: 'Keep Events (Recommended)',
            cls: 'chronos-option-btn mod-cta'
        });
        option3.createEl('p', {
            text: 'Keep all calendar events intact. The task is released from sync tracking so future syncs won\'t affect it.',
            cls: 'chronos-option-desc'
        });
        btn3.addEventListener('click', () => {
            this.onSubmit({ choice: 'markComplete' });
            this.close();
        });

        // Cancel button
        const cancelContainer = contentEl.createDiv({ cls: 'chronos-cancel-container' });
        const cancelBtn = cancelContainer.createEl('button', {
            text: 'Cancel',
            cls: 'chronos-cancel-btn'
        });
        cancelBtn.addEventListener('click', () => this.close());
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
