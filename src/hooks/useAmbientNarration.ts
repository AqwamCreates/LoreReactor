// src/hooks/useAmbientNarration.ts
import { useCallback } from 'react';
import type { Character, InteractionData } from '../types';
import { createChatMessage, addMessageToInteractionData } from './chatLogic';

const now = Date.now();

const AMBIENT_NARRATOR: Character = {
    id: '__ambient_narrator__', name: '', description: 'Ambient environment narration',
    systemPrompt: '', initiativeWeight: 0, chatProbability: 1, maximumChatStamina: 1,
    memories: {},
    numberOfMessagesToDisableThinkPrompt: 0,
    numberOfMessagesToDisableMetaThinkInstructions: 0,
    numberOfMessagesToDisableDialoguePrompt: 0,
    firstCreatedTimestamp: now, lastUpdatedTimestamp: now,
} as Character;

const AMBIENT_POOL: { keywords: string[]; lines: string[] }[] = [
    { keywords: ['hello', 'hi', 'hey', 'greet', 'good morning', 'good evening', 'good night', 'howdy', 'yo', '?'], lines: ["A tentative quiet hangs in the air, waiting to be shaped.", "The space between them hums with the possibility of conversation.", "Words hover at the edge of silence, not yet committed.", "The air shifts subtly, acknowledging a presence.", "Something stirs in the stillness — an opening.", "The moment balances on the edge of beginning."] },
    { keywords: ['night', 'dark', 'moon', 'star', 'midnight', 'dusk', 'evening', 'twilight'], lines: ["Crickets hum softly beyond the walls.", "The darkness outside presses gently against the windows.", "A cool night breeze carries distant sounds through the stillness.", "Moonlight traces pale shapes across the floor.", "The night holds its breath around them.", "Somewhere outside, an owl calls once and falls silent."] },
    { keywords: ['morning', 'dawn', 'sunrise', 'sun', 'daybreak', 'early'], lines: ["Pale light filters through the gaps in the curtains.", "Birdsong drifts in from somewhere far away.", "The first warmth of morning touches the edges of the room.", "Dew-laden air seeps through the cracks, fresh and quiet.", "The world outside is just beginning to stir."] },
    { keywords: ['rain', 'storm', 'thunder', 'lightning', 'pouring', 'drizzle', 'wet'], lines: ["Rain taps a steady rhythm against the glass.", "Thunder rumbles low and distant, then fades.", "Water streaks down the windows in silver threads.", "The storm mutters to itself beyond the walls.", "Each raindrop sounds impossibly loud in the quiet."] },
    { keywords: ['room', 'inside', 'indoors', 'house', 'hall', 'chamber', 'apartment'], lines: ["The room settles into its own particular silence.", "Dust motes drift lazily through a shaft of light.", "The walls seem to absorb the quiet, holding it close.", "Something in the room creaks softly, then stills.", "The space between them feels measured and deliberate."] },
    { keywords: ['outside', 'garden', 'forest', 'tree', 'wind', 'grass', 'field', 'path'], lines: ["Leaves rustle in a wind that carries no warmth.", "Branches sway overhead in slow, patient arcs.", "The outdoors hums with a life that doesn't need words.", "Grass bends and rises in waves of quiet motion.", "The horizon holds still, watching."] },
    { keywords: ['footstep', 'walk', 'pace', 'approach', 'tread', 'floorboard'], lines: ["Footsteps echo faintly, then stop.", "The floor groans under shifting weight somewhere nearby.", "A measured tread passes and fades into distance.", "Each step lands carefully, as if the walker doesn't want to be heard."] },
    { keywords: ['creak', 'groan', 'settle', 'shift', 'wood', 'old'], lines: ["Wood settles with a long, patient sigh.", "Something old shifts its weight and goes still again.", "A creak rises and dissolves into the silence.", "The structure around them breathes in its own slow way."] },
    { keywords: ['fire', 'flame', 'hearth', 'warm', 'candle', 'ember', 'glow'], lines: ["Embers pop softly, casting brief orange light.", "The fire murmurs to itself in a language of heat.", "Warmth radiates outward in gentle, invisible waves.", "A candle flickers though nothing has moved the air."] },
    { keywords: ['water', 'river', 'sea', 'ocean', 'wave', 'stream', 'lake', 'shore'], lines: ["Water moves endlessly in the distance, indifferent and constant.", "Waves fold over themselves in a rhythm older than memory.", "The sound of water fills the silence without breaking it.", "Current pulls at something unseen beneath the surface."] },
    { keywords: ['crowd', 'people', 'voices', 'busy', 'market', 'street', 'city'], lines: ["Distant voices blur into a murmur that means nothing.", "Life continues somewhere else, oblivious.", "The noise of others fades to a hum, then less than a hum.", "Footsteps pass without stopping, belonging to strangers."] },
    { keywords: ['cold', 'frost', 'ice', 'snow', 'winter', 'freeze', 'chill'], lines: ["Cold seeps in through places you can't quite find.", "Frost crystals form silently on the other side of the glass.", "The air bites at exposed skin, patient and persistent.", "Ice shifts somewhere with a sound like a whisper."] },
    { keywords: ['book', 'page', 'read', 'paper', 'library', 'shelf', 'ink'], lines: ["Pages settle against each other with a papery sigh.", "The weight of unread words hangs quietly in the air.", "Ink and paper hold their stories in patient silence.", "A book lies open, waiting for eyes that have looked away."] },
];

const AMBIENT_FALLBACK = [
    "A heavy silence settles over everything.", "The air grows still, thick with unspoken words.",
    "Quiet stretches between them like a held breath.", "The moment lingers, neither comfortable nor cruel.",
    "Stillness fills the space where words should be.", "Time seems to slow in the absence of sound.",
    "The pause grows teeth.", "Nothing moves. Nothing breaks the stillness.",
    "The silence has a texture now, rough and unresolved.", "A beat passes. Then another.",
];

export function useAmbientNarration(
    setStreamingCharacter: (c: Character | null) => void,
    streamingCharacterRef: React.MutableRefObject<Character | null>,
    setStreamingText: (t: string) => void,
    streamingTextRef: React.MutableRefObject<string>,
) {
    const generateAmbientNarration = useCallback(async (data: InteractionData, _signal: AbortSignal): Promise<InteractionData | null> => {
        const recent = data.interactionHistory.filter(m => m.character.id !== '__ambient_narrator__').slice(-8).map(m => m.textContent.toLowerCase()).join(' ');
        let best: typeof AMBIENT_POOL[0] | null = null, bestScore = 0;
        for (const cat of AMBIENT_POOL) { let s = 0; for (const kw of cat.keywords) if (recent.includes(kw)) s++; if (s > bestScore) { bestScore = s; best = cat; } }
        const pool = best ? best.lines : AMBIENT_FALLBACK;
        const recentAmbient = data.interactionHistory.filter(m => m.character.id === '__ambient_narrator__').slice(-3).map(m => m.textContent);
        const avail = pool.filter(l => !recentAmbient.includes(l));
        const final = avail.length > 0 ? avail : pool;
        const selected = final[Math.floor(Math.random() * final.length)];

        setStreamingCharacter(AMBIENT_NARRATOR);
        streamingCharacterRef.current = AMBIENT_NARRATOR;
        setStreamingText('');
        streamingTextRef.current = '';

        for (let i = 0; i < selected.length; i++) {
            const p = selected.substring(0, i + 1);
            streamingTextRef.current = p;
            setStreamingText(p);
            await new Promise(r => setTimeout(r, 20));
        }

        return addMessageToInteractionData(data, createChatMessage(data, AMBIENT_NARRATOR, selected));
    }, [setStreamingCharacter, streamingCharacterRef, setStreamingText, streamingTextRef]);

    return { generateAmbientNarration, AMBIENT_NARRATOR };
}