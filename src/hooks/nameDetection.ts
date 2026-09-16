// src/hooks/nameDetection.ts
import type { Character, HistoryMessage, InteractionData } from '../types';
import { getCoLocatedParticipantCount } from './locationLogic';

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

function isNameMatch(captured: string, characterName: string): boolean {
  const capturedLower = captured.toLowerCase().trim();
  const targetLower = characterName.toLowerCase().trim();

  if (capturedLower === targetLower) return true;

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
    if (allMatch) return true;
  }

  return false;
}

/**
 * THE GATE: Does the character's actual name appear in this text?
 * Every detection path MUST pass through this before returning true.
 */
function containsCharacterName(text: string, characterName: string): boolean {
  const targetLower = characterName.toLowerCase().trim();
  const textLower = text.toLowerCase();

  // Check as whole word boundary match
  const escaped = targetLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, 'i');
  if (wordBoundaryRegex.test(textLower)) return true;

  return false;
}

function detectDirectNameReveal(text: string, characterName: string): boolean {
  if (isFalsePositive(text)) return false;
  if (!containsCharacterName(text, characterName)) return false;

  const capturedName = extractCapturedName(text, SELF_NAME_REVEAL_PATTERNS);
  if (!capturedName) return false;
  return isNameMatch(capturedName, characterName);
}

function detectBareNameDeclaration(text: string, characterName: string): boolean {
  if (isFalsePositive(text)) return false;
  if (!containsCharacterName(text, characterName)) return false;

  const bareNameMatch = text.match(new RegExp(`^(${NAME_CAPTURE})\\.`, 'm'));
  if (!bareNameMatch?.[1]) return false;
  return isNameMatch(bareNameMatch[1].trim(), characterName);
}

function detectNameReveal(text: string, characterName: string, nameQuestionRecentlyAsked = false): boolean {
  // THE GATE: if the character's name doesn't appear in the text at all,
  // it cannot be a name reveal. Period.
  if (!containsCharacterName(text, characterName)) return false;

  if (detectDirectNameReveal(text, characterName)) return true;

  if (!isFalsePositive(text)) {
    // Intent patterns like "let me tell you my name" + name actually present
    const capturedName = extractCapturedName(text, SELF_NAME_REVEAL_PATTERNS);
    if (capturedName && isNameMatch(capturedName, characterName)) return true;
  }

  if (nameQuestionRecentlyAsked && detectBareNameDeclaration(text, characterName)) return true;

  return false;
}

function detectNameQuestion(text: string): boolean {
  return matchesAnyPattern(text, NAME_REVEAL_QUESTION_PATTERNS);
}

function detectNamePermissionSequence(
  interactionData: InteractionData,
  character: Character,
  text: string
): boolean {
  // THE GATE: permission sequence still requires the name to be present
  if (!containsCharacterName(text, character.name)) return false;
  if (isFalsePositive(text)) return false;

  const scanDepth = getCoLocatedParticipantCount(interactionData, character);
  const recentHistory = interactionData.interactionHistory.slice(-scanDepth);

  let previousMessageBySameCharacter: HistoryMessage | null = null;
  for (let i = recentHistory.length - 1; i >= 0; i--) {
    if (recentHistory[i].character.id === character.id) {
      previousMessageBySameCharacter = recentHistory[i];
      break;
    }
  }

  if (!previousMessageBySameCharacter) return false;
  if (previousMessageBySameCharacter.messageType !== 'chat') return false;

  const wasPermissionAsked = matchesAnyPattern(
    previousMessageBySameCharacter.textContent,
    NAME_PERMISSION_QUESTION_PATTERNS
  );

  if (!wasPermissionAsked) return false;

  if (detectDirectNameReveal(text, character.name)) return true;

  const trimmed = text.trim();
  const isLikelyJustAName = trimmed.split(/\s+/).length <= 3 && !/[.!?]/.test(trimmed);
  if (isLikelyJustAName && isNameMatch(trimmed, character.name)) return true;

  return false;
}

export function detectName(
  interactionData: InteractionData,
  character: Character,
  text: string,
) {
  // THE GATE: no name in text = no reveal possible
  if (!containsCharacterName(text, character.name)) return false;

  const chatOnly = interactionData.interactionHistory.filter(m => m.messageType === 'chat');
  const scanDepth = getCoLocatedParticipantCount(interactionData, character);
  const recentHistory = chatOnly.slice(-scanDepth);

  const nameQuestionRecentlyAsked = recentHistory.some(msg =>
    detectNameQuestion(msg.textContent)
  );

  if (detectNameReveal(text, character.name, nameQuestionRecentlyAsked)) return true;

  if (nameQuestionRecentlyAsked && !isFalsePositive(text)) {
    const trimmed = text.trim();
    const isLikelyJustAName = trimmed.split(/\s+/).length <= 3 && !/[.!?]/.test(trimmed);
    if (isLikelyJustAName && isNameMatch(trimmed, character.name)) return true;
  }

  return detectNamePermissionSequence(interactionData, character, text);
}