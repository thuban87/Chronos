import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, MarkdownView } from 'obsidian';
import { GoogleAuth, TokenData } from './src/googleAuth';
import { TaskParser, ChronosTask } from './src/taskParser';
import { DateTimeModal } from './src/dateTimeModal';
import { GoogleCalendarApi, GoogleCalendar } from './src/googleCalendar';
import { SyncManager, ChronosSyncData } from './src/syncManager';

interface ChronosSettings {
	googleCalendarId: string;
	syncIntervalMinutes: number;
	defaultReminderMinutes: number[];
	defaultEventDurationMinutes: number;
	timeZone: string;
}

interface ChronosData {
	settings: ChronosSettings;
	tokens?: TokenData;
	syncData?: ChronosSyncData;
}

const DEFAULT_SETTINGS: ChronosSettings = {
	googleCalendarId: '',
	syncIntervalMinutes: 10,
	defaultReminderMinutes: [30, 10],
	defaultEventDurationMinutes: 30,
	timeZone: 'local'
};

export default class ChronosPlugin extends Plugin {
	settings: ChronosSettings;
	tokens?: TokenData;
	googleAuth: GoogleAuth;
	taskParser: TaskParser;
	calendarApi: GoogleCalendarApi;
	syncManager: SyncManager;
	private syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();
		this.googleAuth = new GoogleAuth();
		this.taskParser = new TaskParser(this.app);
		this.calendarApi = new GoogleCalendarApi(() => this.getAccessToken());
		// SyncManager is initialized in loadSettings()

		// Add settings tab
		this.addSettingTab(new ChronosSettingTab(this.app, this));

		// Start automatic sync interval
		this.startSyncInterval();

		// Add ribbon icon - click to scan tasks
		this.addRibbonIcon('calendar-clock', 'Chronos: Scan tasks', async () => {
			await this.showTaskScanResults();
		});

		// Add command to scan tasks
		this.addCommand({
			id: 'scan-tasks',
			name: 'Scan vault for sync-eligible tasks',
			callback: async () => {
				await this.showTaskScanResults();
			}
		});

		// Add command to insert date/time
		this.addCommand({
			id: 'insert-datetime',
			name: 'Insert date/time for task',
			editorCallback: (editor) => {
				new DateTimeModal(this.app, (result) => {
					let text = `📅 ${result.date}`;
					if (result.time) {
						text += ` ⏰ ${result.time}`;
					}
					if (result.noSync) {
						text += ' 🚫';
					}
					editor.replaceSelection(text);
				}).open();
			}
		});

		// Add command to sync now
		this.addCommand({
			id: 'sync-now',
			name: 'Sync tasks to Google Calendar now',
			callback: async () => {
				await this.syncTasks();
			}
		});

		console.log('Chronos plugin loaded');
	}

	/**
	 * Scan vault and show results in a modal
	 */
	async showTaskScanResults(): Promise<void> {
		new Notice('Scanning vault for tasks...');
		const tasks = await this.taskParser.scanVault();
		new TaskListModal(this.app, tasks).open();
	}

	/**
	 * Sync all eligible tasks to Google Calendar
	 * Uses SyncManager for duplicate prevention and change detection
	 */
	async syncTasks(silent: boolean = false): Promise<void> {
		if (!this.isAuthenticated()) {
			if (!silent) new Notice('Chronos: Please connect to Google Calendar first');
			return;
		}

		if (!this.settings.googleCalendarId) {
			if (!silent) new Notice('Chronos: Please select a calendar in settings');
			return;
		}

		if (!silent) new Notice('Chronos: Syncing tasks...');

		try {
			const tasks = await this.taskParser.scanVault();
			const calendarId = this.settings.googleCalendarId;

			// Compute what needs to be done
			const diff = this.syncManager.computeSyncDiff(tasks, calendarId);

			const timeZone = this.getTimeZone();
			let created = 0;
			let updated = 0;
			let recreated = 0;
			let failed = 0;
			let unchanged = 0;

			// Create new events
			for (const task of diff.toCreate) {
				try {
					const event = await this.calendarApi.createEvent({
						task,
						calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes: this.settings.defaultReminderMinutes,
						timeZone,
					});
					this.syncManager.recordSync(task, event.id, calendarId);
					created++;
				} catch (error) {
					console.error('Failed to create event for task:', task.title, error);
					failed++;
				}
			}

			// Update existing events
			for (const { task, eventId } of diff.toUpdate) {
				try {
					await this.calendarApi.updateEvent(calendarId, eventId, {
						task,
						calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes: this.settings.defaultReminderMinutes,
						timeZone,
					});
					this.syncManager.recordSync(task, eventId, calendarId);
					updated++;
				} catch (error) {
					console.error('Failed to update event for task:', task.title, error);
					failed++;
				}
			}

			// Verify "unchanged" events still exist in Google Calendar
			// (handles case where user deleted events directly in Google)
			console.log(`Chronos: Checking ${diff.unchanged.length} unchanged tasks for deleted events`);
			for (const task of diff.unchanged) {
				const taskId = this.syncManager.generateTaskId(task);
				const syncInfo = this.syncManager.getSyncInfo(taskId);
				console.log(`Chronos: Checking task "${task.title}", taskId=${taskId}, eventId=${syncInfo?.eventId}`);

				if (syncInfo) {
					const exists = await this.calendarApi.eventExists(calendarId, syncInfo.eventId);
					console.log(`Chronos: Event exists check result: ${exists}`);

					if (!exists) {
						// Event was deleted externally - recreate it
						try {
							const event = await this.calendarApi.createEvent({
								task,
								calendarId,
								durationMinutes: this.settings.defaultEventDurationMinutes,
								reminderMinutes: this.settings.defaultReminderMinutes,
								timeZone,
							});
							this.syncManager.recordSync(task, event.id, calendarId);
							recreated++;
						} catch (error) {
							console.error('Failed to recreate event for task:', task.title, error);
							failed++;
						}
					} else {
						unchanged++;
					}
				}
			}

			// Update sync timestamp and save
			this.syncManager.updateLastSyncTime();
			await this.saveSettings();

			// Report results
			if (!silent || created > 0 || updated > 0 || recreated > 0 || failed > 0) {
				const parts: string[] = [];
				if (created > 0) parts.push(`${created} created`);
				if (updated > 0) parts.push(`${updated} updated`);
				if (recreated > 0) parts.push(`${recreated} recreated`);
				if (unchanged > 0) parts.push(`${unchanged} unchanged`);
				if (failed > 0) parts.push(`${failed} failed`);

				if (parts.length > 0) {
					new Notice(`Chronos: ${parts.join(', ')}`);
				} else if (!silent) {
					new Notice('Chronos: No tasks to sync');
				}
			}
		} catch (error) {
			console.error('Sync failed:', error);
			if (!silent) new Notice(`Chronos: Sync failed - ${error}`);
		}
	}

	/**
	 * Get the timezone to use for events
	 */
	getTimeZone(): string {
		if (this.settings.timeZone === 'local') {
			return Intl.DateTimeFormat().resolvedOptions().timeZone;
		}
		return this.settings.timeZone;
	}

	/**
	 * Start the automatic sync interval
	 */
	startSyncInterval(): void {
		// Don't start if already running
		if (this.syncIntervalId !== null) return;

		// Don't start if not authenticated or no calendar selected
		if (!this.isAuthenticated() || !this.settings.googleCalendarId) return;

		const intervalMs = this.settings.syncIntervalMinutes * 60 * 1000;

		this.syncIntervalId = window.setInterval(async () => {
			// Run sync silently (no notices unless there are changes)
			await this.syncTasks(true);
		}, intervalMs);

		console.log(`Chronos: Automatic sync started (every ${this.settings.syncIntervalMinutes} minutes)`);
	}

	/**
	 * Stop the automatic sync interval
	 */
	stopSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
			console.log('Chronos: Automatic sync stopped');
		}
	}

	/**
	 * Restart the sync interval (e.g., after settings change)
	 */
	restartSyncInterval(): void {
		this.stopSyncInterval();
		this.startSyncInterval();
	}

	onunload() {
		// Clean up the sync interval
		this.stopSyncInterval();
		// Clean up the auth server if it's still running
		this.googleAuth?.stopServer();
		console.log('Chronos plugin unloaded');
	}

	async loadSettings() {
		const data: ChronosData = await this.loadData() || { settings: DEFAULT_SETTINGS };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
		this.tokens = data.tokens;
		this.syncManager = new SyncManager(data.syncData);
	}

	async saveSettings() {
		const data: ChronosData = {
			settings: this.settings,
			tokens: this.tokens,
			syncData: this.syncManager?.getSyncData(),
		};
		await this.saveData(data);
	}

	isAuthenticated(): boolean {
		return !!this.tokens?.refreshToken;
	}

	/**
	 * Get a valid access token, refreshing if necessary
	 */
	async getAccessToken(): Promise<string | null> {
		if (!this.tokens?.refreshToken) {
			return null;
		}

		// If token is expired or will expire in next 5 minutes, refresh it
		const bufferMs = 5 * 60 * 1000;
		if (Date.now() + bufferMs >= this.tokens.expiresAt) {
			try {
				this.tokens = await this.googleAuth.refreshAccessToken(this.tokens.refreshToken);
				await this.saveSettings();
			} catch (error) {
				console.error('Failed to refresh token:', error);
				// Token refresh failed - user needs to re-authenticate
				new Notice('Chronos: Session expired. Please reconnect to Google Calendar.');
				return null;
			}
		}

		return this.tokens.accessToken;
	}

	async clearTokens() {
		this.tokens = undefined;
		await this.saveSettings();
	}
}

class ChronosSettingTab extends PluginSettingTab {
	plugin: ChronosPlugin;

	constructor(app: App, plugin: ChronosPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Chronos Settings' });

		// Google Account Connection Section
		containerEl.createEl('h3', { text: 'Google Calendar Connection' });

		this.renderConnectionStatus(containerEl);

		// Sync Settings Section (only show if connected)
		if (this.plugin.isAuthenticated()) {
			containerEl.createEl('h3', { text: 'Calendar Selection' });

			// Calendar dropdown
			const calendarSetting = new Setting(containerEl)
				.setName('Target calendar')
				.setDesc('Select which calendar to sync tasks to');

			// Load calendars asynchronously
			this.loadCalendarDropdown(calendarSetting);

			containerEl.createEl('h3', { text: 'Sync Settings' });

			new Setting(containerEl)
				.setName('Sync interval')
				.setDesc('How often to sync tasks with Google Calendar (in minutes)')
				.addText(text => text
					.setPlaceholder('10')
					.setValue(String(this.plugin.settings.syncIntervalMinutes))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.syncIntervalMinutes = num;
							await this.plugin.saveSettings();
							this.plugin.restartSyncInterval();
						}
					}));

			new Setting(containerEl)
				.setName('Default event duration')
				.setDesc('Duration in minutes for calendar events (tasks without explicit duration)')
				.addText(text => text
					.setPlaceholder('30')
					.setValue(String(this.plugin.settings.defaultEventDurationMinutes))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.defaultEventDurationMinutes = num;
							await this.plugin.saveSettings();
						}
					}));

			new Setting(containerEl)
				.setName('Default reminders')
				.setDesc('Comma-separated minutes before event (e.g., "30, 10" for 30 and 10 min)')
				.addText(text => text
					.setPlaceholder('30, 10')
					.setValue(this.plugin.settings.defaultReminderMinutes.join(', '))
					.onChange(async (value) => {
						const nums = value.split(',')
							.map(s => parseInt(s.trim()))
							.filter(n => !isNaN(n) && n > 0);
						if (nums.length > 0) {
							this.plugin.settings.defaultReminderMinutes = nums;
							await this.plugin.saveSettings();
						}
					}));

			// Sync Status Section
			containerEl.createEl('h3', { text: 'Sync Status' });

			const lastSync = this.plugin.syncManager.getLastSyncTime();
			const syncedCount = this.plugin.syncManager.getSyncedTaskCount();

			const statusText = lastSync
				? `Last sync: ${new Date(lastSync).toLocaleString()}`
				: 'Never synced';

			new Setting(containerEl)
				.setName('Sync status')
				.setDesc(`${statusText} • ${syncedCount} task(s) tracked`)
				.addButton(button => button
					.setButtonText('Sync Now')
					.onClick(async () => {
						await this.plugin.syncTasks();
						this.display(); // Refresh to show new sync time
					}));
		}
	}

	private async loadCalendarDropdown(setting: Setting): Promise<void> {
		// Add a loading state
		setting.addDropdown(dropdown => {
			dropdown.addOption('', 'Loading calendars...');
			dropdown.setDisabled(true);
		});

		try {
			const calendars = await this.plugin.calendarApi.listCalendars();

			// Clear and rebuild the setting
			setting.clear();
			setting.setName('Target calendar');
			setting.setDesc('Select which calendar to sync tasks to');

			setting.addDropdown(dropdown => {
				dropdown.addOption('', '-- Select a calendar --');

				for (const cal of calendars) {
					const label = cal.primary ? `${cal.summary} (Primary)` : cal.summary;
					dropdown.addOption(cal.id, label);
				}

				dropdown.setValue(this.plugin.settings.googleCalendarId);
				dropdown.onChange(async (value) => {
					this.plugin.settings.googleCalendarId = value;
					await this.plugin.saveSettings();
					// Start/restart sync interval when calendar is selected
					this.plugin.restartSyncInterval();
				});
			});
		} catch (error) {
			console.error('Failed to load calendars:', error);

			setting.clear();
			setting.setName('Target calendar');
			setting.setDesc('Failed to load calendars. Check your connection.');

			setting.addButton(button => button
				.setButtonText('Retry')
				.onClick(() => this.display()));
		}
	}

	private renderConnectionStatus(containerEl: HTMLElement): void {
		const statusDiv = containerEl.createDiv({ cls: 'chronos-connection-status' });

		if (this.plugin.isAuthenticated()) {
			// Connected state
			const email = this.plugin.tokens?.email || 'Google Account';
			statusDiv.createEl('p', {
				text: `Connected: ${email}`,
				cls: 'chronos-status-connected'
			});

			new Setting(containerEl)
				.setName('Disconnect')
				.setDesc('Remove connection to Google Calendar')
				.addButton(button => button
					.setButtonText('Disconnect')
					.setWarning()
					.onClick(async () => {
						await this.plugin.clearTokens();
						new Notice('Disconnected from Google Calendar');
						this.display(); // Refresh the settings view
					}));
		} else {
			// Disconnected state
			statusDiv.createEl('p', {
				text: 'Status: Not connected',
				cls: 'chronos-status-disconnected'
			});

			new Setting(containerEl)
				.setName('Connect to Google Calendar')
				.setDesc('Authorize Chronos to access your Google Calendar')
				.addButton(button => button
					.setButtonText('Connect')
					.setCta()
					.onClick(async () => {
						button.setButtonText('Connecting...');
						button.setDisabled(true);

						try {
							await this.plugin.googleAuth.startAuthFlow({
								onTokensReceived: async (tokens) => {
									this.plugin.tokens = tokens;
									await this.plugin.saveSettings();
									new Notice(`Connected to Google Calendar as ${tokens.email || 'user'}`);
									this.display(); // Refresh the settings view
								},
								onError: (error) => {
									new Notice(`Connection failed: ${error}`);
									this.display(); // Refresh to reset button state
								}
							});
						} catch (error) {
							new Notice(`Failed to start authentication: ${error}`);
							this.display();
						}
					}));
		}
	}
}

/**
 * Modal to display scanned tasks
 */
class TaskListModal extends Modal {
	tasks: ChronosTask[];

	constructor(app: App, tasks: ChronosTask[]) {
		super(app);
		this.tasks = tasks;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-task-modal');

		contentEl.createEl('h2', { text: 'Sync-Eligible Tasks' });

		if (this.tasks.length === 0) {
			const emptyDiv = contentEl.createDiv({ cls: 'chronos-empty-state' });
			emptyDiv.createEl('p', { text: 'No sync-eligible tasks found.' });
			emptyDiv.createEl('p', {
				text: 'Tasks need:',
				cls: 'chronos-requirements-header'
			});
			const reqList = emptyDiv.createEl('ul');
			reqList.createEl('li', { text: 'Uncompleted checkbox: - [ ]' });
			reqList.createEl('li', { text: 'Date: 📅 YYYY-MM-DD' });
			reqList.createEl('li', { text: 'Time (optional): ⏰ HH:mm' });

			emptyDiv.createEl('p', {
				text: 'Examples:',
				cls: 'chronos-requirements-header'
			});
			emptyDiv.createEl('p', {
				text: '- [ ] Call dentist 📅 2026-01-15 ⏰ 14:00',
				cls: 'chronos-example'
			});
			emptyDiv.createEl('p', {
				text: '- [ ] Submit report 📅 2026-01-15 (all-day)',
				cls: 'chronos-example'
			});
			emptyDiv.createEl('p', {
				text: 'Use 🚫 to exclude a task from syncing.',
				cls: 'chronos-hint'
			});
			return;
		}

		// Count all-day vs timed
		const allDayCount = this.tasks.filter(t => t.isAllDay).length;
		const timedCount = this.tasks.length - allDayCount;

		let countText = `Found ${this.tasks.length} task${this.tasks.length === 1 ? '' : 's'} to sync`;
		if (allDayCount > 0 && timedCount > 0) {
			countText += ` (${timedCount} timed, ${allDayCount} all-day)`;
		} else if (allDayCount > 0) {
			countText += ` (all-day)`;
		}
		countText += ':';

		contentEl.createEl('p', {
			text: countText,
			cls: 'chronos-task-count'
		});

		contentEl.createEl('p', {
			text: 'Click a task to open it in the editor.',
			cls: 'chronos-hint'
		});

		const taskList = contentEl.createDiv({ cls: 'chronos-task-list' });

		for (const task of this.tasks) {
			const taskDiv = taskList.createDiv({ cls: 'chronos-task-item chronos-task-clickable' });

			// Make the task clickable to open file at line
			taskDiv.addEventListener('click', async () => {
				const file = this.app.vault.getAbstractFileByPath(task.filePath);
				if (file) {
					const leaf = this.app.workspace.getLeaf(false);
					await leaf.openFile(file as any);

					// Jump to the line
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) {
						const editor = view.editor;
						editor.setCursor({ line: task.lineNumber - 1, ch: 0 });
						editor.scrollIntoView({
							from: { line: task.lineNumber - 1, ch: 0 },
							to: { line: task.lineNumber - 1, ch: 0 }
						}, true);
					}

					this.close();
				}
			});

			// Task title
			taskDiv.createEl('div', {
				text: task.title,
				cls: 'chronos-task-title'
			});

			// Task metadata row 1: date/time
			const meta = taskDiv.createDiv({ cls: 'chronos-task-meta' });

			const dateStr = task.datetime.toLocaleDateString();

			meta.createEl('span', {
				text: `📅 ${dateStr}`,
				cls: 'chronos-task-date'
			});

			if (task.isAllDay) {
				meta.createEl('span', {
					text: '📆 All day',
					cls: 'chronos-task-allday'
				});
			} else {
				const timeStr = task.datetime.toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit'
				});
				meta.createEl('span', {
					text: `⏰ ${timeStr}`,
					cls: 'chronos-task-time'
				});
			}

			// Task metadata row 2: file path and line
			const fileMeta = taskDiv.createDiv({ cls: 'chronos-task-file-info' });
			fileMeta.createEl('span', {
				text: `📄 ${task.filePath}:${task.lineNumber}`,
				cls: 'chronos-task-filepath'
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
