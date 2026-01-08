import { App, Modal } from 'obsidian';

/**
 * Warning modal shown when user selects Fresh Start mode in settings
 * Explains what will be lost when events are deleted and recreated
 */
export class FreshStartWarningModal extends Modal {
    private onConfirm: () => void;
    private onCancel: () => void;

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
        contentEl.addClass('chronos-freshstart-warning-modal');

        // Header
        contentEl.createEl('h2', { text: 'Fresh Start Mode Warning' });

        // Explanation
        const explanation = contentEl.createDiv({ cls: 'chronos-warning-explanation' });
        explanation.createEl('p', {
            text: 'This mode DELETES calendar events when tasks move to different calendars (due to tag changes or default calendar changes).'
        });

        // What you'll lose section
        const lossSection = contentEl.createDiv({ cls: 'chronos-warning-loss-section' });
        lossSection.createEl('h3', { text: "What you'll lose from old events:" });

        const lossList = lossSection.createEl('ul', { cls: 'chronos-warning-loss-list' });
        lossList.createEl('li', { text: 'Meeting attendees & RSVPs' });
        lossList.createEl('li', { text: 'Custom descriptions you added in Google Calendar' });
        lossList.createEl('li', { text: 'Zoom/Meet links attached to events' });
        lossList.createEl('li', { text: 'Any edits made outside Obsidian' });

        // Safety net note
        const safetyNote = contentEl.createDiv({ cls: 'chronos-warning-safety-note' });
        safetyNote.createEl('p', {
            text: 'Deletions will require your approval before executing.',
            cls: 'chronos-safety-reassurance'
        });

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'chronos-warning-buttons' });

        const cancelBtn = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'chronos-btn-secondary'
        });
        cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        const confirmBtn = buttonContainer.createEl('button', {
            text: 'I Understand, Enable Fresh Start',
            cls: 'chronos-btn-danger'
        });
        confirmBtn.addEventListener('click', () => {
            this.onConfirm();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
