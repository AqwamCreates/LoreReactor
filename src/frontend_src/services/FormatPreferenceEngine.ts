// frontend_src/services/FormatPreferenceEngine.ts
import type { FormatCategory } from '../utilities/textDisplayReformatter';
import { DIALOGUE_STEMS, getStemmedContentWords } from '../utilities/stemmerHelper';
import {
    loadRawFormatPreferences,
    saveRawFormatPreferences,
} from '../storages/serverStorage';

type position = 'start' | 'start middle' | 'middle' | 'middle end' | 'end';
type lengthCategory = 'one' | 'very short' | 'short' | 'medium' | 'long' | 'very long';
type punctuationType = 'none' | 'comma' | 'period' | 'question' | 'exclamation' | 'dash' | 'ellipsis' | 'colon' | 'semicolon';

export interface FormatContext {
    position: position;
    previousFormat?: FormatCategory;
    nextFormat?: FormatCategory;
    insideQuote: boolean;
    afterDialogueTag: boolean;
    lengthCategory: lengthCategory;
    punctuation: punctuationType;
}

export interface FormatPreferenceData {
    globalTransitions: Record<FormatCategory, Record<FormatCategory, number>>;
    featureCounts: Record<string, number>;
    featureTargetCounts: Record<string, Record<FormatCategory, number>>;
    lastUpdatedTimestamp: number;
}

const ALL_CATEGORIES: FormatCategory[] = [
    'plain', 'italics', 'bold', 'strikethrough',
    'quotes', 'parentheses', 'brackets',
];

const AUTO_APPLY_THRESHOLD = 0.75;
const SAVE_DEBOUNCE_MS = 3000;
const LAPLACE_ALPHA = 1;

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
            featureCounts: {},
            featureTargetCounts: {},
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
        if (segmentStart < totalLength * 0.2) {
            position = 'start';
        } else if (segmentStart < totalLength * 0.4) {
            position = 'start middle';
        } else if (segmentEnd > totalLength * 0.8) {
            position = 'end';
        } else if (segmentStart > totalLength * 0.6) {
            position = 'middle end';
        }

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

        const beforeSegment = text.slice(Math.max(0, segmentStart - 100), segmentStart);
        const words = getStemmedContentWords(beforeSegment);
        const lastWord = words.length > 0 ? words[words.length - 1] : '';
        const afterDialogueTag = DIALOGUE_STEMS.has(lastWord);

        let lengthCategory: lengthCategory = 'medium';
        if (segmentLength < 1) lengthCategory = 'one';
        else if (segmentLength < 5) lengthCategory = 'very short';
        else if (segmentLength < 10) lengthCategory = 'short';
        else if (segmentLength > 100) lengthCategory = 'very long';
        else if (segmentLength > 50) lengthCategory = 'long';

        const segmentText = text.slice(segmentStart, segmentEnd).trim();
        let punctuation: punctuationType = 'none';
        
        const trimmedForPunct = segmentText.replace(/[\*_\)\"\]”\s]+$/, '');
        
        if (trimmedForPunct.endsWith('...') || trimmedForPunct.endsWith('…')) punctuation = 'ellipsis';
        else if (trimmedForPunct.endsWith('—') || trimmedForPunct.endsWith('--') || trimmedForPunct.endsWith('-')) punctuation = 'dash';
        else if (trimmedForPunct.endsWith('?')) punctuation = 'question';
        else if (trimmedForPunct.endsWith('!')) punctuation = 'exclamation';
        else if (trimmedForPunct.endsWith(',')) punctuation = 'comma';
        else if (trimmedForPunct.endsWith('.')) punctuation = 'period';
        else if (trimmedForPunct.endsWith(':')) punctuation = 'colon';
        else if (trimmedForPunct.endsWith(';')) punctuation = 'semicolon';

        return {
            position,
            previousFormat,
            nextFormat,
            insideQuote,
            afterDialogueTag,
            lengthCategory,
            punctuation,
        };
    }

    private extractActiveFeatures(context: FormatContext): string[] {
        const features: string[] = [];
        features.push(`position:${context.position}`);
        if (context.previousFormat) features.push(`previous:${context.previousFormat}`);
        if (context.nextFormat) features.push(`next:${context.nextFormat}`);
        if (context.insideQuote) features.push('inQuote');
        if (context.afterDialogueTag) features.push('afterTag');
        features.push(`length:${context.lengthCategory}`);
        if (context.punctuation !== 'none') features.push(`punctuation:${context.punctuation}`);
        return features;
    }

    recordCorrection(
        detected: FormatCategory,
        target: FormatCategory,
        context: FormatContext,
    ): void {
        this.data.globalTransitions[detected][target]++;

        const activeFeatures = this.extractActiveFeatures(context);
        
        for (const feature of activeFeatures) {
            this.data.featureCounts[feature] = (this.data.featureCounts[feature] ?? 0) + 1;
            
            if (!this.data.featureTargetCounts[feature]) {
                this.data.featureTargetCounts[feature] = {} as any;
                for (const cat of ALL_CATEGORIES) {
                    this.data.featureTargetCounts[feature][cat] = 0;
                }
            }
            this.data.featureTargetCounts[feature][target]++;
        }

        this.data.lastUpdatedTimestamp = Date.now();
        this.scheduleSave();
    }

    predictTarget(
        detected: FormatCategory,
        context: FormatContext,
    ): { target: FormatCategory; confidence: number } | null {
        const activeFeatures = this.extractActiveFeatures(context);
        const NUM_CATEGORIES = ALL_CATEGORIES.length;

        let totalGlobal = 0;
        for (const cat of ALL_CATEGORIES) {
            totalGlobal += this.data.globalTransitions[detected][cat];
        }

        if (totalGlobal === 0) return null;

        const logScores: Record<FormatCategory, number> = {} as any;
        
        // 1. Initialize Result_0 with Global Prior
        for (const target of ALL_CATEGORIES) {
            const globalCount = this.data.globalTransitions[detected][target];
            const prior = (globalCount + LAPLACE_ALPHA) / (totalGlobal + LAPLACE_ALPHA * NUM_CATEGORIES);
            logScores[target] = Math.log(prior);
        }

        // 2. Multiplicative Chain (Calculated in Log-Space to prevent IEEE 754 underflow)
        for (const target of ALL_CATEGORIES) {
            for (const feature of activeFeatures) {
                const featCount = this.data.featureCounts[feature] ?? 0;
                const featTargetCount = this.data.featureTargetCounts[feature]?.[target] ?? 0;
                
                const weight = (featTargetCount + LAPLACE_ALPHA) / (featCount + LAPLACE_ALPHA * NUM_CATEGORIES);
                logScores[target] += Math.log(weight);
            }
        }

        // 3. Normalize (Log-Sum-Exp trick to retrieve accurate probabilities)
        const maxLogScore = Math.max(...Object.values(logScores));
        let sumExp = 0;
        for (const target of ALL_CATEGORIES) {
            sumExp += Math.exp(logScores[target] - maxLogScore);
        }

        let bestTarget: FormatCategory | null = null;
        let bestConfidence = 0;

        for (const target of ALL_CATEGORIES) {
            const prob = Math.exp(logScores[target] - maxLogScore) / sumExp;
            if (prob > bestConfidence) {
                bestConfidence = prob;
                bestTarget = target;
            }
        }

        if (bestTarget && bestConfidence >= AUTO_APPLY_THRESHOLD) {
            return { target: bestTarget, confidence: bestConfidence };
        }

        return null;
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
                punctuation: 'none',
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