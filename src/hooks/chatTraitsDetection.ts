// --- Modifier System ---

interface Modifier {
    keywords: string[];
    type: 'intensifier' | 'diminisher';
    strength: number;
}

const MODIFIERS: Modifier[] = [
    { keywords: ['extremely', 'incredibly', 'insanely', 'unbelievably', 'absolutely', 'totally', 'completely', 'utterly', 'annoyingly'], type: 'intensifier', strength: 2 },
    { keywords: ['very', 'highly', 'really', 'deeply', 'strongly', 'intensely', 'remarkably', 'exceptionally'], type: 'intensifier', strength: 1 },
    { keywords: ['somewhat', 'fairly', 'moderately', 'pretty', 'quite', 'rather', 'reasonably'], type: 'diminisher', strength: 0.5 },

    { keywords: ['barely', 'hardly', 'scarcely', 'not really', 'not very', 'not particularly'], type: 'diminisher', strength: 2 },
    { keywords: ['slightly', 'mildly', 'a bit', 'a little', 'kind of', 'sort of', 'marginally'], type: 'diminisher', strength: 1 },
];

// --- Trait Rules ---

interface TraitRule {
    keywords: string[];
    value: number;
}

const INITIATIVE_WEIGHT_RULES: TraitRule[] = [
    { keywords: ['dominant', 'assertive', 'leader', 'commanding', 'alpha', 'boss', 'captain', 'general', 'authoritative'], value: 2.5 },
    { keywords: ['confident', 'outgoing', 'energetic', 'eager', 'enthusiastic', 'bold', 'forward', 'proactive'], value: 1.8 },
    { keywords: ['normal', 'balanced', 'average', 'moderate', 'steady', 'calm', 'composed'], value: 1.2 },
    { keywords: ['quiet', 'reserved', 'hesitant', 'cautious', 'passive', 'timid', 'meek', 'subdued'], value: 0.7 },
    { keywords: ['shy', 'withdrawn', 'reclusive', 'introverted', 'wallflower', 'bashful', 'diffident'], value: 0.4 },
    { keywords: ['silent', 'mute', 'nonverbal', 'observer', 'spectator', 'background', 'decorative', 'stoic'], value: 0.15 },
    { keywords: ['invisible', 'ghost', 'phantom', 'shadow', 'unnoticed', 'forgotten'], value: 0.0 },
];

const CHAT_PROBABILITY_RULES: TraitRule[] = [
    { keywords: ['talkative', 'chatty', 'verbose', 'garrulous', 'loquacious', 'extroverted', 'social', 'voluble'], value: 0.95 },
    { keywords: ['friendly', 'open', 'communicative', 'expressive', 'warm', 'sociable', 'engaging', 'gregarious'], value: 0.78 },
    { keywords: ['normal', 'balanced', 'moderate', 'average', 'conversational', 'standard', 'typical'], value: 0.5 }, // Changed to 0.5
    { keywords: ['quiet', 'reserved', 'taciturn', 'brief', 'laconic', 'reticent', 'understated'], value: 0.38 },
    { keywords: ['shy', 'anxious', 'nervous', 'reluctant', 'hesitant', 'insecure', 'fearful', 'apprehensive'], value: 0.22 },
    { keywords: ['silent', 'mute', 'nonverbal', 'unresponsive', 'withdrawn', 'aloof', 'distant'], value: 0.08 },
    { keywords: ['catatonic', 'comatose', 'unconscious', 'vegetative', 'inert'], value: 0.0 },
];

const MAXIMUM_CHAT_STAMINA_RULES: TraitRule[] = [
    { keywords: ['hyperactive', 'manic', 'relentless', 'tireless', 'obsessive', 'compulsive', 'unstoppable', 'boundless'], value: 10 },
    { keywords: ['energetic', 'enduring', 'persistent', 'determined', 'focused', 'driven', 'vigorous', 'dynamic'], value: 7 },
    { keywords: ['normal', 'balanced', 'moderate', 'average', 'conversational', 'standard', 'typical'], value: 4 },
    { keywords: ['brief', 'concise', 'terse', 'curt', 'succinct', 'economical', 'short-spoken'], value: 2.5 },
    { keywords: ['exhausted', 'weak', 'frail', 'fatigued', 'breathless', 'wounded', 'weary'], value: 1.5 },
    { keywords: ['dying', 'fading', 'failing', 'debilitated', 'crippled', 'broken'], value: 0.8 },
    { keywords: ['incapacitated', 'unconscious', 'asleep', 'paralyzed', 'comatose', 'dead', 'inert'], value: 0 },
];

// --- Core Detection Logic ---

function findModifier(searchText: string, keywordStartIndex: number): Modifier | null {
    const precedingText = searchText.substring(Math.max(0, keywordStartIndex - 30), keywordStartIndex);

    let bestMatch: Modifier | null = null;
    let bestPosition = -1;

    for (const mod of MODIFIERS) {
        for (const kw of mod.keywords) {
            const idx = precedingText.lastIndexOf(kw);
            if (idx !== -1 && idx > bestPosition) {
                bestPosition = idx;
                bestMatch = mod;
            }
        }
    }

    return bestMatch;
}

function applyModifier(
    baseValue: number,
    modifier: Modifier,
    allValues: number[],
    clampResult: boolean
): number {
    const sorted = [...new Set(allValues)].sort((a, b) => a - b);
    const currentIndex = sorted.indexOf(baseValue);
    if (currentIndex === -1) return baseValue;

    const centerIndex = Math.floor(sorted.length / 2);
    const isAboveCenter = currentIndex > centerIndex;
    const isBelowCenter = currentIndex < centerIndex;

    let shiftDirection: number;

    if (modifier.type === 'intensifier') {
        if (isAboveCenter) shiftDirection = 1;
        else if (isBelowCenter) shiftDirection = -1;
        else shiftDirection = 1;
    } else {
        if (isAboveCenter) shiftDirection = -1;
        else if (isBelowCenter) shiftDirection = 1;
        else shiftDirection = 0;
    }

    if (clampResult) {
        const rawShift = modifier.strength * shiftDirection;
        const newIndex = Math.min(Math.max(Math.round(currentIndex + rawShift), 0), sorted.length - 1);
        return sorted[newIndex];
    }

    const rawMagnitude = modifier.strength;
    const logMagnitude = Math.log(1 + rawMagnitude);
    const effectiveShift = logMagnitude * shiftDirection;
    const targetIndex = currentIndex + effectiveShift;

    if (targetIndex <= 0) {
        const gap = sorted[1] - sorted[0];
        return sorted[0] + targetIndex * gap;
    }

    if (targetIndex >= sorted.length - 1) {
        const gap = sorted[sorted.length - 1] - sorted[sorted.length - 2];
        const overshoot = targetIndex - (sorted.length - 1);
        return sorted[sorted.length - 1] + overshoot * gap;
    }

    const lowerIndex = Math.floor(targetIndex);
    const upperIndex = Math.ceil(targetIndex);
    const fraction = targetIndex - lowerIndex;
    return sorted[lowerIndex] + fraction * (sorted[upperIndex] - sorted[lowerIndex]);
}

function detectValue(
    searchText: string,
    rules: TraitRule[],
    fallback: number,
    clampResult: boolean
): number {
    const allValues = rules.map(r => r.value);
    const resolvedValues: number[] = [];

    for (const rule of rules) {
        for (const keyword of rule.keywords) {
            let searchFrom = 0;
            while (searchFrom < searchText.length) {
                const idx = searchText.indexOf(keyword, searchFrom);
                if (idx === -1) break;

                const modifier = findModifier(searchText, idx);
                let value: number;

                if (modifier) {
                    value = applyModifier(rule.value, modifier, allValues, clampResult);
                } else {
                    value = rule.value;
                }

                if (clampResult) {
                    value = Math.min(Math.max(value, 0), 1);
                }

                resolvedValues.push(value);
                searchFrom = idx + keyword.length;
            }
        }
    }

    if (resolvedValues.length === 0) return fallback;

    const sum = resolvedValues.reduce((acc, v) => acc + v, 0);
    const average = sum / resolvedValues.length;

    if (clampResult) {
        return Math.min(Math.max(average, 0), 1);
    }

    return average;
}

export function getInitiativeWeightValueFromText(text: string) {
    return detectValue(text, INITIATIVE_WEIGHT_RULES, 1.2, false);
}

export function getChatProbabilityValue(text: string) {
    return detectValue(text, CHAT_PROBABILITY_RULES, 0.5, false);
}

export function getMaximumChatStaminaValueFromText(text: string) {
    return detectValue(text, MAXIMUM_CHAT_STAMINA_RULES, 4, false);
}