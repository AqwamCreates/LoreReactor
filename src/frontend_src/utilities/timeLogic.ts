/**
 * Unified duration and elapsed-time formatting utility.
 */
export function formatDuration(ms: number, options?: { verbose?: boolean; includeDays?: boolean }): string {
    const totalSeconds = Math.floor(Math.abs(ms) / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts: string[] = [];

    if (options?.includeDays && days > 0) {
        parts.push(options.verbose ? `${days} day${days !== 1 ? 's' : ''}` : `${days}d`);
    }
    if (hours > 0 || (options?.includeDays && days > 0)) {
        parts.push(options?.verbose ? `${hours} hour${hours !== 1 ? 's' : ''}` : `${hours}h`);
    }
    if (minutes > 0 || hours > 0 || (options?.includeDays && days > 0)) {
        parts.push(options?.verbose ? `${minutes} minute${minutes !== 1 ? 's' : ''}` : `${minutes}m`);
    }
    if (seconds > 0 || parts.length === 0) {
        parts.push(options?.verbose ? `${seconds} second${seconds !== 1 ? 's' : ''}` : `${seconds}s`);
    }

    return parts.join(options?.verbose ? ', ' : ' ');
}

export function formatTimeElapsedSentence(diffMs: number): string {
    if (diffMs <= 1000) return 'It has been just now since the last message in the real world.';
    const timeStr = formatDuration(diffMs, { verbose: true, includeDays: true });
    return `It has been ${timeStr} since the last message in the real world. I may or may not acknowledge the time elapsed. I will update relevant information according to this information. For example, a previous time must be subtracted or added with the elapsed time to get current time.`;
}