import { App, Modal, Setting } from 'obsidian';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface DateTimeResult {
    date: string;      // YYYY-MM-DD
    time: string | null;  // HH:mm or null for all-day
    noSync: boolean;
    customReminders: boolean;
    reminder1: number | null;  // minutes before event
    reminder2: number | null;  // minutes before event
    customDuration: boolean;
    durationHours: number | null;
    durationMinutes: number | null;
    recurrenceFrequency: RecurrenceFrequency;
    recurrenceInterval: number;
    recurrenceWeekdays: string[];  // ['monday', 'wednesday', 'friday']
}

export class DateTimeModal extends Modal {
    private result: DateTimeResult;
    private onSubmit: (result: DateTimeResult) => void;
    private enableRecurrence: boolean;

    constructor(app: App, onSubmit: (result: DateTimeResult) => void, enableRecurrence: boolean = false) {
        super(app);
        this.onSubmit = onSubmit;
        this.enableRecurrence = enableRecurrence;

        // Default to today
        const today = new Date();
        this.result = {
            date: this.formatDate(today),
            time: null,
            noSync: false,
            customReminders: false,
            reminder1: null,
            reminder2: null,
            customDuration: false,
            durationHours: null,
            durationMinutes: null,
            recurrenceFrequency: 'none',
            recurrenceInterval: 1,
            recurrenceWeekdays: []
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

        // Date input (native date picker)
        const dateSetting = new Setting(contentEl)
            .setName('Date');
        const dateInput = dateSetting.controlEl.createEl('input', {
            type: 'date',
            cls: 'chronos-date-picker'
        });
        dateInput.value = this.result.date;
        dateInput.addEventListener('change', () => {
            if (dateInput.value) {
                this.result.date = dateInput.value;
            }
        });

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

        // Custom duration section
        const durationContainer = contentEl.createDiv({ cls: 'chronos-duration-section' });

        new Setting(durationContainer)
            .setName('Custom duration')
            .setDesc('Override default event duration')
            .addToggle(toggle => toggle
                .setValue(this.result.customDuration)
                .onChange(value => {
                    this.result.customDuration = value;
                    // Show/hide the duration inputs
                    durationInputs.style.display = value ? 'flex' : 'none';
                    if (!value) {
                        this.result.durationHours = null;
                        this.result.durationMinutes = null;
                    }
                }));

        const durationInputs = durationContainer.createDiv({ cls: 'chronos-duration-inputs' });
        durationInputs.style.display = this.result.customDuration ? 'flex' : 'none';

        // Duration hours
        const hoursDiv = durationInputs.createDiv({ cls: 'chronos-duration-input' });
        hoursDiv.createEl('label', { text: 'Hours:' });
        const hoursInput = hoursDiv.createEl('input', {
            type: 'number',
            placeholder: '0',
            cls: 'chronos-duration-field'
        });
        hoursInput.min = '0';
        hoursInput.max = '24';
        if (this.result.durationHours) {
            hoursInput.value = String(this.result.durationHours);
        }
        hoursInput.addEventListener('input', () => {
            const val = parseInt(hoursInput.value, 10);
            this.result.durationHours = isNaN(val) || val < 0 ? null : val;
        });
        hoursDiv.createEl('span', { text: 'h', cls: 'chronos-duration-unit' });

        // Duration minutes
        const minutesDiv = durationInputs.createDiv({ cls: 'chronos-duration-input' });
        minutesDiv.createEl('label', { text: 'Minutes:' });
        const minutesInput = minutesDiv.createEl('input', {
            type: 'number',
            placeholder: '30',
            cls: 'chronos-duration-field'
        });
        minutesInput.min = '0';
        minutesInput.max = '59';
        if (this.result.durationMinutes) {
            minutesInput.value = String(this.result.durationMinutes);
        }
        minutesInput.addEventListener('input', () => {
            const val = parseInt(minutesInput.value, 10);
            this.result.durationMinutes = isNaN(val) || val < 0 ? null : val;
        });
        minutesDiv.createEl('span', { text: 'm', cls: 'chronos-duration-unit' });

        // Recurrence section (only shown when recurring tasks feature is enabled)
        const recurrenceContainer = contentEl.createDiv({ cls: 'chronos-recurrence-section' });
        if (!this.enableRecurrence) {
            recurrenceContainer.style.display = 'none';
        }

        new Setting(recurrenceContainer)
            .setName('Repeat')
            .setDesc('Make this a recurring event')
            .addDropdown(dropdown => {
                dropdown.addOption('none', 'Does not repeat');
                dropdown.addOption('daily', 'Daily');
                dropdown.addOption('weekly', 'Weekly');
                dropdown.addOption('monthly', 'Monthly');
                dropdown.addOption('yearly', 'Yearly');
                dropdown.setValue(this.result.recurrenceFrequency);
                dropdown.onChange((value: RecurrenceFrequency) => {
                    this.result.recurrenceFrequency = value;
                    recurrenceOptions.style.display = value !== 'none' ? 'block' : 'none';
                    weekdayOptions.style.display = value === 'weekly' ? 'flex' : 'none';
                });
            });

        const recurrenceOptions = recurrenceContainer.createDiv({ cls: 'chronos-recurrence-options' });
        recurrenceOptions.style.display = this.result.recurrenceFrequency !== 'none' ? 'block' : 'none';

        // Interval input (every N days/weeks/etc)
        const intervalDiv = recurrenceOptions.createDiv({ cls: 'chronos-interval-input' });
        intervalDiv.createEl('span', { text: 'Every ' });
        const intervalInput = intervalDiv.createEl('input', {
            type: 'number',
            cls: 'chronos-interval-field'
        });
        intervalInput.min = '1';
        intervalInput.max = '99';
        intervalInput.value = String(this.result.recurrenceInterval);
        intervalInput.addEventListener('input', () => {
            const val = parseInt(intervalInput.value, 10);
            this.result.recurrenceInterval = isNaN(val) || val < 1 ? 1 : val;
        });
        const intervalLabel = intervalDiv.createEl('span', { cls: 'chronos-interval-label' });
        intervalLabel.setText(this.getIntervalLabel(this.result.recurrenceFrequency, this.result.recurrenceInterval));

        // Update interval label when frequency changes
        const updateIntervalLabel = () => {
            intervalLabel.setText(this.getIntervalLabel(this.result.recurrenceFrequency, this.result.recurrenceInterval));
        };
        intervalInput.addEventListener('input', updateIntervalLabel);

        // Weekday checkboxes (for weekly recurrence)
        const weekdayOptions = recurrenceOptions.createDiv({ cls: 'chronos-weekday-options' });
        weekdayOptions.style.display = this.result.recurrenceFrequency === 'weekly' ? 'flex' : 'none';

        const weekdays = [
            { key: 'sunday', label: 'S' },
            { key: 'monday', label: 'M' },
            { key: 'tuesday', label: 'T' },
            { key: 'wednesday', label: 'W' },
            { key: 'thursday', label: 'T' },
            { key: 'friday', label: 'F' },
            { key: 'saturday', label: 'S' }
        ];

        for (const day of weekdays) {
            const dayBtn = weekdayOptions.createEl('button', {
                text: day.label,
                cls: 'chronos-weekday-btn'
            });
            dayBtn.dataset.day = day.key;
            if (this.result.recurrenceWeekdays.includes(day.key)) {
                dayBtn.addClass('is-selected');
            }
            dayBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const isSelected = this.result.recurrenceWeekdays.includes(day.key);
                if (isSelected) {
                    this.result.recurrenceWeekdays = this.result.recurrenceWeekdays.filter(d => d !== day.key);
                    dayBtn.removeClass('is-selected');
                } else {
                    this.result.recurrenceWeekdays.push(day.key);
                    dayBtn.addClass('is-selected');
                }
            });
        }

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

    private getIntervalLabel(frequency: RecurrenceFrequency, interval: number): string {
        const plural = interval !== 1;
        switch (frequency) {
            case 'daily':
                return plural ? ' days' : ' day';
            case 'weekly':
                return plural ? ' weeks' : ' week';
            case 'monthly':
                return plural ? ' months' : ' month';
            case 'yearly':
                return plural ? ' years' : ' year';
            default:
                return '';
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
