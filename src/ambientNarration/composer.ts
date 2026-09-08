// src/ambientNarration/atoms.ts

export interface Atom {
    text: string;
    tags: string[];
    position: 'open' | 'mid' | 'close';
    mood?: 'calm' | 'tense' | 'melancholy' | 'warm' | 'cold' | 'neutral';
}

export const ATOMS: Atom[] = [
    // ── Openers ──
    { text: 'A quiet settles', tags: ['room', 'inside', 'silence', 'still'], position: 'open', mood: 'calm' },
    { text: 'The air shifts', tags: ['room', 'wind', 'outside', 'change'], position: 'open', mood: 'neutral' },
    { text: 'Something stirs', tags: ['dark', 'forest', 'outside', 'unknown'], position: 'open', mood: 'tense' },
    { text: 'Light moves across surfaces', tags: ['light', 'fire', 'candle', 'glow', 'lamp'], position: 'open', mood: 'warm' },
    { text: 'Cold presses in', tags: ['cold', 'frost', 'ice', 'chill', 'draft'], position: 'open', mood: 'cold' },
    { text: 'Sound fades', tags: ['crowd', 'voices', 'busy', 'street', 'noise'], position: 'open', mood: 'melancholy' },
    { text: 'Warmth lingers', tags: ['fire', 'hearth', 'warm', 'ember', 'room'], position: 'open', mood: 'warm' },
    { text: 'Rain finds its rhythm', tags: ['rain', 'storm', 'water', 'drizzle'], position: 'open', mood: 'calm' },
    { text: 'The world outside continues', tags: ['outside', 'garden', 'forest', 'field', 'grass'], position: 'open', mood: 'neutral' },
    { text: 'Pages rest', tags: ['book', 'paper', 'library', 'shelf', 'read'], position: 'open', mood: 'calm' },
    { text: 'Footsteps pass', tags: ['footstep', 'walk', 'hall', 'approach', 'floorboard'], position: 'open', mood: 'neutral' },
    { text: 'Wood breathes', tags: ['creak', 'wood', 'old', 'settle', 'groan'], position: 'open', mood: 'calm' },
    { text: 'Water moves somewhere beyond reach', tags: ['water', 'river', 'sea', 'ocean', 'stream', 'wave'], position: 'open', mood: 'melancholy' },
    { text: 'Shadows gather at the edges', tags: ['shadow', 'dim', 'corner', 'periphery', 'depth'], position: 'open', mood: 'tense' },
    { text: 'Brightness arrives without announcement', tags: ['light', 'glow', 'radiance', 'gleam', 'clarity'], position: 'open', mood: 'warm' },
    { text: 'Silence thickens', tags: ['silence', 'still', 'quiet', 'pause'], position: 'open', mood: 'tense' },
    { text: 'Dust drifts through pale light', tags: ['room', 'inside', 'dust', 'particle', 'haze'], position: 'open', mood: 'calm' },
    { text: 'Thunder mutters and retreats', tags: ['thunder', 'storm', 'rumble', 'distance'], position: 'open', mood: 'tense' },
    { text: 'Frost traces patterns unseen', tags: ['frost', 'ice', 'cold', 'freeze', 'crystal'], position: 'open', mood: 'cold' },
    { text: 'Life hums just out of earshot', tags: ['crowd', 'people', 'market', 'street', 'city', 'busy'], position: 'open', mood: 'neutral' },

    // ── Middles ──
    { text: ', carrying nothing and everything', tags: ['wind', 'air', 'outside', 'silence'], position: 'mid', mood: 'neutral' },
    { text: ', as if listening', tags: ['room', 'still', 'quiet', 'attention'], position: 'mid', mood: 'tense' },
    { text: ', indifferent to what happens here', tags: ['outside', 'world', 'rain', 'water', 'sea'], position: 'mid', mood: 'melancholy' },
    { text: ', patient and unhurried', tags: ['slow', 'wait', 'still', 'wood', 'endure'], position: 'mid', mood: 'calm' },
    { text: ', touching surfaces gently', tags: ['light', 'glow', 'warm', 'fire', 'soft'], position: 'mid', mood: 'warm' },
    { text: ', finding cracks to slip through', tags: ['cold', 'wind', 'frost', 'rain', 'chill'], position: 'mid', mood: 'cold' },
    { text: ', then dissolving into distance', tags: ['sound', 'footstep', 'voices', 'crowd', 'noise'], position: 'mid', mood: 'melancholy' },
    { text: ', holding shape against the void', tags: ['fire', 'candle', 'ember', 'glow', 'flame'], position: 'mid', mood: 'warm' },
    { text: ', older than anyone present', tags: ['water', 'river', 'sea', 'ocean', 'wave', 'tree', 'forest'], position: 'mid', mood: 'melancholy' },
    { text: ', settling into familiar grooves', tags: ['wood', 'creak', 'old', 'house', 'room'], position: 'mid', mood: 'calm' },
    { text: ', marking passage without meaning to', tags: ['rain', 'drip', 'rhythm', 'pulse', 'cycle'], position: 'mid', mood: 'neutral' },
    { text: ', heavy with things unsaid', tags: ['silence', 'pause', 'quiet', 'still', 'tension'], position: 'mid', mood: 'tense' },
    { text: ', softening edges that were sharp', tags: ['light', 'warm', 'glow', 'gentle', 'ease'], position: 'mid', mood: 'warm' },
    { text: ', pressing closer than comfort allows', tags: ['cold', 'shadow', 'frost', 'ice', 'tight'], position: 'mid', mood: 'cold' },
    { text: ', each word absorbed before it lands', tags: ['book', 'page', 'paper', 'ink', 'library'], position: 'mid', mood: 'calm' },
    { text: ', belonging to no one', tags: ['outside', 'grass', 'field', 'path', 'wind', 'tree'], position: 'mid', mood: 'neutral' },

    // ── Closers ──
    { text: '. Nothing else follows.', tags: ['silence', 'still', 'quiet', 'end', 'stop'], position: 'close', mood: 'calm' },
    { text: '. The moment holds.', tags: ['pause', 'wait', 'still', 'breath'], position: 'close', mood: 'tense' },
    { text: '. Then even that fades.', tags: ['sound', 'footstep', 'voices', 'echo', 'fade'], position: 'close', mood: 'melancholy' },
    { text: '. It asks for nothing in return.', tags: ['outside', 'nature', 'wind', 'tree', 'grass', 'water'], position: 'close', mood: 'neutral' },
    { text: '. Warmth persists despite everything.', tags: ['fire', 'warm', 'hearth', 'ember', 'candle'], position: 'close', mood: 'warm' },
    { text: '. Cold does not negotiate.', tags: ['cold', 'frost', 'ice', 'freeze', 'bite'], position: 'close', mood: 'cold' },
    { text: '. The silence has weight now.', tags: ['silence', 'heavy', 'thick', 'pressure', 'still'], position: 'close', mood: 'tense' },
    { text: '. Pages remember what readers forget.', tags: ['book', 'paper', 'ink', 'story', 'word'], position: 'close', mood: 'melancholy' },
    { text: '. Water does not stop for anyone.', tags: ['water', 'river', 'sea', 'ocean', 'stream', 'current'], position: 'close', mood: 'neutral' },
    { text: '. Light withdraws slowly.', tags: ['dim', 'fade', 'shadow', 'retreat', 'wane'], position: 'close', mood: 'melancholy' },
    { text: '. Brightness forgives what came before.', tags: ['light', 'glow', 'radiance', 'clarity', 'renew'], position: 'close', mood: 'warm' },
    { text: '. Rain keeps its own counsel.', tags: ['rain', 'storm', 'drizzle', 'pouring', 'wet'], position: 'close', mood: 'calm' },
    { text: '. Wood remembers every weight it has borne.', tags: ['wood', 'creak', 'old', 'floor', 'settle'], position: 'close', mood: 'melancholy' },
    { text: '. The city does not notice.', tags: ['crowd', 'city', 'street', 'busy', 'people'], position: 'close', mood: 'neutral' },
    { text: '. Stillness becomes its own answer.', tags: ['still', 'quiet', 'silence', 'peace', 'calm'], position: 'close', mood: 'calm' },
];