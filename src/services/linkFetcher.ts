// src/services/linkFetcher.ts
import { getLanguageModelEngine } from './LanguageModelEngine';
import type { LanguageModel } from '../types';
import { summarizeWebpageContent, mergeWebpageSummaries, type WebpageImageInfo } from './WebpageSummarizationEngine';
import { findWebpageByUrl, saveRawWebpage } from '../storage/storage';
import type { linkFetchMode, searchEngine } from '../types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CACHE_TIME_TO_LIVE_MS = 5 * 60 * 1000;
const MAX_FETCH_DEPTH = 3;
const FETCH_PROXY_URL = '/api/web/fetch';

const tokenEngine = getLanguageModelEngine();

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
 * Proxied fetch through the Express server to bypass CORS restrictions.
 * The server handles the actual HTTP request and returns the response.
 */
async function proxiedFetch(url: string, acceptHeader: string): Promise<{
    ok: boolean;
    status: number;
    contentType: string;
    text?: string;
    base64?: string;
    error?: string;
}> {
    try {
        const response = await fetch(FETCH_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                headers: {
                    'User-Agent': 'LoreReactor/1.0 (Context Fetcher)',
                    'Accept': acceptHeader,
                },
            }),
        });

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
            return {
                ok: false,
                status: response.status,
                contentType: '',
                error: `Proxy returned non-JSON response: HTTP ${response.status}`,
            };
        }

        return await response.json();
    } catch (e) {
        return {
            ok: false,
            status: 0,
            contentType: '',
            error: `Proxy request failed: ${(e as Error).message}`,
        };
    }
}

/**
 * Extracts the subdirectory scope from a URL.
 */
function getSubdirectoryScope(url: string): string {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split('/');
        pathParts.pop();
        const directoryPath = `${pathParts.join('/')}/`;
        return `${parsed.origin}${directoryPath}`;
    } catch {
        return url;
    }
}

/**
 * Checks whether a candidate link falls within the subdirectory scope.
 */
function isWithinSubdirectory(candidateUrl: string, scopePrefix: string): boolean {
    try {
        const parsed = new URL(candidateUrl);
        const fullUrl = `${parsed.origin}${parsed.pathname}`;
        return fullUrl.startsWith(scopePrefix);
    } catch {
        return false;
    }
}

/**
 * Constructs a search engine URL from search terms.
 */
export function buildSearchUrl(terms: string[], engine?: searchEngine): string {
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
 */
function cleanImageUrl(url: string): string {
    const extensionMatch = url.match(/(\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|tiff?))/i);
    if (extensionMatch && extensionMatch.index !== undefined) {
        return url.substring(0, extensionMatch.index + extensionMatch[1].length);
    }
    return url;
}

/**
 * Downloads an image from a URL via proxy and returns it as base64 + mime type.
 */
async function downloadImageAsBase64(imageUrl: string): Promise<{ base64: string; mimeType: string } | null> {
    try {
        const result = await proxiedFetch(imageUrl, 'image/*');

        if (!result.ok || !result.base64 || !result.contentType?.startsWith('image/')) {
            return null;
        }

        return {
            base64: result.base64,
            mimeType: result.contentType.split(';')[0].trim(),
        };
    } catch {
        return null;
    }
}

function parseHtml(html: string, baseUrl: string): { text: string; links: string[]; imageUrls: string[] } {
    const linkRegex = /href=["']([^"']+)["']/gi;
    const links: string[] = [];
    let match: RegExpExecArray | null;
    match = linkRegex.exec(html);
    while (match !== null) {
        let href = match[1];

        if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('data:')) {
            match = linkRegex.exec(html);
            continue;
        }

        if (!href.startsWith('http')) {
            try {
                href = new URL(href, baseUrl).href;
            } catch {
                match = linkRegex.exec(html);
                continue;
            }
        }

        if (!href.startsWith('http')) {
            match = linkRegex.exec(html);
            continue;
        }

        if (!links.includes(href)) {
            links.push(href);
        }

        match = linkRegex.exec(html);
    }

    const imgRegex = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;
    const imageUrls: string[] = [];
    let imgMatch: RegExpExecArray | null;

    while ((imgMatch = imgRegex.exec(html)) !== null) {
        let imgUrl = imgMatch[1];

        if (!imgUrl.startsWith('http')) {
            try {
                imgUrl = new URL(imgUrl, baseUrl).href;
            } catch {
                continue;
            }
        }

        if (imgUrl.startsWith('data:') || imgUrl.includes('pixel') || imgUrl.includes('spacer') || imgUrl.includes('1x1') || imgUrl.includes('blank.gif')) {
            continue;
        }

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
 * Extract mode: keeps only structured content.
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
                    tokenEstimate: await tokenEngine.countTokens(diskCached.content),
                };
                fetchCache.set(cacheKey, result);
                return result;
            }
        } catch (e) {
            console.warn(`Failed to check disk cache for ${url}:`, e);
        }
    }

    // Layer 3: Network fetch via proxy
    try {
        const result = await proxiedFetch(url, 'text/html,text/plain,*/*');

        if (!result.ok) {
            throw new Error(`HTTP ${result.status}: ${result.error || 'Unknown error'}`);
        }

        const contentType = result.contentType || '';
        const rawBody = result.text || '';

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

        const fetchResult: FetchResult = {
            url,
            content,
            links,
            images,
            fetchedAt: now,
            tokenEstimate: await tokenEngine.countTokens(content),
        };

        fetchCache.set(cacheKey, fetchResult);

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

        return fetchResult;

    } catch (e) {
        const errorMsg = (e as Error).message;

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
        fetchMode?: linkFetchMode;
        includeImages?: boolean;
        limitLinksToSubdirectory?: boolean;
        subdirectoryScope?: string;
    } = {}
): Promise<FetchResult[]> {
    const maxDepth = options.maxDepth ?? MAX_FETCH_DEPTH;
    const cacheTimeToLiveMs = options.cacheTimeToLiveMs ?? DEFAULT_CACHE_TIME_TO_LIVE_MS;
    const visited = options.visitedUrls ?? new Set<string>();
    const depth = options.currentDepth ?? 0;
    const fetchMode = options.fetchMode ?? 'full';
    const includeImages = options.includeImages ?? false;
    const limitLinksToSubdirectory = options.limitLinksToSubdirectory ?? false;

    const subdirectoryScope = options.subdirectoryScope ?? (limitLinksToSubdirectory ? getSubdirectoryScope(url) : '');

    if (depth > maxDepth) return [];
    if (visited.has(url)) return [];

    if (limitLinksToSubdirectory && subdirectoryScope && depth > 0) {
        if (!isWithinSubdirectory(url, subdirectoryScope)) {
            return [];
        }
    }

    visited.add(url);

    const result = await fetchSingleUrl(url, cacheTimeToLiveMs, fetchMode, includeImages);

    if (result.error || !result.content) {
        return [result];
    }

    if (fetchMode === 'extract') {
        result.content = extractStructuredContent(result.content);
        result.tokenEstimate = await tokenEngine.countTokens(result.content);
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
                limitLinksToSubdirectory,
                subdirectoryScope,
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
 * Engine context should already be set by caller before calling this function.
 */
export async function fetchMultipleContextUrls(
    urls: string[],
    options: {
        maxDepth?: number;
        cacheTimeToLiveMs?: number;
        fetchMode?: linkFetchMode;
        searchTerms?: string[];
        searchEngine?: searchEngine;
        model?: LanguageModel | null;
        includeImages?: boolean;
        limitLinksToSubdirectory?: boolean;
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
    const limitLinksToSubdirectory = options.limitLinksToSubdirectory ?? false;

    const promises = allUrls.map(url =>
        fetchLinkContent(url, {
            ...options,
            visitedUrls: visited,
            includeImages,
            limitLinksToSubdirectory,
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

    // Summary mode: summarize each page individually, then merge if multiple
    if (options.fetchMode === 'summary' && options.model) {
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
                    tokenEstimate: await tokenEngine.countTokens(finalContent),
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