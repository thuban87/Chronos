import { App, Modal, Notice } from 'obsidian';
import { PendingDeletion } from './syncManager';

/**
 * Modal for restoring a deleted task line (Safety Net)
 * Shows the user the original task line so they can copy/paste it back
 */
export class TaskRestoreModal extends Modal {
    private deletion: PendingDeletion;
    private onDone: () => void;

    constructor(
        app: App,
        deletion: PendingDeletion,
        onDone: () => void
    ) {
        super(app);
        this.deletion = deletion;
        this.onDone = onDone;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-task-restore-modal');

        // Header
        contentEl.createEl('h2', { text: '🔄 Restore Your Task' });

        // Friendly instructions
        const instructions = contentEl.createDiv({ cls: 'chronos-restore-instructions' });
        instructions.createEl('p', {
            text: "We've got your back! Copy your old task below and paste it into the same file it was in before. Then run a sync and everything will reconnect!"
        });
        instructions.createEl('p', {
            text: 'No harm, no foul.',
            cls: 'chronos-restore-tagline'
        });

        // Source file info
        const sourceInfo = contentEl.createDiv({ cls: 'chronos-restore-source' });
        sourceInfo.createEl('span', { text: '📄 Source file: ' });
        sourceInfo.createEl('strong', { text: this.deletion.sourceFile });

        // Task line box
        const taskLineContainer = contentEl.createDiv({ cls: 'chronos-restore-task-container' });
        const taskLineBox = taskLineContainer.createEl('div', {
            cls: 'chronos-restore-task-line',
            text: this.deletion.originalTaskLine
        });

        // Copy button
        const copyBtn = taskLineContainer.createEl('button', {
            text: 'Copy to Clipboard',
            cls: 'chronos-btn-primary'
        });
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(this.deletion.originalTaskLine);
                new Notice('Task line copied to clipboard!');
                copyBtn.setText('✓ Copied!');
                copyBtn.addClass('chronos-btn-success');
                setTimeout(() => {
                    copyBtn.setText('Copy to Clipboard');
                    copyBtn.removeClass('chronos-btn-success');
                }, 2000);
            } catch (error) {
                new Notice('Failed to copy to clipboard');
                console.error('Clipboard error:', error);
            }
        });

        // Done button
        const doneContainer = contentEl.createDiv({ cls: 'chronos-restore-done-container' });
        const doneBtn = doneContainer.createEl('button', {
            text: "Done - I've pasted it back",
            cls: 'chronos-btn-secondary'
        });
        doneBtn.addEventListener('click', () => {
            this.onDone();
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
