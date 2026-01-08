import { App, Modal } from 'obsidian';

interface PowerUserWarningCallbacks {
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Warning modal shown when user tries to disable Safe Mode
 * Explains what will happen when deletions become automatic
 */
export class PowerUserWarningModal extends Modal {
    private callbacks: PowerUserWarningCallbacks;

    constructor(app: App, callbacks: PowerUserWarningCallbacks) {
        super(app);
        this.callbacks = callbacks;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-power-user-warning-modal');

        // Header
        contentEl.createEl('h2', { text: 'Disable Safety Net?' });

        // Explanation
        const explanation = contentEl.createDiv({ cls: 'chronos-warning-explanation' });
        explanation.createEl('p', {
            text: 'In Power User mode, Chronos will immediately delete calendar events without asking for confirmation.'
        });

        // What will be auto-deleted section
        const deleteSection = contentEl.createDiv({ cls: 'chronos-warning-loss-section' });
        deleteSection.createEl('h3', { text: 'This includes:' });

        const deleteList = deleteSection.createEl('ul', { cls: 'chronos-warning-loss-list' });
        deleteList.createEl('li', { text: 'Events for deleted task lines' });
        deleteList.createEl('li', { text: 'Events during calendar rerouting (Fresh Start mode)' });

        // Reassurance
        const reassurance = contentEl.createDiv({ cls: 'chronos-warning-safety-note' });
        reassurance.createEl('p', {
            text: 'You can re-enable Safe Mode at any time.',
            cls: 'chronos-safety-reassurance'
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'chronos-warning-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Keep Safe Mode',
            cls: 'chronos-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.callbacks.onCancel();
            this.close();
        });

        const confirmBtn = buttonContainer.createEl('button', {
            text: 'Enable Power User Mode',
            cls: 'chronos-btn-danger'
        });
        confirmBtn.addEventListener('click', () => {
            this.callbacks.onConfirm();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
