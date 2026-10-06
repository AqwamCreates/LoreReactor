// frontend_src/utilities/nameDetection.ts
import type { Character, ChatMessage, WhisperMessage } from '../types';

type TextMessage = ChatMessage | WhisperMessage;

// ─── Normalization Layer ──────────────────────────────────────────
const INTERNET_SPEAK_MAP: Record<string, string> = {
    "u": " you ",
    "ur": "your ",
    "r": " are ",
    "im": "i am ",
    "gonna": "going to",
    "wanna": "want to",
    "y": "why",
    "k": "okay",
};

function normalizeText(text: string): string {
    let normalized = ` ${text.toLowerCase()} `;
    for (const [shorthand, formal] of Object.entries(INTERNET_SPEAK_MAP)) {
        normalized = normalized.split(shorthand).join(formal);
    }
    return normalized.trim();
}

// ─── Regex Patterns ───────────────────────────────────────────────
const NAME_TERMINATOR = String.raw`(?:\s+and|\s+but|\s+who|\.|,|!|\?|$)`;
const NAME_CAPTURE = String.raw`([\w\s]{1,50}?)`;

const SELF_NAME_REVEAL_PATTERNS = [
    new RegExp(`i am ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`i'm ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`my name is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`my name's ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
    new RegExp(`${NAME_CAPTURE} is my name`, 'i'),
    new RegExp(`\\bi\\s+go\\s+by\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS = [
    /\bwhat is (?:your|ur) name/i,
    /\bwho (?:are|r) (?:you|u)\b/i,
    /\b(?:what|tell me) (?:your|ur) name\b/i,
    /\b(?:call|address) (?:you|u) by\b/i,
    /\bname\?/i,
];

const NAME_PERMISSION_QUESTION_PATTERNS = [
    /\b(?:do|would|can) (?:you|u) want (?:to )?(?:know|hear) (?:my|our) name\b/i,
    /\b(?:shall|should) i tell (?:you|u) (?:my|our) name\b/i,
];

const PASSIVE_ADDRESS_PATTERNS = [
    new RegExp(`^${NAME_CAPTURE}[,:\\s]+`, 'i'),
    new RegExp(`\\bhey\\s+${NAME_CAPTURE}\\b`, 'i'),
];

const CONTEXTUAL_PROBE_PATTERNS = [
    new RegExp(`your name is ${NAME_CAPTURE}\\?`, 'i'),
    new RegExp(`i thought you were ${NAME_CAPTURE}`, 'i'),
];

const FALSE_POSITIVE_PHRASES = [
    /\bi'?m\s+(?:going|gonna|coming|leaving|heading|running|walking|moving|trying|looking|waiting|hoping|thinking|wondering|afraid|sure|not|just|still|already|almost|really|very|so|too|here|there|done|finished|ready|happy|sad|angry|tired|hungry|thirsty|cold|hot|fine|okay|ok|good|bad|sorry|glad|excited|nervous|scared|worried|confused|lost|stuck|trapped|alone|bored|busy|free|late|early|back|home|away|out|in|up|down|on|off)\b/i,
    /\bi am\s+(?:going|gonna|coming|leaving|heading|running|walking|moving|trying|looking|waiting|hoping|thinking|wondering|afraid|sure|not|just|still|already|almost|really|very|so|too|here|there|done|finished|ready|happy|sad|angry|tired|hungry|thirsty|cold|hot|fine|okay|ok|good|bad|sorry|glad|excited|nervous|scared|worried|confused|lost|stuck|trapped|alone|bored|busy|free|late|early|back|home|away|out|in|up|down|on|off)\b/i,
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

function extractCapturedName(text: string, patterns: RegExp[]): string | null {
    const normalized = normalizeText(text);
    for (const pattern of patterns) {
        const match = normalized.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return null;
}

function getAllNameVariants(character: Character): string[] {
    const variants = new Set<string>();
    if (character.name) variants.add(character.name.toLowerCase());
    if (character.aliases) {
        for (const alias of character.aliases) {
            if (alias) variants.add(alias.toLowerCase());
        }
    }
    return Array.from(variants);
}

function isNameMatchAgainstCharacter(captured: string, character: Character): string | null {
    const capturedLower = captured.toLowerCase().trim();
    for (const variant of getAllNameVariants(character)) {
        if (capturedLower === variant || capturedLower.includes(variant)) {
            return character.name || variant;
        }
    }
    return null;
}

function containsAnyCharacterName(text: string, character: Character): boolean {
    const normalized = normalizeText(text);
    for (const variant of getAllNameVariants(character)) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`\\b${escaped}\\b`, 'i').test(normalized)) return true;
    }
    return false;
}

// ─── Main Detection Function ──────────────────────────────────────

export function detectName(
    authorCharacter: Character,
    filteredMessages: TextMessage[],
    currentMessageText?: string,
): Record<string, Record<string, boolean>> {
    const result: Record<string, Record<string, boolean>> = {};

    // 1. Load Known Names
    if (authorCharacter.knownCharacterNames) {
        for (const [charId, names] of Object.entries(authorCharacter.knownCharacterNames)) {
            result[charId] = Object.fromEntries(names.map(n => [n, true]));
        }
    }

    if (authorCharacter.id) {
        if (!result[authorCharacter.id]) result[authorCharacter.id] = {};
        for (const name of getAllNameVariants(authorCharacter)) {
            result[authorCharacter.id][name] = true;
        }
    }

    const textToEvaluate = currentMessageText || filteredMessages[filteredMessages.length - 1]?.textContent || '';
    if (!textToEvaluate.trim()) return result;

    // 2. State: Was a name requested?
    let nameQuestionRecentlyAsked = false;
    for (const msg of filteredMessages) {
        if (msg.character.id !== authorCharacter.id) {
            if (matchesAnyPattern(msg.textContent, NAME_REVEAL_QUESTION_PATTERNS) || 
                matchesAnyPattern(msg.textContent, NAME_PERMISSION_QUESTION_PATTERNS)) {
                nameQuestionRecentlyAsked = true;
                break;
            }
        }
    }

    // 3. Detect Self-Reveal
    if (!isFalsePositive(textToEvaluate) && containsAnyCharacterName(textToEvaluate, authorCharacter)) {
        const revealed = extractCapturedName(textToEvaluate, SELF_NAME_REVEAL_PATTERNS);
        if (revealed) {
            const matched = isNameMatchAgainstCharacter(revealed, authorCharacter);
            if (matched) {
                if (!result[authorCharacter.id]) result[authorCharacter.id] = {};
                result[authorCharacter.id][matched] = true;
            }
        }
    }

    // 4. Detect Others
    const participants = new Set<Character>();
    for (const msg of filteredMessages) {
        if (msg.character.id !== authorCharacter.id) participants.add(msg.character);
    }

    for (const participant of participants) {
        if (!containsAnyCharacterName(textToEvaluate, participant)) continue;

        const revealed = 
            extractCapturedName(textToEvaluate, SELF_NAME_REVEAL_PATTERNS) ||
            (nameQuestionRecentlyAsked ? extractCapturedName(textToEvaluate, [new RegExp(`^(${NAME_CAPTURE})\\.`, 'i')]) : null) ||
            extractCapturedName(textToEvaluate, PASSIVE_ADDRESS_PATTERNS) ||
            extractCapturedName(textToEvaluate, CONTEXTUAL_PROBE_PATTERNS);

        if (revealed) {
            const matched = isNameMatchAgainstCharacter(revealed, participant);
            if (matched) {
                if (!result[participant.id]) result[participant.id] = {};
                result[participant.id][matched] = true;
            }
        }
    }

    return result;
}