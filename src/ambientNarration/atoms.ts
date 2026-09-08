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
    { text: 'Something stirs', tags: ['night', 'dark', 'forest', 'outside'], position: 'open', mood: 'tense' },
    { text: 'Light moves', tags: ['morning', 'sun', 'dawn', 'fire', 'candle'], position: 'open', mood: 'warm' },
    { text: 'Cold presses in', tags: ['cold', 'winter', 'night', 'frost', 'ice'], position: 'open', mood: 'cold' },
    { text: 'Sound fades', tags: ['crowd', 'city', 'voices', 'busy', 'street'], position: 'open', mood: 'melancholy' },
    { text: 'Warmth lingers', tags: ['fire', 'hearth', 'warm', 'ember', 'room'], position: 'open', mood: 'warm' },
    { text: 'Rain finds its rhythm', tags: ['rain', 'storm', 'water', 'drizzle'], position: 'open', mood: 'calm' },
    { text: 'The world outside continues', tags: ['outside', 'garden', 'forest', 'field', 'grass'], position: 'open', mood: 'neutral' },
    { text: 'Pages rest', tags: ['book', 'paper', 'library', 'shelf', 'read'], position: 'open', mood: 'calm' },
    { text: 'Footsteps pass', tags: ['footstep', 'walk', 'hall', 'approach', 'floorboard'], position: 'open', mood: 'neutral' },
    { text: 'Wood breathes', tags: ['creak', 'wood', 'old', 'settle', 'groan'], position: 'open', mood: 'calm' },
    { text: 'Water moves somewhere beyond reach', tags: ['water', 'river', 'sea', 'ocean', 'stream', 'wave'], position: 'open', mood: 'melancholy' },
    { text: 'Darkness gathers at the edges', tags: ['night', 'dark', 'dusk', 'twilight', 'evening'], position: 'open', mood: 'tense' },
    { text: 'Morning arrives without announcement', tags: ['morning', 'dawn', 'sunrise', 'daybreak', 'early'], position: 'open', mood: 'warm' },
    { text: 'Silence thickens', tags: ['silence', 'still', 'quiet', 'pause'], position: 'open', mood: 'tense' },
    { text: 'Dust drifts through pale light', tags: ['room', 'inside', 'morning', 'sun'], position: 'open', mood: 'calm' },
    { text: 'Thunder mutters and retreats', tags: ['thunder', 'storm', 'lightning'], position: 'open', mood: 'tense' },
    { text: 'Frost traces patterns unseen', tags: ['frost', 'ice', 'cold', 'winter', 'freeze'], position: 'open', mood: 'cold' },
    { text: 'Life hums just out of earshot', tags: ['crowd', 'people', 'market', 'street', 'city', 'busy'], position: 'open', mood: 'neutral' },

    // ── Middles ──
    { text: ', carrying nothing and everything', tags: ['wind', 'air', 'outside', 'silence'], position: 'mid', mood: 'neutral' },
    { text: ', as if listening', tags: ['room', 'still', 'quiet', 'night'], position: 'mid', mood: 'tense' },
    { text: ', indifferent to what happens here', tags: ['outside', 'world', 'rain', 'water', 'sea'], position: 'mid', mood: 'melancholy' },
    { text: ', patient and unhurried', tags: ['time', 'slow', 'wait', 'still', 'wood'], position: 'mid', mood: 'calm' },
    { text: ', touching surfaces gently', tags: ['light', 'sun', 'morning', 'fire', 'warm'], position: 'mid', mood: 'warm' },
    { text: ', finding cracks to slip through', tags: ['cold', 'wind', 'frost', 'rain', 'chill'], position: 'mid', mood: 'cold' },
    { text: ', then dissolving into distance', tags: ['sound', 'footstep', 'voices', 'crowd', 'noise'], position: 'mid', mood: 'melancholy' },
    { text: ', holding shape against the dark', tags: ['fire', 'candle', 'ember', 'glow', 'flame'], position: 'mid', mood: 'warm' },
    { text: ', older than anyone present', tags: ['water', 'river', 'sea', 'ocean', 'wave', 'tree', 'forest'], position: 'mid', mood: 'melancholy' },
    { text: ', settling into familiar grooves', tags: ['wood', 'creak', 'old', 'house', 'room'], position: 'mid', mood: 'calm' },
    { text: ', marking time without meaning to', tags: ['rain', 'drip', 'clock', 'tick', 'rhythm'], position: 'mid', mood: 'neutral' },
    { text: ', heavy with things unsaid', tags: ['silence', 'pause', 'quiet', 'still', 'tension'], position: 'mid', mood: 'tense' },
    { text: ', softening edges that were sharp', tags: ['morning', 'dawn', 'light', 'warm', 'sun'], position: 'mid', mood: 'warm' },
    { text: ', pressing closer than comfort allows', tags: ['cold', 'dark', 'night', 'frost', 'ice'], position: 'mid', mood: 'cold' },
    { text: ', each word absorbed before it lands', tags: ['book', 'page', 'paper', 'ink', 'library'], position: 'mid', mood: 'calm' },
    { text: ', belonging to no one', tags: ['outside', 'grass', 'field', 'path', 'wind', 'tree'], position: 'mid', mood: 'neutral' },

    // ── Closers ──
    { text: '. Nothing else follows.', tags: ['silence', 'still', 'quiet', 'end', 'stop'], position: 'close', mood: 'calm' },
    { text: '. The moment holds.', tags: ['pause', 'wait', 'still', 'breath'], position: 'close', mood: 'tense' },
    { text: '. Then even that fades.', tags: ['sound', 'footstep', 'voices', 'echo', 'fade'], position: 'close', mood: 'melancholy' },
    { text: '. It asks for nothing in return.', tags: ['outside', 'nature', 'wind', 'tree', 'grass', 'water'], position: 'close', mood: 'neutral' },
    { text: '. Warmth persists despite everything.', tags: ['fire', 'warm', 'hearth', 'ember', 'candle'], position: 'close', mood: 'warm' },
    { text: '. Cold does not negotiate.', tags: ['cold', 'frost', 'ice', 'winter', 'freeze'], position: 'close', mood: 'cold' },
    { text: '. The silence has weight now.', tags: ['silence', 'heavy', 'thick', 'pressure', 'still'], position: 'close', mood: 'tense' },
    { text: '. Pages remember what readers forget.', tags: ['book', 'paper', 'ink', 'story', 'word'], position: 'close', mood: 'melancholy' },
    { text: '. Water does not stop for anyone.', tags: ['water', 'river', 'sea', 'ocean', 'stream', 'current'], position: 'close', mood: 'neutral' },
    { text: '. Light withdraws slowly.', tags: ['dusk', 'evening', 'dark', 'sunset', 'twilight'], position: 'close', mood: 'melancholy' },
    { text: '. Morning forgives the darkness.', tags: ['morning', 'dawn', 'sunrise', 'light', 'new'], position: 'close', mood: 'warm' },
    { text: '. Rain keeps its own counsel.', tags: ['rain', 'storm', 'drizzle', 'pouring', 'wet'], position: 'close', mood: 'calm' },
    { text: '. Wood remembers every weight it has borne.', tags: ['wood', 'creak', 'old', 'floor', 'settle'], position: 'close', mood: 'melancholy' },
    { text: '. The city does not notice.', tags: ['crowd', 'city', 'street', 'busy', 'people'], position: 'close', mood: 'neutral' },
    { text: '. Stillness becomes its own answer.', tags: ['still', 'quiet', 'silence', 'peace', 'calm'], position: 'close', mood: 'calm' },
];