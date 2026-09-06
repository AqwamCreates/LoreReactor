// src/services/AIRecommendationEngine.ts
import { LanguageModelEngine, type LanguageModelContext } from './LanguageModelEngine';

export interface RecommendationRequest {
    prompt: string;
    modelContext: LanguageModelContext;
}

export interface RecommendationResult {
    rawText: string;
    parsed: Record<string, string>;
}

const FIELD_PATTERNS: { key: string; regex: RegExp }[] = [
    { key: 'Character Name', regex: /<<<Character Name:\s*([\s\S]*?)>>>/i },
    { key: 'Character Description', regex: /<<<Character Description:\s*([\s\S]*?)>>>/i },
    { key: 'Character First Message', regex: /<<<Character First Message:\s*([\s\S]*?)>>>/i },
    { key: 'Character System Prompt', regex: /<<<Character System Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Think Prompt', regex: /<<<Character Think Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Appearance Prompt', regex: /<<<Character Appearance Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Character Dialogue Prompt', regex: /<<<Character Dialogue Prompt:\s*([\s\S]*?)>>>/i },
    { key: 'Context Name', regex: /<<<Context Name:\s*([\s\S]*?)>>>/i },
    { key: 'Context Description', regex: /<<<Context Description:\s*([\s\S]*?)>>>/i },
    { key: 'Context Text Content', regex: /<<<Context Text Content:\s*([\s\S]*?)>>>/i },
    { key: 'Context Regular Expression Activation Trigger', regex: /<<<Context Regular Expression Activation Trigger:\s*([\s\S]*?)>>>/i },
    { key: 'Context Regular Expression Deactivation Trigger', regex: /<<<Context Regular Expression Deactivation Trigger:\s*([\s\S]*?)>>>/i },
    { key: 'Location Name', regex: /<<<Location Name:\s*([\s\S]*?)>>>/i },
    { key: 'Location Description', regex: /<<<Location Description:\s*([\s\S]*?)>>>/i },
    { key: 'Location Text Content', regex: /<<<Location Text Content:\s*([\s\S]*?)>>>/i },
    { key: 'Location Regular Expression Activation Trigger', regex: /<<<Location Regular Expression Activation Trigger:\s*([\s\S]*?)>>>/i },
];

const engine = new LanguageModelEngine();

/**
 * Parses structured {Field Name: content} blocks from raw AI output.
 */
function parseRecommendationFields(rawText: string): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const pattern of FIELD_PATTERNS) {
        const match = rawText.match(pattern.regex);
        if (match && match[1]) {
            const value = match[1].trim();
            if (value.length > 0) {
                parsed[pattern.key] = value;
            }
        }
    }
    return parsed;
}

/**
 * Calls the language model using streaming (same path as roleplay)
 * and parses structured field output from the accumulated response.
 */
export async function generateAIRecommendation(
    request: RecommendationRequest,
    abortSignal: AbortSignal,
): Promise<RecommendationResult> {
    // Build a request body compatible with generateStream's extractFromRequestBody
    const requestBody = {
        prompt: request.prompt,
        n_predict: 4096,
        temperature: 0.9,
        top_p: 0.95,
        stream: true,
    };

    const abortController = new AbortController();

    // Link external signal to our internal controller
    const onAbort = () => abortController.abort();
    abortSignal.addEventListener('abort', onAbort);

    try {
        const result = await engine.generateStream(
            requestBody,
            abortController,
            undefined, // no per-token callbacks needed
            request.modelContext,
            0, // no paragraph limit
            undefined, // no existing text
        );

        const rawText = result.text || '';

        if (!rawText.trim()) {
            throw new Error('AI returned empty response.');
        }

        const parsed = parseRecommendationFields(rawText);

        return { rawText, parsed };
    } finally {
        abortSignal.removeEventListener('abort', onAbort);
    }
}