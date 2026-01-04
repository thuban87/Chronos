import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { GoogleAuth, TokenData, GoogleAuthCredentials } from './src/googleAuth';
import { TaskParser, ChronosTask } from './src/taskParser';
import { DateTimeModal } from './src/dateTimeModal';
import { GoogleCalendarApi, GoogleCalendar, GoogleEvent } from './src/googleCalendar';
import { SyncManager, ChronosSyncData, PendingOperation, SyncLogEntry } from './src/syncManager';
import { AgendaView, AGENDA_VIEW_TYPE, AgendaViewDeps } from './src/agendaView';

interface ChronosSettings {
	googleClientId: string;
	googleClientSecret: string;
	googleCalendarId: string;
	syncIntervalMinutes: number;
	defaultReminderMinutes: number[];
	defaultEventDurationMinutes: number;
	timeZone: string;
	completedTaskBehavior: 'delete' | 'markComplete';
	agendaRefreshIntervalMinutes: number;
}

interface ChronosData {
	settings: ChronosSettings;
	tokens?: TokenData;
	syncData?: ChronosSyncData;
}

const DEFAULT_SETTINGS: ChronosSettings = {
	googleClientId: '',
	googleClientSecret: '',
	googleCalendarId: '',
	syncIntervalMinutes: 10,
	defaultReminderMinutes: [30, 10],
	defaultEventDurationMinutes: 30,
	timeZone: 'local',
	completedTaskBehavior: 'markComplete',
	agendaRefreshIntervalMinutes: 10
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
		this.googleAuth = new GoogleAuth(this.getAuthCredentials());
		this.taskParser = new TaskParser(this.app);
		this.calendarApi = new GoogleCalendarApi(() => this.getAccessToken());
		// SyncManager is initialized in loadSettings()

		// Register the agenda sidebar view
		this.registerView(AGENDA_VIEW_TYPE, (leaf) => {
			const deps: AgendaViewDeps = {
				isAuthenticated: () => this.isAuthenticated(),
				hasCalendarSelected: () => !!this.settings.googleCalendarId,
				fetchEventsForDate: (date: Date) => this.fetchEventsForDate(date),
				fetchEventColors: () => this.calendarApi.getEventColors(),
				getCalendarColor: () => this.getSelectedCalendarColor(),
				getSyncedTasks: () => this.syncManager.getSyncData().syncedTasks,
				getTimeZone: () => this.getTimeZone(),
				openFile: (filePath, lineNumber) => this.openFileAtLine(filePath, lineNumber),
			};
			const view = new AgendaView(leaf, deps);
			view.setRefreshInterval(this.settings.agendaRefreshIntervalMinutes * 60 * 1000);
			return view;
		});

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
					if (result.customReminders && (result.reminder1 || result.reminder2)) {
						const reminders: number[] = [];
						if (result.reminder1) reminders.push(result.reminder1);
						if (result.reminder2) reminders.push(result.reminder2);
						text += ` 🔔 ${reminders.join(',')}`;
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

		// Add command to open/toggle agenda sidebar
		this.addCommand({
			id: 'toggle-agenda',
			name: "Toggle today's agenda sidebar",
			callback: async () => {
				await this.toggleAgendaView();
			}
		});

		// Add command to view sync log
		this.addCommand({
			id: 'view-sync-log',
			name: 'View sync history',
			callback: () => {
				new SyncLogModal(this.app, this).open();
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
			// Generate a batch ID for this sync run
			const batchId = this.syncManager.generateBatchId();

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
					// Use task-specific reminders if set, otherwise use defaults
					const reminderMinutes = task.reminderMinutes || this.settings.defaultReminderMinutes;
					const event = await this.calendarApi.createEvent({
						task,
						calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes,
						timeZone,
					});
					this.syncManager.recordSync(task, event.id, calendarId);
					this.syncManager.logOperation({
						type: 'create',
						taskTitle: task.title,
						filePath: task.filePath,
						success: true,
						batchId,
					}, batchId);
					created++;
				} catch (error: any) {
					console.error('Failed to create event for task:', task.title, error);
					this.syncManager.logOperation({
						type: 'create',
						taskTitle: task.title,
						filePath: task.filePath,
						success: false,
						errorMessage: error?.message || String(error),
						batchId,
					}, batchId);
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
					// Use task-specific reminders if set, otherwise use defaults
					const reminderMinutes = task.reminderMinutes || this.settings.defaultReminderMinutes;
					await this.calendarApi.updateEvent(calendarId, eventId, {
						task,
						calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes,
						timeZone,
					});
					this.syncManager.recordSync(task, eventId, calendarId);
					this.syncManager.logOperation({
						type: 'update',
						taskTitle: task.title,
						filePath: task.filePath,
						success: true,
						batchId,
					}, batchId);
					updated++;
				} catch (error: any) {
					console.error('Failed to update event for task:', task.title, error);
					this.syncManager.logOperation({
						type: 'update',
						taskTitle: task.title,
						filePath: task.filePath,
						success: false,
						errorMessage: error?.message || String(error),
						batchId,
					}, batchId);
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
							// Use task-specific reminders if set, otherwise use defaults
							const reminderMinutes = task.reminderMinutes || this.settings.defaultReminderMinutes;
							const event = await this.calendarApi.createEvent({
								task,
								calendarId,
								durationMinutes: this.settings.defaultEventDurationMinutes,
								reminderMinutes,
								timeZone,
							});
							this.syncManager.recordSync(task, event.id, calendarId);
							this.syncManager.logOperation({
								type: 'recreate',
								taskTitle: task.title,
								filePath: task.filePath,
								success: true,
								batchId,
							}, batchId);
							recreated++;
						} catch (error: any) {
							console.error('Failed to recreate event for task:', task.title, error);
							this.syncManager.logOperation({
								type: 'recreate',
								taskTitle: task.title,
								filePath: task.filePath,
								success: false,
								errorMessage: error?.message || String(error),
								batchId,
							}, batchId);
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
							this.syncManager.logOperation({
								type: 'delete',
								taskTitle: task.title,
								filePath: task.filePath,
								success: true,
								batchId,
							}, batchId);
							deleted++;
						} else {
							// markComplete - update the event title
							await this.calendarApi.markEventCompleted(calendarId, syncInfo.eventId, new Date());
							this.syncManager.logOperation({
								type: 'complete',
								taskTitle: task.title,
								filePath: task.filePath,
								success: true,
								batchId,
							}, batchId);
							completed++;
						}
						// Remove from sync data either way
						this.syncManager.removeSync(taskId);
					} catch (error: any) {
						console.error('Failed to handle completed task:', task.title, error);
						const opType = this.settings.completedTaskBehavior === 'delete' ? 'delete' : 'complete';
						this.syncManager.logOperation({
							type: opType,
							taskTitle: task.title,
							filePath: task.filePath,
							success: false,
							errorMessage: error?.message || String(error),
							batchId,
						}, batchId);
						if (this.isRetryableError(error)) {
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
						this.syncManager.logOperation({
							type: 'delete',
							taskTitle: `(orphaned task)`,
							filePath: syncInfo.filePath,
							success: true,
							batchId,
						}, batchId);
						deleted++;
						this.syncManager.removeSync(taskId);
					} catch (error: any) {
						console.error('Failed to delete orphaned event:', taskId, error);
						this.syncManager.logOperation({
							type: 'delete',
							taskTitle: `(orphaned task)`,
							filePath: syncInfo.filePath,
							success: false,
							errorMessage: error?.message || String(error),
							batchId,
						}, batchId);
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
	 * Get the background color of the selected calendar
	 */
	async getSelectedCalendarColor(): Promise<string | null> {
		if (!this.settings.googleCalendarId) {
			return null;
		}

		try {
			const calendars = await this.calendarApi.listCalendars();
			const selected = calendars.find(c => c.id === this.settings.googleCalendarId);
			return selected?.backgroundColor || null;
		} catch (error) {
			console.error('Chronos: Failed to get calendar color:', error);
			return null;
		}
	}

	/**
	 * Fetch events for a specific date from Google Calendar
	 */
	async fetchEventsForDate(date: Date): Promise<GoogleEvent[]> {
		const calendarId = this.settings.googleCalendarId;
		if (!calendarId) {
			throw new Error('No calendar selected');
		}

		const timeZone = this.getTimeZone();

		// Get start and end of the specified day
		const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
		const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

		return await this.calendarApi.listEvents(calendarId, startOfDay, endOfDay, timeZone);
	}

	/**
	 * Open a file at a specific line in the editor
	 */
	async openFileAtLine(filePath: string, lineNumber: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file) {
			new Notice(`File not found: ${filePath}`);
			return;
		}

		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file as any);

		// Jump to the line
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			editor.setCursor({ line: lineNumber - 1, ch: 0 });
			editor.scrollIntoView({
				from: { line: lineNumber - 1, ch: 0 },
				to: { line: lineNumber - 1, ch: 0 }
			}, true);
		}
	}

	/**
	 * Toggle the agenda sidebar view
	 */
	async toggleAgendaView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE);

		if (leaves.length > 0) {
			// View exists - close it
			leaves.forEach(leaf => leaf.detach());
		} else {
			// Create view in right sidebar
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({
					type: AGENDA_VIEW_TYPE,
					active: true,
				});
				this.app.workspace.revealLeaf(leaf);
			}
		}
	}

	/**
	 * Refresh all open agenda views (e.g., after settings change)
	 * @param reloadColors Whether to also reload calendar colors (e.g., after calendar change)
	 */
	refreshAgendaViews(reloadColors: boolean = false): void {
		const leaves = this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE);
		for (const leaf of leaves) {
			const view = leaf.view as AgendaView;
			view.setRefreshInterval(this.settings.agendaRefreshIntervalMinutes * 60 * 1000);
			if (reloadColors) {
				view.reloadColors();
			}
			view.refresh();
		}
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
	 * Check if Google OAuth credentials are configured
	 */
	hasCredentials(): boolean {
		return !!(this.settings.googleClientId && this.settings.googleClientSecret);
	}

	/**
	 * Get the current OAuth credentials from settings
	 */
	getAuthCredentials(): GoogleAuthCredentials {
		return {
			clientId: this.settings.googleClientId,
			clientSecret: this.settings.googleClientSecret,
		};
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

		// Google API Credentials Section
		containerEl.createEl('h3', { text: 'Google API Credentials' });

		this.renderCredentialsSection(containerEl);

		// Google Account Connection Section (only show if credentials are configured)
		if (this.plugin.hasCredentials()) {
			containerEl.createEl('h3', { text: 'Google Calendar Connection' });
			this.renderConnectionStatus(containerEl);
		}

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

			// Timezone setting
			const currentTz = this.plugin.getTimeZone();
			new Setting(containerEl)
				.setName('Timezone')
				.setDesc(`Events will be created and displayed in this timezone. Current: ${currentTz}`)
				.addDropdown(dropdown => {
					// System local option
					dropdown.addOption('local', `System Local (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);

					// Common timezones with abbreviations
					// Note: Some zones observe DST, showing standard time abbreviation
					const timezones: Array<{ id: string; label: string }> = [
						// Americas
						{ id: 'America/New_York', label: 'America/New_York (EST/EDT)' },
						{ id: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
						{ id: 'America/Denver', label: 'America/Denver (MST/MDT)' },
						{ id: 'America/Los_Angeles', label: 'America/Los_Angeles (PST/PDT)' },
						{ id: 'America/Anchorage', label: 'America/Anchorage (AKST/AKDT)' },
						{ id: 'America/Phoenix', label: 'America/Phoenix (MST)' },
						{ id: 'America/Toronto', label: 'America/Toronto (EST/EDT)' },
						{ id: 'America/Vancouver', label: 'America/Vancouver (PST/PDT)' },
						{ id: 'America/Mexico_City', label: 'America/Mexico_City (CST)' },
						{ id: 'America/Sao_Paulo', label: 'America/Sao_Paulo (BRT)' },
						{ id: 'America/Buenos_Aires', label: 'America/Buenos_Aires (ART)' },
						// Europe
						{ id: 'Europe/London', label: 'Europe/London (GMT/BST)' },
						{ id: 'Europe/Paris', label: 'Europe/Paris (CET/CEST)' },
						{ id: 'Europe/Berlin', label: 'Europe/Berlin (CET/CEST)' },
						{ id: 'Europe/Amsterdam', label: 'Europe/Amsterdam (CET/CEST)' },
						{ id: 'Europe/Rome', label: 'Europe/Rome (CET/CEST)' },
						{ id: 'Europe/Madrid', label: 'Europe/Madrid (CET/CEST)' },
						{ id: 'Europe/Moscow', label: 'Europe/Moscow (MSK)' },
						{ id: 'Europe/Istanbul', label: 'Europe/Istanbul (TRT)' },
						// Asia
						{ id: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
						{ id: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
						{ id: 'Asia/Bangkok', label: 'Asia/Bangkok (ICT)' },
						{ id: 'Asia/Singapore', label: 'Asia/Singapore (SGT)' },
						{ id: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong (HKT)' },
						{ id: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
						{ id: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
						{ id: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
						// Pacific / Australia
						{ id: 'Pacific/Auckland', label: 'Pacific/Auckland (NZST/NZDT)' },
						{ id: 'Australia/Sydney', label: 'Australia/Sydney (AEST/AEDT)' },
						{ id: 'Australia/Melbourne', label: 'Australia/Melbourne (AEST/AEDT)' },
						{ id: 'Australia/Perth', label: 'Australia/Perth (AWST)' },
						{ id: 'Pacific/Honolulu', label: 'Pacific/Honolulu (HST)' },
						// UTC
						{ id: 'UTC', label: 'UTC' },
					];

					for (const tz of timezones) {
						dropdown.addOption(tz.id, tz.label);
					}

					dropdown.setValue(this.plugin.settings.timeZone);
					dropdown.onChange(async (value) => {
						this.plugin.settings.timeZone = value;
						await this.plugin.saveSettings();
						// Refresh agenda views to reflect new timezone
						this.plugin.refreshAgendaViews();
						// Update the description to show new current timezone
						this.display();
					});
				});

			// Agenda Settings Section
			containerEl.createEl('h3', { text: 'Agenda Sidebar' });

			new Setting(containerEl)
				.setName('Agenda refresh interval')
				.setDesc('How often to refresh the agenda sidebar (in minutes)')
				.addText(text => text
					.setPlaceholder('10')
					.setValue(String(this.plugin.settings.agendaRefreshIntervalMinutes))
					.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.agendaRefreshIntervalMinutes = num;
							await this.plugin.saveSettings();
							this.plugin.refreshAgendaViews();
						}
					}));

			new Setting(containerEl)
				.setName('Open agenda sidebar')
				.setDesc("Show today's events in the right sidebar")
				.addButton(button => button
					.setButtonText('Open Agenda')
					.onClick(async () => {
						await this.plugin.toggleAgendaView();
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
					// Refresh agenda views with new calendar color
					this.plugin.refreshAgendaViews(true);
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

	private renderCredentialsSection(containerEl: HTMLElement): void {
		const descEl = containerEl.createEl('p', { cls: 'chronos-credentials-desc' });
		descEl.innerHTML = `
			Chronos requires your own Google Cloud credentials. This keeps your data private and ensures
			you're never affected by API quotas from other users.<br><br>
			<strong>Setup takes ~5 minutes:</strong> Create a free Google Cloud project, enable the Calendar API,
			and create OAuth credentials. See the <a href="https://github.com/thuban87/Chronos#setup">README</a> for step-by-step instructions.<br><br>
			<em>Google Cloud is free for personal use. No credit card required.</em>
		`;

		const hadCredentialsBefore = this.plugin.hasCredentials();

		new Setting(containerEl)
			.setName('Google Client ID')
			.setDesc('From Google Cloud Console → APIs & Services → Credentials')
			.addText(text => text
				.setPlaceholder('xxxxx.apps.googleusercontent.com')
				.setValue(this.plugin.settings.googleClientId)
				.onChange(async (value) => {
					this.plugin.settings.googleClientId = value.trim();
					await this.plugin.saveSettings();
					this.plugin.googleAuth.updateCredentials(this.plugin.getAuthCredentials());
					// Refresh settings if credentials state changed
					if (!hadCredentialsBefore && this.plugin.hasCredentials()) {
						this.display();
					}
				}));

		new Setting(containerEl)
			.setName('Google Client Secret')
			.setDesc('From the same OAuth 2.0 Client ID in Google Cloud Console')
			.addText(text => {
				text
					.setPlaceholder('GOCSPX-xxxxxxxxxx')
					.setValue(this.plugin.settings.googleClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.googleClientSecret = value.trim();
						await this.plugin.saveSettings();
						this.plugin.googleAuth.updateCredentials(this.plugin.getAuthCredentials());
						// Refresh settings if credentials state changed
						if (!hadCredentialsBefore && this.plugin.hasCredentials()) {
							this.display();
						}
					});
				// Make it a password field for some obscurity
				text.inputEl.type = 'password';
			});

		if (!this.plugin.hasCredentials()) {
			const warningEl = containerEl.createEl('p', { cls: 'chronos-credentials-warning' });
			warningEl.setText('⚠️ Enter both credentials above, then the Connect button will appear.');
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

/**
 * A batch of sync log entries grouped by batchId
 */
interface SyncLogBatch {
	batchId: string;
	timestamp: string;
	entries: SyncLogEntry[];
	summary: {
		created: number;
		updated: number;
		deleted: number;
		completed: number;
		recreated: number;
		failed: number;
	};
}

/**
 * Modal to display sync history/log grouped by batch
 */
class SyncLogModal extends Modal {
	plugin: ChronosPlugin;

	constructor(app: App, plugin: ChronosPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-sync-log-modal');

		contentEl.createEl('h2', { text: 'Sync History' });

		const log = this.plugin.syncManager.getSyncLog();

		if (log.length === 0) {
			contentEl.createEl('p', {
				text: 'No sync operations recorded yet.',
				cls: 'chronos-empty-log'
			});
			contentEl.createEl('p', {
				text: 'Sync your tasks to start building history.',
				cls: 'chronos-hint'
			});
			return;
		}

		// Group entries by batchId
		const batches = this.groupEntriesByBatch(log);

		// Header with count and clear button
		const header = contentEl.createDiv({ cls: 'chronos-log-header' });
		header.createEl('span', {
			text: `${batches.length} sync${batches.length === 1 ? '' : 's'} (${log.length} operations)`,
			cls: 'chronos-log-count'
		});

		const clearBtn = header.createEl('button', {
			text: 'Clear Log',
			cls: 'chronos-clear-log-btn'
		});
		clearBtn.addEventListener('click', () => {
			this.plugin.syncManager.clearSyncLog();
			this.plugin.saveSettings();
			this.onOpen(); // Refresh
		});

		// Render batch cards
		const batchContainer = contentEl.createDiv({ cls: 'chronos-batch-container' });

		for (const batch of batches) {
			this.renderBatchCard(batchContainer, batch);
		}
	}

	/**
	 * Group log entries by batchId
	 */
	private groupEntriesByBatch(log: SyncLogEntry[]): SyncLogBatch[] {
		const batchMap = new Map<string, SyncLogEntry[]>();

		// Group entries by batchId
		for (const entry of log) {
			const batchId = entry.batchId || 'unknown';
			if (!batchMap.has(batchId)) {
				batchMap.set(batchId, []);
			}
			batchMap.get(batchId)!.push(entry);
		}

		// Convert to batch objects
		const batches: SyncLogBatch[] = [];
		for (const [batchId, entries] of batchMap) {
			// Use the earliest timestamp in the batch
			const timestamps = entries.map(e => new Date(e.timestamp).getTime());
			const earliestTimestamp = new Date(Math.min(...timestamps)).toISOString();

			// Count operations by type
			const summary = {
				created: 0,
				updated: 0,
				deleted: 0,
				completed: 0,
				recreated: 0,
				failed: 0,
			};

			for (const entry of entries) {
				if (!entry.success) {
					summary.failed++;
				} else if (entry.type === 'create') {
					summary.created++;
				} else if (entry.type === 'update') {
					summary.updated++;
				} else if (entry.type === 'delete') {
					summary.deleted++;
				} else if (entry.type === 'complete') {
					summary.completed++;
				} else if (entry.type === 'recreate') {
					summary.recreated++;
				}
			}

			batches.push({
				batchId,
				timestamp: earliestTimestamp,
				entries,
				summary,
			});
		}

		// Sort batches by timestamp (newest first)
		batches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		return batches;
	}

	/**
	 * Build a summary string from batch counts
	 */
	private buildSummaryText(summary: SyncLogBatch['summary']): string {
		const parts: string[] = [];
		if (summary.created > 0) parts.push(`${summary.created} created`);
		if (summary.updated > 0) parts.push(`${summary.updated} updated`);
		if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`);
		if (summary.completed > 0) parts.push(`${summary.completed} completed`);
		if (summary.recreated > 0) parts.push(`${summary.recreated} recreated`);
		if (summary.failed > 0) parts.push(`${summary.failed} failed`);
		return parts.length > 0 ? parts.join(', ') : 'No operations';
	}

	/**
	 * Render a collapsible batch card
	 */
	private renderBatchCard(container: HTMLElement, batch: SyncLogBatch): void {
		const hasErrors = batch.summary.failed > 0;
		const batchDiv = container.createDiv({
			cls: `chronos-batch-card ${hasErrors ? 'chronos-batch-has-errors' : ''}`
		});

		// Header (clickable to expand)
		const header = batchDiv.createDiv({ cls: 'chronos-batch-header' });

		const arrow = header.createSpan({ cls: 'chronos-collapse-arrow', text: '▶' });

		// Timestamp
		const timestamp = new Date(batch.timestamp);
		const timeStr = timestamp.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});

		header.createSpan({
			text: timeStr,
			cls: 'chronos-batch-time'
		});

		// Summary
		header.createSpan({
			text: ` — ${this.buildSummaryText(batch.summary)}`,
			cls: 'chronos-batch-summary'
		});

		// Collapsible content
		const content = batchDiv.createDiv({ cls: 'chronos-batch-content chronos-collapsed' });

		// Toggle collapse on header click
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

		// Render individual entries inside the batch
		for (const entry of batch.entries) {
			this.renderLogEntry(content, entry);
		}
	}

	private renderLogEntry(container: HTMLElement, entry: SyncLogEntry): void {
		const entryDiv = container.createDiv({
			cls: `chronos-log-entry ${entry.success ? 'chronos-log-success' : 'chronos-log-error'}`
		});

		// Icon based on type
		const icons: Record<string, string> = {
			create: '➕',
			update: '✏️',
			delete: '🗑️',
			complete: '✅',
			recreate: '🔄',
			error: '❌',
		};

		const typeLabels: Record<string, string> = {
			create: 'Created',
			update: 'Updated',
			delete: 'Deleted',
			complete: 'Completed',
			recreate: 'Recreated',
			error: 'Error',
		};

		// Type and title on same line
		const headerDiv = entryDiv.createDiv({ cls: 'chronos-log-entry-header' });
		headerDiv.createSpan({
			text: `${icons[entry.type] || '•'} ${typeLabels[entry.type] || entry.type}`,
			cls: 'chronos-log-type'
		});

		// Task title
		entryDiv.createDiv({
			text: entry.taskTitle,
			cls: 'chronos-log-title'
		});

		// File path (if available)
		if (entry.filePath) {
			const fileName = entry.filePath.split('/').pop() || entry.filePath;
			entryDiv.createDiv({
				text: `📄 ${fileName}`,
				cls: 'chronos-log-file'
			});
		}

		// Error message (if failed)
		if (!entry.success && entry.errorMessage) {
			entryDiv.createDiv({
				text: `Error: ${entry.errorMessage}`,
				cls: 'chronos-log-error-msg'
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
