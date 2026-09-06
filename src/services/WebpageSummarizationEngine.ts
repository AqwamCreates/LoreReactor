// src/services/WebpageSummarizationEngine.ts
import type { BudgetStrategy } from '../types';
import { resolveModelContext } from '../utilities/modelContextResolver';
import { LanguageModelEngine, type LanguageModelContext } from './LanguageModelEngine';

const engine = new LanguageModelEngine();

const WEBPAGE_SUMMARIZE_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text and associated images, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, visual details from images, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const MULTI_PAGE_MERGE_PROMPT = "You are a context merger for roleplay lore. Given multiple webpage summaries from related sources, merge them into a single coherent reference document. Preserve all unique facts, resolve contradictions by noting both perspectives, eliminate redundancy, and maintain clear organization. Write in third person, present tense. Output ONLY the merged document with no preamble, no markdown, no quotes.";

export interface WebpageImageInfo {
    url: string;
    base64?: string;
    mimeType?: string;
}

/**
 * Summarizes a single webpage's extracted text content using the LLM.
 */
export async function summarizeWebpageContent(
    content: string,
    sourceUrl: string,
    modelContext: LanguageModelContext,
    images?: WebpageImageInfo[],
    strategy?: BudgetStrategy | null,
    runningModels?: Record<string, { isRunning: boolean; port?: number }>,
): Promise<string | null> {
    const ctx = resolveModelContext(modelContext, strategy, runningModels);
    const hasImages = images && images.length > 0;
    const basePrompt = hasImages ? WEBPAGE_SUMMARIZE_PROMPT : WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT;

    const prompt = `${basePrompt}\n\nSource: ${sourceUrl}\n\nWebpage content:\n${content}\n\nSummary:`;

    let imageData: { data: string; id: number }[] | undefined;
    if (hasImages) {
        imageData = [];
        let imageIdCounter = 100;
        for (const img of images) {
            if (img.base64) {
                imageData.push({ data: img.base64, id: imageIdCounter++ });
            }
        }
        if (imageData.length === 0) imageData = undefined;
    }

    const requestBody: any = {
        prompt,
        temperature: 1,
        stop: ['\n\n\n', '```', '\nSource:'],
    };

    if (imageData) {
        requestBody.image_data = imageData;
    }

    const result = await engine.generateCompletion(requestBody, ctx);
    return result.text || null;
}

/**
 * Merges multiple webpage summaries into a single coherent reference.
 */
export async function mergeWebpageSummaries(
    summaries: { url: string; summary: string }[],
    modelContext: LanguageModelContext,
    strategy?: BudgetStrategy | null,
    runningModels?: Record<string, { isRunning: boolean; port?: number }>,
): Promise<string | null> {
    const ctx = resolveModelContext(modelContext, strategy, runningModels);
    if (summaries.length === 0) return null;
    if (summaries.length === 1) return summaries[0].summary;

    const formatted = summaries.map((s, i) =>
        `Source ${i + 1} (${s.url}):\n${s.summary}`
    ).join('\n\n---\n\n');

    const prompt = `${MULTI_PAGE_MERGE_PROMPT}\n\nSources to merge:\n${formatted}\n\nMerged document:`;

    const requestBody: any = {
        prompt,
        temperature: 1,
        stop: ['\n\n\n\n', '```'],
    };

    const result = await engine.generateCompletion(requestBody, ctx);
    return result.text || null;
}