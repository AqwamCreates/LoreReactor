// src/services/FormatPreferenceEngine.ts
import type { FormatCategory } from '../utilities/textReformat';
import { DIALOGUE_STEMS, getStemmedContentWords } from '../utilities/stemmerHelper';
import {
    loadRawFormatPreferences,
    saveRawFormatPreferences,
} from '../storages/serverStorage';

type position = 'start' | 'start middle' | 'middle' | 'middle end' | 'end'

type lengthCategory = 'one' | 'very short' | 'short' | 'medium' | 'long' | 'very long';

export interface FormatContext {
    position: position;
    previousFormat?: FormatCategory;
    nextFormat?: FormatCategory;
    insideQuote: boolean;
    afterDialogueTag: boolean;
    lengthCategory: lengthCategory;
}

interface UserCorrection {
    detected: FormatCategory;
    target: FormatCategory;
    context: FormatContext;
    timestamp: number;
}

export interface FormatPreferenceData {
    globalTransitions: Record<FormatCategory, Record<FormatCategory, number>>;
    contextTransitions: Record<string, Record<FormatCategory, Record<FormatCategory, number>>>;
    recentCorrections: UserCorrection[];
    lastUpdatedTimestamp: number;
}

const ALL_CATEGORIES: FormatCategory[] = [
    'plain', 'italics', 'bold', 'strikethrough',
    'quotes', 'parentheses', 'brackets',
];

const AUTO_APPLY_THRESHOLD = 0.75;
const MAX_RECENT_CORRECTIONS = 100;
const SAVE_DEBOUNCE_MS = 3000;

export class FormatPreferenceEngine {
    private data: FormatPreferenceData;
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(initialData?: FormatPreferenceData) {
        this.data = initialData ?? this.createEmptyData();
    }

    private createEmptyData(): FormatPreferenceData {
        const globalTransitions: Record<FormatCategory, Record<FormatCategory, number>> = {} as any;
        for (const cat of ALL_CATEGORIES) {
            globalTransitions[cat] = {} as any;
            for (const target of ALL_CATEGORIES) {
                globalTransitions[cat][target] = 0;
            }
        }

        return {
            globalTransitions,
            contextTransitions: {},
            recentCorrections: [],
            lastUpdatedTimestamp: Date.now(),
        };
    }

    extractContext(
        text: string,
        segmentStart: number,
        segmentEnd: number,
        segments: { start: number; end: number; category: FormatCategory }[],
    ): FormatContext {
        const totalLength = text.length;
        const segmentLength = segmentEnd - segmentStart;

        let position: position = 'middle';
        if (segmentStart < totalLength * 0.2) position = 'start';
        if (segmentStart < totalLength * 0.4) position = 'start middle';
        if (segmentStart > totalLength * 0.6) position = 'middle end';
        else if (segmentEnd > totalLength * 0.8) position = 'end';

        const currentSegmentIndex = segments.findIndex(
            s => s.start === segmentStart && s.end === segmentEnd
        );
        const previousFormat = currentSegmentIndex > 0
            ? segments[currentSegmentIndex - 1].category
            : undefined;
        const nextFormat = currentSegmentIndex < segments.length - 1
            ? segments[currentSegmentIndex + 1].category
            : undefined;

        const textBefore = text.slice(0, segmentStart);
        const quoteMatches = textBefore.match(/["“”]/g) || [];
        const insideQuote = quoteMatches.length % 2 !== 0;

        // Use stemmed content words to detect dialogue tags robustly
        const beforeSegment = text.slice(Math.max(0, segmentStart - 100), segmentStart);
        const words = getStemmedContentWords(beforeSegment);
        const lastWord = words.length > 0 ? words[words.length - 1] : '';
        const afterDialogueTag = DIALOGUE_STEMS.has(lastWord);

        // Fixed logic: use else-if to prevent overwriting
        let lengthCategory: lengthCategory = 'medium';
        if (segmentLength < 1) lengthCategory = 'one';
        else if (segmentLength < 5) lengthCategory = 'very short';
        else if (segmentLength < 10) lengthCategory = 'short';
        else if (segmentLength > 100) lengthCategory = 'very long';
        else if (segmentLength > 50) lengthCategory = 'long';

        return {
            position,
            previousFormat,
            nextFormat,
            insideQuote,
            afterDialogueTag,
            lengthCategory,
        };
    }

    private contextToKey(context: FormatContext): string {
        const parts: string[] = [];
        parts.push(`pos:${context.position}`);
        if (context.previousFormat) parts.push(`prev:${context.previousFormat}`);
        if (context.nextFormat) parts.push(`next:${context.nextFormat}`);
        if (context.insideQuote) parts.push('inQuote');
        if (context.afterDialogueTag) parts.push('afterTag');
        parts.push(`len:${context.lengthCategory}`);
        return parts.join('|');
    }

    recordCorrection(
        detected: FormatCategory,
        target: FormatCategory,
        context: FormatContext,
    ): void {
        this.data.globalTransitions[detected][target]++;

        const contextKey = this.contextToKey(context);
        if (!this.data.contextTransitions[contextKey]) {
            this.data.contextTransitions[contextKey] = {} as any;
            for (const cat of ALL_CATEGORIES) {
                this.data.contextTransitions[contextKey][cat] = {} as any;
                for (const tgt of ALL_CATEGORIES) {
                    this.data.contextTransitions[contextKey][cat][tgt] = 0;
                }
            }
        }
        this.data.contextTransitions[contextKey][detected][target]++;

        this.data.recentCorrections.push({
            detected,
            target,
            context,
            timestamp: Date.now(),
        });
        if (this.data.recentCorrections.length > MAX_RECENT_CORRECTIONS) {
            this.data.recentCorrections.shift();
        }

        this.data.lastUpdatedTimestamp = Date.now();
        this.scheduleSave();
    }

    predictTarget(
        detected: FormatCategory,
        context: FormatContext,
    ): { target: FormatCategory; confidence: number } | null {
        const contextKey = this.contextToKey(context);

        if (this.data.contextTransitions[contextKey]) {
            const contextPrediction = this.calculateBestTarget(
                this.data.contextTransitions[contextKey][detected]
            );
            if (contextPrediction && contextPrediction.confidence >= AUTO_APPLY_THRESHOLD) {
                return contextPrediction;
            }
        }

        const globalPrediction = this.calculateBestTarget(
            this.data.globalTransitions[detected]
        );
        if (globalPrediction && globalPrediction.confidence >= AUTO_APPLY_THRESHOLD) {
            return globalPrediction;
        }

        return null;
    }

    private calculateBestTarget(
        transitions: Record<FormatCategory, number>
    ): { target: FormatCategory; confidence: number } | null {
        let totalCorrections = 0;
        let bestTarget: FormatCategory | null = null;
        let bestCount = 0;

        for (const target of ALL_CATEGORIES) {
            const count = transitions[target] ?? 0;
            totalCorrections += count;
            if (count > bestCount) {
                bestCount = count;
                bestTarget = target;
            }
        }

        if (!bestTarget || totalCorrections === 0) {
            return null;
        }

        const confidence = bestCount / totalCorrections;
        return { target: bestTarget, confidence };
    }

    getPreferenceData(): FormatPreferenceData {
        return { ...this.data };
    }

    getAutoConversions(): Record<FormatCategory, { target: FormatCategory; confidence: number } | null> {
        const result: Record<FormatCategory, { target: FormatCategory; confidence: number } | null> = {} as any;

        for (const cat of ALL_CATEGORIES) {
            const defaultContext: FormatContext = {
                position: 'middle',
                insideQuote: false,
                afterDialogueTag: false,
                lengthCategory: 'medium',
            };
            result[cat] = this.predictTarget(cat, defaultContext);
        }

        return result;
    }

    reset(): void {
        this.data = this.createEmptyData();
        this.scheduleSave();
    }

    private scheduleSave(): void {
        if (this.saveDebounceTimer !== null) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            saveRawFormatPreferences(this.data).catch(e =>
                console.warn('[FormatPreferenceEngine] Failed to save preferences:', e)
            );
        }, SAVE_DEBOUNCE_MS);
    }

    async persist(): Promise<void> {
        if (this.saveDebounceTimer !== null) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }
        await saveRawFormatPreferences(this.data);
    }

    static async load(): Promise<FormatPreferenceEngine> {
        try {
            const data = await loadRawFormatPreferences();
            return new FormatPreferenceEngine(data ?? undefined);
        } catch (e) {
            console.warn('[FormatPreferenceEngine] Failed to load preferences:', e);
            return new FormatPreferenceEngine();
        }
    }
}

let instance: FormatPreferenceEngine | null = null;

export function getFormatPreferenceEngine(): FormatPreferenceEngine {
    if (!instance) {
        instance = new FormatPreferenceEngine();
    }
    return instance;
}

export async function initializeFormatPreferenceEngine(): Promise<FormatPreferenceEngine> {
    instance = await FormatPreferenceEngine.load();
    return instance;
}

export function resetFormatPreferenceEngine(): void {
    instance = null;
}