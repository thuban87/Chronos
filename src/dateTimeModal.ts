import { App, Modal, Setting } from 'obsidian';

export interface DateTimeResult {
    date: string;      // YYYY-MM-DD
    time: string | null;  // HH:mm or null for all-day
    noSync: boolean;
}

export class DateTimeModal extends Modal {
    private result: DateTimeResult;
    private onSubmit: (result: DateTimeResult) => void;

    constructor(app: App, onSubmit: (result: DateTimeResult) => void) {
        super(app);
        this.onSubmit = onSubmit;

        // Default to today
        const today = new Date();
        this.result = {
            date: this.formatDate(today),
            time: null,
            noSync: false
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('chronos-datetime-modal');

        contentEl.createEl('h2', { text: 'Add Date & Time' });

        // Quick date buttons
        const quickDates = contentEl.createDiv({ cls: 'chronos-quick-dates' });
        quickDates.createEl('span', { text: 'Quick select: ', cls: 'chronos-label' });

        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);

        this.createQuickButton(quickDates, 'Today', today);
        this.createQuickButton(quickDates, 'Tomorrow', tomorrow);
        this.createQuickButton(quickDates, '+1 Week', nextWeek);

        // Date input
        new Setting(contentEl)
            .setName('Date')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.result.date)
                .onChange(value => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                        this.result.date = value;
                    }
                }));

        // Time dropdown
        new Setting(contentEl)
            .setName('Time')
            .setDesc('Leave as "All day" for date-only events')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'All day');
                for (let h = 6; h <= 22; h++) {
                    for (let m = 0; m < 60; m += 30) {
                        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        const label = this.formatTimeLabel(h, m);
                        dropdown.addOption(time, label);
                    }
                }
                dropdown.onChange(value => {
                    this.result.time = value || null;
                });
            });

        // No-sync toggle
        new Setting(contentEl)
            .setName('Exclude from sync')
            .setDesc('Add 🚫 to prevent syncing to Google Calendar')
            .addToggle(toggle => toggle
                .setValue(false)
                .onChange(value => {
                    this.result.noSync = value;
                }));

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'chronos-button-container' });

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const insertBtn = buttonContainer.createEl('button', {
            text: 'Insert',
            cls: 'mod-cta'
        });
        insertBtn.addEventListener('click', () => {
            this.onSubmit(this.result);
            this.close();
        });
    }

    private createQuickButton(container: HTMLElement, label: string, date: Date) {
        const btn = container.createEl('button', {
            text: label,
            cls: 'chronos-quick-btn'
        });
        btn.addEventListener('click', () => {
            this.result.date = this.formatDate(date);
            // Refresh the modal to show new date
            this.onOpen();
        });
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private formatTimeLabel(hours: number, minutes: number): string {
        const period = hours >= 12 ? 'PM' : 'AM';
        const h12 = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
        const m = String(minutes).padStart(2, '0');
        return `${h12}:${m} ${period}`;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
