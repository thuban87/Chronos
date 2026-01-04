import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, MarkdownView } from 'obsidian';
import { GoogleAuth, TokenData } from './src/googleAuth';
import { TaskParser, ChronosTask } from './src/taskParser';
import { DateTimeModal } from './src/dateTimeModal';
import { GoogleCalendarApi, GoogleCalendar } from './src/googleCalendar';
import { SyncManager, ChronosSyncData, PendingOperation } from './src/syncManager';

interface ChronosSettings {
	googleCalendarId: string;
	syncIntervalMinutes: number;
	defaultReminderMinutes: number[];
	defaultEventDurationMinutes: number;
	timeZone: string;
	completedTaskBehavior: 'delete' | 'markComplete';
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
	timeZone: 'local',
	completedTaskBehavior: 'markComplete'
};

export default class ChronosPlugin extends Plugin {
	settings: ChronosSettings;
	tokens?: TokenData;
	googleAuth: GoogleAuth;
	taskParser: TaskParser;
	calendarApi: GoogleCalendarApi;
	syncManager: SyncManager;
	private syncIntervalId: number | null = null;
	private statusBarItem: HTMLElement | null = null;

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

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('chronos-status-bar');
		this.statusBarItem.onClickEvent(() => {
			this.syncTasks();
		});
		this.updateStatusBar();

		console.log('Chronos plugin loaded');
	}

	/**
	 * Update the status bar with sync information
	 */
	updateStatusBar(): void {
		if (!this.statusBarItem) return;

		if (!this.isAuthenticated()) {
			this.statusBarItem.setText('📅 Chronos: Not connected');
			this.statusBarItem.setAttr('aria-label', 'Click to open settings and connect');
			return;
		}

		const lastSync = this.syncManager.getLastSyncTime();
		const syncedCount = this.syncManager.getSyncedTaskCount();

		if (!lastSync) {
			this.statusBarItem.setText(`📅 Chronos: ${syncedCount} tasks (never synced)`);
			this.statusBarItem.setAttr('aria-label', 'Click to sync now');
			return;
		}

		const lastSyncDate = new Date(lastSync);
		const now = new Date();
		const diffMs = now.getTime() - lastSyncDate.getTime();
		const diffMins = Math.floor(diffMs / 60000);

		let timeAgo: string;
		if (diffMins < 1) {
			timeAgo = 'just now';
		} else if (diffMins < 60) {
			timeAgo = `${diffMins}m ago`;
		} else {
			const diffHours = Math.floor(diffMins / 60);
			timeAgo = `${diffHours}h ago`;
		}

		// Calculate next sync
		const nextSyncMins = this.settings.syncIntervalMinutes - (diffMins % this.settings.syncIntervalMinutes);
		const nextSyncText = this.syncIntervalId ? `next in ${nextSyncMins}m` : 'auto-sync off';

		const pendingCount = this.syncManager.getPendingOperationCount();
		const pendingText = pendingCount > 0 ? ` • ${pendingCount} pending` : '';

		this.statusBarItem.setText(`📅 ${syncedCount} synced${pendingText} • ${timeAgo}`);
		this.statusBarItem.setAttr('aria-label', `Chronos: Last sync ${timeAgo}, ${nextSyncText}. Click to sync now.`);
	}

	/**
	 * Scan vault and show results in a modal
	 */
	async showTaskScanResults(): Promise<void> {
		new Notice('Scanning vault for tasks...');
		new TaskListModal(this.app, this).open();
	}

	/**
	 * Sync all eligible tasks to Google Calendar
	 * Uses SyncManager for duplicate prevention and change detection
	 * Also handles completed and deleted tasks
	 */
	async syncTasks(silent: boolean = false): Promise<void> {
		if (!this.isAuthenticated()) {
			if (!silent) new Notice('Chronos: Not connected. Go to Settings → Chronos to connect your Google account.');
			return;
		}

		if (!this.settings.googleCalendarId) {
			if (!silent) new Notice('Chronos: No calendar selected. Go to Settings → Chronos to choose a calendar.');
			return;
		}

		if (!silent) new Notice('Chronos: Syncing tasks...');

		try {
			// First, retry any pending operations from previous failures
			const retryResult = await this.retryPendingOperations();

			// Scan for ALL tasks including completed ones
			const allTasks = await this.taskParser.scanVault(true);
			const calendarId = this.settings.googleCalendarId;

			// Separate uncompleted and completed tasks
			const uncompletedTasks = allTasks.filter(t => !t.isCompleted);
			const completedTasks = allTasks.filter(t => t.isCompleted);

			// Compute what needs to be done for uncompleted tasks
			const diff = this.syncManager.computeSyncDiff(uncompletedTasks, calendarId);

			const timeZone = this.getTimeZone();
			let created = 0;
			let updated = 0;
			let recreated = 0;
			let completed = 0;
			let deleted = 0;
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
					if (this.isRetryableError(error)) {
						this.syncManager.queueOperation({
							type: 'create',
							taskId: this.syncManager.generateTaskId(task),
							taskData: {
								title: task.title,
								date: task.date,
								time: task.time,
								filePath: task.filePath,
								lineNumber: task.lineNumber,
								rawText: task.rawText,
								isAllDay: task.isAllDay,
							},
							calendarId,
						});
					}
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
					if (this.isRetryableError(error)) {
						this.syncManager.queueOperation({
							type: 'update',
							taskId: this.syncManager.generateTaskId(task),
							eventId,
							taskData: {
								title: task.title,
								date: task.date,
								time: task.time,
								filePath: task.filePath,
								lineNumber: task.lineNumber,
								rawText: task.rawText,
								isAllDay: task.isAllDay,
							},
							calendarId,
						});
					}
					failed++;
				}
			}

			// Verify "unchanged" events still exist in Google Calendar
			for (const task of diff.unchanged) {
				const taskId = this.syncManager.generateTaskId(task);
				const syncInfo = this.syncManager.getSyncInfo(taskId);

				if (syncInfo) {
					const exists = await this.calendarApi.eventExists(calendarId, syncInfo.eventId);

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

			// Handle completed tasks - check if they were previously synced
			for (const task of completedTasks) {
				const taskId = this.syncManager.generateTaskId(task);
				const syncInfo = this.syncManager.getSyncInfo(taskId);

				if (syncInfo) {
					// This task was synced before and is now completed
					try {
						if (this.settings.completedTaskBehavior === 'delete') {
							await this.calendarApi.deleteEvent(calendarId, syncInfo.eventId);
							deleted++;
						} else {
							// markComplete - update the event title
							await this.calendarApi.markEventCompleted(calendarId, syncInfo.eventId, new Date());
							completed++;
						}
						// Remove from sync data either way
						this.syncManager.removeSync(taskId);
					} catch (error) {
						console.error('Failed to handle completed task:', task.title, error);
						if (this.isRetryableError(error)) {
							const opType = this.settings.completedTaskBehavior === 'delete' ? 'delete' : 'complete';
							this.syncManager.queueOperation({
								type: opType,
								taskId,
								eventId: syncInfo.eventId,
								calendarId,
							});
						} else {
							// Non-retryable error - remove from sync data anyway
							this.syncManager.removeSync(taskId);
						}
					}
				}
			}

			// Handle orphaned tasks (deleted from vault entirely)
			for (const taskId of diff.orphaned) {
				const syncInfo = this.syncManager.getSyncInfo(taskId);
				if (syncInfo) {
					try {
						await this.calendarApi.deleteEvent(calendarId, syncInfo.eventId);
						deleted++;
						this.syncManager.removeSync(taskId);
					} catch (error) {
						console.error('Failed to delete orphaned event:', taskId, error);
						if (this.isRetryableError(error)) {
							this.syncManager.queueOperation({
								type: 'delete',
								taskId,
								eventId: syncInfo.eventId,
								calendarId,
							});
						} else {
							// Non-retryable - just remove from sync data
							this.syncManager.removeSync(taskId);
						}
					}
				}
			}

			// Update sync timestamp and save
			this.syncManager.updateLastSyncTime();
			await this.saveSettings();
			this.updateStatusBar();

			// Report results
			const hasChanges = created > 0 || updated > 0 || recreated > 0 || completed > 0 || deleted > 0 || failed > 0 || retryResult.succeeded > 0;
			if (!silent || hasChanges) {
				const parts: string[] = [];
				if (retryResult.succeeded > 0) parts.push(`${retryResult.succeeded} retried`);
				if (created > 0) parts.push(`${created} created`);
				if (updated > 0) parts.push(`${updated} updated`);
				if (recreated > 0) parts.push(`${recreated} recreated`);
				if (completed > 0) parts.push(`${completed} completed`);
				if (deleted > 0) parts.push(`${deleted} deleted`);
				if (unchanged > 0) parts.push(`${unchanged} unchanged`);
				if (failed > 0) parts.push(`${failed} failed`);

				if (parts.length > 0) {
					new Notice(`Chronos: ${parts.join(', ')}`);
				} else if (!silent) {
					new Notice('Chronos: No tasks to sync');
				}
			}
		} catch (error: any) {
			console.error('Sync failed:', error);
			if (!silent) {
				const message = error?.message || String(error);
				if (message.includes('Not authenticated') || message.includes('401')) {
					new Notice('Chronos: Session expired. Please reconnect in Settings → Chronos.');
				} else if (message.includes('403')) {
					new Notice('Chronos: Permission denied. Try reconnecting your Google account.');
				} else if (message.includes('network') || message.includes('fetch')) {
					new Notice('Chronos: Network error. Check your internet connection.');
				} else {
					new Notice(`Chronos: Sync failed - ${message}`);
				}
			}
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
	 * Check if an error is likely a network/temporary issue worth retrying
	 */
	isRetryableError(error: any): boolean {
		const message = error?.message?.toLowerCase() || String(error).toLowerCase();
		return message.includes('network') ||
			message.includes('fetch') ||
			message.includes('timeout') ||
			message.includes('econnrefused') ||
			message.includes('enotfound') ||
			message.includes('503') ||
			message.includes('429'); // Rate limited
	}

	/**
	 * Retry pending operations from the queue
	 */
	async retryPendingOperations(): Promise<{ succeeded: number; failed: number }> {
		const pending = this.syncManager.getPendingOperations();
		if (pending.length === 0) return { succeeded: 0, failed: 0 };

		const calendarId = this.settings.googleCalendarId;
		const timeZone = this.getTimeZone();
		let succeeded = 0;
		let failed = 0;

		for (const op of pending) {
			try {
				if (op.type === 'create' && op.taskData) {
					// Reconstruct task from stored data
					const task: ChronosTask = {
						rawText: op.taskData.rawText,
						title: op.taskData.title,
						date: op.taskData.date,
						time: op.taskData.time,
						datetime: new Date(op.taskData.date + (op.taskData.time ? 'T' + op.taskData.time : '')),
						isAllDay: op.taskData.isAllDay,
						filePath: op.taskData.filePath,
						fileName: op.taskData.filePath.split('/').pop() || '',
						lineNumber: op.taskData.lineNumber,
						isCompleted: false,
						tags: [],
					};

					const event = await this.calendarApi.createEvent({
						task,
						calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes: this.settings.defaultReminderMinutes,
						timeZone,
					});
					this.syncManager.recordSync(task, event.id, calendarId);
					this.syncManager.removePendingOperation(op.taskId, op.type);
					succeeded++;
				} else if (op.type === 'delete' && op.eventId) {
					await this.calendarApi.deleteEvent(calendarId, op.eventId);
					this.syncManager.removePendingOperation(op.taskId, op.type);
					succeeded++;
				} else if (op.type === 'complete' && op.eventId) {
					await this.calendarApi.markEventCompleted(calendarId, op.eventId, new Date());
					this.syncManager.removePendingOperation(op.taskId, op.type);
					succeeded++;
				}
			} catch (error) {
				this.syncManager.incrementRetryCount(op.taskId, op.type);
				failed++;
			}
		}

		// Prune operations that have failed too many times
		const pruned = this.syncManager.pruneFailedOperations(5);
		if (pruned.length > 0) {
			console.error('Chronos: Dropped operations after max retries:', pruned.length);
		}

		return { succeeded, failed };
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

	}

	/**
	 * Stop the automatic sync interval
	 */
	stopSyncInterval(): void {
		if (this.syncIntervalId !== null) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
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

			new Setting(containerEl)
				.setName('When task is completed')
				.setDesc('What to do with calendar events when their tasks are marked complete')
				.addDropdown(dropdown => dropdown
					.addOption('markComplete', 'Mark as completed (keep event)')
					.addOption('delete', 'Delete from calendar')
					.setValue(this.plugin.settings.completedTaskBehavior)
					.onChange(async (value: 'delete' | 'markComplete') => {
						this.plugin.settings.completedTaskBehavior = value;
						await this.plugin.saveSettings();
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
 * Modal to display scanned tasks with sections for unsynced, synced, and completed
 */
class TaskListModal extends Modal {
	plugin: ChronosPlugin;
	unsyncedTasks: ChronosTask[] = [];
	syncedTasks: ChronosTask[] = [];
	completedTasks: ChronosTask[] = [];
	completedSortBy: 'date' | 'name' = 'date';

	constructor(app: App, plugin: ChronosPlugin) {
		super(app);
		this.plugin = plugin;
	}

	async onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-task-modal');

		contentEl.createEl('h2', { text: 'Chronos Task Overview' });

		// Scan all tasks
		const allTasks = await this.plugin.taskParser.scanVault(true);

		// Separate into categories
		this.unsyncedTasks = [];
		this.syncedTasks = [];
		this.completedTasks = allTasks.filter(t => t.isCompleted);

		const uncompletedTasks = allTasks.filter(t => !t.isCompleted);
		for (const task of uncompletedTasks) {
			const taskId = this.plugin.syncManager.generateTaskId(task);
			const syncInfo = this.plugin.syncManager.getSyncInfo(taskId);
			if (syncInfo) {
				this.syncedTasks.push(task);
			} else {
				this.unsyncedTasks.push(task);
			}
		}

		// Sort synced tasks by date (soonest first)
		this.syncedTasks.sort((a, b) => a.datetime.getTime() - b.datetime.getTime());

		// Sort completed tasks by date initially
		this.sortCompletedTasks();

		this.renderContent();
	}

	sortCompletedTasks() {
		if (this.completedSortBy === 'date') {
			this.completedTasks.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());
		} else {
			this.completedTasks.sort((a, b) => a.title.localeCompare(b.title));
		}
	}

	renderContent() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-task-modal');

		contentEl.createEl('h2', { text: 'Chronos Task Overview' });

		contentEl.createEl('p', {
			text: 'Click any task to open it in the editor.',
			cls: 'chronos-hint'
		});

		// Check if there are any tasks at all
		const totalTasks = this.unsyncedTasks.length + this.syncedTasks.length + this.completedTasks.length;
		if (totalTasks === 0) {
			this.renderEmptyState(contentEl);
			return;
		}

		// Section 1: Unsynced Tasks (ready to sync)
		this.renderUnsyncedSection(contentEl);

		// Section 2: Already Synced Tasks (collapsible)
		this.renderSyncedSection(contentEl);

		// Section 3: Completed Tasks (collapsible with sort)
		this.renderCompletedSection(contentEl);
	}

	renderEmptyState(containerEl: HTMLElement) {
		const emptyDiv = containerEl.createDiv({ cls: 'chronos-empty-state' });
		emptyDiv.createEl('p', { text: 'No tasks with dates found.' });
		emptyDiv.createEl('p', {
			text: 'Tasks need:',
			cls: 'chronos-requirements-header'
		});
		const reqList = emptyDiv.createEl('ul');
		reqList.createEl('li', { text: 'Checkbox: - [ ] or - [x]' });
		reqList.createEl('li', { text: 'Date: 📅 YYYY-MM-DD' });
		reqList.createEl('li', { text: 'Time (optional): ⏰ HH:mm' });

		emptyDiv.createEl('p', {
			text: 'Example:',
			cls: 'chronos-requirements-header'
		});
		emptyDiv.createEl('p', {
			text: '- [ ] Call dentist 📅 2026-01-15 ⏰ 14:00',
			cls: 'chronos-example'
		});
	}

	renderUnsyncedSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'chronos-section' });

		const header = section.createDiv({ cls: 'chronos-section-header' });
		header.createEl('h3', { text: `📤 Ready to Sync (${this.unsyncedTasks.length})` });

		if (this.unsyncedTasks.length === 0) {
			section.createEl('p', {
				text: 'All tasks are synced!',
				cls: 'chronos-empty-section'
			});
			return;
		}

		section.createEl('p', {
			text: 'These tasks will sync on the next auto or manual sync.',
			cls: 'chronos-section-desc'
		});

		const taskList = section.createDiv({ cls: 'chronos-task-list' });
		for (const task of this.unsyncedTasks) {
			this.renderTaskItem(taskList, task, 'unsynced');
		}
	}

	renderSyncedSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'chronos-section chronos-collapsible' });

		const header = section.createDiv({ cls: 'chronos-section-header chronos-clickable' });
		const arrow = header.createSpan({ cls: 'chronos-collapse-arrow', text: '▶' });
		header.createEl('h3', { text: ` ✅ Already Synced (${this.syncedTasks.length})` });

		const content = section.createDiv({ cls: 'chronos-section-content chronos-collapsed' });

		header.addEventListener('click', () => {
			const isCollapsed = content.hasClass('chronos-collapsed');
			if (isCollapsed) {
				content.removeClass('chronos-collapsed');
				arrow.setText('▼');
			} else {
				content.addClass('chronos-collapsed');
				arrow.setText('▶');
			}
		});

		if (this.syncedTasks.length === 0) {
			content.createEl('p', {
				text: 'No synced tasks yet.',
				cls: 'chronos-empty-section'
			});
			return;
		}

		content.createEl('p', {
			text: 'Sorted by date (soonest first).',
			cls: 'chronos-section-desc'
		});

		const taskList = content.createDiv({ cls: 'chronos-task-list' });
		for (const task of this.syncedTasks) {
			this.renderTaskItem(taskList, task, 'synced');
		}
	}

	renderCompletedSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'chronos-section chronos-collapsible' });

		const header = section.createDiv({ cls: 'chronos-section-header chronos-clickable' });
		const arrow = header.createSpan({ cls: 'chronos-collapse-arrow', text: '▶' });
		header.createEl('h3', { text: ` ☑️ Completed (${this.completedTasks.length})` });

		const content = section.createDiv({ cls: 'chronos-section-content chronos-collapsed' });

		header.addEventListener('click', () => {
			const isCollapsed = content.hasClass('chronos-collapsed');
			if (isCollapsed) {
				content.removeClass('chronos-collapsed');
				arrow.setText('▼');
			} else {
				content.addClass('chronos-collapsed');
				arrow.setText('▶');
			}
		});

		if (this.completedTasks.length === 0) {
			content.createEl('p', {
				text: 'No completed tasks.',
				cls: 'chronos-empty-section'
			});
			return;
		}

		// Sort controls
		const sortControls = content.createDiv({ cls: 'chronos-sort-controls' });
		sortControls.createSpan({ text: 'Sort by: ' });

		const dateBtn = sortControls.createEl('button', {
			text: 'Date',
			cls: this.completedSortBy === 'date' ? 'chronos-sort-active' : ''
		});
		const nameBtn = sortControls.createEl('button', {
			text: 'Name',
			cls: this.completedSortBy === 'name' ? 'chronos-sort-active' : ''
		});

		dateBtn.addEventListener('click', () => {
			this.completedSortBy = 'date';
			this.sortCompletedTasks();
			this.renderContent();
		});

		nameBtn.addEventListener('click', () => {
			this.completedSortBy = 'name';
			this.sortCompletedTasks();
			this.renderContent();
		});

		const taskList = content.createDiv({ cls: 'chronos-task-list' });
		for (const task of this.completedTasks) {
			this.renderTaskItem(taskList, task, 'completed');
		}
	}

	renderTaskItem(containerEl: HTMLElement, task: ChronosTask, status: 'unsynced' | 'synced' | 'completed') {
		const taskDiv = containerEl.createDiv({ cls: `chronos-task-item chronos-task-clickable chronos-task-${status}` });

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

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
