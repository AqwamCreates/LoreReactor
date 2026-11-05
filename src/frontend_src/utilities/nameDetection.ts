// src/frontend_src/utilities/nameDetection.ts

import type { Character, TextMessage } from '../types';

// ─── Normalization Layer ──────────────────────────────────────────
const INTERNET_SPEAK_MAP: Record<string, string> = {
    "u": "you",
    "ur": "your",
    "r": "are",
    "im": "i am",
    "ive": "i have",
    "id": "i would",
    "gonna": "going to",
    "wanna": "want to",
    "gotta": "got to",
    "y": "why",
    "k": "okay",
    "ya": "you",
    "ye": "yes",
    "yea": "yes",
    "yeah": "yes",
    "yup": "yes",
    "yep": "yes",
};

function stripFormatting(text: string): string {
    return text
        // Remove *action* or _italic_ wrappers while keeping inner text or stripping pure stage directions
        .replace(/[*_~`]+/g, ' ')
        // Normalize curly quotes/apostrophes to straight ones
        .replace(/[\u2018\u2019\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201F]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeText(text: string): string {
    let normalized = ` ${stripFormatting(text).toLowerCase()} `;
    for (const [shorthand, formal] of Object.entries(INTERNET_SPEAK_MAP)) {
        normalized = normalized.replace(new RegExp(`\\b${shorthand}\\b`, 'gi'), formal);
    }
    return normalized.replace(/\s+/g, ' ');
}

// ─── Regex Patterns ───────────────────────────────────────────────
const NAME_TERMINATOR = String.raw`(?:\s+and|\s+but|\s+who|\s+by\s+the\s+way|\s+though|\s+nice|\s+pleased|\.|,|!|\?|;|:|-|$)`;
const NAME_CAPTURE = String.raw`([a-zA-Z0-9_'’\-\s]{1,50}?)`;

const SELF_NAME_REVEAL_PATTERNS = [
    // "I am Nilou", "I'm Nilou"
    new RegExp(`\\b(?:i am|i'm)\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "My name is Nilou", "My name's Nilou", "The name is Nilou", "The name's Nilou", "Name's Nilou"
    new RegExp(`\\b(?:(?:my|the)\\s+)?name(?:\\s+is|'s)\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "It's me, Nilou", "It is me, Nilou", "It's Nilou", "This is Nilou"
    new RegExp(`\\b(?:it's|it is|this is)\\s+(?:me[,\\s]+)?${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "Call me Nilou", "You can call me Nilou", "Just call me Nilou", "People call me Nilou", "They call me Nilou"
    new RegExp(`\\b(?:(?:you|they|people|everyone|friends)\\s+(?:can|may|usually|just)\\s+)?call\\s+me\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "I go by Nilou", "I'm known as Nilou", "I am called Nilou"
    new RegExp(`\\bi\\s+(?:go\\s+by|(?:am|'m)\\s+(?:known\\s+as|called))\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "Nilou is my name", "Nilou's the name"
    new RegExp(`\\b${NAME_CAPTURE}\\s+(?:is\\s+(?:my|the)\\s+name|'s\\s+(?:my|the)\\s+name)\\b`, 'i'),
    // "Nilou here", "It's just Nilou", "Just Nilou"
    new RegExp(`\\b(?:it's\\s+just|just)\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`(?:^|[.!?]\\s+)${NAME_CAPTURE}\\s+here${NAME_TERMINATOR}`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS = [
    /\bwhat(?:'s|\s+is|\s+are)\s+(?:your|you)\s+(?:name|called)\b/i,
    /\bwho\s+(?:are\s+you|might\s+you\s+be|is\s+this)\b/i,
    /\b(?:what|tell\s+me)\s+your\s+name\b/i,
    /\b(?:what\s+(?:should|can|do|may)\s+i\s+)?(?:call|address)\s+you(?:\s+by)?\b/i,
    /\bmay\s+i\s+(?:have|know|ask)\s+your\s+name\b/i,
    /\band\s+you\s+are\s*\?/i,
    /\byour\s+name\s*\?/i,
    /\bname\s*\?/i,
];

const NAME_PERMISSION_QUESTION_PATTERNS = [
    /\b(?:do|would|can)\s+you\s+want\s+(?:to\s+)?(?:know|hear)\s+(?:my|our)\s+name\b/i,
    /\b(?:shall|should|can|may)\s+i\s+(?:tell|give)\s+you\s+(?:my|our)\s+name\b/i,
];

const PASSIVE_ADDRESS_PATTERNS = [
    // "Nilou, ...", "Nilou! ...", "Nilou? ..."
    new RegExp(`(?:^|[.!?]\\s+)${NAME_CAPTURE}[,:!?.]+`, 'i'),
    // Vocative greetings: "Hey Nilou", "Hello, Nilou", "Hi Nilou", "Oh, Nilou", "Wait, Nilou", "Listen, Nilou"
    new RegExp(`\\b(?:hey|hi|hello|yo|greetings|oh|ah|wait|listen|look|excuse me|sorry|thanks|thank you|mr\\.?|mrs\\.?|ms\\.?|miss|master|lady|lord)\\s*,?\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // Trailing vocative: "..., Nilou." / "..., Nilou?" / "..., Nilou!"
    new RegExp(`,\\s+${NAME_CAPTURE}\\s*[.!?]+(?:\\s|$)`, 'i'),
];

const CONTEXTUAL_PROBE_PATTERNS = [
    // "Nilou, right?", "Nilou, isn't it?", "Nilou, was it?", "Nilou, correct?", "Nilou, yeah?"
    new RegExp(`\\b${NAME_CAPTURE}\\s*,?\\s+(?:right|isn't\\s+it|was\\s+it|wasn't\\s+it|is\\s+it|correct|yes|yeah|huh|eh|no)\\s*\\?`, 'i'),
    // "Right, Nilou?", "Isn't it, Nilou?"
    new RegExp(`\\b(?:right|isn't\\s+it|wasn't\\s+it|correct)\\s*,?\\s+${NAME_CAPTURE}\\s*\\?`, 'i'),
    // "Your name is Nilou?", "Your name's Nilou, right?"
    new RegExp(`\\byour\\s+name(?:\\s+is|'s)\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "You're Nilou, right?", "You are Nilou?", "So you're Nilou"
    new RegExp(`\\b(?:so\\s+)?you(?:'re|\\s+are)\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "Are you Nilou?", "Aren't you Nilou?", "Could you be Nilou?", "Wait, are you Nilou?"
    new RegExp(`\\b(?:are|aren't|were|weren't|could)\\s+you\\s+(?:be\\s+)?${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "Is this Nilou?", "Is that you, Nilou?", "Is it Nilou?"
    new RegExp(`\\bis\\s+(?:this|that|it)\\s+(?:you\\s*,?\\s*)?${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    // "I thought you were Nilou", "You must be Nilou", "You look like Nilou"
    new RegExp(`\\b(?:i\\s+thought\\s+you\\s+were|you\\s+must\\s+be|i\\s+hear\\s+you(?:'re|\\s+are)|they\\s+say\\s+you(?:'re|\\s+are))\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

const AFFIRMATIVE_CONFIRMATION_PATTERNS = [
    /\b(?:yes|yeah|yep|yup|sure|correct|indeed|affirmative|right|exactly|precisely)\b/i,
    /\b(?:that's|that\s+is)\s+(?:me|right|correct|my\s+name|it)\b/i,
    /\b(?:it's|it\s+is)\s+me\b/i,
    /\bi\s+am\b/i,
    /\byou\s+got\s+it\b/i,
];

const NEGATIVE_REJECTION_PATTERNS = [
    /\b(?:no|nope|nah|wrong|incorrect|not\s+me|that's\s+not|it's\s+not|i'm\s+not|i\s+am\s+not)\b/i,
];

const FALSE_POSITIVE_PHRASES = [
    /\b(?:i'?m|i\s+am)\s+(?:going|gonna|coming|leaving|heading|running|walking|moving|trying|looking|waiting|hoping|thinking|wondering|afraid|sure|not|just|still|already|almost|really|very|so|too|here|there|done|finished|ready|happy|sad|angry|tired|hungry|thirsty|cold|hot|fine|okay|ok|good|bad|sorry|glad|excited|nervous|scared|worried|confused|lost|stuck|trapped|alone|bored|busy|free|late|early|back|home|away|out|in|up|down|on|off|a|an|the|your|her|his|their|our)\b/i,
];

// ─── Logic Helpers ───────────────────────────────────────────────

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    const normalized = normalizeText(text);
    for (const pattern of patterns) {
        if (pattern.test(normalized)) return true;
    }
    return false;
}

function isFalsePositive(text: string): boolean {
    return matchesAnyPattern(text, FALSE_POSITIVE_PHRASES);
}

function extractAllCapturedNames(text: string, patterns: RegExp[]): string[] {
    const normalized = normalizeText(text);
    const results: string[] = [];
    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) {
            results.push(match[1].trim());
        }
    }
    return results;
}

function getAllNameVariants(character: Character): string[] {
    const variants: string[] = [];
    const seenLower = new Set<string>();
    const addVariant = (v?: string) => {
        const trimmed = v?.trim();
        if (!trimmed) return;
        const lower = trimmed.toLowerCase();
        if (!seenLower.has(lower)) {
            seenLower.add(lower);
            variants.push(trimmed);
        }
    };
    addVariant(character.name);
    if (character.aliases) {
        for (const alias of character.aliases) {
            addVariant(alias);
        }
    }
    return variants;
}

function matchCharacterVariantsInCapturedText(captured: string, character: Character): string[] {
    const capturedLower = captured.toLowerCase().trim();
    const matchedVariants: string[] = [];
    for (const variant of getAllNameVariants(character)) {
        const variantLower = variant.toLowerCase();
        const escaped = variantLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (capturedLower === variantLower || new RegExp(`\\b${escaped}\\b`, 'i').test(capturedLower)) {
            matchedVariants.push(variant);
        }
    }
    return matchedVariants;
}

function findMentionedVariants(text: string, character: Character): string[] {
    const normalized = normalizeText(text);
    const mentioned: string[] = [];
    for (const variant of getAllNameVariants(character)) {
        const escaped = variant.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalized)) {
            mentioned.push(variant);
        }
    }
    return mentioned;
}

function isAffirmativeConfirmation(text: string): boolean {
    return (
        matchesAnyPattern(text, AFFIRMATIVE_CONFIRMATION_PATTERNS) &&
        !matchesAnyPattern(text, NEGATIVE_REJECTION_PATTERNS)
    );
}

// ─── Main Detection Function ──────────────────────────────────────

export function detectName(
    authorCharacter: Character,
    filteredMessages: TextMessage[],
    currentMessageText?: string,
): Record<string, Record<string, boolean>> {
    const result: Record<string, Record<string, boolean>> = {};

    const unlockName = (charId: string, nameVariant: string) => {
        if (!charId || !nameVariant) return;
        if (!result[charId]) result[charId] = {};
        result[charId][nameVariant] = true;
    };

    // 1. Seed from authorCharacter.knownCharacterNames and previous messages
    if (authorCharacter.knownCharacterNames) {
        for (const [charId, names] of Object.entries(authorCharacter.knownCharacterNames)) {
            for (const n of names) unlockName(charId, n);
        }
    }

    for (const msg of filteredMessages) {
        if (msg.character.id === authorCharacter.id && msg.knownCharacterNames) {
            for (const [charId, nameMap] of Object.entries(msg.knownCharacterNames)) {
                for (const [nameVariant, isKnown] of Object.entries(nameMap)) {
                    if (isKnown) unlockName(charId, nameVariant);
                }
            }
        }
    }

    // Author always knows all of their own names/aliases
    if (authorCharacter.id) {
        for (const name of getAllNameVariants(authorCharacter)) {
            unlockName(authorCharacter.id, name);
        }
    }

    const textToEvaluate = currentMessageText || filteredMessages[filteredMessages.length - 1]?.textContent || '';
    if (!textToEvaluate) return result;

    // 2. Check recent conversation context (was a name asked or probed?)
    let nameQuestionRecentlyAsked = false;
    const recentProbedNamesByCharId = new Map<string, string[]>();

    const recentWindow = filteredMessages.slice(-6);
    for (const msg of recentWindow) {
        if (
            matchesAnyPattern(msg.textContent, NAME_REVEAL_QUESTION_PATTERNS) ||
            matchesAnyPattern(msg.textContent, NAME_PERMISSION_QUESTION_PATTERNS)
        ) {
            nameQuestionRecentlyAsked = true;
        }

        // Check if someone probed a specific name, e.g., "Nilou, right?" or "Are you Nilou?"
        const probedCaptures = extractAllCapturedNames(msg.textContent, CONTEXTUAL_PROBE_PATTERNS);
        if (probedCaptures.length > 0) {
            for (const otherMsg of filteredMessages) {
                const candidateChar = otherMsg.character;
                for (const captured of probedCaptures) {
                    const matchedVariants = matchCharacterVariantsInCapturedText(captured, candidateChar);
                    if (matchedVariants.length > 0) {
                        const existing = recentProbedNamesByCharId.get(candidateChar.id) || [];
                        recentProbedNamesByCharId.set(candidateChar.id, Array.from(new Set([...existing, ...matchedVariants])));
                    }
                }
            }
        }
    }

    const answerToNameQuestionPatterns = [
        // Standalone or short answer when directly asked: "Nilou.", "Nilou!", "It's Nilou.", "Just Nilou."
        new RegExp(`^\\s*(?:it's|it is|i'm|i am|just)?\\s*${NAME_CAPTURE}\\s*[.!?,]*\\s*$`, 'i'),
    ];

    // 3. Detect Self-Reveal in `textToEvaluate`
    const authorMentionedVariants = findMentionedVariants(textToEvaluate, authorCharacter);
    if (authorMentionedVariants.length > 0) {
        const candidateCaptures = [
            ...extractAllCapturedNames(textToEvaluate, SELF_NAME_REVEAL_PATTERNS),
            ...extractAllCapturedNames(textToEvaluate, CONTEXTUAL_PROBE_PATTERNS),
            ...(nameQuestionRecentlyAsked ? extractAllCapturedNames(textToEvaluate, answerToNameQuestionPatterns) : []),
        ];

        for (const captured of candidateCaptures) {
            for (const matched of matchCharacterVariantsInCapturedText(captured, authorCharacter)) {
                unlockName(authorCharacter.id, matched);
            }
        }
    }

    // 4. Detect Other Participants' Names (Self-Reveals, Confirmations, Probes, Direct Address)
    const participants = new Map<string, Character>();
    for (const msg of filteredMessages) {
        if (msg.character?.id && msg.character.id !== authorCharacter.id) {
            participants.set(msg.character.id, msg.character);
        }
    }

    // Evaluate both the latest message (`textToEvaluate`) and recent participant messages
    const messagesToInspect: { speaker: Character | null; text: string }[] = [
        ...recentWindow.map(m => ({ speaker: m.character, text: m.textContent })),
        { speaker: null, text: textToEvaluate },
    ];

    for (const [, participant] of participants) {
        // Case A: Participant was asked "Nilou, right?" / "Are you Nilou?" and replied "Yes" / "It's me" / "That's right"
        const probedVariants = recentProbedNamesByCharId.get(participant.id);
        if (probedVariants && probedVariants.length > 0) {
            for (const entry of messagesToInspect) {
                if ((!entry.speaker || entry.speaker.id === participant.id) && isAffirmativeConfirmation(entry.text)) {
                    for (const variant of probedVariants) {
                        unlockName(participant.id, variant);
                    }
                }
            }
        }

        // Case B: Explicit name mention in current or recent messages
        for (const entry of messagesToInspect) {
            const mentionedVariants = findMentionedVariants(entry.text, participant);
            if (mentionedVariants.length === 0) continue;

            const captures: string[] = [];
            if (!isFalsePositive(entry.text)) {
                captures.push(...extractAllCapturedNames(entry.text, SELF_NAME_REVEAL_PATTERNS));
            }
            if (nameQuestionRecentlyAsked) {
                captures.push(...extractAllCapturedNames(entry.text, answerToNameQuestionPatterns));
            }
            captures.push(
                ...extractAllCapturedNames(entry.text, PASSIVE_ADDRESS_PATTERNS),
                ...extractAllCapturedNames(entry.text, CONTEXTUAL_PROBE_PATTERNS),
            );

            for (const captured of captures) {
                const matchedVariants = matchCharacterVariantsInCapturedText(captured, participant);
                for (const matched of matchedVariants) {
                    unlockName(participant.id, matched);
                }
            }
        }
    }

    return result;
}
