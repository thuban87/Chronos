import { App, TFile } from 'obsidian';

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
}

// Regex patterns for Tasks plugin format + Chronos additions
const CHECKBOX_PATTERN = /^(\s*)?-\s*\[([ xX])\]\s*/;
const DATE_PATTERN = /📅\s*(\d{4}-\d{2}-\d{2})/;
const TIME_PATTERN = /⏰\s*(\d{1,2}:\d{2})/;
const NO_SYNC_PATTERN = /🚫/;
const COMPLETION_PATTERN = /✅\s*\d{4}-\d{2}-\d{2}/;
const TAG_PATTERN = /#[\w-]+/g;

// Patterns to strip from title
const STRIP_PATTERNS = [
    /📅\s*\d{4}-\d{2}-\d{2}/g,      // Due date
    /⏰\s*\d{1,2}:\d{2}/g,           // Time
    /🚫/g,                           // No-sync marker
    /✅\s*\d{4}-\d{2}-\d{2}/g,       // Completion date
    /⏫|🔼|🔽|⏬/g,                   // Priority markers
    /🔁\s*[^\s📅⏰]*/g,              // Recurrence
    /➕\s*\d{4}-\d{2}-\d{2}/g,       // Created date
    /🛫\s*\d{4}-\d{2}-\d{2}/g,       // Start date
    /⏳\s*\d{4}-\d{2}-\d{2}/g,       // Scheduled date
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
     */
    async scanVault(includeCompleted: boolean = false): Promise<ChronosTask[]> {
        const tasks: ChronosTask[] = [];
        const markdownFiles = this.app.vault.getMarkdownFiles();

        for (const file of markdownFiles) {
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
