// src/ambientNarration/composer.ts
import type { Atom } from './atoms';
import { ATOMS, resolveAtomText } from './atoms';

export interface DetectedContext {
    tags: Set<string>;
    dominantMood: string;
}

export function detectContext(text: string): DetectedContext {
    const lower = text.toLowerCase();
    const matchedTags = new Set<string>();
    const moodScores: Record<string, number> = { calm: 0, tense: 0, melancholy: 0, warm: 0, cold: 0, neutral: 0 };

    for (const atom of ATOMS) {
        for (const tag of atom.tags) {
            if (lower.includes(tag)) {
                matchedTags.add(tag);
                if (atom.mood) moodScores[atom.mood]++;
            }
        }
    }

    let dominantMood = 'neutral';
    let bestScore = 0;
    for (const [mood, score] of Object.entries(moodScores)) {
        if (score > bestScore) { bestScore = score; dominantMood = mood; }
    }

    return { tags: matchedTags, dominantMood };
}

function pickAtom(position: 'open' | 'mid' | 'close', contextTags: Set<string>, mood: string, exclude: Set<string>): Atom | null {
    const candidates = ATOMS.filter(a => a.position === position && !exclude.has(a.template || a.text || ''));
    if (candidates.length === 0) return null;

    const scored = candidates.map(atom => {
        let score = 0;
        for (const tag of atom.tags) {
            if (contextTags.has(tag)) score += 2;
        }
        if (atom.mood === mood) score += 3;
        if (atom.mood === 'neutral') score += 1;
        score += Math.random() * 1.5;
        return { atom, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].atom;
}

/** Fallback narration when LLM generation fails. Composes from atomic fragments. */
export function composeFallbackSentence(contextTags: Set<string>, mood: string, recentLines: string[]): string {
    // Track resolved strings to avoid repetition of actual output
    const usedResolved = new Set(recentLines);
    // Track templates to avoid picking the same template twice per composition
    const usedTemplates = new Set<string>();

    const opener = pickAtom('open', contextTags, mood, usedTemplates);
    if (!opener) return 'Stillness fills the space between words.';
    usedTemplates.add(opener.template || opener.text || '');

    const openerText = resolveAtomText(opener);
    usedResolved.add(openerText);

    let middleText = '';
    if (Math.random() < 0.6) {
        const middle = pickAtom('mid', contextTags, mood, usedTemplates);
        if (middle) {
            usedTemplates.add(middle.template || middle.text || '');
            middleText = resolveAtomText(middle);
            usedResolved.add(middleText);
        }
    }

    const closer = pickAtom('close', contextTags, mood, usedTemplates);
    if (!closer) return `${openerText}${middleText}.`;

    const closerText = resolveAtomText(closer);
    return openerText + middleText + closerText;
}