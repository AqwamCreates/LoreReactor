// src/services/ActionFormatEngine.ts
import { loadActionFormatData, saveActionFormatData } from '../storages/serverStorage';
import type { ActionFormatData } from '../types';

export type ActionWrap = '*' | '()' | 'none';
export type ActionCase = 'first' | 'pascal' | 'lower';
export type ActionPunctuation = '.' | '-' | 'none';

export interface ActionFormatPrediction {
    wrap: ActionWrap;
    casing: ActionCase;
    punctuation: ActionPunctuation;
}

export interface ActionFormatUIState {
    actionWrap: ActionWrap;
    actionCase: ActionCase;
    actionPunctuation: ActionPunctuation;
    isAutoFormat: boolean;
}

interface FormatCounts {
    [key: string]: number;
}

const MIN_SAMPLES = 2;
const CONFIDENCE_THRESHOLD = 0.6;
const SAVE_DEBOUNCE_MS = 3000;

class ActionFormatEngine {
    private matrix: Record<string, FormatCounts> = {};
    private uiState: ActionFormatUIState = {
        actionWrap: '*',
        actionCase: 'first',
        actionPunctuation: '.',
        isAutoFormat: false,
    };
    private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {}

    // ─── UI State Management ─────────────────────────────────────────

    setUIPreferences(state: Partial<ActionFormatUIState>): void {
        this.uiState = { ...this.uiState, ...state };
        this.scheduleSave();
    }

    getUIPreferences(): ActionFormatUIState {
        return { ...this.uiState };
    }

    // ─── Matrix Management ───────────────────────────────────────────

    private getContextKey(label: string, prevWrap: ActionWrap | 'unknown'): string {
        return `${label.toLowerCase()}|${prevWrap}`;
    }

    private getFallbackContextKey(prevWrap: ActionWrap | 'unknown'): string {
        return `__ANY__|${prevWrap}`;
    }

    record(label: string, prevWrap: ActionWrap | 'unknown', format: ActionFormatPrediction): void {
        const formatKey = `${format.wrap}|${format.casing}|${format.punctuation}`;
        
        const ctxKey = this.getContextKey(label, prevWrap);
        if (!this.matrix[ctxKey]) this.matrix[ctxKey] = {};
        this.matrix[ctxKey][formatKey] = (this.matrix[ctxKey][formatKey] || 0) + 1;

        const fallbackKey = this.getFallbackContextKey(prevWrap);
        if (!this.matrix[fallbackKey]) this.matrix[fallbackKey] = {};
        this.matrix[fallbackKey][formatKey] = (this.matrix[fallbackKey][formatKey] || 0) + 1;

        this.scheduleSave();
    }

    predict(label: string, prevWrap: ActionWrap | 'unknown'): ActionFormatPrediction | null {
        let counts = this.matrix[this.getContextKey(label, prevWrap)];
        let prediction = this.calculateBest(counts);
        if (prediction) return prediction;

        counts = this.matrix[this.getContextKey(label, 'unknown')];
        prediction = this.calculateBest(counts);
        if (prediction) return prediction;

        counts = this.matrix[this.getFallbackContextKey(prevWrap)];
        prediction = this.calculateBest(counts);
        if (prediction) return prediction;

        return null;
    }

    private calculateBest(counts: FormatCounts | undefined): ActionFormatPrediction | null {
        if (!counts) return null;

        let total = 0;
        let bestKey = '';
        let bestCount = 0;

        for (const [key, count] of Object.entries(counts)) {
            total += count;
            if (count > bestCount) {
                bestCount = count;
                bestKey = key;
            }
        }

        if (total < MIN_SAMPLES || bestCount / total < CONFIDENCE_THRESHOLD) {
            return null;
        }

        const [wrap, casing, punctuation] = bestKey.split('|') as [ActionWrap, ActionCase, ActionPunctuation];
        return { wrap, casing, punctuation };
    }

    // ─── Unified Persistence ──────────────────────────────────────────

    private scheduleSave(): void {
        if (this.saveDebounceTimer !== null) clearTimeout(this.saveDebounceTimer);
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = null;
            const payload: ActionFormatData = {
                ...this.uiState,
                matrix: this.matrix,
            };
            saveActionFormatData(payload).catch(e =>
                console.warn('[ActionFormatEngine] Failed to save:', e)
            );
        }, SAVE_DEBOUNCE_MS);
    }

    static async load(): Promise<ActionFormatEngine> {
        const engine = new ActionFormatEngine();
        try {
            const data = await loadActionFormatData();
            if (data) {
                if (data.matrix) engine.matrix = data.matrix;
                if (data.actionWrap) engine.uiState.actionWrap = data.actionWrap;
                if (data.actionCase) engine.uiState.actionCase = data.actionCase;
                if (data.actionPunctuation) engine.uiState.actionPunctuation = data.actionPunctuation;
                if (typeof data.isAutoFormat === 'boolean') engine.uiState.isAutoFormat = data.isAutoFormat;
            }
        } catch (e) {
            console.warn('[ActionFormatEngine] Failed to load:', e);
        }
        return engine;
    }
}

let instance: ActionFormatEngine | null = null;

export function getActionFormatEngine(): ActionFormatEngine {
    if (!instance) instance = new ActionFormatEngine();
    return instance;
}

export async function initializeActionFormatEngine(): Promise<ActionFormatEngine> {
    if (!instance) {
        instance = await ActionFormatEngine.load();
    }
    return instance;
}

/**
 * Scans a user's manual message for known action labels and extracts 
 * the formatting used. Feeds the engine to learn from free-typing.
 */
export function learnFromUserMessage(text: string, actionLabels: string[], prevUserWrap: ActionWrap | 'unknown'): void {
    const engine = getActionFormatEngine();
    
    for (const label of actionLabels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patterns = [
            { regex: new RegExp(`\\*(${escaped}[^\\*]*)\\*`, 'i'), wrap: '*' as ActionWrap },
            { regex: new RegExp(`\\((${escaped}[^\\)]*)\\)`, 'i'), wrap: '()' as ActionWrap },
            { regex: new RegExp(`(?:^|\\s)(${escaped}[^\\.\-\\*\\)]*)(?:\\.|\\-)?(?:\\s|$)`, 'i'), wrap: 'none' as ActionWrap },
        ];

        for (const { regex, wrap } of patterns) {
            const match = regex.exec(text);
            if (match) {
                const inner = match[1];
                const firstChar = inner.charAt(0);
                const isPascal = inner.split(' ').every(w => w.length > 0 && w.charAt(0) === w.charAt(0).toUpperCase());
                
                let casing: ActionCase = 'lower';
                if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
                    casing = isPascal ? 'pascal' : 'first';
                }

                const fullMatch = match[0].trim();
                let punct: ActionPunctuation = 'none';
                if (fullMatch.endsWith('.')) punct = '.';
                else if (fullMatch.endsWith('-')) punct = '-';

                engine.record(label, prevUserWrap, { wrap, casing, punctuation: punct });
                break; 
            }
        }
    }
}