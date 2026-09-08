// src/ambientNarration/atoms.ts

export interface AtomSlots {
    [key: string]: string[];
}

export interface Atom {
    text?: string;
    template?: string;
    slots?: AtomSlots;
    tags: string[];
    position: 'open' | 'mid' | 'close';
    mood?: 'calm' | 'tense' | 'melancholy' | 'warm' | 'cold' | 'neutral';
}

/** Resolves a templated atom into concrete text. Falls back to static text if no template. */
export function resolveAtomText(atom: Atom): string {
    if (atom.text && !atom.template) return atom.text;
    if (!atom.template || !atom.slots) return atom.text || '';
    let result = atom.template;
    for (const [key, options] of Object.entries(atom.slots)) {
        const choice = options[Math.floor(Math.random() * options.length)];
        result = result.replace(`{${key}}`, choice);
    }
    return result;
}

export const ATOMS: Atom[] = [
    // ── Openers ──
    {
        template: 'A {quiet} {settles}',
        slots: {
            quiet: ['quiet', 'stillness', 'hush', 'calm', 'peace', 'silence'],
            settles: ['settles', 'deepens', 'thickens', 'gathers', 'descends', 'takes hold'],
        },
        tags: ['room', 'inside', 'silence', 'still'],
        position: 'open', mood: 'calm',
    },
    {
        template: 'The air {shifts}',
        slots: {
            shifts: ['shifts', 'stirs', 'moves', 'changes', 'turns', 'breathes'],
        },
        tags: ['room', 'wind', 'outside', 'change'],
        position: 'open', mood: 'neutral',
    },
    {
        template: 'Something {stirs} {direction}',
        slots: {
            stirs: ['stirs', 'moves', 'shifts', 'wakes', 'passes'],
            direction: ['nearby', 'in the distance', 'just beyond reach', 'at the edge', 'somewhere close'],
        },
        tags: ['dark', 'forest', 'outside', 'unknown'],
        position: 'open', mood: 'tense',
    },
    {
        template: '{Light} {moves} across {surfaces}',
        slots: {
            Light: ['Light', 'Glow', 'Radiance', 'Brightness', 'A faint gleam'],
            moves: ['moves', 'drifts', 'slides', 'creeps', 'spills', 'passes'],
            surfaces: ['surfaces', 'walls', 'the floor', 'edges', 'objects nearby'],
        },
        tags: ['light', 'fire', 'candle', 'glow', 'lamp'],
        position: 'open', mood: 'warm',
    },
    {
        template: 'Cold {presses} {target}',
        slots: {
            presses: ['presses', 'seeps', 'creeps', 'bites', 'settles', 'tightens'],
            target: ['in', 'against the skin', 'through gaps', 'into the space', 'closer'],
        },
        tags: ['cold', 'frost', 'ice', 'chill', 'draft'],
        position: 'open', mood: 'cold',
    },
    {
        template: '{Sound} {fades}',
        slots: {
            Sound: ['Sound', 'Noise', 'Voices', 'Movement', 'The hum of activity'],
            fades: ['fades', 'dissolves', 'retreats', 'thins', 'falls away', 'diminishes'],
        },
        tags: ['crowd', 'voices', 'busy', 'street', 'noise'],
        position: 'open', mood: 'melancholy',
    },
    {
        template: '{Warmth} {lingers}',
        slots: {
            Warmth: ['Warmth', 'Heat', 'A gentle warmth', 'Residual heat', 'Comfort'],
            lingers: ['lingers', 'persists', 'remains', 'holds', 'stays', 'endures'],
        },
        tags: ['fire', 'hearth', 'warm', 'ember', 'room'],
        position: 'open', mood: 'warm',
    },
    {
        template: 'Rain {finds} its {rhythm}',
        slots: {
            finds: ['finds', 'keeps', 'maintains', 'establishes', 'resumes'],
            rhythm: ['rhythm', 'cadence', 'pattern', 'tempo', 'pace', 'measure'],
        },
        tags: ['rain', 'storm', 'water', 'drizzle'],
        position: 'open', mood: 'calm',
    },
    {
        template: 'The world outside {continues}',
        slots: {
            continues: ['continues', 'persists', 'carries on', 'moves forward', 'goes on regardless', 'does not pause'],
        },
        tags: ['outside', 'garden', 'forest', 'field', 'grass'],
        position: 'open', mood: 'neutral',
    },
    {
        template: '{Pages} {rest}',
        slots: {
            Pages: ['Pages', 'Books', 'Written words', 'Bound volumes', 'Paper'],
            rest: ['rest', 'wait', 'lie still', 'hold their place', 'remain open', 'sleep'],
        },
        tags: ['book', 'paper', 'library', 'shelf', 'read'],
        position: 'open', mood: 'calm',
    },
    {
        template: '{Footsteps} {pass}',
        slots: {
            Footsteps: ['Footsteps', 'Steps', 'Movement', 'A passing tread', 'Someone walking'],
            pass: ['pass', 'echo briefly', 'come and go', 'move through', 'fade along the way'],
        },
        tags: ['footstep', 'walk', 'hall', 'approach', 'floorboard'],
        position: 'open', mood: 'neutral',
    },
    {
        template: 'Wood {breathes}',
        slots: {
            breathes: ['breathes', 'creaks softly', 'settles', 'groans quietly', 'shifts', 'exhales'],
        },
        tags: ['creak', 'wood', 'old', 'settle', 'groan'],
        position: 'open', mood: 'calm',
    },
    {
        template: 'Water {moves} {location}',
        slots: {
            moves: ['moves', 'flows', 'runs', 'passes', 'travels', 'circulates'],
            location: ['somewhere beyond reach', 'in the distance', 'beneath awareness', 'just out of sight', 'along unseen paths'],
        },
        tags: ['water', 'river', 'sea', 'ocean', 'stream', 'wave'],
        position: 'open', mood: 'melancholy',
    },
    {
        template: '{Shadows} {gather} at the {edges}',
        slots: {
            Shadows: ['Shadows', 'Darkness', 'Dim shapes', 'Absence of light', 'Silhouettes'],
            gather: ['gather', 'collect', 'pool', 'accumulate', 'thicken', 'converge'],
            edges: ['edges', 'corners', 'periphery', 'margins', 'boundaries'],
        },
        tags: ['shadow', 'dim', 'corner', 'periphery', 'depth'],
        position: 'open', mood: 'tense',
    },
    {
        template: '{Brightness} arrives without {announcement}',
        slots: {
            Brightness: ['Brightness', 'Light', 'Clarity', 'Radiance', 'Illumination'],
            announcement: ['announcement', 'warning', 'ceremony', 'fanfare', 'herald', 'signal'],
        },
        tags: ['light', 'glow', 'radiance', 'gleam', 'clarity'],
        position: 'open', mood: 'warm',
    },
    {
        template: 'Silence {thickens}',
        slots: {
            thickens: ['thickens', 'deepens', 'grows heavier', 'presses inward', 'becomes tangible', 'solidifies'],
        },
        tags: ['silence', 'still', 'quiet', 'pause'],
        position: 'open', mood: 'tense',
    },
    {
        template: 'Dust {drifts} through {pale} {light}',
        slots: {
            drifts: ['drifts', 'floats', 'hangs', 'swirls', 'suspends', 'wanders'],
            pale: ['pale', 'soft', 'diffused', 'faint', 'muted', 'gentle'],
            light: ['light', 'air', 'space', 'the room', 'visibility'],
        },
        tags: ['room', 'inside', 'dust', 'particle', 'haze'],
        position: 'open', mood: 'calm',
    },
    {
        template: 'Thunder {mutters} and {retreats}',
        slots: {
            mutters: ['mutters', 'grumbles', 'rumbles', 'growls', 'complains'],
            retreats: ['retreats', 'withdraws', 'recedes', 'pulls back', 'fades', 'moves on'],
        },
        tags: ['thunder', 'storm', 'rumble', 'distance'],
        position: 'open', mood: 'tense',
    },
    {
        template: 'Frost {traces} patterns {quality}',
        slots: {
            traces: ['traces', 'draws', 'etches', 'sketches', 'writes', 'forms'],
            quality: ['unseen', 'delicate', 'intricate', 'silent', 'patient', 'precise'],
        },
        tags: ['frost', 'ice', 'cold', 'freeze', 'crystal'],
        position: 'open', mood: 'cold',
    },
    {
        template: 'Life {hums} just out of {earshot}',
        slots: {
            hums: ['hums', 'murmurs', 'vibrates', 'pulses', 'resonates', 'stirs'],
            earshot: ['earshot', 'reach', 'sight', 'grasp', 'awareness'],
        },
        tags: ['crowd', 'people', 'market', 'street', 'city', 'busy'],
        position: 'open', mood: 'neutral',
    },

    // ── Middles ──
    {
        template: ', {carrying} {nothing} and {everything}',
        slots: {
            carrying: ['carrying', 'bearing', 'holding', 'bringing', 'containing'],
            nothing: ['nothing', 'emptiness', 'absence', 'void'],
            everything: ['everything', 'all of it', 'what remains', 'the weight of it'],
        },
        tags: ['wind', 'air', 'outside', 'silence'],
        position: 'mid', mood: 'neutral',
    },
    {
        template: ', as if {listening}',
        slots: {
            listening: ['listening', 'waiting', 'watching', 'attending', 'paying heed', 'noticing'],
        },
        tags: ['room', 'still', 'quiet', 'attention'],
        position: 'mid', mood: 'tense',
    },
    {
        template: ', {indifferent} to what happens here',
        slots: {
            indifferent: ['indifferent', 'oblivious', 'unmoved', 'unconcerned', 'detached', 'apart'],
        },
        tags: ['outside', 'world', 'rain', 'water', 'sea'],
        position: 'mid', mood: 'melancholy',
    },
    {
        template: ', {patient} and {unhurried}',
        slots: {
            patient: ['patient', 'steady', 'measured', 'deliberate', 'composed'],
            unhurried: ['unhurried', 'unrushed', 'leisurely', 'slow', 'easy'],
        },
        tags: ['slow', 'wait', 'still', 'wood', 'endure'],
        position: 'mid', mood: 'calm',
    },
    {
        template: ', {touching} {surfaces} {gently}',
        slots: {
            touching: ['touching', 'brushing', 'grazing', 'meeting', 'reaching'],
            surfaces: ['surfaces', 'edges', 'things nearby', 'what it finds', 'whatever is close'],
            gently: ['gently', 'softly', 'lightly', 'carefully', 'tenderly'],
        },
        tags: ['light', 'glow', 'warm', 'fire', 'soft'],
        position: 'mid', mood: 'warm',
    },
    {
        template: ', finding {cracks} to {slip} through',
        slots: {
            cracks: ['cracks', 'gaps', 'openings', 'weaknesses', 'spaces'],
            slip: ['slip', 'seep', 'creep', 'flow', 'push', 'thread'],
        },
        tags: ['cold', 'wind', 'frost', 'rain', 'chill'],
        position: 'mid', mood: 'cold',
    },
    {
        template: ', then {dissolving} into {distance}',
        slots: {
            dissolving: ['dissolving', 'fading', 'melting', 'scattering', 'dispersing', 'vanishing'],
            distance: ['distance', 'the background', 'obscurity', 'memory', 'what came before'],
        },
        tags: ['sound', 'footstep', 'voices', 'crowd', 'noise'],
        position: 'mid', mood: 'melancholy',
    },
    {
        template: ', holding {shape} against the {void}',
        slots: {
            shape: ['shape', 'form', 'outline', 'presence', 'structure'],
            void: ['void', 'dark', 'emptiness', 'absence', 'surrounding blank'],
        },
        tags: ['fire', 'candle', 'ember', 'glow', 'flame'],
        position: 'mid', mood: 'warm',
    },
    {
        template: ', {older} than anyone present',
        slots: {
            older: ['older', 'more ancient', 'longer-lasting', 'more enduring', 'predating'],
        },
        tags: ['water', 'river', 'sea', 'ocean', 'wave', 'tree', 'forest'],
        position: 'mid', mood: 'melancholy',
    },
    {
        template: ', settling into {familiar} {grooves}',
        slots: {
            familiar: ['familiar', 'known', 'well-worn', 'expected', 'accustomed'],
            grooves: ['grooves', 'patterns', 'rhythms', 'habits', 'tracks', 'paths'],
        },
        tags: ['wood', 'creak', 'old', 'house', 'room'],
        position: 'mid', mood: 'calm',
    },
    {
        template: ', marking {passage} without meaning to',
        slots: {
            passage: ['passage', 'progress', 'movement', 'change', 'transition'],
        },
        tags: ['rain', 'drip', 'rhythm', 'pulse', 'cycle'],
        position: 'mid', mood: 'neutral',
    },
    {
        template: ', {heavy} with things {unsaid}',
        slots: {
            heavy: ['heavy', 'laden', 'burdened', 'weighted', 'full'],
            unsaid: ['unsaid', 'unspoken', 'unvoiced', 'held back', 'withheld'],
        },
        tags: ['silence', 'pause', 'quiet', 'still', 'tension'],
        position: 'mid', mood: 'tense',
    },
    {
        template: ', {softening} edges that were {sharp}',
        slots: {
            softening: ['softening', 'easing', 'blunting', 'smoothing', 'rounding'],
            sharp: ['sharp', 'hard', 'rigid', 'defined', 'harsh'],
        },
        tags: ['light', 'warm', 'glow', 'gentle', 'ease'],
        position: 'mid', mood: 'warm',
    },
    {
        template: ', pressing {closer} than {comfort} allows',
        slots: {
            closer: ['closer', 'nearer', 'tighter', 'deeper', 'further in'],
            comfort: ['comfort', 'ease', 'tolerance', 'acceptance', 'welcome'],
        },
        tags: ['cold', 'shadow', 'frost', 'ice', 'tight'],
        position: 'mid', mood: 'cold',
    },
    {
        template: ', each {word} {absorbed} before it lands',
        slots: {
            word: ['word', 'sound', 'syllable', 'utterance', 'phrase'],
            absorbed: ['absorbed', 'caught', 'taken in', 'consumed', 'received', 'swallowed'],
        },
        tags: ['book', 'page', 'paper', 'ink', 'library'],
        position: 'mid', mood: 'calm',
    },
    {
        template: ', belonging to {no one}',
        slots: {
            'no one': ['no one', 'nobody', 'no single person', 'nothing specific', 'the unclaimed'],
        },
        tags: ['outside', 'grass', 'field', 'path', 'wind', 'tree'],
        position: 'mid', mood: 'neutral',
    },

    // ── Closers ──
    {
        template: '. Nothing else {follows}.',
        slots: {
            follows: ['follows', 'comes after', 'responds', 'answers', 'breaks the stillness'],
        },
        tags: ['silence', 'still', 'quiet', 'end', 'stop'],
        position: 'close', mood: 'calm',
    },
    {
        template: '. The moment {holds}.',
        slots: {
            holds: ['holds', 'sustains', 'persists', 'remains', 'stays suspended', 'does not break'],
        },
        tags: ['pause', 'wait', 'still', 'breath'],
        position: 'close', mood: 'tense',
    },
    {
        template: '. Then even that {fades}.',
        slots: {
            fades: ['fades', 'dissolves', 'disappears', 'slips away', 'evaporates', 'is gone'],
        },
        tags: ['sound', 'footstep', 'voices', 'echo', 'fade'],
        position: 'close', mood: 'melancholy',
    },
    {
        template: '. It asks for {nothing} in return.',
        slots: {
            nothing: ['nothing', 'no acknowledgment', 'no response', 'no attention', 'no reciprocity'],
        },
        tags: ['outside', 'nature', 'wind', 'tree', 'grass', 'water'],
        position: 'close', mood: 'neutral',
    },
    {
        template: '. {Warmth} persists despite everything.',
        slots: {
            Warmth: ['Warmth', 'Heat', 'Comfort', 'A residual glow', 'What remains of warmth'],
        },
        tags: ['fire', 'warm', 'hearth', 'ember', 'candle'],
        position: 'close', mood: 'warm',
    },
    {
        template: '. Cold does not {negotiate}.',
        slots: {
            negotiate: ['negotiate', 'compromise', 'yield', 'bargain', 'relent', 'hesitate'],
        },
        tags: ['cold', 'frost', 'ice', 'freeze', 'bite'],
        position: 'close', mood: 'cold',
    },
    {
        template: '. The silence has {weight} now.',
        slots: {
            weight: ['weight', 'mass', 'density', 'pressure', 'substance', 'gravity'],
        },
        tags: ['silence', 'heavy', 'thick', 'pressure', 'still'],
        position: 'close', mood: 'tense',
    },
    {
        template: '. Pages remember what {readers} {forget}.',
        slots: {
            readers: ['readers', 'voices', 'those who passed through', 'the living', 'anyone present'],
            forget: ['forget', 'overlook', 'leave behind', 'abandon', 'lose'],
        },
        tags: ['book', 'paper', 'ink', 'story', 'word'],
        position: 'close', mood: 'melancholy',
    },
    {
        template: '. Water does not {stop} for anyone.',
        slots: {
            stop: ['stop', 'pause', 'wait', 'hesitate', 'slow', 'yield'],
        },
        tags: ['water', 'river', 'sea', 'ocean', 'stream', 'current'],
        position: 'close', mood: 'neutral',
    },
    {
        template: '. Light {withdraws} {slowly}.',
        slots: {
            withdraws: ['withdraws', 'retreats', 'recedes', 'dims', 'pulls back', 'ebbs'],
            slowly: ['slowly', 'gradually', 'by degrees', 'without hurry', 'imperceptibly'],
        },
        tags: ['dim', 'fade', 'shadow', 'retreat', 'wane'],
        position: 'close', mood: 'melancholy',
    },
    {
        template: '. {Brightness} forgives what came before.',
        slots: {
            Brightness: ['Brightness', 'Light', 'Clarity', 'Radiance', 'What illumination remains'],
        },
        tags: ['light', 'glow', 'radiance', 'clarity', 'renew'],
        position: 'close', mood: 'warm',
    },
    {
        template: '. Rain keeps its own {counsel}.',
        slots: {
            counsel: ['counsel', 'rhythm', 'purpose', 'logic', 'reasoning', 'terms'],
        },
        tags: ['rain', 'storm', 'drizzle', 'pouring', 'wet'],
        position: 'close', mood: 'calm',
    },
    {
        template: '. Wood remembers every {weight} it has {borne}.',
        slots: {
            weight: ['weight', 'pressure', 'load', 'burden', 'force'],
            borne: ['borne', 'carried', 'supported', 'endured', 'sustained', 'held'],
        },
        tags: ['wood', 'creak', 'old', 'floor', 'settle'],
        position: 'close', mood: 'melancholy',
    },
    {
        template: '. The city does not {notice}.',
        slots: {
            notice: ['notice', 'register', 'acknowledge', 'respond', 'care', 'react'],
        },
        tags: ['crowd', 'city', 'street', 'busy', 'people'],
        position: 'close', mood: 'neutral',
    },
    {
        template: '. {Stillness} becomes its own {answer}.',
        slots: {
            Stillness: ['Stillness', 'Quiet', 'Silence', 'Absence of motion', 'Calm'],
            answer: ['answer', 'response', 'resolution', 'conclusion', 'reply'],
        },
        tags: ['still', 'quiet', 'silence', 'peace', 'calm'],
        position: 'close', mood: 'calm',
    },
];