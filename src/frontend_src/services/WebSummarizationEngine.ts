// frontend-src/services/WebpageSummarizationEngine.ts
import { getBudgetStrategyEngine } from './BudgetStrategyEngine';
import { getLanguageModelEngine } from './LanguageModelEngine';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { deriveDelimiters } from '../utilities/promptLogic';
import { buildRequestBody } from '../utilities/genericRequestBuilderLogic';
import type { Sampler, StopPattern } from '../types';

const WEBPAGE_SUMMARIZE_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text and associated images, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, visual details from images, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const MULTI_PAGE_MERGE_PROMPT = "You are a context merger for roleplay lore. Given multiple webpage summaries from related sources, merge them into a single coherent reference document. Preserve all unique facts, resolve contradictions by noting both perspectives, eliminate redundancy, and maintain clear organization. Write in third person, present tense. Output ONLY the merged document with no preamble, no markdown, no quotes.";

export interface WebpageImageInfo {
    url: string;
    base64?: string;
    mimeType?: string;
}

/**
 * Derive model-specific and profile-specific stop tokens for webpage summarization.
 */
function getWebpageStopTokens(stopPattern?: StopPattern): string[] {
    const activeModel = getLanguageModelEngine().getContext();
    const effectiveChatTemplateKey = activeModel?.chatTemplate;
    const resolvedChatTemplate = effectiveChatTemplateKey ? getModelTemplate(effectiveChatTemplateKey) : undefined;
    const delimiters = deriveDelimiters(resolvedChatTemplate);

    const templateStops = resolvedChatTemplate?.stopPatterns || [];
    const profileStops = stopPattern?.pattern ? [stopPattern.pattern] : [];

    const stops = [
        ...templateStops,
        ...profileStops,
        '\n\n\n',
        '```',
        '\nSource:',
        delimiters.turnEnd.trim(),
    ].filter(s => s.length > 0);

    return [...new Set(stops)];
}

/**
 * Summarizes a single webpage's extracted text content using the budget-aware engine.
 * Respects the active model's chat template stop tokens, the profile's stop pattern, and the provided sampler.
 */
export async function summarizeWebpageContent(
    content: string,
    sourceUrl: string,
    images?: WebpageImageInfo[],
    sampler?: Sampler,
    stopPattern?: StopPattern,
): Promise<string | null> {
    if (!content || !content.trim()) return null;

    const hasImages = images && images.length > 0;
    const basePrompt = hasImages ? WEBPAGE_SUMMARIZE_PROMPT : WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT;

    const stops = getWebpageStopTokens(stopPattern);
    const prompt = `${basePrompt}\n\nSource: ${sourceUrl}\n\nWebpage content:\n${content}\n\nSummary:`;

    const requestBody = buildRequestBody(prompt, 1024, sampler, stops);

    // Inject image data into the request body if images are present
    if (hasImages) {
        const imageData: { data: string; id: number }[] = [];
        let imageIdCounter = 100;
        for (const img of images!) {
            if (img.base64) {
                imageData.push({ data: img.base64, id: imageIdCounter++ });
            }
        }
        if (imageData.length > 0) {
            (requestBody as Record<string, unknown>).image_data = imageData;
        }
    }

    const bse = getBudgetStrategyEngine();
    const { text } = await bse.generateCompletion(requestBody);
    return text || null;
}

/**
 * Merges multiple webpage summaries into a single coherent reference.
 * Respects the active model's chat template stop tokens, the profile's stop pattern, and the provided sampler.
 */
export async function mergeWebpageSummaries(
    summaries: { url: string; summary: string }[],
    sampler?: Sampler,
    stopPattern?: StopPattern,
): Promise<string | null> {
    if (summaries.length === 0) return null;
    if (summaries.length === 1) return summaries[0].summary;

    const formatted = summaries.map((s, i) =>
        `Source ${i + 1} (${s.url}):\n${s.summary}`
    ).join('\n\n---\n\n');

    const stops = getWebpageStopTokens(stopPattern);
    const prompt = `${MULTI_PAGE_MERGE_PROMPT}\n\nSources to merge:\n${formatted}\n\nMerged document:`;

    const requestBody = buildRequestBody(prompt, 2048, sampler, stops);

    const bse = getBudgetStrategyEngine();
    const { text } = await bse.generateCompletion(requestBody);
    return text || null;
}