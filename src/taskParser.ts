import { App, TFile } from 'obsidian';
import { parseRecurrence } from './recurrenceParser';

/**
 * Represents a parsed task that's eligible for calendar sync
 */
export interface ChronosTask {
    /** Original full line of text */
    rawText: string;
    /** Task description (without emoji markers) */
    title: string;
    /** Due date in YYYY-MM-DD format */
    date: string;
    /** Time in HH:mm format, or null for all-day events */
    time: string | null;
    /** Full datetime as Date object (midnight for all-day events) */
    datetime: Date;
    /** Whether this is an all-day event (no time specified) */
    isAllDay: boolean;
    /** Source file path */
    filePath: string;
    /** Source file name (for event description) */
    fileName: string;
    /** Line number in file (1-indexed) */
    lineNumber: number;
    /** Whether task is completed */
    isCompleted: boolean;
    /** Any tags on the task */
    tags: string[];
    /** Custom reminder times in minutes (null = use defaults) */
    reminderMinutes: number[] | null;
    /** Custom duration in minutes (null = use default) */
    durationMinutes: number | null;
    /** Recurrence text (e.g., "every week") - null if not recurring */
    recurrenceText: string | null;
    /** Parsed RRULE for Google Calendar - null if not recurring or parse failed */
    recurrenceRule: string | null;
}

/**
 * Result of parsing a single line
 */
interface ParseResult {
    isTask: boolean;
    isCompleted: boolean;
    isNoSync: boolean;
    date: string | null;
    time: string | null;
    title: string;
    tags: string[];
    reminderMinutes: number[] | null;
    durationMinutes: number | null;
    recurrenceText: string | null;
}

// Regex patterns for Tasks plugin format + Chronos additions
const CHECKBOX_PATTERN = /^(\s*)?-\s*\[([ xX])\]\s*/;
const DATE_PATTERN = /📅\s*(\d{4}-\d{2}-\d{2})/;
const TIME_PATTERN = /⏰\s*(\d{1,2}:\d{2})/;
const NO_SYNC_PATTERN = /🚫/;
const COMPLETION_PATTERN = /✅\s*\d{4}-\d{2}-\d{2}/;
const TAG_PATTERN = /#[\w-]+/g;
// Reminder pattern: 🔔 followed by comma-separated numbers (e.g., 🔔 30,10 or 🔔 15)
const REMINDER_PATTERN = /🔔\s*([\d,\s]+)/;
// Duration pattern: ⏱️ followed by hours/minutes (e.g., ⏱️ 2h, ⏱️ 30m, ⏱️ 1h30m, ⏱️ 90)
const DURATION_PATTERN = /⏱️\s*(?:(\d+)h)?(?:(\d+)m?)?/;
// Recurrence pattern: 🔁 followed by recurrence text (e.g., 🔁 every week, 🔁 every 2 days)
// Captures everything after 🔁 until we hit another emoji marker or end of line
const RECURRENCE_PATTERN = /🔁\s*([^📅⏰🚫🔔⏱️✅⏫🔼🔽⏬➕🛫⏳#]+)/;

// Patterns to strip from title
const STRIP_PATTERNS = [
    /📅\s*\d{4}-\d{2}-\d{2}/g,      // Due date
    /⏰\s*\d{1,2}:\d{2}/g,           // Time
    /🚫/g,                           // No-sync marker
    /✅\s*\d{4}-\d{2}-\d{2}/g,       // Completion date
    /⏫|🔼|🔽|⏬/g,                   // Priority markers
    /🔁\s*[^📅⏰🚫🔔⏱️✅⏫🔼🔽⏬➕🛫⏳#]+/g,  // Recurrence
    /➕\s*\d{4}-\d{2}-\d{2}/g,       // Created date
    /🛫\s*\d{4}-\d{2}-\d{2}/g,       // Start date
    /⏳\s*\d{4}-\d{2}-\d{2}/g,       // Scheduled date
    /🔔\s*[\d,\s]+/g,                // Custom reminder times
    /⏱️\s*(?:\d+h)?(?:\d+m?)?/g,     // Custom duration
    /#[\w-]+/g,                       // Tags (e.g., #work, #personal)
];

export class TaskParser {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Parse a single line to extract task information
     */
    parseLine(line: string): ParseResult {
        const result: ParseResult = {
            isTask: false,
            isCompleted: false,
            isNoSync: false,
            date: null,
            time: null,
            title: '',
            tags: [],
            reminderMinutes: null,
            durationMinutes: null,
            recurrenceText: null,
        };

        // Check if it's a task (checkbox)
        const checkboxMatch = line.match(CHECKBOX_PATTERN);
        if (!checkboxMatch) {
            return result;
        }

        result.isTask = true;
        result.isCompleted = checkboxMatch[2].toLowerCase() === 'x';

        // Check for no-sync marker
        result.isNoSync = NO_SYNC_PATTERN.test(line);

        // Extract date
        const dateMatch = line.match(DATE_PATTERN);
        if (dateMatch) {
            result.date = dateMatch[1];
        }

        // Extract time (optional)
        const timeMatch = line.match(TIME_PATTERN);
        if (timeMatch) {
            // Normalize time to HH:mm format
            result.time = this.normalizeTime(timeMatch[1]);
        }

        // Extract custom reminder times (e.g., 🔔 30,10 or 🔔 15)
        const reminderMatch = line.match(REMINDER_PATTERN);
        if (reminderMatch) {
            const reminderStr = reminderMatch[1];
            const reminders = reminderStr
                .split(',')
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n) && n > 0);
            if (reminders.length > 0) {
                result.reminderMinutes = reminders;
            }
        }

        // Extract custom duration (e.g., ⏱️ 2h or ⏱️ 30m or ⏱️ 1h30m or ⏱️ 90)
        const durationMatch = line.match(DURATION_PATTERN);
        if (durationMatch) {
            const hours = durationMatch[1] ? parseInt(durationMatch[1], 10) : 0;
            const minutes = durationMatch[2] ? parseInt(durationMatch[2], 10) : 0;
            const totalMinutes = (hours * 60) + minutes;
            if (totalMinutes > 0) {
                result.durationMinutes = totalMinutes;
            }
        }

        // Extract recurrence (e.g., 🔁 every week or 🔁 every 2 days)
        const recurrenceMatch = line.match(RECURRENCE_PATTERN);
        if (recurrenceMatch) {
            result.recurrenceText = recurrenceMatch[1].trim();
        }

        // Extract tags
        const tagMatches = line.match(TAG_PATTERN);
        if (tagMatches) {
            result.tags = tagMatches;
        }

        // Build clean title
        let title = line.replace(CHECKBOX_PATTERN, '').trim();

        // Remove all emoji markers and metadata
        for (const pattern of STRIP_PATTERNS) {
            title = title.replace(pattern, '');
        }

        // Clean up extra whitespace
        result.title = title.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * Normalize time to HH:mm format (e.g., "9:30" -> "09:30")
     */
    private normalizeTime(time: string): string {
        const [hours, minutes] = time.split(':');
        return `${hours.padStart(2, '0')}:${minutes}`;
    }

    /**
     * Check if a file might contain tasks using metadataCache
     * This is a quick check to avoid reading files that definitely don't have tasks
     */
    private fileHasTasks(file: TFile): boolean {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache || !cache.listItems) {
            return false;
        }
        // Check if any list item has a task marker (checkbox)
        return cache.listItems.some(item => item.task !== undefined);
    }

    /**
     * Scan the entire vault for sync-eligible tasks
     * A task is eligible if:
     * - It has a checkbox (- [ ] or - [x])
     * - It is NOT completed (- [ ]) - unless includeCompleted is true
     * - It has a date (📅)
     * - It does NOT have a no-sync marker (🚫)
     * - Time (⏰) is optional - without it, creates all-day event
     *
     * Uses metadataCache to skip files without tasks (performance optimization)
     *
     * @param includeCompleted Whether to include completed tasks
     * @param excludedFolders Folders to skip (e.g., ["Templates", "Archive"])
     * @param excludedFiles Specific files to skip (e.g., ["Tasks/reference.md"])
     */
    async scanVault(
        includeCompleted: boolean = false,
        excludedFolders: string[] = [],
        excludedFiles: string[] = []
    ): Promise<ChronosTask[]> {
        const tasks: ChronosTask[] = [];
        const markdownFiles = this.app.vault.getMarkdownFiles();

        for (const file of markdownFiles) {
            // Check folder exclusions
            if (this.isExcludedByFolder(file.path, excludedFolders)) {
                continue;
            }

            // Check file exclusions
            if (this.isExcludedByFile(file.path, excludedFiles)) {
                continue;
            }

            // Quick check: skip files that don't have any tasks
            if (!this.fileHasTasks(file)) {
                continue;
            }
            const fileTasks = await this.scanFile(file, includeCompleted);
            tasks.push(...fileTasks);
        }

        // Sort by datetime (all-day events first within same day, then by time)
        tasks.sort((a, b) => {
            // Compare dates first
            const dateCompare = a.date.localeCompare(b.date);
            if (dateCompare !== 0) return dateCompare;

            // Same date: all-day events come first
            if (a.isAllDay && !b.isAllDay) return -1;
            if (!a.isAllDay && b.isAllDay) return 1;

            // Both have times: compare times
            if (a.time && b.time) {
                return a.time.localeCompare(b.time);
            }

            return 0;
        });

        return tasks;
    }

    /**
     * Check if a file path is within an excluded folder
     */
    private isExcludedByFolder(filePath: string, excludedFolders: string[]): boolean {
        // Normalize the file path for comparison
        const normalizedFilePath = this.normalizePath(filePath);

        for (const folder of excludedFolders) {
            // Normalize folder path
            const normalizedFolder = this.normalizePath(folder);

            // Check if file is in this folder or a subfolder
            if (normalizedFilePath.startsWith(normalizedFolder + '/')) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a file path matches an excluded file
     */
    private isExcludedByFile(filePath: string, excludedFiles: string[]): boolean {
        // Normalize the file path for comparison
        const normalizedFilePath = this.normalizePath(filePath);

        for (const excludedFile of excludedFiles) {
            const normalizedExcluded = this.normalizePath(excludedFile);
            if (normalizedFilePath === normalizedExcluded) {
                return true;
            }
        }
        return false;
    }

    /**
     * Normalize a path for consistent comparison
     * - Convert backslashes to forward slashes
     * - Remove leading/trailing slashes
     * - Trim whitespace
     */
    private normalizePath(path: string): string {
        return path
            .trim()
            .replace(/\\/g, '/')  // Backslashes to forward slashes
            .replace(/^\/+|\/+$/g, '');  // Remove leading/trailing slashes
    }

    /**
     * Scan a single file for sync-eligible tasks
     */
    async scanFile(file: TFile, includeCompleted: boolean = false): Promise<ChronosTask[]> {
        const tasks: ChronosTask[] = [];
        const content = await this.app.vault.read(file);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const parsed = this.parseLine(line);

            // Must be a task with a date, NOT marked as no-sync
            // Include completed tasks only if includeCompleted is true
            const completionCheck = includeCompleted || !parsed.isCompleted;
            if (parsed.isTask && completionCheck && parsed.date && !parsed.isNoSync) {
                const isAllDay = parsed.time === null;
                const datetime = this.parseDateTime(parsed.date, parsed.time);

                if (datetime) {
                    // Parse recurrence to RRULE if present
                    let recurrenceRule: string | null = null;
                    if (parsed.recurrenceText) {
                        const recResult = parseRecurrence(parsed.recurrenceText);
                        if (recResult.success && recResult.rrule) {
                            recurrenceRule = recResult.rrule;
                        }
                        // If parse failed, recurrenceRule stays null - task syncs as non-recurring
                    }

                    tasks.push({
                        rawText: line,
                        title: parsed.title,
                        date: parsed.date,
                        time: parsed.time,
                        datetime: datetime,
                        isAllDay: isAllDay,
                        filePath: file.path,
                        fileName: file.basename,
                        lineNumber: i + 1, // 1-indexed
                        isCompleted: parsed.isCompleted,
                        tags: parsed.tags,
                        reminderMinutes: parsed.reminderMinutes,
                        durationMinutes: parsed.durationMinutes,
                        recurrenceText: parsed.recurrenceText,
                        recurrenceRule: recurrenceRule,
                    });
                }
            }
        }

        return tasks;
    }

    /**
     * Parse date and time strings into a Date object
     * For all-day events (time is null), returns midnight
     */
    private parseDateTime(date: string, time: string | null): Date | null {
        try {
            const [year, month, day] = date.split('-').map(Number);

            if (time) {
                const [hours, minutes] = time.split(':').map(Number);
                const dt = new Date(year, month - 1, day, hours, minutes);
                if (isNaN(dt.getTime())) return null;
                return dt;
            } else {
                // All-day event: use midnight
                const dt = new Date(year, month - 1, day, 0, 0, 0);
                if (isNaN(dt.getTime())) return null;
                return dt;
            }
        } catch {
            return null;
        }
    }

    /**
     * Get a summary of tasks for display
     */
    getTaskSummary(tasks: ChronosTask[]): string {
        if (tasks.length === 0) {
            return 'No sync-eligible tasks found.\n\nTasks need:\n- Uncompleted checkbox (- [ ])\n- Date (📅 YYYY-MM-DD)\n- Optional: Time (⏰ HH:mm)\n\nUse 🚫 to exclude a task from sync.';
        }

        const lines: string[] = [
            `Found ${tasks.length} task${tasks.length === 1 ? '' : 's'} to sync:`,
            ''
        ];

        for (const task of tasks) {
            const dateStr = task.datetime.toLocaleDateString();
            if (task.isAllDay) {
                lines.push(`- ${task.title}`);
                lines.push(`  ${dateStr} (all day) - ${task.fileName}`);
            } else {
                const timeStr = task.datetime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                lines.push(`- ${task.title}`);
                lines.push(`  ${dateStr} at ${timeStr} - ${task.fileName}`);
            }
        }

        return lines.join('\n');
    }
}
