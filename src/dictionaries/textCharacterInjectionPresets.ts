// src/dictionaries/textCharacterInjectionPresets.ts
import type { TextCharacterInjection } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * English letter frequency weights based on large-scale corpus analysis.
 * Source: Oxford Emory Math Center letter frequency data
 * E=12.7%, T=9.1%, A=8.2%, O=7.5%, I=7.0%, N=6.7%, S=6.3%, H=6.1%, R=6.0%
 * Weights are scaled to integers (multiply by 100 for precision)
 */
const ENGLISH_LETTER_WEIGHTS: Record<string, number> = {
    'E': 1270, 'T': 906, 'A': 817, 'O': 751, 'I': 697, 'N': 675, 'S': 633, 'H': 609, 'R': 599,
    'D': 425, 'L': 403, 'C': 278, 'U': 276, 'M': 241, 'W': 236, 'F': 223, 'G': 202, 'Y': 197,
    'P': 193, 'B': 149, 'V': 98, 'K': 77, 'J': 15, 'X': 15, 'Q': 10, 'Z': 7,
};

const LOWERCASE_LETTER_WEIGHTS: Record<string, number> = {};
for (const [k, v] of Object.entries(ENGLISH_LETTER_WEIGHTS)) {
    LOWERCASE_LETTER_WEIGHTS[k.toLowerCase()] = v;
}

/**
 * Punctuation frequency weights based on English text analysis.
 * Period: 65.3/1000 words, Comma: 61.6/1000 words, etc.
 */
const PUNCTUATION_WEIGHTS: Record<string, number> = {
    '.': 653, ',': 616, '"': 267, "'": 243, '!': 80, '?': 56,
    ';': 32, ':': 28, '-': 45, '(': 18, ')': 18, '[': 8, ']': 8,
};

/**
 * Common English bigram weights (two-letter combinations)
 * Source: Oxford Emory digram frequency data [[1]]
 */
const BIGRAM_WEIGHTS: Record<string, number> = {
    'th': 350, 'he': 300, 'in': 240, 'en': 205, 'nt': 200, 're': 185, 'er': 180, 'an': 175,
    'ti': 170, 'es': 165, 'on': 160, 'at': 155, 'se': 150, 'nd': 145, 'or': 140, 'ar': 135,
    'al': 130, 'te': 125, 'co': 120, 'de': 115, 'to': 110, 'ra': 105, 'et': 100, 'ed': 95,
    'it': 90, 'sa': 85, 'em': 80, 'ro': 75,
};

/**
 * Common English trigram weights (three-letter combinations)
 * Source: THE=1.87%, AND=0.78%, ING=0.69%, HER=0.42%, THA=0.40% [[8]] [[14]]
 */
const TRIGRAM_WEIGHTS: Record<string, number> = {
    'the': 1870, 'and': 780, 'tha': 400, 'ent': 380, 'ing': 690, 'ion': 360, 'tio': 310, 'for': 290,
    'nde': 270, 'has': 250, 'nce': 240, 'edt': 220, 'tis': 210, 'oft': 200, 'sth': 190, 'men': 185,
    'her': 420, 'ere': 180, 'ate': 175, 'his': 170, 'con': 165, 'res': 160, 'ver': 155, 'all': 150,
    'ers': 145, 'was': 140, 'oun': 135, 'pro': 130, 'wit': 125, 'com': 120, 'ith': 115,
    'ter': 110, 'ist': 105, 'ess': 100, 'est': 95, 'out': 90, 'our': 85, 'are': 80, 'ect': 75,
};

/**
 * Helper to create a capital-first variant of bigrams/trigrams.
 * E.g., "th" -> "Th", "the" -> "The"
 */
function capitalizeInitial(weights: Record<string, number>): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(weights)) {
        if (key.length === 0) continue;
        const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
        result[capitalized] = value;
    }
    return result;
}

const CAPITALIZED_BIGRAM_WEIGHTS = capitalizeInitial(BIGRAM_WEIGHTS);
const CAPITALIZED_TRIGRAM_WEIGHTS = capitalizeInitial(TRIGRAM_WEIGHTS);

export interface TextCharacterInjectionPreset {
    name: string;
    description: string;
    textCharacters: string[];
    textCharacterWeights: Record<number, number>;
}

const createPreset = (
    name: string,
    description: string,
    charWeights: Record<string, number>,
): TextCharacterInjectionPreset => {
    const textCharacters = Object.keys(charWeights);
    const textCharacterWeights: Record<number, number> = {};
    textCharacters.forEach((char, idx) => {
        textCharacterWeights[idx] = charWeights[char];
    });
    return { name, description, textCharacters, textCharacterWeights };
};

export const TEXT_CHARACTER_INJECTION_PRESETS: TextCharacterInjectionPreset[] = [
    // ─── Letter Presets ─────────────────────────────────────────────
    createPreset(
        'Uppercase Letters (Frequency Weighted)',
        'Single uppercase A-Z weighted by English letter frequency. E=12.7%, T=9.1%, A=8.2%, etc.',
        ENGLISH_LETTER_WEIGHTS,
    ),
    createPreset(
        'Lowercase Letters (Frequency Weighted)',
        'Single lowercase a-z weighted by English letter frequency. e=12.7%, t=9.1%, a=8.2%, etc.',
        LOWERCASE_LETTER_WEIGHTS,
    ),
    createPreset(
        'Uppercase Letters (Uniform)',
        'Single uppercase A-Z with equal probability for each letter.',
        Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, 100])),
    ),
    createPreset(
        'Lowercase Letters (Uniform)',
        'Single lowercase a-z with equal probability for each letter.',
        Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, 100])),
    ),
    createPreset(
        'Mixed Case Letters (Frequency Weighted)',
        'Single letter a-z or A-Z weighted by English frequency. 52 total characters.',
        { ...LOWERCASE_LETTER_WEIGHTS, ...ENGLISH_LETTER_WEIGHTS },
    ),

    // ─── Digit Presets ──────────────────────────────────────────────
    createPreset(
        'Digits (Uniform)',
        'Single digit 0-9 with equal probability.',
        { '0': 100, '1': 100, '2': 100, '3': 100, '4': 100, '5': 100, '6': 100, '7': 100, '8': 100, '9': 100 },
    ),
    createPreset(
        'Hex Characters',
        'Hexadecimal characters 0-9, a-f, A-F. Useful for generating hex-like prefixes.',
        {
            '0': 100, '1': 100, '2': 100, '3': 100, '4': 100, '5': 100, '6': 100, '7': 100, '8': 100, '9': 100,
            'a': 80, 'b': 80, 'c': 80, 'd': 80, 'e': 80, 'f': 80,
            'A': 40, 'B': 40, 'C': 40, 'D': 40, 'E': 40, 'F': 40,
        },
    ),

    // ─── Punctuation & Symbol Presets ───────────────────────────────
    createPreset(
        'Common Punctuation (Frequency Weighted)',
        'Punctuation marks weighted by English text frequency. Period=65.3/1000, comma=61.6/1000.',
        PUNCTUATION_WEIGHTS,
    ),
    createPreset(
        'Common Punctuation (Uniform)',
        'Basic punctuation marks with equal probability.',
        { '.': 100, ',': 100, '!': 100, '?': 100, ';': 100, ':': 100, '-': 100, '(': 100, ')': 100, '[': 100, ']': 100, '"': 100, "'": 100 },
    ),
    createPreset(
        'Special Symbols',
        'Keyboard special characters @#$%^&*+=<> etc.',
        { '@': 100, '#': 100, '$': 100, '%': 100, '^': 100, '&': 100, '*': 100, '+': 100, '=': 100, '<': 100, '>': 100, '~': 100, '`': 100 },
    ),
    createPreset(
        'Markdown Characters',
        'Characters commonly used in Markdown formatting: * # _ ` ~ - > | \\',
        { '*': 100, '#': 100, '_': 100, '`': 100, '~': 100, '-': 100, '>': 100, '|': 100, '\\': 100 },
    ),

    // ─── Whitespace Presets ─────────────────────────────────────────
    createPreset(
        'Whitespace Characters',
        'Space, tab, newline, and various Unicode whitespace characters.',
        {
            ' ': 500, '\t': 100, '\n': 80, '\r': 40,
            '\u00A0': 30, '\u2003': 10, '\u2009': 10,
        },
    ),
    createPreset(
        'Invisible Characters',
        'Zero-width and invisible Unicode characters. Useful for bypassing pattern-based filters.',
        {
            '\u200B': 200, '\u200C': 200, '\u200D': 200, '\uFEFF': 150,
            '\u2060': 150, '\u00AD': 100, '\u034F': 50, '\u180E': 50,
        },
    ),

    // ─── Bigram Presets ─────────────────────────────────────────────
    createPreset(
        'Common Bigrams (Frequency Weighted)',
        'Two-letter combinations weighted by English frequency. "th"=3.5%, "he"=3.0%, "in"=2.4%, etc. [[1]]',
        BIGRAM_WEIGHTS,
    ),
    createPreset(
        'Common Bigrams (Uniform)',
        'Common two-letter combinations with equal probability.',
        Object.fromEntries(Object.keys(BIGRAM_WEIGHTS).map(bg => [bg, 100])),
    ),
    createPreset(
        'Common Bigrams - Capitalized (Frequency Weighted)',
        'Two-letter combinations with first letter uppercase, weighted by English frequency. "Th"=3.5%, "He"=3.0%, "In"=2.4%, etc.',
        CAPITALIZED_BIGRAM_WEIGHTS,
    ),
    createPreset(
        'Common Bigrams - Capitalized (Uniform)',
        'Common two-letter combinations with first letter uppercase, equal probability.',
        Object.fromEntries(Object.keys(CAPITALIZED_BIGRAM_WEIGHTS).map(bg => [bg, 100])),
    ),

    // ─── Trigram Presets ────────────────────────────────────────────
    createPreset(
        'Common Trigrams (Frequency Weighted)',
        'Three-letter combinations weighted by English frequency. "the"=1.87%, "and"=0.78%, "ing"=0.69%, "her"=0.42%, "tha"=0.40%, etc. [[8]] [[9]]',
        TRIGRAM_WEIGHTS,
    ),
    createPreset(
        'Common Trigrams (Uniform)',
        'Common three-letter combinations with equal probability.',
        Object.fromEntries(Object.keys(TRIGRAM_WEIGHTS).map(tg => [tg, 100])),
    ),
    createPreset(
        'Common Trigrams - Capitalized (Frequency Weighted)',
        'Three-letter combinations with first letter uppercase, weighted by English frequency. "The"=1.87%, "And"=0.78%, "Ing"=0.69%, etc.',
        CAPITALIZED_TRIGRAM_WEIGHTS,
    ),
    createPreset(
        'Common Trigrams - Capitalized (Uniform)',
        'Common three-letter combinations with first letter uppercase, equal probability.',
        Object.fromEntries(Object.keys(CAPITALIZED_TRIGRAM_WEIGHTS).map(tg => [tg, 100])),
    ),

    // ─── Combined/Mixed Presets ─────────────────────────────────────
    createPreset(
        'Mixed Alphanumeric (Uniform)',
        'Letters (a-z, A-Z) and digits (0-9) with equal probability. 62 characters total.',
        Object.fromEntries([
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('').map(c => [c, 100]),
        ]),
    ),
    createPreset(
        'Mixed Alphanumeric (Frequency Weighted)',
        'Letters weighted by frequency, digits uniform. Realistic-looking prefixes.',
        { ...LOWERCASE_LETTER_WEIGHTS, ...ENGLISH_LETTER_WEIGHTS, '0': 100, '1': 100, '2': 100, '3': 100, '4': 100, '5': 100, '6': 100, '7': 100, '8': 100, '9': 100 },
    ),
    createPreset(
        'Letters + Punctuation (Frequency Weighted)',
        'All letters and common punctuation, weighted by English text frequency.',
        { ...LOWERCASE_LETTER_WEIGHTS, ...ENGLISH_LETTER_WEIGHTS, ...PUNCTUATION_WEIGHTS },
    ),

    // ─── Special Purpose Presets ────────────────────────────────────
    createPreset(
        'Base64 Characters',
        'Valid Base64 alphabet: A-Z, a-z, 0-9, +, /. Useful for creating Base64-like prefixes.',
        {
            ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, 100])),
            ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, 100])),
            ...Object.fromEntries('0123456789'.split('').map(c => [c, 100])),
            '+': 50, '/': 50,
        },
    ),
    createPreset(
        'URL-Safe Characters',
        'Characters safe for use in URLs without encoding.',
        {
            ...Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map(c => [c, 100])),
            ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c => [c, 100])),
            ...Object.fromEntries('0123456789'.split('').map(c => [c, 100])),
            '-': 100, '_': 100, '.': 100, '~': 100,
        },
    ),
    createPreset(
        'Bracket Pairs',
        'Common bracket types for wrapping injections.',
        { '(': 100, ')': 100, '[': 100, ']': 100, '{': 100, '}': 100, '<': 100, '>': 100 },
    ),
    createPreset(
        'Mathematical Symbols',
        'Common mathematical operators and symbols.',
        { '+': 100, '-': 100, '×': 100, '÷': 100, '=': 100, '≠': 100, '<': 100, '>': 100, '≤': 100, '≥': 100, '±': 100, '∑': 50, '∏': 50, '√': 50, '∞': 30, 'π': 30 },
    ),
    createPreset(
        'Arrow Characters',
        'Various arrow symbols used in text.',
        { '←': 100, '→': 100, '↑': 100, '↓': 100, '↔': 100, '⇐': 50, '⇒': 50, '⇑': 50, '⇓': 50, '⟶': 30, '⟵': 30, '➜': 80, '➤': 80 },
    ),
];

/**
 * Creates a TextCharacterInjection entity from a preset definition.
 */
export function createInjectionFromPreset(
    preset: TextCharacterInjectionPreset,
    overrides?: Partial<TextCharacterInjection>,
): TextCharacterInjection {
    const now = Date.now();
    return {
        id: uuidv4(),
        name: preset.name,
        description: preset.description,
        textCharacters: [...preset.textCharacters],
        textCharacterWeights: { ...preset.textCharacterWeights },
        textCharacterInjectionBindings: [],
        textCharacterInjectionWeight: overrides?.textCharacterInjectionWeight ?? 1,
        textCharacterBreakProbability: overrides?.textCharacterBreakProbability ?? 0,
        textCharacterSkipProbability: overrides?.textCharacterSkipProbability ?? 0,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
        ...overrides,
    };
}