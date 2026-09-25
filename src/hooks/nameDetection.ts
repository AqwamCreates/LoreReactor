// src/hooks/nameDetection.ts
import type { Character, ChatMessage, WhisperMessage } from '../types';

type TextMessage = ChatMessage | WhisperMessage;

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
    new RegExp(`mine is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS = [
    /\bnames?\?/i,
    /\b(?:call|address|refer\s+to)\s+(?:you|thy|thee).*?\?/i,
    /\babout\s+(?:you|thy|thee).*?\?/i,
    /\bare\s+(?:you|thy|thee).*?\?/i,
    /\b(?:you|thy|thee)\s+are.*?\?/i,
    /\b(?:you|thy|thee)\s+go\s+by\b.*?\?/i,
    /\b(?:want|need|tell\s+me|give\s+me|say)\s+(?:your|ur|the|a)\s+name\b/i,
    /\b(?:what(?:'s| is))?\s*(?:your|ur)\s+name\b/i,
    /\b(?:introduce|identify)\s+(?:yourself|thyself)\b/i,
    /\bwho\s+(?:are|r)\s+(?:you|u|thy|thee)\b/i,
];

const NAME_PERMISSION_QUESTION_PATTERNS = [
    /\b(?:do|would|should|can|may)\s+(?:you|u)\s+(?:want|like|wish)\s+(?:to\s+)?(?:know|hear)\s+(?:my|our)\s+name\b/i,
    /\b(?:want|would\s+you\s+like)\s+(?:to\s+)?(?:know|hear)\s+(?:my|our)\s+name\b/i,
    /\b(?:shall|i\s+should)\s+(?:tell|say)\s+(?:you|u)\s+(?:my|our)\s+name\b/i,
    /\b(?:ready\s+for\s+my\s+name|should\s+i\s+introduce\s+myself)\b/i,
    /\bi\s+go\s+by\b.*?\?/i,
];

const FALSE_POSITIVE_PHRASES = [
    /\bi'?m\s+(?:going|gonna|coming|leaving|heading|running|walking|moving|trying|looking|waiting|hoping|thinking|wondering|afraid|sure|not|just|still|already|almost|really|very|so|too|here|there|done|finished|ready|happy|sad|angry|tired|hungry|thirsty|cold|hot|fine|okay|ok|good|bad|sorry|glad|excited|nervous|scared|worried|confused|lost|stuck|trapped|alone|bored|busy|free|late|early|back|home|away|out|in|up|down|on|off)\b/i,
    /\bi am\s+(?:going|gonna|coming|leaving|heading|running|walking|moving|trying|looking|waiting|hoping|thinking|wondering|afraid|sure|not|just|still|already|almost|really|very|so|too|here|there|done|finished|ready|happy|sad|angry|tired|hungry|thirsty|cold|hot|fine|okay|ok|good|bad|sorry|glad|excited|nervous|scared|worried|confused|lost|stuck|trapped|alone|bored|busy|free|late|early|back|home|away|out|in|up|down|on|off)\b/i,
    /\bi'?m\s+(?:a|an|the)\s+/i,
    /\bi am\s+(?:a|an|the)\s+/i,
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
}

function isFalsePositive(text: string): boolean {
    return matchesAnyPattern(text, FALSE_POSITIVE_PHRASES);
}

function extractCapturedName(text: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }
    return null;
}

/** Get all name variants for a character: real name + aliases */
function getAllNameVariants(character: Character): string[] {
    const variants: string[] = [];
    if (character.name) variants.push(character.name);
    if (character.aliases) {
        for (const alias of character.aliases) {
            if (alias && !variants.includes(alias)) variants.push(alias);
        }
    }
    return variants;
}

/** Check if captured text matches any variant of a character's name */
function isNameMatchAgainstCharacter(captured: string, character: Character): string | null {
    const capturedLower = captured.toLowerCase().trim();
    if (!capturedLower) return null;

    for (const variant of getAllNameVariants(character)) {
        const targetLower = variant.toLowerCase().trim();
        if (!targetLower) continue;

        if (capturedLower === targetLower) return variant;

        const capturedWords = capturedLower.split(/\s+/);
        const targetWords = targetLower.split(/\s+/);

        for (let i = 0; i <= capturedWords.length - targetWords.length; i++) {
            let allMatch = true;
            for (let j = 0; j < targetWords.length; j++) {
                if (capturedWords[i + j] !== targetWords[j]) {
                    allMatch = false;
                    break;
                }
            }
            if (allMatch) return variant;
        }
    }

    return null;
}

/** Check if text contains any variant of a character's name */
function containsAnyCharacterName(text: string, character: Character): boolean {
    for (const variant of getAllNameVariants(character)) {
        const targetLower = variant.toLowerCase().trim();
        if (!targetLower) continue;
        const escaped = targetLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (wordBoundaryRegex.test(text)) return true;
    }
    return false;
}

function detectDirectNameRevealVariant(text: string, character: Character): string | null {
    if (isFalsePositive(text)) return null;
    if (!containsAnyCharacterName(text, character)) return null;

    const capturedName = extractCapturedName(text, SELF_NAME_REVEAL_PATTERNS);
    if (!capturedName) return null;
    return isNameMatchAgainstCharacter(capturedName, character);
}

function detectBareNameDeclarationVariant(text: string, character: Character): string | null {
    if (isFalsePositive(text)) return null;
    if (!containsAnyCharacterName(text, character)) return null;

    const bareNameMatch = text.match(new RegExp(`^(${NAME_CAPTURE})\\.`, 'm'));
    if (!bareNameMatch?.[1]) return null;
    return isNameMatchAgainstCharacter(bareNameMatch[1].trim(), character);
}

function detectNameRevealVariant(text: string, character: Character, nameQuestionRecentlyAsked = false): string | null {
    if (!containsAnyCharacterName(text, character)) return null;

    const directReveal = detectDirectNameRevealVariant(text, character);
    if (directReveal) return directReveal;

    if (!isFalsePositive(text)) {
        const capturedName = extractCapturedName(text, SELF_NAME_REVEAL_PATTERNS);
        if (capturedName) {
            const matched = isNameMatchAgainstCharacter(capturedName, character);
            if (matched) return matched;
        }
    }

    if (nameQuestionRecentlyAsked) {
        const bareDecl = detectBareNameDeclarationVariant(text, character);
        if (bareDecl) return bareDecl;
    }

    return null;
}

function detectNameQuestion(text: string): boolean {
    return matchesAnyPattern(text, NAME_REVEAL_QUESTION_PATTERNS);
}

function detectNamePermissionSequenceVariant(
    filteredMessages: TextMessage[],
    authorCharacter: Character,
    targetCharacter: Character,
    text: string,
): string | null {
    if (!containsAnyCharacterName(text, targetCharacter)) return null;
    if (isFalsePositive(text)) return null;

    let previousMessageBySameCharacter: TextMessage | null = null;
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
        if (filteredMessages[i].character.id === authorCharacter.id) {
            previousMessageBySameCharacter = filteredMessages[i];
            break;
        }
    }

    if (!previousMessageBySameCharacter) return null;

    const wasPermissionAsked = matchesAnyPattern(
        previousMessageBySameCharacter.textContent,
        NAME_PERMISSION_QUESTION_PATTERNS,
    );

    if (!wasPermissionAsked) return null;

    const directReveal = detectDirectNameRevealVariant(text, targetCharacter);
    if (directReveal) return directReveal;

    const trimmed = text.trim();
    const isLikelyJustAName = trimmed.split(/\s+/).length <= 3 && !/[.!?]/.test(trimmed);
    if (isLikelyJustAName) {
        const matched = isNameMatchAgainstCharacter(trimmed, targetCharacter);
        if (matched) return matched;
    }

    return null;
}

/**
 * Detect name reveals in the latest message authored by `character`.
 * Returns an updated knownCharacterNames snapshot reflecting newly detected knowledge.
 * Uses character.knownCharacterNames as the baseline for existing persistent knowledge.
 *
 * @param character The character whose knowledge is being updated
 * @param filteredMessages Pre-filtered text messages scoped to visible messages.
 *   The caller is responsible for filtering; this function only processes what it receives.
 */
export function detectName(
    character: Character,
    filteredMessages: TextMessage[],
): Record<string, Record<string, boolean>> {
    // Start from the character's persistent knowledge as baseline
    const result: Record<string, Record<string, boolean>> = {};
    if (character.knownCharacterNames) {
        for (const [charId, names] of Object.entries(character.knownCharacterNames)) {
            result[charId] = {};
            for (const name of names) {
                result[charId][name] = true;
            }
        }
    }

    // Get the latest text message by this character from the filtered messages
    let latestMessage: TextMessage | null = null;
    for (let i = filteredMessages.length - 1; i >= 0; i--) {
        if (filteredMessages[i].character.id === character.id) {
            latestMessage = filteredMessages[i];
            break;
        }
    }
    if (!latestMessage) return result;

    const text = latestMessage.textContent;
    if (!text) return result;

    // Check for name questions in recent filtered messages
    const nameQuestionRecentlyAsked = filteredMessages.some(msg =>
        msg.character.id !== character.id && detectNameQuestion(msg.textContent),
    );

    // Collect unique participant characters from the filtered messages
    const participantMap = new Map<string, Character>();
    for (const msg of filteredMessages) {
        if (msg.character.id !== character.id && !participantMap.has(msg.character.id)) {
            participantMap.set(msg.character.id, msg.character);
        }
    }

    // Check each other participant for name reveals
    for (const [, participant] of participantMap) {
        // Direct reveal detection
        const revealedVariant = detectNameRevealVariant(text, participant, nameQuestionRecentlyAsked);
        if (revealedVariant) {
            if (!result[participant.id]) result[participant.id] = {};
            result[participant.id][revealedVariant] = true;
            continue;
        }

        // Bare name after question
        if (nameQuestionRecentlyAsked && !isFalsePositive(text)) {
            const trimmed = text.trim();
            const isLikelyJustAName = trimmed.split(/\s+/).length <= 3 && !/[.!?]/.test(trimmed);
            if (isLikelyJustAName) {
                const matched = isNameMatchAgainstCharacter(trimmed, participant);
                if (matched) {
                    if (!result[participant.id]) result[participant.id] = {};
                    result[participant.id][matched] = true;
                    continue;
                }
            }
        }

        // Permission sequence detection
        const permissionVariant = detectNamePermissionSequenceVariant(filteredMessages, character, participant, text);
        if (permissionVariant) {
            if (!result[participant.id]) result[participant.id] = {};
            result[participant.id][permissionVariant] = true;
        }
    }

    return result;
}