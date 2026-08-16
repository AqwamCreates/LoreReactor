// src/services/WebpageSummarizationEngine.ts
import { LanguageModelEngine, type LanguageModelContext } from './LanguageModelEngine';

const engine = new LanguageModelEngine();

const WEBPAGE_SUMMARIZE_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text and associated image descriptions, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, visual details from images, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT = "You are a concise summarizer for web content used as roleplay context. Given raw webpage text, produce a dense summary that preserves: key facts, names, dates, locations, relationships, definitions, and any lore-relevant details. Eliminate navigation text, ads, boilerplate, and redundancy. Write in third person, present tense. Output ONLY the summary with no preamble, no markdown, no quotes.";

const MULTI_PAGE_MERGE_PROMPT = "You are a context merger for roleplay lore. Given multiple webpage summaries from related sources, merge them into a single coherent reference document. Preserve all unique facts, resolve contradictions by noting both perspectives, eliminate redundancy, and maintain clear organization. Write in third person, present tense. Output ONLY the merged document with no preamble, no markdown, no quotes.";

export interface WebpageImageInfo {
    url: string;
    alt?: string;
    description?: string;
}

/**
 * Formats image info into a text block for inclusion in summarization prompts.
 */
function formatImageBlock(images: WebpageImageInfo[]): string {
    if (images.length === 0) return '';

    const entries = images.map((img, i) => {
        const parts: string[] = [`Image ${i + 1}: ${img.url}`];
        if (img.alt) parts.push(`Alt text: ${img.alt}`);
        if (img.description) parts.push(`Description: ${img.description}`);
        return parts.join('\n');
    });

    return `\n\nAssociated Images:\n${entries.join('\n\n')}`;
}

/**
 * Summarizes a single webpage's extracted text content using the LLM.
 * Optionally includes image metadata when images were extracted from the page.
 */
export async function summarizeWebpageContent(
    content: string,
    sourceUrl: string,
    modelContext: LanguageModelContext,
    maxTokens = 512,
    images?: WebpageImageInfo[]
): Promise<string | null> {
    const hasImages = images && images.length > 0;
    const basePrompt = hasImages ? WEBPAGE_SUMMARIZE_PROMPT : WEBPAGE_SUMMARIZE_TEXT_ONLY_PROMPT;
    const imageBlock = hasImages ? formatImageBlock(images) : '';

    const prompt = `${basePrompt}\n\nSource: ${sourceUrl}\n\nWebpage content:\n${content}${imageBlock}\n\nSummary:`;

    return engine.generateCompletion(prompt, modelContext, {
        maxTokens,
        temperature: 0.3,
        stop: ['\n\n\n', '```', '\nSource:'],
    });
}

/**
 * Merges multiple webpage summaries into a single coherent reference.
 * Used when a context entry has multiple URLs or search results.
 */
export async function mergeWebpageSummaries(
    summaries: { url: string; summary: string }[],
    modelContext: LanguageModelContext,
    maxTokens = 1024
): Promise<string | null> {
    if (summaries.length === 0) return null;
    if (summaries.length === 1) return summaries[0].summary;

    const formatted = summaries.map((s, i) =>
        `Source ${i + 1} (${s.url}):\n${s.summary}`
    ).join('\n\n---\n\n');

    const prompt = `${MULTI_PAGE_MERGE_PROMPT}\n\nSources to merge:\n${formatted}\n\nMerged document:`;

    return engine.generateCompletion(prompt, modelContext, {
        maxTokens,
        temperature: 0.3,
        stop: ['\n\n\n\n', '```'],
    });
}