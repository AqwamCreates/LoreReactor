// src/services/StreamingAccumulator.ts

/**
 * Manages the two-phase display text accumulation during streaming generation.
 *
 * Streaming output goes through two states:
 * - Live: tokens received since the last tool resolution or stream start
 * - Committed: display text that has been finalized (either by tool replacement
 *   or by stream completion)
 *
 * The displayed text at any point is committed + live. When a tool invocation
 * resolves, live text is folded into committed with replacements applied,
 * and live resets to empty for the next segment.
 */
export class StreamingAccumulator {
    private committed = '';
    private live = '';
    private lastRawLength = 0;

    /**
     * Initializes the accumulator with pre-existing text for resume mode.
     * Sets committed text and lastRawLength so new stream tokens append correctly.
     */
    initializeWithExisting(text: string): void {
        this.committed = text;
        this.live = '';
        this.lastRawLength = text.length;
    }

    /**
     * Processes a new raw chunk from the stream and returns the full display text.
     *
     * @param rawFullText - The complete raw text from the stream so far (not just the delta)
     * @param displayChunk - The display-safe portion of the new delta (after tool parsing)
     * @returns The concatenated display text (committed + updated live)
     */
    appendChunk(rawFullText: string, displayChunk: string): string {
        this.live += displayChunk;
        this.lastRawLength = rawFullText.length;
        return this.getDisplayText();
    }

    /**
     * Commits the current live text into the permanent buffer and resets live state.
     * Called after a tool invocation has been resolved and its replacement applied.
     *
     * @param replacementText - Optional text to append to committed instead of live
     *                          (e.g., calculator result that should appear inline)
     */
    commitLive(replacementText?: string): void {
        this.committed += replacementText ?? this.live;
        this.live = '';
        this.lastRawLength = 0;
    }

    /**
     * Appends arbitrary text directly to the committed buffer.
     * Used for tool display replacements that should be permanent.
     */
    appendCommitted(text: string): void {
        this.committed += text;
    }

    /** Returns the current display text: committed + live. */
    getDisplayText(): string {
        return this.committed + this.live;
    }

    /** Returns only the committed (finalized) portion. */
    getCommittedText(): string {
        return this.committed;
    }

    /** Returns the length of raw text processed so far, for delta computation. */
    getLastRawLength(): number {
        return this.lastRawLength;
    }

    /** Resets all state. Called when resuming after tool resolution. */
    reset(): void {
        this.committed = '';
        this.live = '';
        this.lastRawLength = 0;
    }

    /** Soft reset: keeps committed text but clears live and raw tracking. */
    resetLive(): void {
        this.live = '';
        this.lastRawLength = 0;
    }
}