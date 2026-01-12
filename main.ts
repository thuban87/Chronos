import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { GoogleAuth, TokenData, GoogleAuthCredentials } from './src/googleAuth';
import { TaskParser, ChronosTask } from './src/taskParser';
import { DateTimeModal } from './src/dateTimeModal';
import { GoogleCalendarApi, GoogleCalendar, GoogleEvent } from './src/googleCalendar';
import { SyncManager, ChronosSyncData, PendingOperation, SyncLogEntry, MultiCalendarSyncDiff, SyncedTaskInfo, PendingDeletion, DeletedEventRecord, PendingSeverance, PendingSuccessorCheck } from './src/syncManager';
import { AgendaView, AGENDA_VIEW_TYPE, AgendaViewDeps, AgendaEvent } from './src/agendaView';
import { BatchCalendarApi, ChangeSetOperation, BatchResult, DivertedDeletion, PendingRecurringCompletion, generateOperationId } from './src/batchApi';
import { RecurringDeleteModal, RecurringDeleteChoice } from './src/recurringDeleteModal';
import { DeletionReviewModal } from './src/deletionReviewModal';
import { TaskRestoreModal } from './src/taskRestoreModal';
import { FreshStartWarningModal } from './src/freshStartWarningModal';
import { PowerUserWarningModal } from './src/powerUserWarningModal';
import { EventRestoreModal } from './src/eventRestoreModal';
import { SeveranceReviewModal } from './src/severanceReviewModal';
import { ExclusionModal } from './src/exclusionModal';
import { RecurringEnableModal } from './src/recurringEnableModal';
import { SeriesDisconnectionModal } from './src/seriesDisconnectionModal';
import { RecurrenceChangeModal } from './src/recurrenceChangeModal';
import { ChronosEvents, ChronosEventPayloads, AgendaTaskEvent } from './src/events';

// Re-export types for other plugins to use
export { ChronosEvents, ChronosEventPayloads, AgendaTaskEvent } from './src/events';
export { ChronosTask } from './src/taskParser';
export { SyncedTaskInfo } from './src/syncManager';

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
	tagCalendarMappings: Record<string, string>;  // tag → calendarId
	eventRoutingBehavior: 'preserve' | 'keepBoth' | 'freshStart';
	safeMode: boolean;  // Safety Net: require approval for deletions
	externalEventBehavior: 'ask' | 'sever' | 'recreate';  // What to do when events are moved/deleted in Google Calendar
	strictTimeSync: boolean;  // Detect when Google event time differs from Obsidian task time
	agendaCalendarIds: string[];  // Calendar IDs to display in agenda (empty = none selected)
	agendaImportFormat: 'list' | 'table' | 'simple';  // Format for importing agenda to file
	excludedFolders: string[];  // Folders to exclude from sync (e.g., "Templates", "Archive")
	excludedFiles: string[];  // Specific files to exclude from sync (e.g., "Tasks/reference.md")
	enableRecurringTasks: boolean;  // Feature toggle for recurring task succession
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
	agendaRefreshIntervalMinutes: 10,
	tagCalendarMappings: {},
	eventRoutingBehavior: 'preserve',
	safeMode: true,  // Safety Net enabled by default
	externalEventBehavior: 'ask',  // Default: ask user what to do with moved/deleted events
	strictTimeSync: false,  // Default: don't check for time drift
	agendaCalendarIds: [],  // Empty = no calendars selected for agenda
	agendaImportFormat: 'list',  // Default to list format
	excludedFolders: [],  // No folders excluded by default
	excludedFiles: [],  // No files excluded by default
	enableRecurringTasks: false,  // Recurring task succession disabled by default (requires Tasks plugin config)
};

export default class ChronosPlugin extends Plugin {
	settings: ChronosSettings;
	tokens?: TokenData;
	googleAuth: GoogleAuth;
	taskParser: TaskParser;
	calendarApi: GoogleCalendarApi;
	batchApi: BatchCalendarApi;
	syncManager: SyncManager;
	private syncIntervalId: number | null = null;
	private statusBarItem: HTMLElement | null = null;
	private pendingDeletionsStatusBarItem: HTMLElement | null = null;
	private pendingSeverancesStatusBarItem: HTMLElement | null = null;
	pendingRerouteFailures: { task: ChronosTask; oldCalendarId: string; newCalendarId: string; error: string }[] = [];
	private calendarNameCache: Map<string, string> = new Map();

	/**
	 * Event emitter for inter-plugin communication
	 * Other plugins can subscribe to Chronos events:
	 * ```typescript
	 * const chronos = app.plugins.plugins['chronos'];
	 * chronos.events.on('task-created', (payload) => { ... });
	 * ```
	 */
	events: ChronosEvents = new ChronosEvents();

	async onload() {
		await this.loadSettings();
		this.googleAuth = new GoogleAuth(this.getAuthCredentials());
		this.taskParser = new TaskParser(this.app);
		this.calendarApi = new GoogleCalendarApi(() => this.getAccessToken());
		this.batchApi = new BatchCalendarApi(() => this.getAccessToken());
		// SyncManager is initialized in loadSettings()

		// Register the agenda sidebar view
		this.registerView(AGENDA_VIEW_TYPE, (leaf) => {
			const deps: AgendaViewDeps = {
				isAuthenticated: () => this.isAuthenticated(),
				hasCalendarsSelected: () => this.settings.agendaCalendarIds.length > 0,
				fetchEventsForDate: (date: Date) => this.fetchAgendaEventsForDate(date),
				fetchEventColors: () => this.calendarApi.getEventColors(),
				getSyncedTasks: () => this.syncManager.getSyncData().syncedTasks,
				getTimeZone: () => this.getTimeZone(),
				openFile: (filePath, lineNumber) => this.openFileAtLine(filePath, lineNumber),
				importAgendaToEditor: (editor, date) => this.importAgendaToEditor(editor, date),
				getActiveEditor: () => {
					// First try the active view
					const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (activeView?.editor) {
						return activeView.editor;
					}
					// If sidebar has focus, find any open markdown view
					const leaves = this.app.workspace.getLeavesOfType('markdown');
					for (const leaf of leaves) {
						const view = leaf.view as MarkdownView;
						if (view?.editor) {
							return view.editor;
						}
					}
					return null;
				},
				// Event emitter callbacks for inter-plugin communication
				onAgendaRefresh: (date, events) => {
					this.events.emit('agenda-refresh', { date, events });
				},
				onTaskStartingSoon: (task, minutesUntilStart) => {
					this.events.emit('task-starting-soon', { task, minutesUntilStart });
				},
				onTaskNow: (task) => {
					this.events.emit('task-now', { task });
				},
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
					if (result.customDuration && (result.durationHours || result.durationMinutes)) {
						let durationText = '⏱️ ';
						if (result.durationHours && result.durationHours > 0) {
							durationText += `${result.durationHours}h`;
						}
						if (result.durationMinutes && result.durationMinutes > 0) {
							durationText += `${result.durationMinutes}m`;
						}
						// Only add if we have at least some duration
						if (durationText !== '⏱️ ') {
							text += ` ${durationText}`;
						}
					}
					// Build recurrence text
					if (result.recurrenceFrequency !== 'none') {
						let recurrenceText = '🔁 every ';
						if (result.recurrenceInterval > 1) {
							recurrenceText += `${result.recurrenceInterval} `;
						}
						// For weekly with specific days
						if (result.recurrenceFrequency === 'weekly' && result.recurrenceWeekdays.length > 0) {
							recurrenceText += result.recurrenceWeekdays.join(', ');
						} else {
							// Simple frequency
							const freqMap: Record<string, string> = {
								'daily': result.recurrenceInterval > 1 ? 'days' : 'day',
								'weekly': result.recurrenceInterval > 1 ? 'weeks' : 'week',
								'monthly': result.recurrenceInterval > 1 ? 'months' : 'month',
								'yearly': result.recurrenceInterval > 1 ? 'years' : 'year'
							};
							recurrenceText += freqMap[result.recurrenceFrequency] || result.recurrenceFrequency;
						}
						text += ` ${recurrenceText}`;
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

		// Add command to import agenda to current file
		this.addCommand({
			id: 'import-agenda-to-file',
			name: 'Import agenda to current file',
			editorCallback: async (editor: any) => {
				// Use the agenda's current date if available, otherwise today
				const agendaLeaves = this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE);
				let importDate = new Date();

				if (agendaLeaves.length > 0) {
					const agendaView = agendaLeaves[0].view as AgendaView;
					importDate = agendaView.getCurrentDate();
				}

				await this.importAgendaToEditor(editor, importDate);
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

		// Add command to review pending deletions (Safety Net)
		this.addCommand({
			id: 'review-pending-deletions',
			name: 'Review pending deletions',
			callback: () => {
				this.openDeletionReviewModal();
			}
		});

		// Add command to review disconnected events (External Event Handling)
		this.addCommand({
			id: 'review-disconnected-events',
			name: 'Review disconnected events',
			callback: () => {
				this.openSeveranceReviewModal();
			}
		});

		// Add status bar item
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('chronos-status-bar');
		this.statusBarItem.onClickEvent(() => {
			this.syncTasks();
		});

		// Add pending deletions status bar item (Safety Net)
		this.pendingDeletionsStatusBarItem = this.addStatusBarItem();
		this.pendingDeletionsStatusBarItem.addClass('chronos-pending-deletions-status');
		this.pendingDeletionsStatusBarItem.onClickEvent(() => {
			this.openDeletionReviewModal();
		});

		// Add pending severances status bar item (External Event Handling)
		this.pendingSeverancesStatusBarItem = this.addStatusBarItem();
		this.pendingSeverancesStatusBarItem.addClass('chronos-pending-severances-status');
		this.pendingSeverancesStatusBarItem.onClickEvent(() => {
			this.openSeveranceReviewModal();
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
			this.updatePendingDeletionsStatusBar();
			this.updatePendingSeverancesStatusBar();
			return;
		}

		const lastSync = this.syncManager.getLastSyncTime();
		const syncedCount = this.syncManager.getSyncedTaskCount();

		if (!lastSync) {
			this.statusBarItem.setText(`📅 Chronos: ${syncedCount} tasks (never synced)`);
			this.statusBarItem.setAttr('aria-label', 'Click to sync now');
			this.updatePendingDeletionsStatusBar();
			this.updatePendingSeverancesStatusBar();
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

		this.updatePendingDeletionsStatusBar();
		this.updatePendingSeverancesStatusBar();
	}

	/**
	 * Update the pending deletions status bar indicator (Safety Net)
	 * Only visible when there are pending deletions awaiting review
	 */
	updatePendingDeletionsStatusBar(): void {
		if (!this.pendingDeletionsStatusBarItem) return;

		const pendingDeletionCount = this.syncManager.getPendingDeletionCount();

		if (pendingDeletionCount === 0) {
			// Hide the status bar item when no pending deletions
			this.pendingDeletionsStatusBarItem.style.display = 'none';
		} else {
			// Show the status bar item with warning indicator
			this.pendingDeletionsStatusBarItem.style.display = '';
			this.pendingDeletionsStatusBarItem.setText(`⚠️ ${pendingDeletionCount} pending`);
			this.pendingDeletionsStatusBarItem.setAttr(
				'aria-label',
				`${pendingDeletionCount} deletion${pendingDeletionCount === 1 ? '' : 's'} awaiting review. Click to review.`
			);
		}
	}

	/**
	 * Update the pending severances status bar indicator (External Event Handling)
	 * Only visible when there are pending severances awaiting review
	 */
	updatePendingSeverancesStatusBar(): void {
		if (!this.pendingSeverancesStatusBarItem) return;

		const pendingSeverances = this.syncManager.getPendingSeverances();
		const count = pendingSeverances.length;

		if (count === 0) {
			// Hide the status bar item when no pending severances
			this.pendingSeverancesStatusBarItem.style.display = 'none';
		} else {
			// Show the status bar item with indicator
			this.pendingSeverancesStatusBarItem.style.display = '';
			this.pendingSeverancesStatusBarItem.setText(`🔗 ${count} disconnected`);
			this.pendingSeverancesStatusBarItem.setAttr(
				'aria-label',
				`${count} event${count === 1 ? '' : 's'} disconnected. Click to review.`
			);
		}
	}

	/**
	 * Open the severance review modal (External Event Handling)
	 */
	openSeveranceReviewModal(): void {
		const pendingSeverances = this.syncManager.getPendingSeverances();
		if (pendingSeverances.length === 0) {
			new Notice('No disconnected events to review');
			return;
		}

		const modal = new SeveranceReviewModal(this.app, pendingSeverances, {
			onSever: async (severance: PendingSeverance) => {
				// Mark as severed (keeps sync record for reconciliation, won't sync unless edited)
				this.syncManager.markSevered(severance.taskId);
				// Remove from pending queue
				this.syncManager.removePendingSeverance(severance.id);

				// Log the sever operation
				this.syncManager.logOperation({
					type: 'sever',
					taskTitle: severance.eventTitle,
					filePath: severance.sourceFile,
					success: true,
					batchId: this.syncManager.generateBatchId(),
				});

				await this.saveSettings();
				this.updateStatusBar();
				new Notice(`Severed "${severance.eventTitle}" - it won't sync to Google Calendar unless you edit the task`);

				// Refresh modal
				const updated = this.syncManager.getPendingSeverances();
				if (updated.length === 0) {
					modal.close();
				} else {
					modal.refresh(updated);
				}
			},
			onRecreate: async (severance: PendingSeverance) => {
				try {
					// Recreate the event in Google Calendar
					const timeZone = this.settings.timeZone === 'local'
						? Intl.DateTimeFormat().resolvedOptions().timeZone
						: this.settings.timeZone;

					const isAllDay = !severance.eventTime;

					// Build pseudo task for the createEvent API
					// Parse datetime from date and time
					let datetime: Date;
					if (isAllDay) {
						datetime = new Date(severance.eventDate + 'T00:00:00');
					} else {
						datetime = new Date(`${severance.eventDate}T${severance.eventTime}:00`);
					}

					const pseudoTask: ChronosTask = {
						title: severance.eventTitle,
						date: severance.eventDate,
						time: severance.eventTime || null,
						datetime: datetime,
						filePath: severance.sourceFile,
						fileName: severance.sourceFile.split('/').pop() || severance.sourceFile,
						lineNumber: 0, // Unknown, but not critical
						rawText: severance.originalTaskLine,
						isCompleted: false,
						isAllDay: isAllDay,
						tags: [],
						reminderMinutes: null
					};

					const createdEvent = await this.calendarApi.createEvent({
						task: pseudoTask,
						calendarId: severance.calendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes: this.settings.defaultReminderMinutes,
						timeZone,
					});

					this.syncManager.recordSync(pseudoTask, createdEvent.id, severance.calendarId);
					// Clear any severed status (the new sync record won't have it, but clear from legacy array too)
					this.syncManager.clearSevered(severance.taskId);

					// Remove from pending queue
					this.syncManager.removePendingSeverance(severance.id);

					await this.saveSettings();
					this.updateStatusBar();
					new Notice(`Recreated "${severance.eventTitle}" on calendar`);

					// Refresh modal
					const updated = this.syncManager.getPendingSeverances();
					if (updated.length === 0) {
						modal.close();
					} else {
						modal.refresh(updated);
					}
				} catch (error: any) {
					console.error('Failed to recreate event:', error);
					new Notice(`Failed to recreate event: ${error.message}`);
				}
			},
			onSeverAll: async () => {
				const severances = this.syncManager.getPendingSeverances();
				const batchId = this.syncManager.generateBatchId();
				for (const severance of severances) {
					this.syncManager.markSevered(severance.taskId);
					this.syncManager.removePendingSeverance(severance.id);

					// Log each sever operation
					this.syncManager.logOperation({
						type: 'sever',
						taskTitle: severance.eventTitle,
						filePath: severance.sourceFile,
						success: true,
						batchId,
					});
				}
				await this.saveSettings();
				this.updateStatusBar();
				new Notice(`Severed ${severances.length} event(s) - they won't sync to Google Calendar unless edited`);
			},
			onRecreateAll: async () => {
				const severances = this.syncManager.getPendingSeverances();
				const timeZone = this.settings.timeZone === 'local'
					? Intl.DateTimeFormat().resolvedOptions().timeZone
					: this.settings.timeZone;

				let created = 0;
				let failed = 0;

				for (const severance of severances) {
					try {
						const isAllDay = !severance.eventTime;

						// Parse datetime from date and time
						let datetime: Date;
						if (isAllDay) {
							datetime = new Date(severance.eventDate + 'T00:00:00');
						} else {
							datetime = new Date(`${severance.eventDate}T${severance.eventTime}:00`);
						}

						const pseudoTask: ChronosTask = {
							title: severance.eventTitle,
							date: severance.eventDate,
							time: severance.eventTime || null,
							datetime: datetime,
							filePath: severance.sourceFile,
							fileName: severance.sourceFile.split('/').pop() || severance.sourceFile,
							lineNumber: 0,
							rawText: severance.originalTaskLine,
							isCompleted: false,
							isAllDay: isAllDay,
							tags: [],
							reminderMinutes: null
						};

						const createdEvent = await this.calendarApi.createEvent({
							task: pseudoTask,
							calendarId: severance.calendarId,
							durationMinutes: this.settings.defaultEventDurationMinutes,
							reminderMinutes: this.settings.defaultReminderMinutes,
							timeZone,
						});

						this.syncManager.recordSync(pseudoTask, createdEvent.id, severance.calendarId);
						this.syncManager.clearSevered(severance.taskId);
						this.syncManager.removePendingSeverance(severance.id);
						created++;
					} catch (error: any) {
						console.error(`Failed to recreate event "${severance.eventTitle}":`, error);
						failed++;
					}
				}

				await this.saveSettings();
				this.updateStatusBar();

				if (failed > 0) {
					new Notice(`Recreated ${created} event(s), ${failed} failed`);
				} else {
					new Notice(`Recreated ${created} event(s) on calendar`);
				}
			}
		});
		modal.open();
	}

	/**
	 * Open the deletion review modal (Safety Net)
	 */
	async openDeletionReviewModal(): Promise<void> {
		// Refresh calendar name cache before opening modal
		await this.refreshCalendarNameCache();

		const pendingDeletions = this.syncManager.getPendingDeletions();

		new DeletionReviewModal(this.app, pendingDeletions, {
			onDelete: async (deletion: PendingDeletion) => {
				try {
					// Delete the event from Google Calendar
					await this.calendarApi.deleteEvent(deletion.calendarId, deletion.eventId);
				} catch (error: any) {
					// 410 Gone means already deleted - treat as success
					if (error?.message?.includes('410') || error?.status === 410) {
						console.log(`Event ${deletion.eventId} already deleted (410 Gone)`);
					} else {
						console.error('Failed to delete event:', error);
						new Notice(`Failed to delete event: ${error.message}`);
						return;
					}
				}

				// Move to recently deleted and remove from pending
				const calendarName = await this.getCalendarNameById(deletion.calendarId);
				this.syncManager.confirmDeletion(deletion.id, calendarName);

				// Remove from sync tracking
				this.syncManager.removeSync(deletion.taskId);

				await this.saveSettings();
				this.updateStatusBar();
				new Notice(`Deleted "${deletion.eventTitle}" from calendar`);
			},
			onKeep: (deletion: PendingDeletion) => {
				// Remove from pending queue but don't delete from calendar
				// Also remove from sync tracking (Option B - forget it)
				this.syncManager.removePendingDeletion(deletion.id);
				this.syncManager.removeSync(deletion.taskId);
				this.saveSettings();
				this.updateStatusBar();
				new Notice(`Keeping "${deletion.eventTitle}" on calendar (Chronos will no longer track it)`);
			},
			onRestore: (deletion: PendingDeletion) => {
				new TaskRestoreModal(this.app, deletion, () => {
					// User clicked "Done - I've pasted it back"
					// Remove from pending queue (they'll sync to reconnect)
					this.syncManager.removePendingDeletion(deletion.id);
					this.saveSettings();
					this.updateStatusBar();
					new Notice('Great! Run a sync to reconnect the task to its event.');
				}).open();
			},
			onDeleteAll: async () => {
				const deletions = this.syncManager.getPendingDeletions();

				if (deletions.length === 0) {
					new Notice('No pending deletions to process');
					return;
				}

				let deleted = 0;
				let created = 0;
				let failed = 0;

				const timeZone = this.settings.timeZone === 'local'
					? Intl.DateTimeFormat().resolvedOptions().timeZone
					: this.settings.timeZone;

				// Build delete operations for batch API
				const deleteOps: ChangeSetOperation[] = deletions.map((deletion, index) => ({
					id: `delete_batch_${Date.now()}_${index}`,
					type: 'delete' as const,
					calendarId: deletion.calendarId,
					eventId: deletion.eventId,
				}));

				// Execute deletions in batch
				const deleteResults = await this.batchApi.executeBatch(deleteOps);

				// Map deletion ID to result for easy lookup
				const resultMap = new Map<string, { success: boolean; status: number }>();
				deleteResults.results.forEach((result, index) => {
					const deletion = deletions[index];
					// 410 Gone means already deleted - treat as success
					const isSuccess = result.success || result.status === 410;
					resultMap.set(deletion.id, { success: isSuccess, status: result.status });
					if (isSuccess) {
						deleted++;
					} else {
						failed++;
					}
				});

				// Build create operations for Fresh Start items where delete succeeded
				const createOps: ChangeSetOperation[] = [];
				const createOpToDeletion = new Map<string, PendingDeletion>();

				deletions.forEach((deletion, index) => {
					const result = resultMap.get(deletion.id);
					// Create replacement event if delete succeeded (including 410) and this is a freshStart item
					if (result?.success && deletion.reason === 'freshStart' && deletion.linkedCreate) {
						const task = deletion.linkedCreate.task;
						const opId = `create_batch_${Date.now()}_${index}`;
						createOps.push({
							id: opId,
							type: 'create',
							calendarId: deletion.linkedCreate.newCalendarId,
							task,
							durationMinutes: this.settings.defaultEventDurationMinutes,
							reminderMinutes: task.reminderMinutes || this.settings.defaultReminderMinutes,
							timeZone,
						});
						createOpToDeletion.set(opId, deletion);
					}
				});

				// Execute creates in batch if any
				if (createOps.length > 0) {
					const createResults = await this.batchApi.executeBatch(createOps);

					createResults.results.forEach((result) => {
						const deletion = createOpToDeletion.get(result.id);
						if (result.success && result.body?.id && deletion?.linkedCreate) {
							// Record the new sync
							this.syncManager.recordSync(
								deletion.linkedCreate.task,
								result.body.id,
								deletion.linkedCreate.newCalendarId
							);
							created++;
						}
					});
				}

				// Clean up pending deletions and sync records for successful deletions
				for (const deletion of deletions) {
					const result = resultMap.get(deletion.id);
					if (result?.success) {
						const calendarName = this.getCachedCalendarName(deletion.calendarId);
						this.syncManager.confirmDeletion(deletion.id, calendarName);
						// Only remove sync for non-freshStart items (orphans)
						// For freshStart items, recordSync already overwrote the entry with the new event
						if (deletion.reason !== 'freshStart') {
							this.syncManager.removeSync(deletion.taskId);
						}
					}
				}

				await this.saveSettings();
				this.updateStatusBar();

				const msg = `Deleted ${deleted} event${deleted === 1 ? '' : 's'}` +
					(created > 0 ? `, created ${created} new` : '') +
					(failed > 0 ? `, ${failed} failed` : '');
				new Notice(msg);
			},
			onKeepAll: async () => {
				const deletions = this.syncManager.getPendingDeletions();
				let kept = 0;
				let created = 0;

				const timeZone = this.settings.timeZone === 'local'
					? Intl.DateTimeFormat().resolvedOptions().timeZone
					: this.settings.timeZone;

				// For Fresh Start items, keep old AND create new
				// For orphan items, just remove from pending (keep old event)
				const freshStartItems = deletions.filter(d => d.reason === 'freshStart' && d.linkedCreate);
				const orphanItems = deletions.filter(d => d.reason !== 'freshStart' || !d.linkedCreate);

				// Handle orphan items - just keep the old events
				for (const deletion of orphanItems) {
					this.syncManager.removePendingDeletion(deletion.id);
					this.syncManager.removeSync(deletion.taskId);
					kept++;
				}

				// Handle Fresh Start items - keep old AND create new on new calendar
				if (freshStartItems.length > 0) {
					// Build create operations for batch API
					const createOps: ChangeSetOperation[] = freshStartItems.map((deletion, index) => {
						const task = deletion.linkedCreate!.task;
						return {
							id: `keepall_create_${Date.now()}_${index}`,
							type: 'create' as const,
							calendarId: deletion.linkedCreate!.newCalendarId,
							task,
							durationMinutes: this.settings.defaultEventDurationMinutes,
							reminderMinutes: task.reminderMinutes || this.settings.defaultReminderMinutes,
							timeZone,
						};
					});

					// Execute creates in batch
					const createResults = await this.batchApi.executeBatch(createOps);

					// Process results
					createResults.results.forEach((result, index) => {
						const deletion = freshStartItems[index];
						if (result.success && result.body?.id && deletion.linkedCreate) {
							// Record the new sync (overwrites old entry)
							this.syncManager.recordSync(
								deletion.linkedCreate.task,
								result.body.id,
								deletion.linkedCreate.newCalendarId
							);
							created++;
						}
						// Remove from pending queue regardless of success
						this.syncManager.removePendingDeletion(deletion.id);
					});

					kept += freshStartItems.length;
				}

				await this.saveSettings();
				this.updateStatusBar();

				let msg = `Kept ${kept} event${kept === 1 ? '' : 's'}`;
				if (created > 0) msg += `, created ${created} on new calendar`;
				new Notice(msg);
			},
			getCalendarName: (calendarId: string) => {
				// Synchronous calendar name lookup from cache
				return this.getCachedCalendarName(calendarId);
			},
			// Fresh Start specific callbacks
			onDeleteAndRecreate: async (deletion: PendingDeletion) => {
				if (!deletion.linkedCreate) {
					// Fallback to regular delete if no linked create
					try {
						await this.calendarApi.deleteEvent(deletion.calendarId, deletion.eventId);
					} catch (error: any) {
						// 410 Gone means already deleted - treat as success
						if (!(error?.message?.includes('410') || error?.status === 410)) {
							console.error('Failed to delete event:', error);
							new Notice(`Failed to delete event: ${error.message}`);
							return;
						}
						console.log(`Event ${deletion.eventId} already deleted (410 Gone)`);
					}
					const calendarName = await this.getCalendarNameById(deletion.calendarId);
					this.syncManager.confirmDeletion(deletion.id, calendarName);
					this.syncManager.removeSync(deletion.taskId);
					await this.saveSettings();
					this.updateStatusBar();
					new Notice(`Deleted "${deletion.eventTitle}" from calendar`);
					return;
				}

				// Step 1: Delete the old event (handle 410 as success)
				try {
					await this.calendarApi.deleteEvent(deletion.calendarId, deletion.eventId);
				} catch (error: any) {
					// 410 Gone means already deleted - continue to create
					if (!(error?.message?.includes('410') || error?.status === 410)) {
						console.error('Failed to delete event:', error);
						new Notice(`Failed to delete old event: ${error.message}`);
						return;
					}
					console.log(`Event ${deletion.eventId} already deleted (410 Gone), proceeding with create`);
				}

				try {
					// Step 2: Create the new event on the new calendar
					const task = deletion.linkedCreate.task;
					const reminderMinutes = task.reminderMinutes || this.settings.defaultReminderMinutes;
					const timeZone = this.settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;

					const newEvent = await this.calendarApi.createEvent({
						task,
						calendarId: deletion.linkedCreate.newCalendarId,
						durationMinutes: this.settings.defaultEventDurationMinutes,
						reminderMinutes,
						timeZone,
					});

					// Step 3: Update sync tracking with new event/calendar
					this.syncManager.recordSync(task, newEvent.id, deletion.linkedCreate.newCalendarId);

					// Step 4: Move to recently deleted and remove from pending
					const oldCalendarName = await this.getCalendarNameById(deletion.calendarId);
					this.syncManager.confirmDeletion(deletion.id, oldCalendarName);

					await this.saveSettings();
					this.updateStatusBar();

					const newCalendarName = deletion.linkedCreate.newCalendarName ||
						await this.getCalendarNameById(deletion.linkedCreate.newCalendarId);
					new Notice(`Moved "${deletion.eventTitle}" to ${newCalendarName}`);
				} catch (error: any) {
					console.error('Failed to create replacement event:', error);
					new Notice(`Failed to create replacement event: ${error.message}`);
				}
			},
			onKeepOriginal: (deletion: PendingDeletion) => {
				// Remove from pending queue, keep the old event
				// Remove sync tracking so the task (with new tag/calendar) will create fresh on next sync
				this.syncManager.removePendingDeletion(deletion.id);
				this.syncManager.removeSync(deletion.taskId);
				this.saveSettings();
				this.updateStatusBar();
				new Notice(`Keeping original "${deletion.eventTitle}" on calendar (task will sync to new calendar next time)`);
			}
		}).open();
	}

	/**
	 * Get calendar name by ID (async version)
	 */
	private async getCalendarNameById(calendarId: string): Promise<string> {
		try {
			const calendars = await this.calendarApi.listCalendars();
			// Populate cache while we have the data
			for (const cal of calendars) {
				this.calendarNameCache.set(cal.id, cal.summary);
			}
			const calendar = calendars.find(c => c.id === calendarId);
			return calendar?.summary || calendarId;
		} catch {
			return calendarId;
		}
	}

	/**
	 * Refresh the calendar name cache from Google
	 */
	async refreshCalendarNameCache(): Promise<void> {
		try {
			const calendars = await this.calendarApi.listCalendars();
			this.calendarNameCache.clear();
			for (const cal of calendars) {
				this.calendarNameCache.set(cal.id, cal.summary);
			}
		} catch (e) {
			console.warn('Could not refresh calendar name cache:', e);
		}
	}

	/**
	 * Get cached calendar name (synchronous, for display)
	 * Returns the actual calendar name if cached, otherwise the ID
	 */
	private getCachedCalendarName(calendarId: string): string {
		// Check cache first - this has the actual calendar names
		const cached = this.calendarNameCache.get(calendarId);
		if (cached) {
			return cached;
		}
		// Fallback to ID if not in cache
		return calendarId;
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
	 * Uses batch API for dramatically improved performance
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

		// Emit sync-start event for other plugins
		this.events.emit('sync-start', { timestamp: new Date() });

		try {
			// Generate a batch ID for this sync run
			const batchId = this.syncManager.generateBatchId();

			// First, retry any pending operations from previous failures
			const retryResult = await this.retryPendingOperations();

			// Scan for ALL tasks including completed ones (respecting exclusions)
			const allTasks = await this.taskParser.scanVault(
				true,
				this.settings.excludedFolders,
				this.settings.excludedFiles
			);

			// Separate uncompleted and completed tasks
			const uncompletedTasks = allTasks.filter(t => !t.isCompleted);
			const completedTasksList = allTasks.filter(t => t.isCompleted);

			// Compute what needs to be done using multi-calendar routing
			const diff = this.syncManager.computeMultiCalendarSyncDiff(
				uncompletedTasks,
				(task) => this.getTargetCalendarForTask(task)
			);

			// Show warnings for tasks with multiple mapped tags
			for (const warning of diff.warnings) {
				new Notice(warning);
			}

			const timeZone = this.getTimeZone();

			// Collect completed tasks that need action (have sync info)
			const completedWithSync: { task: ChronosTask; syncInfo: SyncedTaskInfo }[] = [];
			for (const task of completedTasksList) {
				const taskId = this.syncManager.generateTaskId(task);
				const syncInfo = this.syncManager.getSyncInfo(taskId);
				if (syncInfo) {
					completedWithSync.push({ task, syncInfo });
				}
			}

			// Build the complete ChangeSet (collect phase)
			const changeSet = this.syncManager.buildChangeSet(
				diff,
				completedWithSync,
				this.settings.eventRoutingBehavior,
				this.settings.completedTaskBehavior,
				this.settings.defaultEventDurationMinutes,
				this.settings.defaultReminderMinutes,
				timeZone,
				this.settings.safeMode
			);

			// Handle diverted deletions (Safety Net)
			if (changeSet.divertedDeletions.length > 0) {
				// Fetch calendar list once for name lookups and populate cache
				let calendarMap: Record<string, string> = {};
				try {
					const calendars = await this.calendarApi.listCalendars();
					for (const cal of calendars) {
						calendarMap[cal.id] = cal.summary;
						// Populate the cache for future synchronous lookups
						this.calendarNameCache.set(cal.id, cal.summary);
					}
				} catch (e) {
					console.warn('Could not fetch calendar list for names:', e);
				}

				// Phase 4: Batch-fetch event details for risk assessment
				const eventDetailsMap: Record<string, GoogleEvent> = {};
				const getOps: ChangeSetOperation[] = changeSet.divertedDeletions.map((diverted, index) => ({
					id: `get_event_${index}`,
					type: 'get' as const,
					calendarId: diverted.calendarId,
					eventId: diverted.eventId,
				}));

				if (getOps.length > 0) {
					try {
						const getResult = await this.batchApi.executeBatch(getOps);
						for (const result of getResult.results) {
							if (result.success && result.body) {
								// Map result back to eventId
								const opIndex = parseInt(result.id.replace('get_event_', ''), 10);
								const diverted = changeSet.divertedDeletions[opIndex];
								if (diverted) {
									eventDetailsMap[diverted.eventId] = result.body;
								}
							}
						}
					} catch (e) {
						console.warn('Could not fetch event details for risk assessment:', e);
					}
				}

				for (const diverted of changeSet.divertedDeletions) {
					// Get fetched event details (if available)
					const eventDetails = eventDetailsMap[diverted.eventId];

					// Determine risk indicators
					const hasAttendees = !!(eventDetails?.attendees && eventDetails.attendees.length > 0);
					const chronosSignature = 'Synced by Chronos for Obsidian';
					const hasCustomDescription = !!(eventDetails?.description &&
						!eventDetails.description.includes(chronosSignature));
					const hasConferenceLink = !!(eventDetails?.conferenceData?.entryPoints &&
						eventDetails.conferenceData.entryPoints.length > 0);

					// Build event snapshot for potential restoration
					const eventSnapshot = eventDetails ? {
						summary: eventDetails.summary,
						description: eventDetails.description,
						location: eventDetails.location,
						start: eventDetails.start,
						end: eventDetails.end,
						reminders: eventDetails.reminders,
						colorId: eventDetails.colorId,
						attendees: eventDetails.attendees,
						conferenceData: eventDetails.conferenceData,
					} : undefined;

					const pendingDeletion: PendingDeletion = {
						id: this.syncManager.generatePendingDeletionId(),
						taskId: diverted.taskId,
						eventId: diverted.eventId,
						calendarId: diverted.calendarId,
						eventTitle: diverted.eventTitle,
						eventDate: diverted.eventDate,
						eventTime: diverted.eventTime,
						sourceFile: diverted.sourceFile,
						reason: diverted.reason,
						reasonDetail: diverted.reasonDetail,
						originalTaskLine: diverted.originalTaskLine,
						linkedCreate: diverted.linkedCreate ? {
							newCalendarId: diverted.linkedCreate.newCalendarId,
							newCalendarName: calendarMap[diverted.linkedCreate.newCalendarId] || diverted.linkedCreate.newCalendarId,
							task: diverted.linkedCreate.task.task!,
						} : undefined,
						eventSnapshot,
						hasAttendees,
						hasCustomDescription,
						hasConferenceLink,
						queuedAt: new Date().toISOString(),
					};
					this.syncManager.addPendingDeletion(pendingDeletion);
				}
				await this.saveSettings();
				this.updateStatusBar();
			}

			// Handle pending recurring completions (Safety Net OFF + recurring task completed)
			if (changeSet.pendingRecurringCompletions.length > 0) {
				for (const pending of changeSet.pendingRecurringCompletions) {
					// Show modal for each recurring task completion
					const choice = await this.showRecurringDeleteModal(pending.taskTitle);

					if (choice) {
						switch (choice) {
							case 'deleteAll':
								// Delete the entire series
								changeSet.operations.push({
									id: generateOperationId('delete'),
									type: 'delete',
									calendarId: pending.calendarId,
									eventId: pending.eventId,
								});
								break;

							case 'markComplete':
								// Keep calendar events intact, just release from sync tracking
								// This prevents breaking the recurring series
								this.syncManager.removeSyncInfo(pending.taskId);
								new Notice(`Released "${pending.taskTitle}" from sync. Calendar events kept.`);
								break;

							case 'deleteNext':
								// For now, same as markComplete - release from tracking
								// Single instance deletion requires complex Google Calendar exception handling
								this.syncManager.removeSyncInfo(pending.taskId);
								new Notice('Single instance deletion not yet supported. Calendar events kept.');
								break;
						}
					} else {
						// User cancelled - release from tracking anyway since task is completed
						this.syncManager.removeSyncInfo(pending.taskId);
					}
				}
				await this.saveSettings();
			}

			// Handle Safety Net ON recurring completions - release from tracking
			// (These weren't added to pendingRecurringCompletions, but we need to clean up sync info)
			if (this.settings.safeMode) {
				for (const { task, syncInfo } of completedWithSync) {
					// Check both current task AND stored sync info for recurrence
					const isRecurring = !!task.recurrenceRule || !!syncInfo.isRecurring;
					if (isRecurring) {
						const taskId = this.syncManager.generateTaskId(task);
						this.syncManager.removeSyncInfo(taskId);
					}
				}
				await this.saveSettings();
			}

			// Counters for results
			let created = 0;
			let updated = 0;
			let rerouted = 0;
			let recreated = 0;
			let completed = 0;
			let deleted = 0;
			let failed = 0;
			let unchanged = 0;

			// Track failed reroutes for user prompt
			const failedReroutes: { task: ChronosTask; oldCalendarId: string; newCalendarId: string; error: string }[] = [];

			// If there are operations that need existing event data, batch-fetch them first
			if (changeSet.needsEventData.length > 0) {
				const getOps: ChangeSetOperation[] = changeSet.needsEventData.map(op => ({
					...op,
					id: `get_${op.id}`,
					type: 'get' as const,
				}));

				const getResult = await this.executeBatchWithRetry(getOps);

				// Attach fetched data to the original operations
				// Also track which operations failed (event deleted externally)
				for (const result of getResult.results) {
					const originalId = result.id.replace('get_', '');
					const op = changeSet.operations.find(o => o.id === originalId);

					if (result.success && result.body) {
						if (op) {
							op.existingEventData = result.body;
						}
					} else if (result.status === 404 || result.status === 410) {
						// Event was deleted externally
						if (op && op.task) {
							// Remove the sync record
							const taskId = this.syncManager.generateTaskId(op.task);
							this.syncManager.removeSync(taskId);
							// Convert this operation from update to create
							op.type = 'create';
							op.eventId = undefined;
						}
					}
				}
			}

			// Execute the main batch (if there are operations)
			if (changeSet.operations.length > 0) {
				const batchResult = await this.executeBatchWithRetry(changeSet.operations);

				if (batchResult.batchFailed) {
					// Entire batch failed - all operations should be queued for retry
					for (const op of changeSet.operations) {
						this.logOperationFromBatch(op, false, batchResult.batchError || 'Batch request failed', batchId);
						if (op.task && (op.type === 'create' || op.type === 'update')) {
							this.syncManager.queueOperation({
								type: op.type,
								taskId: this.syncManager.generateTaskId(op.task),
								eventId: op.eventId,
								taskData: {
									title: op.task.title,
									date: op.task.date,
									time: op.task.time,
									filePath: op.task.filePath,
									lineNumber: op.task.lineNumber,
									rawText: op.task.rawText,
									isAllDay: op.task.isAllDay,
								},
								calendarId: op.calendarId,
							});
						}
						failed++;
					}
				} else {
					// Process individual results
					for (const result of batchResult.results) {
						const op = changeSet.operations.find(o => o.id === result.id);
						if (!op) continue;

						if (result.success) {
							// Handle successful operation
							switch (op.type) {
								case 'create':
									if (op.task && result.body?.id) {
										this.syncManager.recordSync(op.task, result.body.id, op.calendarId);
										created++;
										// Emit task-created event
										this.events.emit('task-created', {
											task: op.task,
											eventId: result.body.id,
											calendarId: op.calendarId,
										});
									}
									this.logOperationFromBatch(op, true, undefined, batchId);
									break;

								case 'update':
									if (op.task) {
										this.syncManager.recordSync(op.task, op.eventId!, op.calendarId);
										updated++;
										// Emit task-updated event
										this.events.emit('task-updated', {
											task: op.task,
											eventId: op.eventId!,
											calendarId: op.calendarId,
										});
									}
									this.logOperationFromBatch(op, true, undefined, batchId);
									break;

								case 'delete':
									// Find orphaned task ID or completed task to remove sync
									if (op.task) {
										const taskId = this.syncManager.generateTaskId(op.task);
										this.syncManager.removeSync(taskId);
										// Emit task-deleted event
										this.events.emit('task-deleted', {
											taskId,
											eventId: op.eventId!,
											calendarId: op.calendarId,
											title: op.task.title,
										});
									} else {
										// Orphaned deletion - find by eventId
										const orphanId = diff.orphaned.find(id => {
											const info = this.syncManager.getSyncInfo(id);
											return info?.eventId === op.eventId;
										});
										if (orphanId) {
											this.syncManager.removeSync(orphanId);
											// Emit task-deleted event for orphan
											const orphanInfo = this.syncManager.getSyncInfo(orphanId);
											this.events.emit('task-deleted', {
												taskId: orphanId,
												eventId: op.eventId!,
												calendarId: op.calendarId,
												title: orphanInfo?.title || 'Unknown',
											});
										}
									}
									deleted++;
									this.logOperationFromBatch(op, true, undefined, batchId);
									break;

								case 'move':
									if (op.task && result.body?.id) {
										this.syncManager.recordSync(op.task, result.body.id, op.destinationCalendarId!);
										rerouted++;
										// Emit task-updated event for moves (calendar changed)
										this.events.emit('task-updated', {
											task: op.task,
											eventId: result.body.id,
											calendarId: op.destinationCalendarId!,
										});
									}
									this.logOperationFromBatch(op, true, undefined, batchId);
									break;

								case 'complete':
									if (op.task) {
										const taskId = this.syncManager.generateTaskId(op.task);
										this.syncManager.removeSync(taskId);
										completed++;
										// Emit task-completed event
										this.events.emit('task-completed', {
											task: op.task,
											eventId: op.eventId!,
											calendarId: op.calendarId,
										});
									}
									this.logOperationFromBatch(op, true, undefined, batchId);
									break;
							}
						} else {
							// Handle failed operation
							const errorMsg = result.error || `HTTP ${result.status}`;

							// Check for calendar-gone errors on moves
							if (op.type === 'move' && (result.status === 404 || result.status === 403)) {
								if (op.task) {
									failedReroutes.push({
										task: op.task,
										oldCalendarId: op.calendarId,
										newCalendarId: op.destinationCalendarId!,
										error: 'Source calendar not accessible'
									});
								}
							}
							// Handle event-gone errors on updates (404 = Not Found, 410 = Gone)
							// Event was deleted externally - remove sync record so it will be recreated next sync
							else if (op.type === 'update' && (result.status === 404 || result.status === 410)) {
								if (op.task) {
									const taskId = this.syncManager.generateTaskId(op.task);
									this.syncManager.removeSync(taskId);
								}
								// Don't count as failed - we're handling it gracefully
								// It will be recreated on the next sync
							} else {
								this.logOperationFromBatch(op, false, errorMsg, batchId);

								// Queue for retry if retryable
								if (this.isRetryableStatusCode(result.status)) {
									if (op.task && (op.type === 'create' || op.type === 'update')) {
										this.syncManager.queueOperation({
											type: op.type,
											taskId: this.syncManager.generateTaskId(op.task),
											eventId: op.eventId,
											taskData: {
												title: op.task.title,
												date: op.task.date,
												time: op.task.time,
												filePath: op.task.filePath,
												lineNumber: op.task.lineNumber,
												rawText: op.task.rawText,
												isAllDay: op.task.isAllDay,
											},
											calendarId: op.calendarId,
										});
									}
								}
								failed++;
							}
						}
					}
				}
			}

			// If there were failed reroutes due to inaccessible calendars, prompt user
			if (failedReroutes.length > 0) {
				this.pendingRerouteFailures = failedReroutes;
				setTimeout(() => {
					new RerouteFailureModal(this.app, this, failedReroutes, batchId, timeZone).open();
				}, 100);
			}

			// Verify "unchanged" events still exist - batch check
			if (diff.unchanged.length > 0) {
				const existenceCheckOps: ChangeSetOperation[] = diff.unchanged.map(({ task, calendarId }) => {
					const taskId = this.syncManager.generateTaskId(task);
					const syncInfo = this.syncManager.getSyncInfo(taskId);
					return {
						id: `check_${taskId}`,
						type: 'get' as const,
						calendarId,
						eventId: syncInfo?.eventId,
						task,
					};
				}).filter(op => op.eventId); // Only check if we have an eventId

				if (existenceCheckOps.length > 0) {
					const checkResult = await this.executeBatchWithRetry(existenceCheckOps);

					const toRecreate: ChangeSetOperation[] = [];

					for (const result of checkResult.results) {
						const op = existenceCheckOps.find(o => o.id === result.id);
						if (!op || !op.task) continue;

						const taskId = this.syncManager.generateTaskId(op.task);

						// Event doesn't exist or is cancelled
						if (!result.success || result.body?.status === 'cancelled') {
							// Handle based on externalEventBehavior setting
							const behavior = this.settings.externalEventBehavior;

							if (behavior === 'recreate') {
								// Queue for recreation (current behavior)
								const reminderMinutes = op.task.reminderMinutes || this.settings.defaultReminderMinutes;
								toRecreate.push({
									id: `recreate_${taskId}`,
									type: 'create',
									calendarId: op.calendarId,
									task: op.task,
									durationMinutes: this.settings.defaultEventDurationMinutes,
									reminderMinutes,
									timeZone,
								});
							} else if (behavior === 'sever') {
								// Sever the link - mark as severed (keeps record for reconciliation)
								this.syncManager.markSevered(taskId);
								this.syncManager.logOperation({
									type: 'sever',
									taskTitle: op.task.title,
									filePath: op.task.filePath,
									success: true,
									batchId,
								}, batchId);
							} else {
								// 'ask' mode - queue for user review
								const syncInfo = this.syncManager.getSyncInfo(taskId);
								const calendarName = await this.getCalendarNameById(op.calendarId);
								this.syncManager.addPendingSeverance({
									id: this.syncManager.generatePendingSeveranceId(),
									taskId,
									eventId: syncInfo?.eventId || '',
									calendarId: op.calendarId,
									calendarName: calendarName || op.calendarId,
									eventTitle: op.task.title,
									eventDate: op.task.date,
									eventTime: op.task.time,
									sourceFile: op.task.filePath,
									detectedAt: new Date().toISOString(),
									originalTaskLine: this.syncManager.reconstructTaskLine(syncInfo || {
										eventId: '',
										contentHash: '',
										calendarId: op.calendarId,
										title: op.task.title,
										date: op.task.date,
										time: op.task.time,
										lineNumber: op.task.lineNumber,
									}),
								});
								// Mark as severed so it doesn't keep getting checked (pending user decision)
								this.syncManager.markSevered(taskId);
							}
						} else {
							// Event exists - check for time drift if strictTimeSync is enabled
							let timeDriftDetected = false;

							if (this.settings.strictTimeSync && result.body) {
								const event = result.body;
								const task = op.task;

								// Get expected task datetime
								let expectedTime: string | null = null;
								if (task.isAllDay) {
									// For all-day events, compare dates
									expectedTime = task.date;
								} else if (task.time) {
									// For timed events, compare full datetime
									expectedTime = `${task.date}T${task.time}`;
								}

								// Get actual event datetime from Google
								let actualTime: string | null = null;
								if (event.start?.date) {
									// All-day event
									actualTime = event.start.date;
								} else if (event.start?.dateTime) {
									// Timed event - extract date and time (ignore timezone for comparison)
									const dt = event.start.dateTime;
									// dateTime format: 2026-01-15T14:00:00-05:00 or 2026-01-15T14:00:00Z
									const match = dt.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
									if (match) {
										actualTime = `${match[1]}T${match[2]}`;
									}
								}

								// Compare times
								if (expectedTime && actualTime && expectedTime !== actualTime) {
									timeDriftDetected = true;
								}
							}

							if (timeDriftDetected) {
								// Time drift detected - handle based on externalEventBehavior setting
								const behavior = this.settings.externalEventBehavior;

								if (behavior === 'recreate') {
									// Queue for update to fix the time
									const reminderMinutes = op.task.reminderMinutes || this.settings.defaultReminderMinutes;
									toRecreate.push({
										id: `fix_time_${taskId}`,
										type: 'update',
										calendarId: op.calendarId,
										eventId: op.eventId,
										task: op.task,
										durationMinutes: this.settings.defaultEventDurationMinutes,
										reminderMinutes,
										timeZone,
									});
								} else if (behavior === 'sever') {
									// Sever the link - mark as severed (keeps record for reconciliation)
									this.syncManager.markSevered(taskId);
									this.syncManager.logOperation({
										type: 'sever',
										taskTitle: op.task.title,
										filePath: op.task.filePath,
										success: true,
										batchId,
									}, batchId);
								} else {
									// 'ask' mode - queue for user review
									const syncInfo = this.syncManager.getSyncInfo(taskId);
									const calendarName = await this.getCalendarNameById(op.calendarId);
									this.syncManager.addPendingSeverance({
										id: this.syncManager.generatePendingSeveranceId(),
										taskId,
										eventId: syncInfo?.eventId || '',
										calendarId: op.calendarId,
										calendarName: calendarName || op.calendarId,
										eventTitle: op.task.title,
										eventDate: op.task.date,
										eventTime: op.task.time,
										sourceFile: op.task.filePath,
										detectedAt: new Date().toISOString(),
										originalTaskLine: this.syncManager.reconstructTaskLine(syncInfo || {
											eventId: '',
											contentHash: '',
											calendarId: op.calendarId,
											title: op.task.title,
											date: op.task.date,
											time: op.task.time,
											lineNumber: op.task.lineNumber,
										}),
									});
									// Mark as severed so it doesn't keep getting checked (pending user decision)
									this.syncManager.markSevered(taskId);
								}
							} else {
								// Event exists and times match (or strictTimeSync is off)
								// Update line number if needed
								const syncInfo = this.syncManager.getSyncInfo(taskId);
								if (syncInfo && syncInfo.lineNumber !== op.task.lineNumber) {
									this.syncManager.updateSyncLineNumber(taskId, op.task.lineNumber);
								}
								unchanged++;
							}
						}
					}

					// Execute recreations if needed
					if (toRecreate.length > 0) {
						const recreateResult = await this.executeBatchWithRetry(toRecreate);

						for (const result of recreateResult.results) {
							const op = toRecreate.find(o => o.id === result.id);
							if (!op || !op.task) continue;

							if (result.success && result.body?.id) {
								this.syncManager.recordSync(op.task, result.body.id, op.calendarId);
								this.syncManager.logOperation({
									type: 'recreate',
									taskTitle: op.task.title,
									filePath: op.task.filePath,
									success: true,
									batchId,
								}, batchId);
								recreated++;
							} else {
								this.syncManager.logOperation({
									type: 'recreate',
									taskTitle: op.task.title,
									filePath: op.task.filePath,
									success: false,
									errorMessage: result.error || 'Recreation failed',
									batchId,
								}, batchId);
								failed++;
							}
						}
					}
				}
			}

			// Update sync timestamp and save
			this.syncManager.updateLastSyncTime();
			await this.saveSettings();
			this.updateStatusBar();

			// Emit sync-complete event for other plugins
			this.events.emit('sync-complete', {
				timestamp: new Date(),
				created: created + retryResult.succeeded,
				updated,
				deleted,
				completed,
				errors: failed,
			});

			// Report results
			const hasChanges = created > 0 || updated > 0 || recreated > 0 || rerouted > 0 || completed > 0 || deleted > 0 || failed > 0 || retryResult.succeeded > 0;
			if (!silent || hasChanges) {
				const parts: string[] = [];
				if (retryResult.succeeded > 0) parts.push(`${retryResult.succeeded} retried`);
				if (created > 0) parts.push(`${created} created`);
				if (updated > 0) parts.push(`${updated} updated`);
				if (rerouted > 0) parts.push(`${rerouted} moved`);
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
	 * Execute a batch with smart retry on 500/503 errors
	 * Waits 5 seconds and retries once before giving up
	 */
	private async executeBatchWithRetry(operations: ChangeSetOperation[]): Promise<BatchResult> {
		const result = await this.batchApi.executeBatch(operations);

		// If batch failed with server error, wait and retry once
		if (result.batchFailed && result.batchStatus && (result.batchStatus >= 500 && result.batchStatus < 600)) {
			// Wait 5 seconds
			await new Promise(resolve => setTimeout(resolve, 5000));

			// Retry once
			const retryResult = await this.batchApi.executeBatch(operations);
			return retryResult;
		}

		return result;
	}

	/**
	 * Show the recurring delete modal and return the user's choice
	 * Returns null if the user cancels
	 */
	private showRecurringDeleteModal(taskTitle: string): Promise<RecurringDeleteChoice | null> {
		return new Promise((resolve) => {
			const modal = new RecurringDeleteModal(
				this.app,
				taskTitle,
				(result) => {
					resolve(result.choice);
				}
			);

			// Handle modal close without selection
			const originalOnClose = modal.onClose.bind(modal);
			modal.onClose = () => {
				originalOnClose();
				resolve(null);
			};

			modal.open();
		});
	}

	/**
	 * Log an operation result from batch execution
	 */
	private logOperationFromBatch(op: ChangeSetOperation, success: boolean, errorMessage: string | undefined, batchId: string): void {
		let logType: 'create' | 'update' | 'delete' | 'complete' | 'move' | 'error' = op.type === 'get' ? 'error' : op.type;

		// Map operation types to log types
		if (op.type === 'move') logType = 'move';
		if (op.type === 'complete') logType = 'complete';

		this.syncManager.logOperation({
			type: logType,
			taskTitle: op.task?.title || '(unknown)',
			filePath: op.task?.filePath,
			success,
			errorMessage,
			batchId,
		}, batchId);
	}

	/**
	 * Check if an HTTP status code indicates a retryable error
	 */
	private isRetryableStatusCode(status: number): boolean {
		// 5xx server errors and 429 (rate limit) are retryable
		return status >= 500 || status === 429;
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
	 * Determine the target calendar for a task based on its tags and mappings
	 * Returns the calendar ID and optionally a warning message
	 */
	getTargetCalendarForTask(task: ChronosTask): { calendarId: string; warning?: string } {
		const mappings = this.settings.tagCalendarMappings;
		const defaultCalendar = this.settings.googleCalendarId;

		// If no mappings configured, use default
		if (Object.keys(mappings).length === 0) {
			return { calendarId: defaultCalendar };
		}

		// Find which of the task's tags have mappings (case-insensitive)
		const matchedTags: string[] = [];
		const matchedCalendars: string[] = [];

		// Build a lowercase lookup map for case-insensitive matching
		const lowerCaseMappings: Record<string, { originalKey: string; calendarId: string }> = {};
		for (const [key, calendarId] of Object.entries(mappings)) {
			lowerCaseMappings[key.toLowerCase()] = { originalKey: key, calendarId };
		}

		for (const tag of task.tags) {
			// Normalize tag (ensure # prefix for comparison)
			const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
			const lowerTag = normalizedTag.toLowerCase();

			// Case-insensitive lookup
			if (lowerCaseMappings[lowerTag]) {
				matchedTags.push(normalizedTag);
				matchedCalendars.push(lowerCaseMappings[lowerTag].calendarId);
			}
		}

		// No mapped tags → use default
		if (matchedTags.length === 0) {
			return { calendarId: defaultCalendar };
		}

		// One mapped tag → use that calendar
		if (matchedTags.length === 1) {
			return { calendarId: matchedCalendars[0] };
		}

		// Multiple mapped tags → warning + use default
		return {
			calendarId: defaultCalendar,
			warning: `Task "${task.title}" has multiple mapped tags (${matchedTags.join(', ')}). Using default calendar.`
		};
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
	 * Fetch events for a specific date from Google Calendar (single calendar - used by sync)
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
	 * Fetch events from multiple calendars for the agenda view
	 * Returns AgendaEvent[] with calendar metadata attached to each event
	 */
	async fetchAgendaEventsForDate(date: Date): Promise<AgendaEvent[]> {
		const calendarIds = this.settings.agendaCalendarIds;
		if (calendarIds.length === 0) {
			return [];
		}

		const timeZone = this.getTimeZone();
		const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
		const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);

		// Fetch calendar list for names and colors (cache this if needed)
		let calendars: GoogleCalendar[] = [];
		try {
			calendars = await this.calendarApi.listCalendars();
		} catch (error) {
			console.error('Chronos: Failed to fetch calendar list for agenda:', error);
		}

		const allEvents: AgendaEvent[] = [];

		// Fetch from each selected calendar
		for (const calendarId of calendarIds) {
			try {
				const events = await this.calendarApi.listEvents(calendarId, startOfDay, endOfDay, timeZone);
				const calendarInfo = calendars.find(c => c.id === calendarId);

				for (const event of events) {
					allEvents.push({
						...event,
						calendarId,
						calendarName: calendarInfo?.summary || 'Unknown Calendar',
						calendarColor: calendarInfo?.backgroundColor || '#4285f4',
					});
				}
			} catch (error) {
				console.error(`Chronos: Failed to fetch events from calendar ${calendarId}:`, error);
				// Continue with other calendars
			}
		}

		// Sort by start time
		allEvents.sort((a, b) => {
			const aTime = a.start.dateTime || a.start.date || '';
			const bTime = b.start.dateTime || b.start.date || '';
			return aTime.localeCompare(bTime);
		});

		return allEvents;
	}

	/**
	 * Import agenda events into the editor at cursor position
	 */
	async importAgendaToEditor(editor: any, date: Date): Promise<void> {
		if (!editor) {
			new Notice('Open a note to import agenda');
			return;
		}

		try {
			const events = await this.fetchAgendaEventsForDate(date);

			if (events.length === 0) {
				new Notice('No events found for this day');
				return;
			}

			const lines: string[] = [];
			const dateStr = date.toLocaleDateString('en-US', {
				weekday: 'long',
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});

			const format = this.settings.agendaImportFormat;

			if (format === 'table') {
				lines.push(`## Agenda for ${dateStr}`);
				lines.push('');
				lines.push('| Time | Event |');
				lines.push('|------|-------|');

				for (const event of events) {
					const timeStr = this.formatEventTimeForImport(event);
					const title = event.summary || 'Untitled';
					const link = event.htmlLink ? `[${title}](${event.htmlLink})` : title;
					lines.push(`| ${timeStr} | ${link} |`);
				}
			} else if (format === 'simple') {
				lines.push(`## Agenda for ${dateStr}`);
				lines.push('');

				for (const event of events) {
					const timeStr = this.formatEventTimeForImport(event);
					const title = event.summary || 'Untitled';
					lines.push(`- ${timeStr} - ${title}`);
				}
			} else {
				// Default: list format with links
				lines.push(`## Agenda for ${dateStr}`);
				lines.push('');

				for (const event of events) {
					const timeStr = this.formatEventTimeForImport(event);
					const title = event.summary || 'Untitled';
					const link = event.htmlLink || '#';
					lines.push(`- ${timeStr} - [${title}](${link})`);
				}
			}

			lines.push('');

			// Insert at cursor position
			const cursor = editor.getCursor();
			editor.replaceRange(lines.join('\n'), cursor);

			new Notice(`Imported ${events.length} event${events.length === 1 ? '' : 's'}`);
		} catch (error: any) {
			console.error('Chronos: Failed to import agenda:', error);
			new Notice(`Failed to import agenda: ${error?.message || 'Unknown error'}`);
		}
	}

	/**
	 * Format event time for agenda import
	 */
	private formatEventTimeForImport(event: AgendaEvent): string {
		if (event.start.date) {
			return 'All day';
		}

		if (event.start.dateTime) {
			const startTime = new Date(event.start.dateTime);
			return startTime.toLocaleTimeString('en-US', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: true
			});
		}

		return '';
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
			const view = leaf.view;
			// Safety check - ensure view is actually an AgendaView with the expected methods
			if (view && typeof (view as any).setRefreshInterval === 'function') {
				const agendaView = view as AgendaView;
				agendaView.setRefreshInterval(this.settings.agendaRefreshIntervalMinutes * 60 * 1000);
				if (reloadColors && typeof agendaView.reloadColors === 'function') {
					agendaView.reloadColors();
				}
				if (typeof agendaView.refresh === 'function') {
					agendaView.refresh();
				}
			}
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
		// Clean up event listeners
		this.events.removeAllListeners();
		console.log('Chronos plugin unloaded');
	}

	// ==========================================
	// PUBLIC API FOR OTHER PLUGINS
	// ==========================================

	/**
	 * Get all synced tasks with their calendar event info
	 * Useful for other plugins that want to build on Chronos data
	 *
	 * @example
	 * ```typescript
	 * const chronos = app.plugins.plugins['chronos'];
	 * const tasks = chronos.getSyncedTasks();
	 * for (const [taskId, info] of Object.entries(tasks)) {
	 *     console.log(`${info.title} on ${info.date} at ${info.time}`);
	 * }
	 * ```
	 */
	getSyncedTasks(): Record<string, SyncedTaskInfo> {
		return this.syncManager.getSyncData().syncedTasks;
	}

	/**
	 * Get a specific synced task by its task ID
	 */
	getSyncedTask(taskId: string): SyncedTaskInfo | undefined {
		return this.syncManager.getSyncInfo(taskId);
	}

	/**
	 * Check if Chronos is connected to Google Calendar
	 */
	isConnected(): boolean {
		return this.isAuthenticated();
	}

	/**
	 * Get the default calendar ID
	 */
	getDefaultCalendarId(): string {
		return this.settings.googleCalendarId;
	}

	// ==========================================

	async loadSettings() {
		const data: ChronosData = await this.loadData() || { settings: DEFAULT_SETTINGS };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
		this.tokens = data.tokens;
		this.syncManager = new SyncManager(data.syncData);

		// Auto-prune expired recently deleted records (Phase 5: Historical Recovery)
		const pruned = this.syncManager.pruneExpiredDeletions();
		if (pruned > 0) {
			console.log(`Chronos: Pruned ${pruned} expired recently deleted record(s)`);
			// Save immediately if we pruned anything
			await this.saveSettings();
		}
	}

	async saveSettings() {
		const syncData = this.syncManager?.getSyncData();
		const data: ChronosData = {
			settings: this.settings,
			tokens: this.tokens,
			syncData: syncData,
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
	calendars: GoogleCalendar[] = [];
	mappingsContainer: HTMLElement | null = null;

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

			// Default calendar dropdown
			const calendarSetting = new Setting(containerEl)
				.setName('Default calendar')
				.setDesc('Tasks without mapped tags will sync to this calendar');

			// Load calendars asynchronously
			this.loadCalendarDropdown(calendarSetting);

			// Tag-to-Calendar Mappings section
			containerEl.createEl('h3', { text: 'Tag-to-Calendar Mappings' });

			const mappingsDesc = containerEl.createEl('p', { cls: 'chronos-mappings-desc' });
			mappingsDesc.setText('Route tasks to specific calendars based on their tags. Tasks with unmapped or no tags go to the default calendar above.');

			// Render mappings container (will be re-rendered after calendars load)
			this.mappingsContainer = containerEl.createDiv({ cls: 'chronos-mappings-container' });
			this.renderTagMappings(this.mappingsContainer);

			// Event routing behavior setting
			containerEl.createEl('h3', { text: 'Event Routing Behavior' });

			const routingDesc = containerEl.createEl('p', { cls: 'chronos-routing-desc' });
			routingDesc.setText('What happens to existing calendar events when a task\'s target calendar changes (via tag edits or default calendar switch).');

			new Setting(containerEl)
				.setName('Routing mode')
				.setDesc(this.getRoutingModeDescription(this.plugin.settings.eventRoutingBehavior))
				.addDropdown(dropdown => {
					dropdown.addOption('preserve', '🔄 Preserve - Move events, keep all details');
					dropdown.addOption('keepBoth', '📋 Keep Both - Leave old, create new (duplicates)');
					dropdown.addOption('freshStart', '🧹 Fresh Start - Delete old, create new');
					dropdown.setValue(this.plugin.settings.eventRoutingBehavior);
					dropdown.onChange(async (value: 'preserve' | 'keepBoth' | 'freshStart') => {
						const previousValue = this.plugin.settings.eventRoutingBehavior;

						// Show warning modal when selecting Fresh Start
						if (value === 'freshStart' && previousValue !== 'freshStart') {
							new FreshStartWarningModal(
								this.plugin.app,
								async () => {
									// User confirmed - apply the change
									this.plugin.settings.eventRoutingBehavior = value;
									await this.plugin.saveSettings();
									this.display();
								},
								() => {
									// User cancelled - revert dropdown
									dropdown.setValue(previousValue);
								}
							).open();
						} else {
							// Not selecting Fresh Start, apply immediately
							this.plugin.settings.eventRoutingBehavior = value;
							await this.plugin.saveSettings();
							this.display();
						}
					});
				});

			// Reload warning
			const reloadWarning = containerEl.createDiv({ cls: 'chronos-reload-warning' });
			reloadWarning.createEl('p', {
				text: '⚠️ Changing the routing mode requires an app reload to take effect.'
			});
			reloadWarning.createEl('p', {
				text: 'To reload: Search for "Reload app without saving" in the command palette (Ctrl/Cmd+P), or close and reopen Obsidian.',
				cls: 'chronos-reload-instructions'
			});

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

			const completedTaskSetting = new Setting(containerEl)
				.setName('When task is completed')
				.setDesc('What to do with calendar events when their tasks are marked complete')
				.addDropdown(dropdown => dropdown
					.addOption('markComplete', 'Mark as completed (keep event)')
					.addOption('delete', 'Delete from calendar')
					.setValue(this.plugin.settings.completedTaskBehavior)
					.onChange(async (value: 'delete' | 'markComplete') => {
						this.plugin.settings.completedTaskBehavior = value;
						await this.plugin.saveSettings();
						// Toggle warning visibility
						completedTaskWarning.style.display = value === 'delete' ? 'block' : 'none';
					}));

			// Warning shown when delete mode is selected
			const completedTaskWarning = containerEl.createDiv({ cls: 'chronos-completed-task-warning' });
			completedTaskWarning.innerHTML = `<strong>Warning:</strong> Events WILL be deleted when you check tasks as complete with this setting enabled.`;
			completedTaskWarning.style.display = this.plugin.settings.completedTaskBehavior === 'delete' ? 'block' : 'none';

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

			// Exclusion Rules Section
			containerEl.createEl('h3', { text: 'Exclusion Rules' });

			const exclusionDesc = containerEl.createEl('p', { cls: 'chronos-exclusion-desc' });
			exclusionDesc.textContent = 'Exclude folders or files from calendar sync. Tasks in excluded locations will be ignored even if they have dates.';

			// Excluded Folders
			new Setting(containerEl)
				.setName('Excluded folders')
				.setDesc('Folders to exclude from sync (including subfolders)');

			const folderListContainer = containerEl.createDiv({ cls: 'chronos-exclusion-list' });
			this.renderExcludedFolders(folderListContainer);

			// Add folder input with autocomplete
			const addFolderContainer = containerEl.createDiv({ cls: 'chronos-add-exclusion' });
			const folderSuggester = this.createFolderSuggester(addFolderContainer);
			const addFolderBtn = addFolderContainer.createEl('button', {
				text: 'Add Folder',
				cls: 'chronos-add-exclusion-btn'
			});

			addFolderBtn.addEventListener('click', async () => {
				let folder = folderSuggester.getValue().trim();
				if (!folder) {
					return;
				}
				// Normalize: remove leading/trailing slashes
				folder = folder.replace(/^\/+|\/+$/g, '');
				// Prevent adding root
				if (folder === '' || folder === '/') {
					new Notice('Cannot exclude root folder');
					return;
				}
				if (this.plugin.settings.excludedFolders.includes(folder)) {
					new Notice('Folder already excluded');
					return;
				}

				// Check for synced tasks in this folder
				const affectedTasks = this.getAffectedSyncedTasks(folder, true);
				if (affectedTasks.length > 0) {
					new ExclusionModal(
						this.app,
						folder,
						true,
						affectedTasks.length,
						async (result) => {
							if (result.action === 'cancel') {
								return;
							}
							// Add the exclusion
							this.plugin.settings.excludedFolders.push(folder);
							await this.plugin.saveSettings();
							folderSuggester.clear();
							this.renderExcludedFolders(folderListContainer);

							if (result.action === 'delete') {
								await this.deleteEventsForExcludedTasks(affectedTasks);
							} else {
								// 'keep' - just sever the sync relationship
								this.severSyncForTasks(affectedTasks);
							}
						}
					).open();
				} else {
					this.plugin.settings.excludedFolders.push(folder);
					await this.plugin.saveSettings();
					folderSuggester.clear();
					this.renderExcludedFolders(folderListContainer);
				}
			});

			// Excluded Files
			new Setting(containerEl)
				.setName('Excluded files')
				.setDesc('Specific files to exclude from sync');

			const fileListContainer = containerEl.createDiv({ cls: 'chronos-exclusion-list' });
			this.renderExcludedFiles(fileListContainer);

			// Add file input with autocomplete
			const addFileContainer = containerEl.createDiv({ cls: 'chronos-add-exclusion' });
			const fileSuggester = this.createFileSuggester(addFileContainer);
			const addFileBtn = addFileContainer.createEl('button', {
				text: 'Add File',
				cls: 'chronos-add-exclusion-btn'
			});

			addFileBtn.addEventListener('click', async () => {
				let file = fileSuggester.getValue().trim();
				if (!file) {
					return;
				}
				// Normalize: remove leading slash
				file = file.replace(/^\/+/, '');
				if (this.plugin.settings.excludedFiles.includes(file)) {
					new Notice('File already excluded');
					return;
				}

				// Check for synced tasks in this file
				const affectedTasks = this.getAffectedSyncedTasks(file, false);
				if (affectedTasks.length > 0) {
					new ExclusionModal(
						this.app,
						file,
						false,
						affectedTasks.length,
						async (result) => {
							if (result.action === 'cancel') {
								return;
							}
							// Add the exclusion
							this.plugin.settings.excludedFiles.push(file);
							await this.plugin.saveSettings();
							fileSuggester.clear();
							this.renderExcludedFiles(fileListContainer);

							if (result.action === 'delete') {
								await this.deleteEventsForExcludedTasks(affectedTasks);
							} else {
								// 'keep' - just sever the sync relationship
								this.severSyncForTasks(affectedTasks);
							}
						}
					).open();
				} else {
					this.plugin.settings.excludedFiles.push(file);
					await this.plugin.saveSettings();
					fileSuggester.clear();
					this.renderExcludedFiles(fileListContainer);
				}
			});

			// Agenda View Section
			containerEl.createEl('h3', { text: 'Agenda View' });

			const agendaDesc = containerEl.createEl('p', { cls: 'chronos-agenda-settings-desc' });
			agendaDesc.textContent = 'Choose which calendars to display in the agenda sidebar and how to format imported events.';

			// Calendar checkboxes container
			const calendarCheckboxContainer = containerEl.createDiv({ cls: 'chronos-agenda-calendar-checkboxes' });
			this.renderAgendaCalendarCheckboxes(calendarCheckboxContainer);

			// Import format setting
			new Setting(containerEl)
				.setName('Import format')
				.setDesc('Format for importing agenda to notes')
				.addDropdown(dropdown => dropdown
					.addOption('list', 'List - Bullet points with links')
					.addOption('table', 'Table - Time and event columns')
					.addOption('simple', 'Simple - Plain text, no links')
					.setValue(this.plugin.settings.agendaImportFormat)
					.onChange(async (value: 'list' | 'table' | 'simple') => {
						this.plugin.settings.agendaImportFormat = value;
						await this.plugin.saveSettings();
					}));

			// Safety Net Section
			containerEl.createEl('h3', { text: 'Safety Net' });

			const safetyNetDesc = containerEl.createEl('p', { cls: 'chronos-safety-net-desc' });
			safetyNetDesc.textContent = 'Safety Net protects against accidental data loss by requiring your approval before deleting calendar events.';

			new Setting(containerEl)
				.setName('Safe Mode')
				.setDesc('When enabled, deletions require your approval before executing')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.safeMode)
					.onChange(async (value) => {
						if (!value) {
							// User is trying to disable Safe Mode - show warning
							new PowerUserWarningModal(this.app, {
								onConfirm: async () => {
									this.plugin.settings.safeMode = false;
									await this.plugin.saveSettings();
									safeModeStatus.textContent = 'Status: Power User Mode (deletions are automatic)';
									safeModeStatus.classList.remove('chronos-safe-mode-on');
									safeModeStatus.classList.add('chronos-safe-mode-off');
								},
								onCancel: () => {
									// Reset toggle back to true
									toggle.setValue(true);
								}
							}).open();
						} else {
							this.plugin.settings.safeMode = true;
							await this.plugin.saveSettings();
							safeModeStatus.textContent = 'Status: Protected (deletions require approval)';
							safeModeStatus.classList.remove('chronos-safe-mode-off');
							safeModeStatus.classList.add('chronos-safe-mode-on');
						}
					}));

			// Status indicator
			const safeModeStatus = containerEl.createDiv({ cls: 'chronos-safe-mode-status' });
			if (this.plugin.settings.safeMode) {
				safeModeStatus.textContent = 'Status: Protected (deletions require approval)';
				safeModeStatus.classList.add('chronos-safe-mode-on');
			} else {
				safeModeStatus.textContent = 'Status: Power User Mode (deletions are automatic)';
				safeModeStatus.classList.add('chronos-safe-mode-off');
			}

			// Recurring Tasks Section
			containerEl.createEl('h3', { text: 'Recurring Tasks' });

			const recurringStatus = containerEl.createDiv({ cls: 'chronos-recurring-status' });
			if (this.plugin.settings.enableRecurringTasks) {
				recurringStatus.textContent = 'Status: Enabled (recurring task succession active)';
				recurringStatus.classList.add('chronos-recurring-enabled');
			} else {
				recurringStatus.textContent = 'Status: Disabled (recurring tasks sync as one-time events)';
				recurringStatus.classList.add('chronos-recurring-disabled');
			}

			new Setting(containerEl)
				.setName('Enable recurring tasks sync')
				.setDesc('When enabled, Chronos will track recurring task succession from Tasks plugin. Requires specific Tasks plugin configuration.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableRecurringTasks)
					.onChange(async (value) => {
						if (value) {
							// Show warning modal when enabling
							new RecurringEnableModal(
								this.app,
								async () => {
									// User confirmed
									this.plugin.settings.enableRecurringTasks = true;
									await this.plugin.saveSettings();
									recurringStatus.textContent = 'Status: Enabled (recurring task succession active)';
									recurringStatus.classList.remove('chronos-recurring-disabled');
									recurringStatus.classList.add('chronos-recurring-enabled');
								},
								() => {
									// User cancelled - reset toggle
									toggle.setValue(false);
								}
							).open();
						} else {
							this.plugin.settings.enableRecurringTasks = false;
							await this.plugin.saveSettings();
							recurringStatus.textContent = 'Status: Disabled (recurring tasks sync as one-time events)';
							recurringStatus.classList.remove('chronos-recurring-enabled');
							recurringStatus.classList.add('chronos-recurring-disabled');
						}
					}));

			const recurringInfo = containerEl.createDiv({ cls: 'chronos-recurring-info' });
			recurringInfo.innerHTML = `
				<p><strong>What this does:</strong></p>
				<p>When you complete a recurring task, Tasks plugin creates a new instance with the next date. 
				With this enabled, Chronos will recognize the new task as a "successor" and track it using the 
				existing Google Calendar recurring event instead of creating duplicates.</p>
				<p class="chronos-recurring-requirement"><strong>⚠️ Requirement:</strong> Tasks plugin must be configured to create 
				new recurring task instances <em>below</em> the completed task, not above.</p>
			`;

			// External Event Handling Section
			containerEl.createEl('h3', { text: 'External Event Handling' });

			const externalEventDesc = containerEl.createEl('p', { cls: 'chronos-external-event-desc' });
			externalEventDesc.textContent = 'When Chronos can\'t find an event on its expected calendar (e.g., you moved or deleted it in Google Calendar):';

			new Setting(containerEl)
				.setName('Behavior')
				.setDesc('Choose what happens when events are moved or deleted in Google Calendar')
				.addDropdown(dropdown => dropdown
					.addOption('ask', 'Ask me each time')
					.addOption('sever', 'Sever link (stop tracking)')
					.addOption('recreate', 'Recreate event')
					.setValue(this.plugin.settings.externalEventBehavior)
					.onChange(async (value: 'ask' | 'sever' | 'recreate') => {
						this.plugin.settings.externalEventBehavior = value;
						await this.plugin.saveSettings();
					}));

			// Warning/explanation box
			const externalEventWarning = containerEl.createDiv({ cls: 'chronos-external-event-warning' });
			externalEventWarning.innerHTML = `
				<p><strong>Options explained:</strong></p>
				<ul>
					<li><strong>Ask me each time</strong> - Review each case and decide whether to recreate or stop tracking</li>
					<li><strong>Sever link</strong> - Stop tracking the task, don't recreate the event</li>
					<li><strong>Recreate event</strong> - Assume the deletion was accidental and recreate the event</li>
				</ul>
				<p class="chronos-recovery-note"><strong>Note:</strong> Severed tasks can sync again if you edit the title, date, or time. This creates a new event - it won't reconnect to the moved one.</p>
			`;

			// Strict Time Sync setting
			new Setting(containerEl)
				.setName('Strict time sync')
				.setDesc('Detect when the Google Calendar event time differs from the Obsidian task time. When enabled, time changes made in Google Calendar will trigger the behavior above.')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.strictTimeSync)
					.onChange(async (value) => {
						this.plugin.settings.strictTimeSync = value;
						await this.plugin.saveSettings();
					}));

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
			// Store calendars for use in tag mappings
			this.calendars = calendars;

			// Clear and rebuild the setting
			setting.clear();
			setting.setName('Default calendar');
			setting.setDesc('Tasks without mapped tags will sync to this calendar');

			setting.addDropdown(dropdown => {
				dropdown.addOption('', '-- Select a calendar --');

				for (const cal of calendars) {
					const label = cal.primary ? `${cal.summary} (Primary)` : cal.summary;
					dropdown.addOption(cal.id, label);
				}

				dropdown.setValue(this.plugin.settings.googleCalendarId);
				dropdown.onChange(async (value) => {
					const oldCalendarId = this.plugin.settings.googleCalendarId;

					// If switching from one calendar to another (not initial selection)
					if (oldCalendarId && oldCalendarId !== value) {
						// Count affected events
						const syncedTasks = this.plugin.syncManager.getSyncData().syncedTasks;
						const affectedCount = Object.values(syncedTasks).filter(
							info => info.calendarId === oldCalendarId
						).length;

						if (affectedCount > 0) {
							// Show warning modal
							const oldCalName = this.calendars.find(c => c.id === oldCalendarId)?.summary || 'Unknown';
							const newCalName = this.calendars.find(c => c.id === value)?.summary || 'Unknown';

							new CalendarChangeWarningModal(
								this.app,
								this.plugin,
								oldCalName,
								newCalName,
								value,
								affectedCount,
								() => {
									// On confirm - apply the change
									this.plugin.settings.googleCalendarId = value;
									this.plugin.saveSettings();
									this.plugin.restartSyncInterval();
									this.plugin.refreshAgendaViews(true);
								},
								() => {
									// On cancel - revert the dropdown
									dropdown.setValue(oldCalendarId);
								}
							).open();
							return;
						}
					}

					// No affected events or initial selection - proceed normally
					this.plugin.settings.googleCalendarId = value;
					await this.plugin.saveSettings();
					this.plugin.restartSyncInterval();
					this.plugin.refreshAgendaViews(true);
				});
			});

			// Re-render tag mappings now that calendars are loaded
			if (this.mappingsContainer) {
				this.renderTagMappings(this.mappingsContainer);
			}
		} catch (error) {
			console.error('Failed to load calendars:', error);
			this.calendars = [];

			setting.clear();
			setting.setName('Default calendar');
			setting.setDesc('Failed to load calendars. Check your connection.');

			setting.addButton(button => button
				.setButtonText('Retry')
				.onClick(() => this.display()));
		}
	}

	/**
	 * Render the tag-to-calendar mappings UI
	 */
	private renderTagMappings(container: HTMLElement): void {
		container.empty();

		const mappings = this.plugin.settings.tagCalendarMappings;
		const mappingEntries = Object.entries(mappings);

		if (mappingEntries.length === 0) {
			container.createEl('p', {
				text: 'No tag mappings configured. Add a mapping below.',
				cls: 'chronos-no-mappings'
			});
		} else {
			// Render each mapping
			const mappingsList = container.createDiv({ cls: 'chronos-mappings-list' });

			for (const [tag, calendarId] of mappingEntries) {
				const mappingRow = mappingsList.createDiv({ cls: 'chronos-mapping-row' });

				// Tag display
				mappingRow.createSpan({
					text: tag,
					cls: 'chronos-mapping-tag'
				});

				// Arrow
				mappingRow.createSpan({
					text: '→',
					cls: 'chronos-mapping-arrow'
				});

				// Calendar name
				const calendar = this.calendars.find(c => c.id === calendarId);
				const calendarName = calendar?.summary || 'Unknown calendar';
				mappingRow.createSpan({
					text: calendarName,
					cls: 'chronos-mapping-calendar'
				});

				// Delete button
				const deleteBtn = mappingRow.createEl('button', {
					text: '×',
					cls: 'chronos-mapping-delete'
				});
				deleteBtn.addEventListener('click', async () => {
					delete this.plugin.settings.tagCalendarMappings[tag];
					await this.plugin.saveSettings();
					this.renderTagMappings(container);
				});
			}
		}

		// Add new mapping section
		const addSection = container.createDiv({ cls: 'chronos-add-mapping' });

		const tagInput = addSection.createEl('input', {
			type: 'text',
			placeholder: '#work',
			cls: 'chronos-tag-input'
		});

		addSection.createSpan({
			text: '→',
			cls: 'chronos-mapping-arrow'
		});

		const calendarSelect = addSection.createEl('select', {
			cls: 'chronos-calendar-select'
		});

		// Add empty option
		const emptyOption = calendarSelect.createEl('option', {
			text: 'Select calendar...',
			value: ''
		});

		// Add calendar options
		for (const cal of this.calendars) {
			const option = calendarSelect.createEl('option', {
				text: cal.primary ? `${cal.summary} (Primary)` : cal.summary,
				value: cal.id
			});
		}

		const addBtn = addSection.createEl('button', {
			text: 'Add',
			cls: 'chronos-add-mapping-btn'
		});

		addBtn.addEventListener('click', async () => {
			let tag = tagInput.value.trim();
			const calendarId = calendarSelect.value;

			if (!tag || !calendarId) {
				new Notice('Please enter a tag and select a calendar');
				return;
			}

			// Normalize tag to include # if not present
			if (!tag.startsWith('#')) {
				tag = '#' + tag;
			}

			// Check if tag already exists
			if (this.plugin.settings.tagCalendarMappings[tag]) {
				new Notice(`Tag "${tag}" is already mapped. Delete the existing mapping first.`);
				return;
			}

			// Add the mapping
			this.plugin.settings.tagCalendarMappings[tag] = calendarId;
			await this.plugin.saveSettings();

			// Reset inputs
			tagInput.value = '';
			calendarSelect.value = '';

			// Re-render
			this.renderTagMappings(container);
		});
	}

	/**
	 * Render the agenda calendar checkboxes for selecting which calendars to show in agenda
	 */
	private renderAgendaCalendarCheckboxes(container: HTMLElement): void {
		container.empty();

		if (!this.calendars || this.calendars.length === 0) {
			container.createEl('p', {
				text: 'Loading calendars...',
				cls: 'chronos-muted'
			});

			// Try to load calendars
			this.plugin.calendarApi.listCalendars().then(calendars => {
				this.calendars = calendars;
				this.renderAgendaCalendarCheckboxes(container);
			}).catch(error => {
				container.empty();
				container.createEl('p', {
					text: 'Failed to load calendars. Check your connection.',
					cls: 'chronos-muted'
				});
			});
			return;
		}

		const heading = container.createEl('p', {
			text: 'Select calendars to display in the agenda sidebar:',
			cls: 'chronos-agenda-checkbox-heading'
		});

		const checkboxList = container.createDiv({ cls: 'chronos-agenda-checkbox-list' });

		for (const cal of this.calendars) {
			const isChecked = this.plugin.settings.agendaCalendarIds.includes(cal.id);

			const row = checkboxList.createDiv({ cls: 'chronos-agenda-checkbox-row' });

			// Color indicator
			const colorDot = row.createSpan({ cls: 'chronos-agenda-checkbox-color' });
			colorDot.style.backgroundColor = cal.backgroundColor || '#4285f4';

			const checkbox = row.createEl('input', {
				type: 'checkbox',
				attr: {
					id: `agenda-cal-${cal.id.replace(/[^a-zA-Z0-9]/g, '-')}`,
				}
			});
			checkbox.checked = isChecked;

			const label = row.createEl('label', {
				text: cal.summary + (cal.primary ? ' (Primary)' : ''),
				attr: { for: `agenda-cal-${cal.id.replace(/[^a-zA-Z0-9]/g, '-')}` }
			});

			checkbox.addEventListener('change', async () => {
				if (checkbox.checked) {
					if (!this.plugin.settings.agendaCalendarIds.includes(cal.id)) {
						this.plugin.settings.agendaCalendarIds.push(cal.id);
					}
				} else {
					this.plugin.settings.agendaCalendarIds =
						this.plugin.settings.agendaCalendarIds.filter(id => id !== cal.id);
				}
				await this.plugin.saveSettings();
				// Refresh agenda views to show new calendar selection
				this.plugin.refreshAgendaViews(true);
			});
		}

		// Quick actions
		const quickActions = container.createDiv({ cls: 'chronos-agenda-quick-actions' });

		const selectAllBtn = quickActions.createEl('button', {
			text: 'Select All',
			cls: 'chronos-agenda-quick-btn'
		});
		selectAllBtn.addEventListener('click', async () => {
			this.plugin.settings.agendaCalendarIds = this.calendars.map(c => c.id);
			await this.plugin.saveSettings();
			this.renderAgendaCalendarCheckboxes(container);
			this.plugin.refreshAgendaViews(true);
		});

		const clearAllBtn = quickActions.createEl('button', {
			text: 'Clear All',
			cls: 'chronos-agenda-quick-btn'
		});
		clearAllBtn.addEventListener('click', async () => {
			this.plugin.settings.agendaCalendarIds = [];
			await this.plugin.saveSettings();
			this.renderAgendaCalendarCheckboxes(container);
			this.plugin.refreshAgendaViews(true);
		});
	}

	/**
	 * Render the excluded folders list
	 */
	private renderExcludedFolders(container: HTMLElement): void {
		container.empty();

		const folders = this.plugin.settings.excludedFolders;

		if (folders.length === 0) {
			container.createEl('p', {
				text: 'No folders excluded',
				cls: 'chronos-exclusion-empty'
			});
			return;
		}

		for (const folder of folders) {
			const row = container.createDiv({ cls: 'chronos-exclusion-row' });
			row.createSpan({ text: `📁 ${folder}`, cls: 'chronos-exclusion-path' });

			const removeBtn = row.createEl('button', {
				text: '×',
				cls: 'chronos-exclusion-remove'
			});
			removeBtn.addEventListener('click', async () => {
				this.plugin.settings.excludedFolders =
					this.plugin.settings.excludedFolders.filter(f => f !== folder);
				await this.plugin.saveSettings();
				this.renderExcludedFolders(container);
			});
		}
	}

	/**
	 * Render the excluded files list
	 */
	private renderExcludedFiles(container: HTMLElement): void {
		container.empty();

		const files = this.plugin.settings.excludedFiles;

		if (files.length === 0) {
			container.createEl('p', {
				text: 'No files excluded',
				cls: 'chronos-exclusion-empty'
			});
			return;
		}

		for (const file of files) {
			const row = container.createDiv({ cls: 'chronos-exclusion-row' });
			row.createSpan({ text: `📄 ${file}`, cls: 'chronos-exclusion-path' });

			const removeBtn = row.createEl('button', {
				text: '×',
				cls: 'chronos-exclusion-remove'
			});
			removeBtn.addEventListener('click', async () => {
				this.plugin.settings.excludedFiles =
					this.plugin.settings.excludedFiles.filter(f => f !== file);
				await this.plugin.saveSettings();
				this.renderExcludedFiles(container);
			});
		}
	}

	/**
	 * Create a folder suggester input with autocomplete
	 */
	private createFolderSuggester(container: HTMLElement): { getValue: () => string; clear: () => void } {
		const wrapper = container.createDiv({ cls: 'chronos-suggester-container' });
		const input = wrapper.createEl('input', {
			type: 'text',
			placeholder: 'Start typing folder name...',
			cls: 'chronos-suggester-input'
		});

		let dropdown: HTMLElement | null = null;
		let selectedIndex = -1;

		const getFolders = (): string[] => {
			const folders: string[] = [];
			const files = this.app.vault.getAllLoadedFiles();
			for (const file of files) {
				if ('children' in file) {
					// It's a folder
					folders.push(file.path);
				}
			}
			return folders.sort();
		};

		const showDropdown = (matches: string[]) => {
			hideDropdown();
			if (matches.length === 0) return;

			dropdown = wrapper.createDiv({ cls: 'chronos-suggester-dropdown' });
			selectedIndex = -1;

			for (let i = 0; i < Math.min(matches.length, 10); i++) {
				const item = dropdown.createDiv({ cls: 'chronos-suggester-item' });
				item.createSpan({ text: '📁' });
				item.createSpan({ text: matches[i] });
				item.addEventListener('click', () => {
					input.value = matches[i];
					hideDropdown();
				});
				item.addEventListener('mouseenter', () => {
					updateSelection(i);
				});
			}
		};

		const hideDropdown = () => {
			if (dropdown) {
				dropdown.remove();
				dropdown = null;
				selectedIndex = -1;
			}
		};

		const updateSelection = (index: number) => {
			if (!dropdown) return;
			const items = dropdown.querySelectorAll('.chronos-suggester-item');
			items.forEach((item, i) => {
				item.toggleClass('is-selected', i === index);
			});
			selectedIndex = index;
		};

		input.addEventListener('input', () => {
			const query = input.value.toLowerCase();
			if (query.length === 0) {
				hideDropdown();
				return;
			}
			const folders = getFolders();
			const matches = folders.filter(f => f.toLowerCase().includes(query));
			showDropdown(matches);
		});

		input.addEventListener('keydown', (e) => {
			if (!dropdown) return;
			const items = dropdown.querySelectorAll('.chronos-suggester-item');

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				updateSelection(Math.min(selectedIndex + 1, items.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				updateSelection(Math.max(selectedIndex - 1, 0));
			} else if (e.key === 'Enter' && selectedIndex >= 0) {
				e.preventDefault();
				const folders = getFolders().filter(f => f.toLowerCase().includes(input.value.toLowerCase()));
				if (folders[selectedIndex]) {
					input.value = folders[selectedIndex];
					hideDropdown();
				}
			} else if (e.key === 'Escape') {
				hideDropdown();
			}
		});

		input.addEventListener('blur', () => {
			// Delay to allow click events on dropdown items
			setTimeout(hideDropdown, 150);
		});

		return {
			getValue: () => input.value,
			clear: () => { input.value = ''; hideDropdown(); }
		};
	}

	/**
	 * Create a file suggester input with autocomplete
	 */
	private createFileSuggester(container: HTMLElement): { getValue: () => string; clear: () => void } {
		const wrapper = container.createDiv({ cls: 'chronos-suggester-container' });
		const input = wrapper.createEl('input', {
			type: 'text',
			placeholder: 'Start typing file name...',
			cls: 'chronos-suggester-input'
		});

		let dropdown: HTMLElement | null = null;
		let selectedIndex = -1;

		const getFiles = (): string[] => {
			return this.app.vault.getMarkdownFiles().map(f => f.path).sort();
		};

		const showDropdown = (matches: string[]) => {
			hideDropdown();
			if (matches.length === 0) return;

			dropdown = wrapper.createDiv({ cls: 'chronos-suggester-dropdown' });
			selectedIndex = -1;

			for (let i = 0; i < Math.min(matches.length, 10); i++) {
				const item = dropdown.createDiv({ cls: 'chronos-suggester-item' });
				item.createSpan({ text: '📄' });
				item.createSpan({ text: matches[i] });
				item.addEventListener('click', () => {
					input.value = matches[i];
					hideDropdown();
				});
				item.addEventListener('mouseenter', () => {
					updateSelection(i);
				});
			}
		};

		const hideDropdown = () => {
			if (dropdown) {
				dropdown.remove();
				dropdown = null;
				selectedIndex = -1;
			}
		};

		const updateSelection = (index: number) => {
			if (!dropdown) return;
			const items = dropdown.querySelectorAll('.chronos-suggester-item');
			items.forEach((item, i) => {
				item.toggleClass('is-selected', i === index);
			});
			selectedIndex = index;
		};

		input.addEventListener('input', () => {
			const query = input.value.toLowerCase();
			if (query.length === 0) {
				hideDropdown();
				return;
			}
			const files = getFiles();
			const matches = files.filter(f => f.toLowerCase().includes(query));
			showDropdown(matches);
		});

		input.addEventListener('keydown', (e) => {
			if (!dropdown) return;
			const items = dropdown.querySelectorAll('.chronos-suggester-item');

			if (e.key === 'ArrowDown') {
				e.preventDefault();
				updateSelection(Math.min(selectedIndex + 1, items.length - 1));
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				updateSelection(Math.max(selectedIndex - 1, 0));
			} else if (e.key === 'Enter' && selectedIndex >= 0) {
				e.preventDefault();
				const files = getFiles().filter(f => f.toLowerCase().includes(input.value.toLowerCase()));
				if (files[selectedIndex]) {
					input.value = files[selectedIndex];
					hideDropdown();
				}
			} else if (e.key === 'Escape') {
				hideDropdown();
			}
		});

		input.addEventListener('blur', () => {
			// Delay to allow click events on dropdown items
			setTimeout(hideDropdown, 150);
		});

		return {
			getValue: () => input.value,
			clear: () => { input.value = ''; hideDropdown(); }
		};
	}

	/**
	 * Get synced tasks that would be affected by an exclusion
	 */
	private getAffectedSyncedTasks(path: string, isFolder: boolean): SyncedTaskInfo[] {
		const syncedTasks = this.plugin.syncManager.getSyncData().syncedTasks;
		const affected: SyncedTaskInfo[] = [];

		const normalizedPath = path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

		for (const taskInfo of Object.values(syncedTasks)) {
			const taskPath = taskInfo.filePath.replace(/\\/g, '/');

			if (isFolder) {
				// Check if task's file is in this folder
				if (taskPath.startsWith(normalizedPath + '/')) {
					affected.push(taskInfo);
				}
			} else {
				// Check if task's file matches exactly
				if (taskPath === normalizedPath) {
					affected.push(taskInfo);
				}
			}
		}

		return affected;
	}

	/**
	 * Delete Google Calendar events for excluded tasks
	 */
	private async deleteEventsForExcludedTasks(tasks: SyncedTaskInfo[]): Promise<void> {
		let deleted = 0;
		let failed = 0;

		for (const task of tasks) {
			try {
				await this.plugin.calendarApi.deleteEvent(task.calendarId, task.eventId);
				this.plugin.syncManager.removeSyncInfo(task.taskId);
				deleted++;
			} catch (error) {
				console.error(`Chronos: Failed to delete event for excluded task:`, error);
				failed++;
			}
		}

		if (deleted > 0) {
			new Notice(`Deleted ${deleted} event${deleted === 1 ? '' : 's'} from Google Calendar`);
		}
		if (failed > 0) {
			new Notice(`Failed to delete ${failed} event${failed === 1 ? '' : 's'}`);
		}
	}

	/**
	 * Remove sync tracking for tasks without deleting their events
	 */
	private severSyncForTasks(tasks: SyncedTaskInfo[]): void {
		for (const task of tasks) {
			this.plugin.syncManager.removeSyncInfo(task.taskId);
		}
		if (tasks.length > 0) {
			new Notice(`Stopped tracking ${tasks.length} task${tasks.length === 1 ? '' : 's'} (events kept in calendar)`);
		}
	}

	/**
	 * Get a detailed description for the current routing mode
	 */
	private getRoutingModeDescription(mode: 'preserve' | 'keepBoth' | 'freshStart'): string {
		switch (mode) {
			case 'preserve':
				return 'When a task\'s target calendar changes, its existing event will be moved to the new calendar. All details you added in Google Calendar (descriptions, attendees, custom reminders) will be preserved. Recommended for most users.';
			case 'keepBoth':
				return 'When a task\'s target calendar changes, the old event will remain on the original calendar and a new event will be created on the new calendar. This creates duplicates but ensures you never lose anything.';
			case 'freshStart':
				return 'When a task\'s target calendar changes, the old event will be deleted and a new event will be created on the new calendar. Any edits you made to the old event in Google Calendar (descriptions, attendees, etc.) will be lost.';
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

		// Scan all tasks (respecting exclusions)
		const allTasks = await this.plugin.taskParser.scanVault(
			true,
			this.plugin.settings.excludedFolders,
			this.plugin.settings.excludedFiles
		);

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
		moved: number;
		severed: number;
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
		const recentlyDeleted = this.plugin.syncManager.getRecentlyDeleted();

		// If both are empty, show empty state
		if (log.length === 0 && recentlyDeleted.length === 0) {
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

		// Sync History Section
		if (log.length > 0) {
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

		// Recently Deleted Section
		this.renderRecentlyDeletedSection(contentEl, recentlyDeleted);
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
				moved: 0,
				severed: 0,
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
				} else if (entry.type === 'move') {
					summary.moved++;
				} else if (entry.type === 'sever') {
					summary.severed++;
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
		if (summary.moved > 0) parts.push(`${summary.moved} moved`);
		if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`);
		if (summary.completed > 0) parts.push(`${summary.completed} completed`);
		if (summary.recreated > 0) parts.push(`${summary.recreated} recreated`);
		if (summary.severed > 0) parts.push(`${summary.severed} severed`);
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
			move: '📦',
			sever: '🔗',
			error: '❌',
		};

		const typeLabels: Record<string, string> = {
			create: 'Created',
			update: 'Updated',
			delete: 'Deleted',
			complete: 'Completed',
			recreate: 'Recreated',
			move: 'Moved',
			sever: 'Severed',
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

	/**
	 * Render the Recently Deleted section (Phase 5: Historical Recovery)
	 */
	private renderRecentlyDeletedSection(container: HTMLElement, records: DeletedEventRecord[]): void {
		// Section header
		const section = container.createDiv({ cls: 'chronos-recently-deleted-section' });

		const sectionHeader = section.createDiv({ cls: 'chronos-section-header chronos-clickable' });
		const arrow = sectionHeader.createSpan({ cls: 'chronos-collapse-arrow', text: '▶' });
		sectionHeader.createEl('h3', { text: `Recently Deleted (${records.length})` });

		const sectionContent = section.createDiv({ cls: 'chronos-recently-deleted-content chronos-collapsed' });

		// Toggle collapse
		sectionHeader.addEventListener('click', () => {
			const isCollapsed = sectionContent.hasClass('chronos-collapsed');
			if (isCollapsed) {
				sectionContent.removeClass('chronos-collapsed');
				arrow.setText('▼');
			} else {
				sectionContent.addClass('chronos-collapsed');
				arrow.setText('▶');
			}
		});

		if (records.length === 0) {
			sectionContent.createEl('p', {
				text: 'No recently deleted events.',
				cls: 'chronos-empty-section'
			});
			return;
		}

		// Description
		sectionContent.createEl('p', {
			text: 'Events you\'ve deleted in the last 30 days. You can restore them to create new calendar events.',
			cls: 'chronos-section-desc'
		});

		// Clear all button
		const clearAllContainer = sectionContent.createDiv({ cls: 'chronos-recently-deleted-actions' });
		const clearAllBtn = clearAllContainer.createEl('button', {
			text: 'Clear All',
			cls: 'chronos-clear-log-btn'
		});
		clearAllBtn.addEventListener('click', () => {
			// Clear all recently deleted
			for (const record of records) {
				this.plugin.syncManager.removeRecentlyDeleted(record.id);
			}
			this.plugin.saveSettings();
			this.onOpen(); // Refresh
		});

		// List of deleted events
		const list = sectionContent.createDiv({ cls: 'chronos-recently-deleted-list' });

		// Sort by deletedAt descending (most recent first)
		const sortedRecords = [...records].sort((a, b) =>
			new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime()
		);

		for (const record of sortedRecords) {
			this.renderDeletedRecord(list, record);
		}
	}

	/**
	 * Render a single deleted event record
	 */
	private renderDeletedRecord(container: HTMLElement, record: DeletedEventRecord): void {
		const item = container.createDiv({ cls: 'chronos-deleted-record' });

		// Title row
		const titleRow = item.createDiv({ cls: 'chronos-deleted-record-header' });
		titleRow.createSpan({
			text: '🗑️',
			cls: 'chronos-deleted-record-icon'
		});
		titleRow.createSpan({
			text: record.eventTitle,
			cls: 'chronos-deleted-record-title'
		});

		// Details
		const details = item.createDiv({ cls: 'chronos-deleted-record-details' });

		// Date and calendar
		const dateStr = record.eventDate;
		details.createDiv({
			text: `📅 ${dateStr} • 📆 ${record.calendarName}`,
			cls: 'chronos-deleted-record-info'
		});

		// Deleted timestamp with confirmation info
		const deletedAt = new Date(record.deletedAt);
		const deletedStr = deletedAt.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
		const confirmedByStr = record.confirmedBy === 'user' ? 'by you' : 'automatically';
		details.createDiv({
			text: `Deleted: ${deletedStr} (${confirmedByStr})`,
			cls: 'chronos-deleted-record-time'
		});

		// Actions
		const actions = item.createDiv({ cls: 'chronos-deleted-record-actions' });

		// Only show Restore button if we have a snapshot
		if (record.eventSnapshot) {
			const restoreBtn = actions.createEl('button', {
				text: 'Restore Event',
				cls: 'chronos-btn-primary chronos-btn-small'
			});
			restoreBtn.addEventListener('click', () => {
				this.openRestoreModal(record);
			});
		} else {
			actions.createEl('span', {
				text: 'No snapshot available',
				cls: 'chronos-deleted-record-no-snapshot'
			});
		}

		// Remove button
		const removeBtn = actions.createEl('button', {
			text: 'Remove',
			cls: 'chronos-btn-secondary chronos-btn-small'
		});
		removeBtn.addEventListener('click', () => {
			this.plugin.syncManager.removeRecentlyDeleted(record.id);
			this.plugin.saveSettings();
			this.onOpen(); // Refresh
		});
	}

	/**
	 * Open the EventRestoreModal for a deleted record
	 */
	private openRestoreModal(record: DeletedEventRecord): void {
		new EventRestoreModal(this.app, record, {
			onRestore: async (rec) => {
				await this.restoreEvent(rec);
			},
			onCancel: () => {
				// Nothing to do
			}
		}).open();
	}

	/**
	 * Restore a deleted event by creating a new event from its snapshot
	 */
	private async restoreEvent(record: DeletedEventRecord): Promise<void> {
		if (!record.eventSnapshot) {
			new Notice('Cannot restore: no event snapshot available');
			return;
		}

		const snapshot = record.eventSnapshot;

		try {
			// Build the event body for Google Calendar API
			const eventBody: any = {
				summary: snapshot.summary,
				start: snapshot.start,
				end: snapshot.end,
			};

			// Add optional fields if present
			if (snapshot.description) {
				eventBody.description = snapshot.description;
			}
			if (snapshot.location) {
				eventBody.location = snapshot.location;
			}
			if (snapshot.colorId) {
				eventBody.colorId = snapshot.colorId;
			}
			if (snapshot.reminders) {
				eventBody.reminders = snapshot.reminders;
			}
			// Note: We don't restore attendees automatically as they will receive new invitations
			// This is mentioned in the limitations warning

			// Create the event using the calendar API
			const createdEvent = await this.plugin.calendarApi.createEvent({
				task: {
					id: 'restore_' + Date.now(),
					title: snapshot.summary,
					date: snapshot.start.date || snapshot.start.dateTime?.split('T')[0] || '',
					time: snapshot.start.dateTime ? snapshot.start.dateTime.split('T')[1]?.substring(0, 5) : null,
					datetime: snapshot.start.dateTime ? new Date(snapshot.start.dateTime) : new Date(snapshot.start.date || ''),
					isAllDay: !snapshot.start.dateTime,
					filePath: '',
					lineNumber: 0,
					rawText: '',
					completed: false,
					reminderMinutes: snapshot.reminders?.overrides?.map(o => o.minutes),
				},
				calendarId: record.calendarId,
				durationMinutes: this.plugin.settings.defaultEventDurationMinutes,
				reminderMinutes: snapshot.reminders?.overrides?.map(o => o.minutes) || this.plugin.settings.defaultReminderMinutes,
				timeZone: this.plugin.getTimeZone(),
			});

			// Remove from recently deleted
			this.plugin.syncManager.removeRecentlyDeleted(record.id);
			await this.plugin.saveSettings();

			new Notice(`Restored "${record.eventTitle}" to ${record.calendarName}`);

			// Refresh the modal
			this.onOpen();
		} catch (error: any) {
			console.error('Failed to restore event:', error);
			new Notice(`Failed to restore event: ${error.message}`);
			throw error;
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal shown when events couldn't be rerouted due to inaccessible source calendar
 * Asks user if they want to recreate the events fresh on the new calendar
 */
class RerouteFailureModal extends Modal {
	plugin: ChronosPlugin;
	failedReroutes: { task: ChronosTask; oldCalendarId: string; newCalendarId: string; error: string }[];
	batchId: string;
	timeZone: string;

	constructor(
		app: App,
		plugin: ChronosPlugin,
		failedReroutes: { task: ChronosTask; oldCalendarId: string; newCalendarId: string; error: string }[],
		batchId: string,
		timeZone: string
	) {
		super(app);
		this.plugin = plugin;
		this.failedReroutes = failedReroutes;
		this.batchId = batchId;
		this.timeZone = timeZone;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-reroute-failure-modal');

		contentEl.createEl('h2', { text: '⚠️ Some Events Couldn\'t Be Moved' });

		const count = this.failedReroutes.length;
		contentEl.createEl('p', {
			text: `${count} event${count === 1 ? '' : 's'} couldn't be moved because the source calendar is no longer accessible (it may have been deleted).`
		});

		contentEl.createEl('p', {
			text: 'Would you like to create fresh copies of these events on the new calendar?',
			cls: 'chronos-reroute-question'
		});

		// List affected tasks
		const listEl = contentEl.createEl('ul', { cls: 'chronos-reroute-list' });
		for (const item of this.failedReroutes.slice(0, 10)) {
			listEl.createEl('li', { text: item.task.title });
		}
		if (this.failedReroutes.length > 10) {
			listEl.createEl('li', {
				text: `...and ${this.failedReroutes.length - 10} more`,
				cls: 'chronos-reroute-more'
			});
		}

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'chronos-reroute-buttons' });

		const noBtn = buttonContainer.createEl('button', {
			text: 'No, Skip These',
			cls: 'chronos-btn-secondary'
		});
		noBtn.addEventListener('click', () => {
			// Just remove them from sync tracking and close
			for (const item of this.failedReroutes) {
				const taskId = this.plugin.syncManager.generateTaskId(item.task);
				this.plugin.syncManager.removeSync(taskId);
			}
			this.plugin.saveSettings();
			new Notice(`Skipped ${count} event${count === 1 ? '' : 's'}. They will sync as new on next sync.`);
			this.close();
		});

		const yesBtn = buttonContainer.createEl('button', {
			text: 'Yes, Create Fresh',
			cls: 'chronos-btn-primary'
		});
		yesBtn.addEventListener('click', async () => {
			yesBtn.setAttr('disabled', 'true');
			yesBtn.setText('Creating...');

			let created = 0;
			let failed = 0;

			for (const item of this.failedReroutes) {
				try {
					const reminderMinutes = item.task.reminderMinutes || this.plugin.settings.defaultReminderMinutes;
					const event = await this.plugin.calendarApi.createEvent({
						task: item.task,
						calendarId: item.newCalendarId,
						durationMinutes: this.plugin.settings.defaultEventDurationMinutes,
						reminderMinutes,
						timeZone: this.timeZone,
					});
					this.plugin.syncManager.recordSync(item.task, event.id, item.newCalendarId);
					this.plugin.syncManager.logOperation({
						type: 'create',
						taskTitle: item.task.title,
						filePath: item.task.filePath,
						success: true,
						batchId: this.batchId,
					}, this.batchId);
					created++;
				} catch (error: any) {
					console.error('Failed to create fresh event:', item.task.title, error);
					this.plugin.syncManager.logOperation({
						type: 'create',
						taskTitle: item.task.title,
						filePath: item.task.filePath,
						success: false,
						errorMessage: error?.message || String(error),
						batchId: this.batchId,
					}, this.batchId);
					// Remove from sync tracking so it can be retried
					const taskId = this.plugin.syncManager.generateTaskId(item.task);
					this.plugin.syncManager.removeSync(taskId);
					failed++;
				}
			}

			await this.plugin.saveSettings();
			this.plugin.updateStatusBar();

			if (failed > 0) {
				new Notice(`Created ${created} event${created === 1 ? '' : 's'}, ${failed} failed`);
			} else {
				new Notice(`Created ${created} fresh event${created === 1 ? '' : 's'}`);
			}

			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// Clear the pending failures
		this.plugin.pendingRerouteFailures = [];
	}
}

/**
 * Modal shown when user changes their default calendar
 * Warns about the routing behavior and affected events
 */
class CalendarChangeWarningModal extends Modal {
	plugin: ChronosPlugin;
	oldCalName: string;
	newCalName: string;
	newCalId: string;
	affectedCount: number;
	onConfirm: () => void;
	onCancel: () => void;

	constructor(
		app: App,
		plugin: ChronosPlugin,
		oldCalName: string,
		newCalName: string,
		newCalId: string,
		affectedCount: number,
		onConfirm: () => void,
		onCancel: () => void
	) {
		super(app);
		this.plugin = plugin;
		this.oldCalName = oldCalName;
		this.newCalName = newCalName;
		this.newCalId = newCalId;
		this.affectedCount = affectedCount;
		this.onConfirm = onConfirm;
		this.onCancel = onCancel;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('chronos-calendar-change-modal');

		contentEl.createEl('h2', { text: '⚠️ Calendar Change - Confirm Your Routing Mode' });

		// Processing time warning (prominent at top)
		const processingWarning = contentEl.createDiv({ cls: 'chronos-processing-warning' });
		processingWarning.createEl('p', {
			text: `⏱️ PLEASE NOTE: Processing ${this.affectedCount} event${this.affectedCount === 1 ? '' : 's'} may take ${Math.ceil(this.affectedCount * 0.3)} - ${Math.ceil(this.affectedCount * 0.5)} seconds.`,
			cls: 'chronos-processing-time'
		});
		processingWarning.createEl('p', {
			text: 'The app may appear unresponsive during this time. Please wait for the completion notice.',
			cls: 'chronos-processing-note'
		});

		// What's changing
		const changeInfo = contentEl.createDiv({ cls: 'chronos-change-info' });
		changeInfo.createEl('p', {
			text: `You're switching from "${this.oldCalName}" to "${this.newCalName}".`
		});
		changeInfo.createEl('p', {
			text: `This will affect ${this.affectedCount} synced event${this.affectedCount === 1 ? '' : 's'}.`,
			cls: 'chronos-affected-count'
		});

		// Current mode explanation
		const mode = this.plugin.settings.eventRoutingBehavior;
		const modeSection = contentEl.createDiv({ cls: 'chronos-mode-section' });

		const modeNames: Record<string, string> = {
			preserve: '🔄 Preserve',
			keepBoth: '📋 Keep Both',
			freshStart: '🧹 Fresh Start'
		};

		const modeDescriptions: Record<string, string> = {
			preserve: `Each task's existing event will be MOVED from "${this.oldCalName}" to "${this.newCalName}". All details you added in Google Calendar (descriptions, attendees, custom reminders) will be preserved.`,
			keepBoth: `Each task's old event will STAY on "${this.oldCalName}", and a NEW copy will be created on "${this.newCalName}". This creates duplicates but ensures you never lose anything.`,
			freshStart: `Each task's old event will be DELETED from "${this.oldCalName}", and a NEW event will be created on "${this.newCalName}". Any edits you made to old events in Google Calendar will be lost.`
		};

		modeSection.createEl('p', {
			text: `Your current mode: ${modeNames[mode]}`,
			cls: 'chronos-current-mode'
		});

		contentEl.createEl('hr');

		modeSection.createEl('p', {
			text: modeDescriptions[mode],
			cls: 'chronos-mode-description'
		});

		// Other modes available
		const otherModes = contentEl.createDiv({ cls: 'chronos-other-modes' });
		otherModes.createEl('p', { text: 'Other modes available:', cls: 'chronos-other-modes-header' });

		const otherModesList = otherModes.createEl('ul');
		for (const [key, name] of Object.entries(modeNames)) {
			if (key !== mode) {
				const shortDesc: Record<string, string> = {
					preserve: 'Moves events, keeps all details',
					keepBoth: 'Creates duplicates but nothing is lost',
					freshStart: 'Deletes old events, loses any edits'
				};
				otherModesList.createEl('li', { text: `${name} - ${shortDesc[key]}` });
			}
		}

		contentEl.createEl('hr');

		// Hint to go back
		contentEl.createEl('p', {
			text: 'Hit Cancel to go back to settings to change your routing mode.',
			cls: 'chronos-cancel-hint'
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
			text: 'OK, Proceed',
			cls: 'chronos-btn-primary'
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
