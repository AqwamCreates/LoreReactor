// frontend_src/hooks/useCharacterVoice.ts
import { useCallback } from 'react';
import type { Character, textType } from '../types';
import { textToSpeechEngine, type TextToSpeechContext } from '../services/TextToSpeechEngine';
import { useSessionStore } from './useSessionStore';
import { getCharacterVoiceURL } from '../storages/serverStorage';
import { detectFormatSegments, type FormatCategory } from '../utilities/textDisplayReformatter';
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

const CATEGORY_TO_TEXT_TYPE: Record<FormatCategory, textType | null> = {
    plain: 'normal',
    quotes: 'quoted',
    bold: 'bolded',
    italics: 'italicized',
    parentheses: 'parenthesized',
    brackets: 'bracketed',
    strikethrough: 'normal', // Treat strikethrough as normal visible text
};

const BRACED_REGEX = /\{([^}]+)\}/g;

function extractNarratableText(text: string, narrateTexts: Record<textType, boolean>): string {
    // 1. Remove tool calls and results entirely so they are never narrated
    const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toolRegex = new RegExp(
        `(${escapeRegex(toolCallStartString)}[\\s\\S]*?${escapeRegex(toolCallEndString)}|${escapeRegex(toolResultStartString)}[\\s\\S]*?${escapeRegex(toolResultEndString)})`,
        'g'
    );
    const cleanText = text.replace(toolRegex, '');

    // 2. Use the display reformatter to accurately parse visible text and formatting
    const segments = detectFormatSegments(cleanText);
    const parts: string[] = [];

    for (const segment of segments) {
        const textType = CATEGORY_TO_TEXT_TYPE[segment.category];
        
        if (segment.category === 'plain') {
            let plainText = segment.innerText;
            
            // Extract braced text if enabled
            if (narrateTexts.braced) {
                const bracedMatches = plainText.matchAll(BRACED_REGEX);
                for (const match of bracedMatches) {
                    if (match[1]) parts.push(match[1].trim());
                }
                // Remove braced text from plain text so it's not narrated twice
                plainText = plainText.replace(BRACED_REGEX, '');
            }
            
            if (narrateTexts.normal && plainText.trim()) {
                parts.push(plainText.trim());
            }
        } else if (textType && narrateTexts[textType]) {
            // Narrate the inner text of the formatted segment (stripping the markdown/formatting characters)
            parts.push(segment.innerText.trim());
        }
    }

    // Join and clean up excess whitespace
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function useCharacterVoice() {
    const speakMessage = useCallback((text: string, character: Character) => {
        const voice = character.voice;
        const voiceFilename = voice?.voiceFilename;
        const transcript = voice?.textContent;
        const language = voice?.language;

        if (!voiceFilename || !transcript) {
            return; 
        }

        const profile = useSessionStore.getState().interactionData?.profile;
        const narrateTexts = profile?.narrateTexts;
        
        if (!narrateTexts) return;

        // Extract only the visible text and enabled formatted text
        const finalText = extractNarratableText(text, narrateTexts);
        if (!finalText) return;

        (async () => {
            try {
                const voiceUrl = getCharacterVoiceURL(character.id, voiceFilename);
                if (!voiceUrl) return;

                const audioResponse = await fetch(voiceUrl);
                if (!audioResponse.ok) return;
                
                const audioBlob = await audioResponse.blob();
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(audioBlob);
                });

                const context: TextToSpeechContext = { 
                    devicePreference: profile?.textToSpeechDeviceType ?? 'auto' 
                };

                const blob = await textToSpeechEngine.synthesize(
                    finalText, 
                    base64, 
                    transcript, 
                    language,
                    context
                );

                if (blob) {
                    const u = URL.createObjectURL(blob);
                    const a = new Audio(u);
                    a.onended = () => URL.revokeObjectURL(u);
                    a.play().catch(e => console.warn('Text To Speech playback failed:', e));
                }
            } catch (e) {
                console.warn('Text To Speech speak failed:', e);
            }
        })();
    }, []);

    return { speakMessage };
}