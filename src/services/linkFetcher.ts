// src/services/linkFetcher.ts
import { estimateTokens, type LanguageModelContext } from './LanguageModelEngine';
import { summarizeWebpageContent, mergeWebpageSummaries, type WebpageImageInfo } from './WebpageSummarizationEngine';
import { findWebpageByUrl, saveRawWebpage } from '../hooks/storage';
import type { searchEngine } from '../types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CACHE_TIME_TO_LIVE_MS = 5 * 60 * 1000;
const MAX_FETCH_DEPTH = 3;
const FETCH_TIMEOUT_MS = 10000;
const IMAGE_FETCH_TIMEOUT_MS = 5000;

interface FetchResult {
    url: string;
    content: string;
    links: string[];
    images: WebpageImageInfo[];
    fetchedAt: number;
    tokenEstimate: number;
    error?: string;
}

const fetchCache = new Map<string, FetchResult>();

function getCacheKey(url: string, mode: string): string {
    return `${mode}::${url}`;
}

/**
 * Constructs a search engine URL from search terms.
 */
export function buildSearchUrl(terms: string[], engine: searchEngine): string {
    const query = encodeURIComponent(terms.join(' '));
    switch (engine) {
        case 'Google':
            return `https://www.google.com/search?q=${query}`;
        case 'Bing':
            return `https://www.bing.com/search?q=${query}`;
        case 'DuckDuckGo':
            return `https://html.duckduckgo.com/html/?q=${query}`;
        case 'Yandex':
            return `https://yandex.com/search/?text=${query}`;
        case 'Baidu':
            return `https://www.baidu.com/s?wd=${query}`;
        default:
            return `https://www.google.com/search?q=${query}`;
    }
}

/**
 * Cleans an image URL by stripping everything after the file extension.
 * Handles Fandom/Wikipedia-style URLs where clicking an image redirects
 * to a wiki article page instead of serving the raw image.
 * e.g., "https://static.wikia.nocookie.net/lore/images/a/ab/Dragon.png/revision/latest?cb=20240101"
 *     → "https://static.wikia.nocookie.net/lore/images/a/ab/Dragon.png"
 */
function cleanImageUrl(url: string): string {
    const extensionMatch = url.match(/(\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?))/i);
    if (extensionMatch && extensionMatch.index !== undefined) {
        return url.substring(0, extensionMatch.index + extensionMatch[1].length);
    }
    return url;
}

/**
 * Downloads an image from a URL and returns it as base64 + mime type.
 * Returns null if the fetch fails or the response isn't an image.
 */
async function downloadImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

        const response = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LoreReactor/1.0 (Context Fetcher)',
                'Accept': 'image/*',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) return null;

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return null;

        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                resolve(result.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });

        return { base64, mimeType: contentType.split(';')[0].trim() };
    } catch {
        return null;
    }
}

function parseHtml(html: string, baseUrl: string): { text: string; links: string[]; imageUrls: string[] } {
    const linkRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
        links.push(match[1]);
    }

    // Extract image URLs from <img> tags
    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const imageUrls: string[] = [];
    let imgMatch: RegExpExecArray | null;

    while ((imgMatch = imgRegex.exec(html)) !== null) {
        let imgUrl = imgMatch[1];

        // Resolve relative URLs against base
        if (!imgUrl.startsWith('http')) {
            try {
                imgUrl = new URL(imgUrl, baseUrl).href;
            } catch {
                continue;
            }
        }

        // Skip tracking pixels, icons, and data URIs
        if (imgUrl.startsWith('data:') || imgUrl.includes('pixel') || imgUrl.includes('spacer') || imgUrl.includes('1x1') || imgUrl.includes('blank.gif')) {
            continue;
        }

        // Clean URL — strip query params after file extension
        const cleaned = cleanImageUrl(imgUrl);
        if (!imageUrls.includes(cleaned)) {
            imageUrls.push(cleaned);
        }
    }

    let cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '');

    cleaned = cleaned.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n');
    cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
    cleaned = cleaned.replace(/<[^>]+>/g, '');

    cleaned = cleaned
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

    cleaned = cleaned.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

    return { text: cleaned, links, imageUrls };
}

/**
 * Extract mode: keeps only structured content (headings, lists, definitions, key-value).
 */
function extractStructuredContent(text: string): string {
    const lines = text.split('\n');
    const kept: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (/^(#{1,6}\s|[A-Z][A-Z\s]{2,}:?\s*$|\d+[\.\)]\s)/.test(trimmed)) {
            kept.push(trimmed);
            continue;
        }

        if (/^[-•*]\s/.test(trimmed)) {
            kept.push(trimmed);
            continue;
        }

        if (/^[^:—=]{1,60}[:—=]/.test(trimmed) && trimmed.length < 300) {
            kept.push(trimmed);
            continue;
        }

        if (/^\d+[\.\)]\s/.test(trimmed)) {
            kept.push(trimmed);
            continue;
        }

        if (trimmed.length > 200) continue;

        kept.push(trimmed);
    }

    const result = kept.join('\n');
    return result || '[No structured content extracted]';
}

async function fetchSingleUrl(url: string, cacheTimeToLiveMs: number, fetchMode: string, includeImages: boolean): Promise<FetchResult> {
    const now = Date.now();

    // Layer 1: In-memory cache
    const cacheKey = getCacheKey(url, fetchMode);
    const cached = fetchCache.get(cacheKey);
    if (cached && (now - cached.fetchedAt) < cacheTimeToLiveMs) {
        return cached;
    }

    // Layer 2: Persistent disk cache
    if (cacheTimeToLiveMs > 0) {
        try {
            const diskCached = await findWebpageByUrl(url);
            if (diskCached && (now - diskCached.lastUpdatedTimestamp) < cacheTimeToLiveMs) {
                const result: FetchResult = {
                    url,
                    content: diskCached.content,
                    links: [],
                    images: [],
                    fetchedAt: diskCached.lastUpdatedTimestamp,
                    tokenEstimate: estimateTokens(diskCached.content),
                };
                fetchCache.set(cacheKey, result);
                return result;
            }
        } catch (e) {
            console.warn(`Failed to check disk cache for ${url}:`, e);
        }
    }

    // Layer 3: Network fetch
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'LoreReactor/1.0 (Context Fetcher)',
                'Accept': 'text/html,text/plain,*/*',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const rawBody = await response.text();

        let content: string;
        let links: string[] = [];
        let imageUrls: string[] = [];

        if (contentType.includes('text/html')) {
            const parsed = parseHtml(rawBody, url);
            content = parsed.text;
            links = parsed.links;
            imageUrls = parsed.imageUrls;
        } else {
            content = rawBody;
        }

        // Download actual image binaries as base64
        let images: WebpageImageInfo[] = [];
        if (includeImages && imageUrls.length > 0) {
            const downloadPromises = imageUrls.map(async (imgUrl) => {
                const downloaded = await downloadImageAsBase64(imgUrl);
                if (downloaded) {
                    return {
                        url: imgUrl,
                        base64: downloaded.base64,
                        mimeType: downloaded.mimeType,
                    } as WebpageImageInfo;
                }
                return null;
            });

            const downloadResults = await Promise.all(downloadPromises);
            images = downloadResults.filter((r): r is WebpageImageInfo => r !== null);
        }

        const result: FetchResult = {
            url,
            content,
            links,
            images,
            fetchedAt: now,
            tokenEstimate: estimateTokens(content),
        };

        fetchCache.set(cacheKey, result);

        // Save to persistent disk cache (text content only — images are re-downloaded on cache miss)
        try {
            await saveRawWebpage({
                id: uuidv4(),
                name: url,
                url,
                content,
                firstCreatedTimestamp: now,
                lastUpdatedTimestamp: now,
            });
        } catch (e) {
            console.warn(`Failed to persist webpage cache for ${url}:`, e);
        }

        return result;

    } catch (e) {
        const errorMsg = (e as Error).name === 'AbortError'
            ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
            : (e as Error).message;

        console.warn(`Failed to fetch ${url}: ${errorMsg}`);

        const errorResult: FetchResult = {
            url,
            content: '',
            links: [],
            images: [],
            fetchedAt: now,
            tokenEstimate: 0,
            error: errorMsg,
        };

        fetchCache.set(cacheKey, errorResult);
        return errorResult;
    }
}

/**
 * Fetches a single URL with optional recursive link following.
 */
export async function fetchLinkContent(
    url: string,
    options: {
        maxDepth?: number;
        cacheTimeToLiveMs?: number;
        visitedUrls?: Set<string>;
        currentDepth?: number;
        fetchMode?: 'full' | 'summary' | 'extract';
        includeImages?: boolean;
    } = {}
): Promise<FetchResult[]> {
    const maxDepth = options.maxDepth ?? MAX_FETCH_DEPTH;
    const cacheTimeToLiveMs = options.cacheTimeToLiveMs ?? DEFAULT_CACHE_TIME_TO_LIVE_MS;
    const visited = options.visitedUrls ?? new Set<string>();
    const depth = options.currentDepth ?? 0;
    const fetchMode = options.fetchMode ?? 'full';
    const includeImages = options.includeImages ?? false;

    if (depth > maxDepth) return [];
    if (visited.has(url)) return [];

    visited.add(url);

    const result = await fetchSingleUrl(url, cacheTimeToLiveMs, fetchMode, includeImages);

    if (result.error || !result.content) {
        return [result];
    }

    if (fetchMode === 'extract') {
        result.content = extractStructuredContent(result.content);
        result.tokenEstimate = estimateTokens(result.content);
    }

    const allResults: FetchResult[] = [result];

    if (depth < maxDepth && result.links.length > 0) {
        const childPromises = result.links.map(linkUrl =>
            fetchLinkContent(linkUrl, {
                maxDepth,
                cacheTimeToLiveMs,
                visitedUrls: visited,
                currentDepth: depth + 1,
                fetchMode,
                includeImages,
            })
        );

        const childResults = await Promise.all(childPromises);
        for (const childBatch of childResults) {
            allResults.push(...childBatch);
        }
    }

    return allResults;
}

/**
 * Batch entry point: fetches multiple URLs for a single context entry.
 * Shares a visited set across all URLs to prevent duplicate fetches.
 * Returns combined results and aggregated error list.
 *
 * For 'summary' fetchMode, each page is individually summarized via
 * WebpageSummarizationEngine (including real image data when available),
 * then multi-page results are merged.
 *
 * Also accepts searchTerms + searchEngine — converts them to search URLs
 * and merges them into the fetch pipeline alongside direct URLs.
 */
export async function fetchMultipleContextUrls(
    urls: string[],
    options: {
        maxDepth?: number;
        cacheTimeToLiveMs?: number;
        fetchMode?: 'full' | 'summary' | 'extract';
        searchTerms?: string[];
        searchEngine?: searchEngine;
        modelContext?: LanguageModelContext;
        includeImages?: boolean;
    } = {}
): Promise<{ results: FetchResult[]; errors: string[] }> {
    const allUrls = [...urls];

    if (options.searchTerms && options.searchTerms.length > 0 && options.searchEngine) {
        const searchUrl = buildSearchUrl(options.searchTerms, options.searchEngine);
        allUrls.push(searchUrl);
    }

    const visited = new Set<string>();
    const allResults: FetchResult[] = [];
    const errors: string[] = [];
    const includeImages = options.includeImages ?? false;

    const promises = allUrls.map(url =>
        fetchLinkContent(url, {
            ...options,
            visitedUrls: visited,
            includeImages,
        })
    );

    const batches = await Promise.all(promises);

    for (const batch of batches) {
        for (const result of batch) {
            allResults.push(result);
            if (result.error) {
                errors.push(`${result.url}: ${result.error}`);
            }
        }
    }

    // Summary mode: summarize each page individually (with real images), then merge if multiple
    if (options.fetchMode === 'summary' && options.modelContext) {
        const validResults = allResults.filter(r => !r.error && r.content.length > 0);

        if (validResults.length > 0) {
            const summarizedEntries: { url: string; summary: string }[] = [];

            for (const result of validResults) {
                const imagesForSummary = includeImages && result.images.length > 0
                    ? result.images
                    : undefined;

                const summary = await summarizeWebpageContent(
                    result.content,
                    result.url,
                    options.modelContext,
                    imagesForSummary
                );
                if (summary) {
                    summarizedEntries.push({ url: result.url, summary });
                }
            }

            if (summarizedEntries.length > 0) {
                let finalContent: string;

                if (summarizedEntries.length === 1) {
                    finalContent = `[Summarized: ${summarizedEntries[0].url}]\n${summarizedEntries[0].summary}`;
                } else {
                    const merged = await mergeWebpageSummaries(
                        summarizedEntries,
                        options.modelContext,
                    );
                    if (merged) {
                        const sourceList = summarizedEntries.map(e => e.url).join(', ');
                        finalContent = `[Summarized & Merged from: ${sourceList}]\n${merged}`;
                    } else {
                        finalContent = summarizedEntries
                            .map(e => `[Summarized: ${e.url}]\n${e.summary}`)
                            .join('\n\n---\n\n');
                    }
                }

                allResults.length = 0;
                allResults.push({
                    url: summarizedEntries.length === 1 ? summarizedEntries[0].url : 'merged-summary',
                    content: finalContent,
                    links: [],
                    images: [],
                    fetchedAt: Date.now(),
                    tokenEstimate: estimateTokens(finalContent),
                });
            }
        }
    }

    return { results: allResults, errors };
}

export function clearFetchCache(): void {
    fetchCache.clear();
}

export function getFetchCacheStats(): { size: number; urls: string[] } {
    return {
        size: fetchCache.size,
        urls: Array.from(fetchCache.keys()),
    };
}