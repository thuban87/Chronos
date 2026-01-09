/**
 * Parses Tasks plugin recurrence syntax and converts to Google Calendar RRULE format
 */

// Day name mappings to RRULE day codes
const DAY_MAP: Record<string, string> = {
    'sunday': 'SU',
    'monday': 'MO',
    'tuesday': 'TU',
    'wednesday': 'WE',
    'thursday': 'TH',
    'friday': 'FR',
    'saturday': 'SA',
    // Short forms
    'sun': 'SU',
    'mon': 'MO',
    'tue': 'TU',
    'wed': 'WE',
    'thu': 'TH',
    'fri': 'FR',
    'sat': 'SA',
};

// Frequency word mappings to RRULE frequency
const FREQ_MAP: Record<string, string> = {
    'day': 'DAILY',
    'days': 'DAILY',
    'daily': 'DAILY',
    'week': 'WEEKLY',
    'weeks': 'WEEKLY',
    'weekly': 'WEEKLY',
    'month': 'MONTHLY',
    'months': 'MONTHLY',
    'monthly': 'MONTHLY',
    'year': 'YEARLY',
    'years': 'YEARLY',
    'yearly': 'YEARLY',
    'annually': 'YEARLY',
};

export interface RecurrenceResult {
    /** The RRULE string (without "RRULE:" prefix) */
    rrule: string | null;
    /** Human-readable description for display */
    description: string | null;
    /** Whether parsing succeeded */
    success: boolean;
    /** Error message if parsing failed */
    error?: string;
}

/**
 * Parse Tasks plugin recurrence text into Google RRULE
 * @param recurrenceText The text after 🔁 (e.g., "every week", "every 2 days")
 */
export function parseRecurrence(recurrenceText: string): RecurrenceResult {
    if (!recurrenceText || !recurrenceText.trim()) {
        return { rrule: null, description: null, success: false, error: 'Empty recurrence' };
    }

    const text = recurrenceText.toLowerCase().trim();

    // Remove "when done" suffix if present (we don't support completion-triggered recurrence)
    const cleanText = text.replace(/\s*when\s+done\s*$/i, '').trim();

    // Try: every [weekday(s)]
    const weekdayResult = parseWeekdays(cleanText);
    if (weekdayResult.success) {
        return weekdayResult;
    }

    // Try: every [N] [frequency]
    const intervalResult = parseIntervalFrequency(cleanText);
    if (intervalResult.success) {
        return intervalResult;
    }

    // Try: every [frequency] (no interval)
    const simpleResult = parseSimpleFrequency(cleanText);
    if (simpleResult.success) {
        return simpleResult;
    }

    return {
        rrule: null,
        description: null,
        success: false,
        error: `Unrecognized recurrence pattern: "${recurrenceText}"`
    };
}

/**
 * Parse "every monday" or "every monday, wednesday, friday"
 */
function parseWeekdays(text: string): RecurrenceResult {
    // Match: every [day], [day], ...
    const match = text.match(/^every\s+(.+)$/);
    if (!match) {
        return { rrule: null, description: null, success: false };
    }

    const daysPart = match[1];
    // Split on commas, "and", or whitespace
    const dayNames = daysPart.split(/[,\s]+(?:and\s+)?/).filter(d => d.length > 0 && d !== 'and');

    const rruleDays: string[] = [];
    const readableDays: string[] = [];

    for (const dayName of dayNames) {
        const rruleDay = DAY_MAP[dayName];
        if (rruleDay) {
            rruleDays.push(rruleDay);
            // Capitalize first letter for readable version
            readableDays.push(dayName.charAt(0).toUpperCase() + dayName.slice(1));
        }
    }

    if (rruleDays.length > 0 && rruleDays.length === dayNames.length) {
        // All parts were valid day names
        const rrule = `FREQ=WEEKLY;BYDAY=${rruleDays.join(',')}`;
        const description = `Weekly on ${readableDays.join(', ')}`;
        return { rrule, description, success: true };
    }

    return { rrule: null, description: null, success: false };
}

/**
 * Parse "every 2 weeks" or "every 3 months"
 */
function parseIntervalFrequency(text: string): RecurrenceResult {
    const match = text.match(/^every\s+(\d+)\s+(\w+)$/);
    if (!match) {
        return { rrule: null, description: null, success: false };
    }

    const interval = parseInt(match[1], 10);
    const freqWord = match[2];
    const freq = FREQ_MAP[freqWord];

    if (freq && interval > 0) {
        const rrule = interval === 1
            ? `FREQ=${freq}`
            : `FREQ=${freq};INTERVAL=${interval}`;
        const description = interval === 1
            ? `Every ${freqWord}`
            : `Every ${interval} ${freqWord}`;
        return { rrule, description, success: true };
    }

    return { rrule: null, description: null, success: false };
}

/**
 * Parse "every day" or "every week"
 */
function parseSimpleFrequency(text: string): RecurrenceResult {
    const match = text.match(/^every\s+(\w+)$/);
    if (!match) {
        return { rrule: null, description: null, success: false };
    }

    const freqWord = match[1];
    const freq = FREQ_MAP[freqWord];

    if (freq) {
        const rrule = `FREQ=${freq}`;
        const description = `Every ${freqWord}`;
        return { rrule, description, success: true };
    }

    return { rrule: null, description: null, success: false };
}

/**
 * Get a human-readable description of an RRULE
 * Used for displaying recurrence in UI
 */
export function describeRRule(rrule: string): string {
    if (!rrule) return '';

    // Parse the RRULE components
    const parts = rrule.split(';');
    const components: Record<string, string> = {};

    for (const part of parts) {
        const [key, value] = part.split('=');
        if (key && value) {
            components[key] = value;
        }
    }

    const freq = components['FREQ'];
    const interval = components['INTERVAL'] ? parseInt(components['INTERVAL'], 10) : 1;
    const byDay = components['BYDAY'];

    if (byDay) {
        // Weekly with specific days
        const dayMap: Record<string, string> = {
            'SU': 'Sun', 'MO': 'Mon', 'TU': 'Tue', 'WE': 'Wed',
            'TH': 'Thu', 'FR': 'Fri', 'SA': 'Sat'
        };
        const days = byDay.split(',').map(d => dayMap[d] || d).join(', ');
        return `Weekly on ${days}`;
    }

    const freqNames: Record<string, string> = {
        'DAILY': 'day',
        'WEEKLY': 'week',
        'MONTHLY': 'month',
        'YEARLY': 'year'
    };

    const freqName = freqNames[freq] || freq.toLowerCase();

    if (interval === 1) {
        return `Every ${freqName}`;
    } else {
        return `Every ${interval} ${freqName}s`;
    }
}
