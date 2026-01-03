import { App, Modal, Plugin, PluginSettingTab, Setting, Notice, MarkdownView } from 'obsidian';
import { GoogleAuth, TokenData } from './src/googleAuth';
import { TaskParser, ChronosTask } from './src/taskParser';
import { DateTimeModal } from './src/dateTimeModal';

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

	async onload() {
		await this.loadSettings();
		this.googleAuth = new GoogleAuth();
		this.taskParser = new TaskParser(this.app);

		// Add settings tab
		this.addSettingTab(new ChronosSettingTab(this.app, this));

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

	onunload() {
		// Clean up the auth server if it's still running
		this.googleAuth?.stopServer();
		console.log('Chronos plugin unloaded');
	}

	async loadSettings() {
		const data: ChronosData = await this.loadData() || { settings: DEFAULT_SETTINGS };
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
		this.tokens = data.tokens;
	}

	async saveSettings() {
		const data: ChronosData = {
			settings: this.settings,
			tokens: this.tokens,
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

		const taskList = contentEl.createDiv({ cls: 'chronos-task-list' });

		for (const task of this.tasks) {
			const taskDiv = taskList.createDiv({ cls: 'chronos-task-item' });

			// Task title
			taskDiv.createEl('div', {
				text: task.title,
				cls: 'chronos-task-title'
			});

			// Task metadata
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

			meta.createEl('span', {
				text: `📄 ${task.fileName}`,
				cls: 'chronos-task-file'
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
