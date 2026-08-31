import type { ChatMessage } from '../types'; 

const NAME_TERMINATOR = String.raw`(?:\s+and|\s+but|\s+who|\.|,|!|\?|$)`;
const NAME_CAPTURE = String.raw`([\w\s]{1,50}?)`;

const SELF_NAME_REVEAL_PATTERNS = [
  new RegExp(`i am ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`i'm ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`my name's ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`call me ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`${NAME_CAPTURE} is my name`, 'i'),
  new RegExp(`s+go\\s+by\\s+${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
  new RegExp(`mine is ${NAME_CAPTURE}${NAME_TERMINATOR}`, 'i'),
];

const NAME_REVEAL_QUESTION_PATTERNS = [
  // Questions (end with ?)
  /\bnames?\?/i,
  /\b(?:call|address|refer\s+to)\s+(?:you|thy|thee).*?\?/i,
  /\babout\s+(?:you|thy|thee).*?\?/i,
  /\bare\s+(?:you|thy|thee).*?\?/i,
  /\b(?:you|thy|thee)\s+are.*?\?/i,
  /\b(?:you|thy|thee)\s+go\s+by\b.*?\?/i,

  // ✅ Demands/imperatives (end with ! or .)
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

// Patterns indicating the user is proceeding to say their name regardless of context.
const NAME_REVEAL_INTENT_PATTERNS = [
  /\b(?:i'll|i will|i shall|let me|i'm gonna|i am going to)\s+(?:tell|say|give)\s+(?:you|u|them)\s+(?:my|the)\s+name\b/i,
  /\b(?:anyway|regardless|either way|in any case|fine|alright|ok),?\s*(?:i'm|i am|my name is|call me)\b/i,
  /\b(?:here(?:'s| is)|it is|that is)\s+(?:my|the)\s+name\b/i,
  /\b(?:never mind|doesn't matter),?\s*(?:i'm|i am|my name is)\b/i,
  /\b(?:just)\s+(?:know|call me|remember)\s+(?:that)?\s*i['']?m\b/i,
  /\b(?:by the way|btw),?\s*(?:i'm|i am|my name is)\b/i
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
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

function detectDirectNameReveal(text: string, characterName: string): boolean {
  const capturedName = extractCapturedName(text, SELF_NAME_REVEAL_PATTERNS);
  if (!capturedName) return false;

  const capturedLower = capturedName.toLowerCase();
  const targetLower = characterName.toLowerCase();

  return capturedLower.includes(targetLower) || targetLower.includes(capturedLower);
}

function detectBareNameDeclaration(text: string, characterName: string): boolean {
  const bareNameMatch = text.match(new RegExp(`^(${NAME_CAPTURE})\\.`, 'm'));
  if (!bareNameMatch?.[1]) return false;

  const capturedLower = bareNameMatch[1].trim().toLowerCase();
  const targetLower = characterName.toLowerCase();

  return capturedLower.includes(targetLower) || targetLower.includes(capturedLower);
}

function detectNameReveal(text: string, characterName: string, nameQuestionRecentlyAsked: boolean = false): boolean {
  if (detectDirectNameReveal(text, characterName)) {
    return true;
  }

  if (matchesAnyPattern(text, NAME_REVEAL_INTENT_PATTERNS)) {
    return true;
  }

  if (nameQuestionRecentlyAsked) {
    if (detectBareNameDeclaration(text, characterName)) {
      return true;
    }
  }

  return false;
}

function detectNameQuestion(text: string): boolean {
  return matchesAnyPattern(text, NAME_REVEAL_QUESTION_PATTERNS);
}

function detectNamePermissionSequence(
  chatMessageHistory: ChatMessage[], 
  characterId: string, 
  characterName: string, 
  text: string
): boolean {
  
  // 1. Find the previous message sent by THIS specific character.
  let previousMessageBySameCharacter: ChatMessage | null = null;

  // Iterate backwards from the end of history.
  for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
    if (chatMessageHistory[i].character.id === characterId) {
      previousMessageBySameCharacter = chatMessageHistory[i];
      break; // Stop at the first match (the most recent one).
    }
  }

  // If this character has never spoken before in this session, no sequence exists
  if (!previousMessageBySameCharacter) {
    return false;
  }

  // 2. Check if that previous message contained a permission question
  const wasPermissionAsked = matchesAnyPattern(
    previousMessageBySameCharacter.textContent, 
    NAME_PERMISSION_QUESTION_PATTERNS
  );

  if (!wasPermissionAsked) {
    return false;
  }

  // 3. If the primer exists, check if the current text is likely the name
  const isLikelyJustAName = text.trim().split(/\s+/).length <= 3 && !/[.!?]/.test(text);
  const isDirectReveal = detectDirectNameReveal(text, characterName);
  
  return isLikelyJustAName || isDirectReveal;
}

export function detectName(chatMessageHistory: ChatMessage[], characterId: string, characterName: string, text: string) {
  const nameQuestionRecentlyAsked = chatMessageHistory.some(msg => detectNameQuestion(msg.textContent));

  if (detectNameReveal(text, characterName, nameQuestionRecentlyAsked)) return true;

  if (nameQuestionRecentlyAsked) {
    const isLikelyJustAName = text.trim().split(/\s+/).length <= 3 && !/[.!?]/.test(text);
    if (isLikelyJustAName) return true;
  }

  return detectNamePermissionSequence(chatMessageHistory, characterId, characterName, text);
}