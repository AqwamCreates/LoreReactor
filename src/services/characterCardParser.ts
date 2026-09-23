// src/services/characterCardParser.ts
// Parses TavernAI / SillyTavern character cards
// Supports V1, V2, and V3 specs including lorebooks, assets, and extensions
// Handles both PNG tEXt metadata and CharX (.charx) ZIP containers

import type { ParsedCharacterCard, Context, RegularExpressionTrigger } from "../types";

/** Extended parsed result that includes lorebook contexts and emotion images */
export interface ParsedCharacterCardExtended extends ParsedCharacterCard {
    /** Auto-generated contexts from character_book entries */
    lorebookContexts?: Partial<Context>[];
    /** Emotion/expression images extracted from V3 assets or extensions */
    emotionImages?: Record<string, string>;
    /** Display nickname separate from AI-facing name */
    nickname?: string;
    /** Greetings only used in group chats */
    groupOnlyGreetings?: string[];
    /** Multilingual creator notes keyed by language code */
    creatorNotesMultilingual?: Record<string, string>;
    /** Source URLs for the character */
    source?: string[];
    /** Creation timestamp (unix ms) */
    creationDate?: number;
    /** Last modification timestamp (unix ms) */
    modificationDate?: number;
    /** Spec version string (e.g. "3.0") */
    specVersion?: string;
}

// ─── Raw JSON shapes from card specs ────────────────────────────────

interface RawV1Card {
    name?: string;
    description?: string;
    first_mes?: string;
    personality?: string;
    scenario?: string;
    mes_example?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    tags?: string[];
    creator?: string;
    character_version?: string;
    [key: string]: unknown;
}

interface RawV2Data {
    name?: string;
    description?: string;
    first_mes?: string;
    personality?: string;
    scenario?: string;
    mes_example?: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    character_version?: string;
    character_book?: CharacterBook;
    extensions?: Record<string, unknown>;
    [key: string]: unknown;
}

interface RawV3Data extends RawV2Data {
    nickname?: string;
    group_only_greetings?: string[];
    assets?: V3Asset[];
    creator_notes_multilingual?: Record<string, string>;
    source?: string[];
    creation_date?: number;
    modification_date?: number;
}

interface RawCardEnvelope {
    spec?: string;
    spec_version?: string;
    data?: unknown;
    [key: string]: unknown;
}

// ─── Lorebook Types ─────────────────────────────────────────────────

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
    use_regex?: boolean;
    id?: number | string;
    extensions?: Record<string, unknown>;
}

interface CharacterBook {
    name?: string;
    description?: string;
    scan_depth?: number;
    token_budget?: number;
    recursive_scanning?: boolean;
    extensions?: Record<string, unknown>;
    entries?: CharacterBookEntry[];
}

// ─── V3 Asset Types ─────────────────────────────────────────────────

interface V3Asset {
    name?: string;
    type?: string;
    uri?: string;
    ext?: string;
    filename?: string;
}

// ─── Main Parser ────────────────────────────────────────────────────

/**
 * Reads a character card file (PNG or CharX ZIP) and extracts character data.
 * Returns null if no valid character card data is found.
 */
export async function parseCharacterCard(file: File): Promise<ParsedCharacterCardExtended | null> {
    const fileName = file.name.toLowerCase();

    // Try CharX (ZIP) first if extension matches
    if (fileName.endsWith('.charx') || file.type === 'application/zip') {
        return parseCharX(file);
    }

    // Fall back to PNG parsing
    if (file.type === 'image/png' || fileName.endsWith('.png')) {
        return parsePngCard(file);
    }

    // Try JSON import
    if (file.type === 'application/json' || fileName.endsWith('.json')) {
        return parseJsonCard(file);
    }

    return null;
}

/**
 * Parse a CharX (.charx) ZIP container.
 * Extracts the character.json from the ZIP root and processes it.
 */
async function parseCharX(file: File): Promise<ParsedCharacterCardExtended | null> {
    try {
        // Use JSZip-like manual ZIP parsing for the character.json entry
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);

        // Verify ZIP signature (PK\x03\x04)
        if (view.getUint8(0) !== 0x50 || view.getUint8(1) !== 0x4B ||
            view.getUint8(2) !== 0x03 || view.getUint8(3) !== 0x04) {
            return null;
        }

        // Search for character.json in local file headers
        let offset = 0;
        while (offset < buffer.byteLength - 4) {
            if (view.getUint8(offset) === 0x50 && view.getUint8(offset + 1) === 0x4B &&
                view.getUint8(offset + 2) === 0x03 && view.getUint8(offset + 3) === 0x04) {

                const fileNameLength = view.getUint16(offset + 26, true);
                const extraFieldLength = view.getUint16(offset + 28, true);
                const compressedSize = view.getUint32(offset + 18, true);
                const uncompressedSize = view.getUint32(offset + 22, true);
                const compressionMethod = view.getUint16(offset + 8, true);

                const fileNameStart = offset + 30;
                const fileNameBytes = new Uint8Array(buffer, fileNameStart, fileNameLength);
                const entryName = new TextDecoder('utf-8').decode(fileNameBytes);

                const dataStart = fileNameStart + fileNameLength + extraFieldLength;

                if (entryName === 'character.json' || entryName.endsWith('/character.json')) {
                    let jsonBytes: Uint8Array;

                    if (compressionMethod === 0) {
                        // Stored (no compression)
                        jsonBytes = new Uint8Array(buffer, dataStart, uncompressedSize);
                    } else if (compressionMethod === 8) {
                        // Deflate — use DecompressionStream if available
                        const compressedData = new Uint8Array(buffer, dataStart, compressedSize);
                        try {
                            const ds = new DecompressionStream('deflate-raw');
                            const writer = ds.writable.getWriter();
                            const reader = ds.readable.getReader();
                            writer.write(compressedData);
                            writer.close();
                            const chunks: Uint8Array[] = [];
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                chunks.push(value);
                            }
                            const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
                            jsonBytes = new Uint8Array(totalLength);
                            let pos = 0;
                            for (const chunk of chunks) {
                                jsonBytes.set(chunk, pos);
                                pos += chunk.length;
                            }
                        } catch {
                            return null;
                        }
                    } else {
                        // Unsupported compression
                        continue;
                    }

                    const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
                    const json = JSON.parse(jsonText) as RawCardEnvelope;
                    return processCardEnvelope(json);
                }

                offset = dataStart + compressedSize;
            } else {
                offset++;
            }
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Parse a PNG file with embedded character card data in tEXt chunks.
 */
async function parsePngCard(file: File): Promise<ParsedCharacterCardExtended | null> {
    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);

        // Verify PNG signature
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (view.getUint8(i) !== pngSignature[i]) return null;
        }

        // Collect all tEXt chunks — V3 cards may have both ccv3 and chara
        let v3Data: RawV3Data | null = null;
        let v2Data: RawV2Data | null = null;
        let v1Data: RawV1Card | null = null;
        let specVersion: string | undefined;

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
                        const json = decodeBase64AsUtf8(value) as RawCardEnvelope;

                        // V3: spec === "chara_card_v3", keyword is typically "ccv3"
                        if (keyword === 'ccv3' || keyword === 'CCV3') {
                            if (json.spec === 'chara_card_v3' && json.data) {
                                v3Data = json.data as RawV3Data;
                                specVersion = json.spec_version;
                            }
                        }

                        // V2: spec === "chara_card_v2", keyword is "chara"
                        if (keyword === 'chara' || keyword === 'Chara') {
                            if (json.spec && json.data) {
                                v2Data = json.data as RawV2Data;
                                specVersion = json.spec_version;
                            } else if ((json as RawV1Card).name && !json.spec) {
                                // V1 format — flat object
                                v1Data = json as unknown as RawV1Card;
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
        if (v3Data) {
            const result = normalizeV3(v3Data);
            if (specVersion) result.specVersion = specVersion;
            return result;
        }
        if (v2Data) {
            const result = normalizeV2(v2Data);
            if (specVersion) result.specVersion = specVersion;
            return result;
        }
        if (v1Data) return normalizeV1(v1Data);

        return null;
    } catch {
        return null;
    }
}

/**
 * Parse a standalone JSON character card file.
 */
async function parseJsonCard(file: File): Promise<ParsedCharacterCardExtended | null> {
    try {
        const text = await file.text();
        const json = JSON.parse(text) as RawCardEnvelope;
        return processCardEnvelope(json);
    } catch {
        return null;
    }
}

/**
 * Process a parsed JSON envelope and return the appropriate normalized result.
 */
function processCardEnvelope(json: RawCardEnvelope): ParsedCharacterCardExtended | null {
    if (json.spec === 'chara_card_v3' && json.data) {
        const result = normalizeV3(json.data as RawV3Data);
        if (json.spec_version) result.specVersion = json.spec_version;
        return result;
    }
    if (json.spec === 'chara_card_v2' && json.data) {
        const result = normalizeV2(json.data as RawV2Data);
        if (json.spec_version) result.specVersion = json.spec_version;
        return result;
    }
    if ((json as RawV1Card).name && !json.spec) {
        return normalizeV1(json as unknown as RawV1Card);
    }
    // Try treating the whole object as V1
    if ((json as RawV1Card).name) {
        return normalizeV1(json as unknown as RawV1Card);
    }
    return null;
}

// ─── Decoding Helpers ───────────────────────────────────────────────

function decodeText(buffer: ArrayBuffer, start: number, end: number): string {
    const bytes = new Uint8Array(buffer, start, end - start);
    return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Decodes a base64 string as UTF-8, preserving multi-byte characters.
 * atob() treats each byte as Latin-1, which corrupts curly quotes, em-dashes, etc.
 */
function decodeBase64AsUtf8(base64: string): unknown {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const utf8String = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(utf8String) as unknown;
}

// ─── V1 Normalization ──────────────────────────────────────────────

function normalizeV1(json: RawV1Card): ParsedCharacterCardExtended {
    return {
        name: json.name || '',
        description: json.description || '',
        firstMes: json.first_mes || '',
        personality: json.personality || undefined,
        scenario: json.scenario || undefined,
        mesExample: json.mes_example || undefined,
        systemPrompt: json.system_prompt || undefined,
        starterPrompt: json.post_history_instructions || undefined,
        tags: json.tags || undefined,
        creator: json.creator || undefined,
        characterVersion: json.character_version || undefined,
    };
}

// ─── V2 Normalization ──────────────────────────────────────────────

function normalizeV2(data: RawV2Data): ParsedCharacterCardExtended {
    const result: ParsedCharacterCardExtended = {
        name: data.name || '',
        description: data.description || '',
        firstMes: data.first_mes || '',
        personality: data.personality || undefined,
        scenario: data.scenario || undefined,
        mesExample: data.mes_example || undefined,
        creatorNotes: data.creator_notes || undefined,
        systemPrompt: data.system_prompt || undefined,
        starterPrompt: data.post_history_instructions || undefined,
        alternateGreetings: data.alternate_greetings?.length ? data.alternate_greetings : undefined,
        tags: data.tags || undefined,
        creator: (data.extensions as Record<string, unknown>)?.creator as string | undefined || data.creator || undefined,
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

function normalizeV3(data: RawV3Data): ParsedCharacterCardExtended {
    // V3 contains all V2 fields plus additions
    const result = normalizeV2(data);

    // V3-specific fields
    if (data.nickname) result.nickname = data.nickname;
    if (data.group_only_greetings?.length) result.groupOnlyGreetings = data.group_only_greetings;
    if (data.creator_notes_multilingual) result.creatorNotesMultilingual = data.creator_notes_multilingual;
    if (data.source?.length) result.source = data.source;
    if (data.creation_date) result.creationDate = data.creation_date;
    if (data.modification_date) result.modificationDate = data.modification_date;

    // V3 assets → emotion images and other asset types
    if (data.assets?.length) {
        const assetImages = extractV3Assets(data.assets);
        // Merge with extension images; V3 assets take priority
        result.emotionImages = { ...(result.emotionImages || {}), ...assetImages };
    }

    return result;
}

// ─── Lorebook → Context Extraction ─────────────────────────────────

/**
 * Converts character_book entries into partial Context objects.
 * Maps lorebook keys → RegularExpressionTrigger arrays, content → text,
 * insertion_order → insertionDepth, constant → always-active context.
 * Respects V3 use_regex flag — when true, keys are used as-is without escaping.
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
        const useRegex = entry.use_regex === true;

        // Build regex trigger from keys
        let activationTriggers: RegularExpressionTrigger[] | undefined;
        if (keys.length > 0) {
            // When use_regex is true, keys are already regex patterns — don't escape
            const processed = useRegex ? keys : keys.map(k => escapeRegex(k));
            let regexPattern: string;
            if (entry.selective && secondaryKeys.length > 0) {
                // Selective: need match from BOTH key sets
                const primaryGroup = processed.join('|');
                const secondaryProcessed = useRegex ? secondaryKeys : secondaryKeys.map(k => escapeRegex(k));
                const secondaryGroup = secondaryProcessed.join('|');
                regexPattern = `(?=.*(?:${primaryGroup}))(?=.*(?:${secondaryGroup}))`;
            } else {
                regexPattern = processed.join('|');
            }
            // Respect case sensitivity (only apply when NOT using raw regex)
            if (!entry.case_sensitive && !useRegex) {
                regexPattern = `(?i)${regexPattern}`;
            }
            activationTriggers = [{
                trigger: regexPattern,
                context: 'global',
                target: 'everyone',
            }];
        }

        // Constant entries have no trigger — always active
        const isConstant = entry.constant === true;

        const context: Partial<Context> = {
            name: entry.name || entry.comment || "Lorebook Entry",
            text: entry.content,
            regularExpressionActivationTriggers: isConstant ? undefined : activationTriggers,
            insertionDepth: entry.insertion_order ?? 0,
            tokenBudget: book.token_budget ? Math.min(book.token_budget, 512) : undefined,
            firstCreatedTimestamp: now,
            lastUpdatedTimestamp: now,
        };

        contexts.push(context);
    }

    return contexts;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── V3 Asset Extraction ───────────────────────────────────────────

/**
 * Extracts emotion/expression images from V3 assets array.
 * Maps asset names to filenames for the Character.images record.
 * Handles V3 asset types: icon, background, user_icon, emotion.
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
        // V3 spec: uri is required, filename is our fallback
        const filename = asset.uri || asset.filename;
        if (!filename) continue;

        const type = (asset.type || '').toLowerCase();

        // Handle known V3 asset types
        if (type === 'icon' || type === 'background' || type === 'user_icon') {
            // Store these under their type name for potential use
            images[type] = filename;
            continue;
        }

        // Only process emotion/expression/sprite/emote/image types for emotion mapping
        if (type && !['emotion', 'expression', 'sprite', 'emote', 'image'].some(t => type.includes(t))) {
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
function extractExtensionImages(extensions: Record<string, unknown> | undefined): Record<string, string> {
    if (!extensions) return {};
    const images: Record<string, string> = {};

    // SillyTavern expression images: extensions.sillytavern_v2.expressions or extensions.expressions
    const stExpressions = (extensions.sillytavern_v2 as Record<string, unknown>)?.expressions as Record<string, string> | undefined
        || extensions.expressions as Record<string, string> | undefined
        || extensions.st_expressions as Record<string, string> | undefined;
    if (stExpressions && typeof stExpressions === 'object') {
        for (const [emotion, filename] of Object.entries(stExpressions)) {
            if (typeof filename === 'string' && filename.trim()) {
                images[emotion.toLowerCase()] = filename;
            }
        }
    }

    // Agnai voice/image extensions: extensions.agnai?.images
    const agnaiImages = (extensions.agnai as Record<string, unknown>)?.images as Record<string, string> | undefined
        || extensions.agnai_images as Record<string, string> | undefined;
    if (agnaiImages && typeof agnaiImages === 'object') {
        for (const [emotion, filename] of Object.entries(agnaiImages)) {
            if (typeof filename === 'string' && filename.trim()) {
                images[emotion.toLowerCase()] = filename;
            }
        }
    }

    // Generic expression map: extensions.expression_images
    const genericExpressions = extensions.expression_images as Record<string, string> | undefined;
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
 * Uses post_history_instructions as starterPrompt fallback when no explicit
 * starter prompt field exists in the card spec.
 */
export function mapCardToEditorFields(card: ParsedCharacterCard): {
    name: string;
    description: string;
    systemPrompt: string;
    appearancePrompt: string;
    dialoguePrompt: string;
    starterPrompt: string;
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

    // Starter prompt: use explicit starterPrompt if present, otherwise
    // fall back to post_history_instructions (common convention in ST cards)
    const starterPrompt = card.starterPrompt || '';

    // Description: combine description + creator_notes if useful
    let description = card.description || '';
    if (card.creatorNotes && !description) {
        description = card.creatorNotes;
    }

    return {
        name: card.name || '',
        description,
        systemPrompt,
        appearancePrompt: '',
        dialoguePrompt: card.mesExample || '',
        starterPrompt,
        firstMessage: card.firstMes || '',
    };
}