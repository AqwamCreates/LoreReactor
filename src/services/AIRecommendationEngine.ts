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
    { key: 'Character Name', regex: /\{Character Name:\s*([\s\S]*?)\}/i },
    { key: 'Character Description', regex: /\{Character Description:\s*([\s\S]*?)\}/i },
    { key: 'Character First Message', regex: /\{Character First Message:\s*([\s\S]*?)\}/i },
    { key: 'Character System Prompt', regex: /\{Character System Prompt:\s*([\s\S]*?)\}/i },
    { key: 'Character Think Prompt', regex: /\{Character Think Prompt:\s*([\s\S]*?)\}/i },
    { key: 'Character Appearance Prompt', regex: /\{Character Appearance Prompt:\s*([\s\S]*?)\}/i },
    { key: 'Character Dialogue Prompt', regex: /\{Character Dialogue Prompt:\s*([\s\S]*?)\}/i },
    { key: 'Context Name', regex: /\{Context Name:\s*([\s\S]*?)\}/i },
    { key: 'Context Description', regex: /\{Context Description:\s*([\s\S]*?)\}/i },
    { key: 'Context Text Content', regex: /\{Context Text Content:\s*([\s\S]*?)\}/i },
    { key: 'Context Regular Expression Activation Trigger', regex: /\{Context Regular Expression Activation Trigger:\s*([\s\S]*?)\}/i },
    { key: 'Context Regular Expression Deactivation Trigger', regex: /\{Context Regular Expression Deactivation Trigger:\s*([\s\S]*?)\}/i },
    { key: 'Location Name', regex: /\{Location Name:\s*([\s\S]*?)\}/i },
    { key: 'Location Description', regex: /\{Location Description:\s*([\s\S]*?)\}/i },
    { key: 'Location Text Content', regex: /\{Location Text Content:\s*([\s\S]*?)\}/i },
    { key: 'Location Regular Expression Activation Trigger', regex: /\{Location Regular Expression Activation Trigger:\s*([\s\S]*?)\}/i },
];

const engine = new LanguageModelEngine();

/**
 * Calls the language model with the user's prompt and parses structured field output.
 */
export async function generateAIRecommendation(
    request: RecommendationRequest,
    abortSignal: AbortSignal,
): Promise<RecommendationResult> {
    const body = {
        prompt: request.prompt,
        n_predict: 2048,
        temperature: 0.9,
        top_p: 0.95,
        stream: false,
    };

    const result = await engine.generateCompletion(body, request.modelContext);

    if (!result.text || !result.text.trim()) {
        throw new Error('AI returned empty response.');
    }

    const parsed: Record<string, string> = {};
    for (const pattern of FIELD_PATTERNS) {
        const match = result.text.match(pattern.regex);
        if (match && match[1]) {
            parsed[pattern.key] = match[1].trim();
        }
    }

    return { rawText: result.text, parsed };
}