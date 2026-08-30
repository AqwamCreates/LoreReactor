// src/services/characterCardParser.ts
// Parses TavernAI / SillyTavern character cards (PNG with embedded JSON)
// Supports V1, V2, and V3 specs

import type { ParsedCharacterCard } from "../types";

/**
 * Reads a PNG file and extracts character data from tEXt metadata chunks.
 * Returns null if no valid character card data is found.
 */
export async function parseCharacterCard(file: File): Promise<ParsedCharacterCard | null> {
    if (file.type !== 'image/png') return null;

    try {
        const buffer = await file.arrayBuffer();
        const view = new DataView(buffer);

        // Verify PNG signature
        const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) {
            if (view.getUint8(i) !== pngSignature[i]) return null;
        }

        // Walk PNG chunks looking for tEXt
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

                    if (keyword === 'chara' || keyword === 'Chara') {
                        try {
                            const json = decodeBase64AsUtf8(value);

                            // V2/V3: has spec field and nested data object
                            if (json.spec && json.data) {
                                return normalizeV2V3(json.data);
                            }

                            // V1 format — flat object with name at top level
                            if (json.name) {
                                return normalizeV1(json);
                            }
                        } catch {
                            // Not valid JSON, continue searching
                        }
                    }
                }
            }

            // Move to next chunk: length(4) + type(4) + data(length) + crc(4)
            offset += 4 + 4 + chunkLength + 4;
        }

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

function normalizeV1(json: any): ParsedCharacterCard {
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

// Handles both V2 and V3 — they share the same data structure
function normalizeV2V3(data: any): ParsedCharacterCard {
    return {
        name: data.name || '',
        description: data.description || '',
        firstMes: data.first_mes || '',
        personality: data.personality || undefined,
        scenario: data.scenario || undefined,
        mesExample: data.mes_example || undefined,
        creatorNotes: data.creator_notes || undefined,
        systemPrompt: data.system_prompt || undefined,
        postHistoryInstructions: data.post_history_instructions || undefined,
        alternateGreetings: data.alternate_greetings || undefined,
        tags: data.tags || undefined,
        creator: data.extensions?.creator || undefined,
        characterVersion: data.character_version || undefined,
    };
}

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
        firstMessage: card.firstMes || '',
    };
}