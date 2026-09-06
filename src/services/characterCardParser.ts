// src/services/characterCardParser.ts
// Parses TavernAI / SillyTavern character cards (PNG with embedded JSON)
// Supports V1, V2, and V3 specs including lorebooks, assets, and extensions

import type { ParsedCharacterCard, Context } from "../types";

/** Extended parsed result that includes lorebook contexts and emotion images */
export interface ParsedCharacterCardExtended extends ParsedCharacterCard {
    /** Auto-generated contexts from character_book entries */
    lorebookContexts?: Partial<Context>[];
    /** Emotion/expression images extracted from V3 assets or extensions */
    emotionImages?: Record<string, string>;
    /** Alternate first messages for swipe selection */
    alternateGreetings?: string[];
    /** Display nickname separate from AI-facing name */
    nickname?: string;
    /** Greetings only used in group chats */
    groupOnlyGreetings?: string[];
}

/**
 * Reads a PNG file and extracts character data from tEXt metadata chunks.
 * Checks both V2 (`chara`) and V3 (`ccv3`) keywords.
 * Returns null if no valid character card data is found.
 */
export async function parseCharacterCard(file: File): Promise<ParsedCharacterCardExtended | null> {
    if (file.type !== 'image/png') return null;

    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);

        // Verify PNG signature
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (view.getUint8(i) !== pngSignature[i]) return null;
        }

        // Collect all tEXt chunks — V3 cards may have both ccv3 and chara
        let v3Data: any = null;
        let v2Data: any = null;
        let v1Data: any = null;

        let offset = 8;
        while (offset < buffer.byteLength) {
            const chunkLength = view.getUint32(offset);
            const chunkType = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7)
            );

            if (chunkType === 'tEXt') {
                const dataStart = offset + 8;
                const dataEnd = dataStart + chunkLength;

                // Find null separator between keyword and value
                let nullPos = -1;
                for (let i = dataStart; i < dataEnd; i++) {
                    if (view.getUint8(i) === 0) { nullPos = i; break; }
                }

                if (nullPos !== -1) {
                    const keyword = decodeText(buffer, dataStart, nullPos);
                    const value = decodeText(buffer, nullPos + 1, dataEnd);

                    try {
                        const json = decodeBase64AsUtf8(value);

                        // V3: spec === "chara_card_v3", keyword is typically "ccv3"
                        if (keyword === 'ccv3' || keyword === 'CCV3') {
                            if (json.spec === 'chara_card_v3' && json.data) {
                                v3Data = json.data;
                            }
                        }

                        // V2: spec === "chara_card_v2", keyword is "chara"
                        if (keyword === 'chara' || keyword === 'Chara') {
                            if (json.spec && json.data) {
                                v2Data = json.data;
                            } else if (json.name && !json.spec) {
                                // V1 format — flat object
                                v1Data = json;
                            }
                        }
                    } catch {
                        // Not valid JSON, continue searching
                    }
                }
            }

            // Move to next chunk: length(4) + type(4) + data(length) + crc(4)
            offset += 4 + 4 + chunkLength + 4;
        }

        // Priority: V3 > V2 > V1
        if (v3Data) return normalizeV3(v3Data);
        if (v2Data) return normalizeV2(v2Data);
        if (v1Data) return normalizeV1(v1Data);

        return null;
    } catch {
        return null;
    }
}

function decodeText(buffer: ArrayBuffer, start: number, end: number): string {
    const bytes = new Uint8Array(buffer, start, end - start);
    return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Decodes a base64 string as UTF-8, preserving multi-byte characters.
 * atob() treats each byte as Latin-1, which corrupts curly quotes, em-dashes, etc.
 */
function decodeBase64AsUtf8(base64: string): any {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const utf8String = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(utf8String);
}

// ─── V1 Normalization ──────────────────────────────────────────────

function normalizeV1(json: any): ParsedCharacterCardExtended {
    return {
        name: json.name || '',
        description: json.description || '',
        firstMes: json.first_mes || '',
        personality: json.personality || undefined,
        scenario: json.scenario || undefined,
        mesExample: json.mes_example || undefined,
        systemPrompt: json.system_prompt || undefined,
        postHistoryInstructions: json.post_history_instructions || undefined,
        tags: json.tags || undefined,
        creator: json.creator || undefined,
        characterVersion: json.character_version || undefined,
    };
}

// ─── V2 Normalization ──────────────────────────────────────────────

function normalizeV2(data: any): ParsedCharacterCardExtended {
    const result: ParsedCharacterCardExtended = {
        name: data.name || '',
        description: data.description || '',
        firstMes: data.first_mes || '',
        personality: data.personality || undefined,
        scenario: data.scenario || undefined,
        mesExample: data.mes_example || undefined,
        creatorNotes: data.creator_notes || undefined,
        systemPrompt: data.system_prompt || undefined,
        postHistoryInstructions: data.post_history_instructions || undefined,
        alternateGreetings: data.alternate_greetings?.length ? data.alternate_greetings : undefined,
        tags: data.tags || undefined,
        creator: data.extensions?.creator || data.creator || undefined,
        characterVersion: data.character_version || undefined,
    };

    // Extract lorebook contexts
    if (data.character_book?.entries?.length) {
        result.lorebookContexts = extractLorebookContexts(data.character_book);
    }

    // Mine extensions for expression images and trait hints
    const extImages = extractExtensionImages(data.extensions);
    if (Object.keys(extImages).length > 0) {
        result.emotionImages = extImages;
    }

    return result;
}

// ─── V3 Normalization ──────────────────────────────────────────────

function normalizeV3(data: any): ParsedCharacterCardExtended {
    // V3 contains all V2 fields plus additions
    const result = normalizeV2(data);

    // V3-specific fields
    if (data.nickname) result.nickname = data.nickname;
    if (data.group_only_greetings?.length) result.groupOnlyGreetings = data.group_only_greetings;

    // V3 assets → emotion images
    if (data.assets?.length) {
        const assetImages = extractV3Assets(data.assets);
        // Merge with extension images; V3 assets take priority
        result.emotionImages = { ...(result.emotionImages || {}), ...assetImages };
    }

    return result;
}

// ─── Lorebook → Context Extraction ─────────────────────────────────

interface CharacterBookEntry {
    keys?: string[];
    content?: string;
    enabled?: boolean;
    insertion_order?: number;
    case_sensitive?: boolean;
    selective?: boolean;
    secondary_keys?: string[];
    constant?: boolean;
    name?: string;
    comment?: string;
    priority?: number;
    position?: 'before_char' | 'after_char';
    extensions?: Record<string, any>;
}

interface CharacterBook {
    name?: string;
    entries?: CharacterBookEntry[];
    scan_depth?: number;
    token_budget?: number;
    recursive_scanning?: boolean;
    extensions?: Record<string, any>;
}

/**
 * Converts character_book entries into partial Context objects.
 * Maps lorebook keys → regex activation triggers, content → text,
 * insertion_order → insertionDepth, constant → always-active context.
 */
function extractLorebookContexts(book: CharacterBook): Partial<Context>[] {
    if (!book.entries?.length) return [];

    const now = Date.now();
    const contexts: Partial<Context>[] = [];

    // Sort by insertion_order (lower = higher priority / earlier insertion)
    const sorted = [...book.entries]
        .filter(e => e.enabled !== false && e.content?.trim())
        .sort((a, b) => (a.insertion_order ?? 999) - (b.insertion_order ?? 999));

    for (const entry of sorted) {
        const keys = entry.keys || [];
        const secondaryKeys = entry.selective ? (entry.secondary_keys || []) : [];

        // Build regex from keys
        let regexTrigger: string | undefined;
        if (keys.length > 0) {
            const escaped = keys.map(k => escapeRegex(k));
            if (entry.selective && secondaryKeys.length > 0) {
                // Selective: need match from BOTH key sets
                const primaryGroup = escaped.join('|');
                const secondaryGroup = secondaryKeys.map(k => escapeRegex(k)).join('|');
                regexTrigger = `(?=.*(?:${primaryGroup}))(?=.*(?:${secondaryGroup}))`;
            } else {
                regexTrigger = escaped.join('|');
            }
            // Respect case sensitivity
            if (!entry.case_sensitive) {
                regexTrigger = `(?i)${regexTrigger}`;
            }
        }

        // Constant entries have no trigger — always active
        const isConstant = entry.constant === true;

        const ctx: Partial<Context> = {
            name: entry.name || entry.comment || `Lorebook Entry`,
            text: entry.content,
            regularExpressionActivationTrigger: isConstant ? undefined : regexTrigger,
            insertionDepth: entry.insertion_order ?? 0,
            tokenBudget: book.token_budget ? Math.min(book.token_budget, 512) : undefined,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };

        contexts.push(ctx);
    }

    return contexts;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── V3 Asset Extraction ───────────────────────────────────────────

interface V3Asset {
    name?: string;
    type?: string;
    uri?: string;
    filename?: string;
}

/**
 * Extracts emotion/expression images from V3 assets array.
 * Maps asset names to filenames for the Character.images record.
 * Only processes image-type assets with recognizable emotion names.
 */
function extractV3Assets(assets: V3Asset[]): Record<string, string> {
    const images: Record<string, string> = {};

    const EMOTION_ALIASES: Record<string, string[]> = {
        'neutral': ['neutral', 'default', 'normal', 'base'],
        'happy': ['happy', 'joy', 'smile', 'smiling', 'cheerful'],
        'sad': ['sad', 'crying', 'tears', 'upset', 'melancholy'],
        'angry': ['angry', 'rage', 'furious', 'mad', 'irritated'],
        'surprised': ['surprised', 'shock', 'shocked', 'astonished'],
        'embarrassed': ['embarrassed', 'blush', 'blushing', 'shy'],
        'thinking': ['thinking', 'thoughtful', 'pondering', 'contemplative'],
        'confused': ['confused', 'puzzled', 'bewildered'],
        'disgusted': ['disgusted', 'disgust', 'revolted'],
        'fearful': ['fearful', 'afraid', 'scared', 'terrified'],
        'love': ['love', 'loving', 'affectionate', 'heart'],
        'smug': ['smug', 'smirk', 'smirking', 'cocky'],
    };

    for (const asset of assets) {
        const filename = asset.filename || asset.uri;
        if (!filename) continue;

        // Only process image types
        const type = (asset.type || '').toLowerCase();
        if (type && !['image', 'icon', 'expression', 'sprite', 'emote'].some(t => type.includes(t))) {
            continue;
        }

        const assetName = (asset.name || '').toLowerCase().trim();

        // Match against known emotion aliases
        let matchedEmotion: string | null = null;
        for (const [emotion, aliases] of Object.entries(EMOTION_ALIASES)) {
            if (aliases.some(alias => assetName.includes(alias))) {
                matchedEmotion = emotion;
                break;
            }
        }

        // If no known emotion matched, use the raw asset name as key
        const key = matchedEmotion || assetName.replace(/[^a-z0-9_-]/g, '_') || undefined;
        if (key) {
            images[key] = filename;
        }
    }

    return images;
}

// ─── Extensions Mining ─────────────────────────────────────────────

/**
 * Extracts expression/emotion images from tool-specific extensions.
 * Supports SillyTavern, Agnai, and common community namespaces.
 */
function extractExtensionImages(extensions: Record<string, any> | undefined): Record<string, string> {
    if (!extensions) return {};
    const images: Record<string, string> = {};

    // SillyTavern expression images: extensions.sillytavern_v2.expressions or extensions.expressions
    const stExpressions = extensions.sillytavern_v2?.expressions
        || extensions.expressions
        || extensions.st_expressions;
    if (stExpressions && typeof stExpressions === 'object') {
        for (const [emotion, filename] of Object.entries(stExpressions)) {
            if (typeof filename === 'string' && filename.trim()) {
                images[emotion.toLowerCase()] = filename;
            }
        }
    }

    // Agnai voice/image extensions: extensions.agnai?.images
    const agnaiImages = extensions.agnai?.images || extensions.agnai_images;
    if (agnaiImages && typeof agnaiImages === 'object') {
        for (const [emotion, filename] of Object.entries(agnaiImages)) {
            if (typeof filename === 'string' && filename.trim()) {
                images[emotion.toLowerCase()] = filename;
            }
        }
    }

    // Generic expression map: extensions.expression_images
    const genericExpressions = extensions.expression_images;
    if (genericExpressions && typeof genericExpressions === 'object') {
        for (const [emotion, filename] of Object.entries(genericExpressions)) {
            if (typeof filename === 'string' && filename.trim()) {
                images[emotion.toLowerCase()] = filename;
            }
        }
    }

    return images;
}

// ─── Editor Field Mapping ──────────────────────────────────────────

/**
 * Maps parsed card data to fields compatible with CharacterEditorModal.
 * Combines personality + scenario into system prompt if system_prompt is empty.
 */
export function mapCardToEditorFields(card: ParsedCharacterCard): {
    name: string;
    description: string;
    systemPrompt: string;
    thinkPrompt: string;
    appearancePrompt: string;
    dialoguePrompt: string;
    firstMessage: string;
} {
    // Build system prompt from available fields
    let systemPrompt = card.systemPrompt || '';
    if (!systemPrompt) {
        const parts: string[] = [];
        if (card.personality) parts.push(`Personality: ${card.personality}`);
        if (card.scenario) parts.push(`Scenario: ${card.scenario}`);
        systemPrompt = parts.join('\n\n');
    }

    // Use post_history_instructions as think prompt if available
    const thinkPrompt = card.postHistoryInstructions || '';

    // Description: combine description + creator_notes if useful
    let description = card.description || '';
    if (card.creatorNotes && !description) {
        description = card.creatorNotes;
    }

    return {
        name: card.name || '',
        description,
        systemPrompt,
        thinkPrompt,
        appearancePrompt: '',
        dialoguePrompt: card.mesExample || '',
        firstMessage: card.firstMes || '',
    };
}