import { App, Modal, Setting } from 'obsidian';

export interface DateTimeResult {
    date: string;      // YYYY-MM-DD
    time: string | null;  // HH:mm or null for all-day
    noSync: boolean;
    customReminders: boolean;
    reminder1: number | null;  // minutes before event
    reminder2: number | null;  // minutes before event
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
            noSync: false,
            customReminders: false,
            reminder1: null,
            reminder2: null
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
                .setValue(this.result.noSync)
                .onChange(value => {
                    this.result.noSync = value;
                }));

        // Custom reminders section
        const reminderContainer = contentEl.createDiv({ cls: 'chronos-reminder-section' });

        new Setting(reminderContainer)
            .setName('Custom reminders')
            .setDesc('Override default reminder times (in minutes before event)')
            .addToggle(toggle => toggle
                .setValue(this.result.customReminders)
                .onChange(value => {
                    this.result.customReminders = value;
                    // Show/hide the reminder inputs
                    reminderInputs.style.display = value ? 'flex' : 'none';
                    if (!value) {
                        this.result.reminder1 = null;
                        this.result.reminder2 = null;
                    }
                }));

        const reminderInputs = reminderContainer.createDiv({ cls: 'chronos-reminder-inputs' });
        reminderInputs.style.display = this.result.customReminders ? 'flex' : 'none';

        // Reminder 1
        const reminder1Div = reminderInputs.createDiv({ cls: 'chronos-reminder-input' });
        reminder1Div.createEl('label', { text: 'Reminder 1:' });
        const input1 = reminder1Div.createEl('input', {
            type: 'number',
            placeholder: '30',
            cls: 'chronos-reminder-field'
        });
        input1.min = '1';
        input1.max = '10080'; // 1 week in minutes
        if (this.result.reminder1) {
            input1.value = String(this.result.reminder1);
        }
        input1.addEventListener('input', () => {
            const val = parseInt(input1.value, 10);
            this.result.reminder1 = isNaN(val) || val <= 0 ? null : val;
        });
        reminder1Div.createEl('span', { text: 'min', cls: 'chronos-reminder-unit' });

        // Reminder 2
        const reminder2Div = reminderInputs.createDiv({ cls: 'chronos-reminder-input' });
        reminder2Div.createEl('label', { text: 'Reminder 2:' });
        const input2 = reminder2Div.createEl('input', {
            type: 'number',
            placeholder: '10',
            cls: 'chronos-reminder-field'
        });
        input2.min = '1';
        input2.max = '10080';
        if (this.result.reminder2) {
            input2.value = String(this.result.reminder2);
        }
        input2.addEventListener('input', () => {
            const val = parseInt(input2.value, 10);
            this.result.reminder2 = isNaN(val) || val <= 0 ? null : val;
        });
        reminder2Div.createEl('span', { text: 'min', cls: 'chronos-reminder-unit' });

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
