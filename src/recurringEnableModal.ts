import { App, Modal } from 'obsidian';

/**
 * Modal shown when user enables recurring tasks feature.
 * Requires user to confirm they understand the requirements.
 */
export class RecurringEnableModal extends Modal {
    private onConfirm: () => void;
    private onCancel: () => void;
    private checkboxChecked: boolean = false;

    constructor(
        app: App,
        onConfirm: () => void,
        onCancel: () => void
    ) {
        super(app);
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-recurring-enable-modal');

        contentEl.createEl('h2', { text: 'Enable Recurring Tasks Sync' });

        // Warning section
        const warningDiv = contentEl.createDiv({ cls: 'chronos-recurring-warning' });

        warningDiv.createEl('p', {
            text: '⚠️ Before enabling recurring task sync, please understand:',
            cls: 'chronos-recurring-warning-header'
        });

        const requirementsList = warningDiv.createEl('ul', { cls: 'chronos-recurring-requirements' });

        requirementsList.createEl('li', {
            text: 'Tasks plugin MUST be configured to create new recurring instances BELOW completed tasks (not above).'
        });

        requirementsList.createEl('li', {
            text: 'This is a one-way sync. Changes made to recurring events in Google Calendar will NOT update your Obsidian tasks.'
        });

        requirementsList.createEl('li', {
            text: 'If Chronos cannot find a successor task after you complete a recurring task, you\'ll be asked whether to keep or delete the calendar series.'
        });

        // Tasks plugin setting instructions
        const instructionsDiv = contentEl.createDiv({ cls: 'chronos-recurring-instructions' });
        instructionsDiv.createEl('p', {
            text: '📋 To configure Tasks plugin:',
            cls: 'chronos-recurring-instructions-header'
        });
        instructionsDiv.createEl('p', {
            text: 'Settings → Tasks → "Where to create the new task" → Select "Below the current task"',
            cls: 'chronos-recurring-instructions-path'
        });

        // Checkbox confirmation
        const confirmDiv = contentEl.createDiv({ cls: 'chronos-recurring-confirm' });

        const checkboxContainer = confirmDiv.createDiv({ cls: 'chronos-recurring-checkbox-container' });
        const checkbox = checkboxContainer.createEl('input', {
            type: 'checkbox',
            attr: { id: 'chronos-recurring-confirm-check' }
        });
        const label = checkboxContainer.createEl('label', {
            text: 'I understand these requirements and have configured Tasks plugin correctly',
            attr: { for: 'chronos-recurring-confirm-check' }
        });

        // Enable button (initially disabled)
        const buttonContainer = contentEl.createDiv({ cls: 'chronos-recurring-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel'
        });

        const enableBtn = buttonContainer.createEl('button', {
            text: 'Enable Recurring Sync',
            cls: 'mod-cta',
            attr: { disabled: 'true' }
        });

        // Event handlers
        checkbox.addEventListener('change', () => {
            this.checkboxChecked = checkbox.checked;
            if (this.checkboxChecked) {
                enableBtn.removeAttribute('disabled');
            } else {
                enableBtn.setAttribute('disabled', 'true');
            }
        });

        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        enableBtn.addEventListener('click', () => {
            if (this.checkboxChecked) {
                this.onConfirm();
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
