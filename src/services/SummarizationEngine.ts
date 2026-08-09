// src/services/SummarizationEngine.ts
import type { ChatData, ChatMessage } from '../types';

const SUMMARIZE_SYSTEM_PROMPT = `You are a concise summarizer for roleplay chat messages. Given a single chat message, produce a brief summary that preserves: character actions, key dialogue points, emotional tone, and plot-relevant details. Output ONLY the summary text with no preamble, no markdown, no quotes.`;

/**
 * Generates a summary for a single chat message using the LLM.
 * Returns the summary string, or null if generation fails.
 */
export async function generateMessageSummary(
    message: ChatMessage,
    runtimePort: number,
    maxTokens: number = 256
): Promise<string | null> {
    const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\nMessage from ${message.character.name}:\n${message.textContent}\n\nSummary:`;

    try {
        const res = await fetch(`http://localhost:${runtimePort}/completion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt,
                n_predict: maxTokens,
                temperature: 0.3,
                stop: ['\n\n', '\nMessage from', '```'],
                stream: false,
            }),
        });

        if (!res.ok) return null;

        const data = await res.json();
        const content = data.content?.trim();
        if (!content || content.length === 0) return null;

        return content;
    } catch (e) {
        console.warn('Failed to generate message summary:', e);
        return null;
    }
}

/**
 * Generates summaries for all messages outside the sliding window
 * that don't already have a summary.
 * 
 * Returns a map of messageId → summary string.
 */
export async function generateMissingSummaries(
    chatData: ChatData,
    windowSize: number,
    runtimePort: number,
    maxTokens: number = 256
): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const history = chatData.chatMessageHistory;
    const cutoff = Math.max(0, history.length - windowSize);

    // Only summarize messages outside the window that lack summaries
    const toSummarize = history.slice(0, cutoff).filter(m => !m.textContentSummary);

    if (toSummarize.length === 0) return results;

    // Process sequentially to avoid overwhelming the server
    for (const msg of toSummarize) {
        const summary = await generateMessageSummary(msg, runtimePort, maxTokens);
        if (summary) {
            results.set(msg.id, summary);
        }
    }

    return results;
}

/**
 * Checks whether any summarization step should trigger based on token count.
 * Returns the first triggered step's config, or null if none triggered.
 */
export function checkTriggerThreshold(
    chatData: ChatData,
    currentTokenCount: number,
    modelContextLength: number
): { strategyType: string; slidingWindowSize?: number } | null {
    const profile = chatData.Profile;
    if (!profile?.summarizationSteps) return null;

    const enabledSteps = profile.summarizationSteps
        .filter(s => s.enabled)
        .sort((a, b) => a.order - b.order);

    for (const step of enabledSteps) {
        const threshold = step.triggerTokenThreshold ?? 0;

        // Auto threshold: trigger at 70% of context length
        const effectiveThreshold = threshold > 0
            ? threshold
            : Math.floor(modelContextLength * 0.7);

        if (currentTokenCount >= effectiveThreshold) {
            if (step.strategyType === 'Sliding Window Replace') {
                return {
                    strategyType: step.strategyType,
                    slidingWindowSize: step.slidingWindowSize,
                };
            }
            // Future: Periodic Compression, Recursive Summary
        }
    }

    return null;
}