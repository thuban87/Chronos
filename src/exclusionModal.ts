import { App, Modal } from 'obsidian';

export interface ExclusionModalResult {
    action: 'keep' | 'delete' | 'cancel';
}

/**
 * Modal shown when adding an exclusion that affects already-synced tasks
 */
export class ExclusionModal extends Modal {
    private exclusionPath: string;
    private isFolder: boolean;
    private affectedCount: number;
    private onResult: (result: ExclusionModalResult) => void;

    constructor(
        app: App,
        exclusionPath: string,
        isFolder: boolean,
        affectedCount: number,
        onResult: (result: ExclusionModalResult) => void
    ) {
        super(app);
        this.exclusionPath = exclusionPath;
        this.isFolder = isFolder;
        this.affectedCount = affectedCount;
        this.onResult = onResult;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-exclusion-modal');

        const type = this.isFolder ? 'folder' : 'file';
        const icon = this.isFolder ? '📁' : '📄';

        contentEl.createEl('h2', { text: 'Synced Tasks Found' });

        const messageEl = contentEl.createEl('p');
        messageEl.innerHTML = `The ${type} <strong>${icon} ${this.exclusionPath}</strong> contains <strong>${this.affectedCount} synced task${this.affectedCount === 1 ? '' : 's'}</strong>.`;

        contentEl.createEl('p', {
            text: 'What would you like to do with the existing calendar events?'
        });

        // Options container
        const optionsEl = contentEl.createDiv({ cls: 'chronos-exclusion-modal-options' });

        // Keep events option
        const keepOption = optionsEl.createDiv({ cls: 'chronos-exclusion-modal-option' });
        const keepBtn = keepOption.createEl('button', {
            text: 'Keep Events',
            cls: 'mod-cta'
        });
        keepOption.createEl('p', {
            text: 'Events stay in Google Calendar. Tasks will stop syncing but existing events remain.',
            cls: 'chronos-exclusion-modal-desc'
        });
        keepBtn.addEventListener('click', () => {
            this.onResult({ action: 'keep' });
            this.close();
        });

        // Delete events option
        const deleteOption = optionsEl.createDiv({ cls: 'chronos-exclusion-modal-option' });
        const deleteBtn = deleteOption.createEl('button', {
            text: 'Delete Events',
            cls: 'mod-warning'
        });
        deleteOption.createEl('p', {
            text: 'Events will be deleted from Google Calendar. This cannot be undone.',
            cls: 'chronos-exclusion-modal-desc'
        });
        deleteBtn.addEventListener('click', () => {
            this.onResult({ action: 'delete' });
            this.close();
        });

        // Cancel button
        const cancelEl = contentEl.createDiv({ cls: 'chronos-exclusion-modal-cancel' });
        const cancelBtn = cancelEl.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.onResult({ action: 'cancel' });
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
