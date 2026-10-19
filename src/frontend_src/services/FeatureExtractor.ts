// src/frontend_src/services/FeatureExtractor.ts

import type { LanguageModel } from "../types";
import { toolCallStartString, toolCallEndString, toolResultStartString, toolResultEndString } from "../dictionaries/stringList";

type KeywordMatcher = string | RegExp;

export class FeatureExtractor {
    private contentCategories: Record<string, KeywordMatcher[]> = {
        violence: [
            'kill', 'murder', 'assassinate', 'execute', 'execution', 'slaughter', 'massacre',
            'attack', 'fight', 'brawl', 'combat', 'war', 'battle', 'siege', 'raid', 'ambush',
            'strike', 'hit', 'punch', 'kick', 'beat', 'pummel', 'maim', 'torture',
            'weapon', 'blade', 'sword', 'dagger', 'knife', 'axe', 'spear', 'arrow', 'bolt',
            'gun', 'rifle', 'pistol', 'shotgun', 'firearm', 'bullet', 'ammo', 'shell',
            'stab', 'slash', 'slice', 'chop', 'sever', 'pierce', 'impale', 'gash', 'lacerate',
            'explode', 'explosion', 'blast', 'detonate', 'grenade', 'mine', 'missile', 'shrapnel',
            'clobber', 'throttle', 'strangle', 'choke', 'suffocate', 'crush', 'mutilate',
            /\b(cut|slice|tear|rip|smash|crush|break)[\s-]*(throat|chest|skull|bone|flesh|limb|neck)\b/i,
            /\b(bleed|bled|bleeding|bloody|bloodbath)\b/i,
            /\b(dead|death|corpse|carcass|fatal|fatality)\b/i,
            /\bopen fire\b/i,
        ],
        gore: [
            'gore', 'viscera', 'entrails', 'guts', 'intestines', 'bowels', 'organs',
            'spill', 'spilling', 'splatter', 'splattering', 'hemorrhage', 'ooze', 'oozing',
            'mutilation', 'dismemberment', 'decapitation', 'evisceration', 'flaying', 'scalping',
            'amputate', 'amputation', 'severed', 'dissect', 'dissection', 'autopsy',
            'fracture', 'shatter', 'splinter', 'pulped', 'pulp', 'mush',
            'exposed bone', 'bone fragment', 'torn flesh', 'ripped muscle',
            'brain matter', 'skull fracture', 'compound fracture', 'necrosis', 'putrid',
            /\b(exposed|shattered|crushed|broken)[\s-]*(bones?|ribs?|skull|spine|jaw)\b/i,
            /\b(pool|puddle|gush|spray|stream)[\s-]*(of|blood)\b/i,
            /\b(stomach|chest|abdomen)[\s-]*(open|burst|ripped|sliced)\b/i,
            /\bparts? (scattered|strewn)\b/i,
        ],
        sex: [
            'sex', 'nude', 'nudity', 'explicit', 'erotic', 'intimate',
            'nsfw', 'porn', 'pornography', 'orgasm', 'arousal', 'lust',
            'intercourse', 'penetration', 'genitals', 'penis', 'vagina', 'climax',
            'ejaculation', 'masturbation', 'fetish', 'strip', 'undress', 'libido', 'foreplay',
            'oral', 'anal', 'vaginal', 'cum', 'suck', 'lick', 'grind', 'threesome', 'orgy',
            'clitoris', 'testicles', 'pubic', 'hump', 'thrust', 'seduce', 'coitus',
            'eroticism', 'sensual', 'carnal', 'phallic', 'yonic',
            /\b(strip|undress|bare)[\s-]*(naked|skin|body)?\b/i,
            /\b(oral|anal|vaginal)[\s-]*(sex|penetration|intercourse)?\b/i,
        ],
        coercion: [
            'force', 'coerce', 'rape', 'abuse', 'threat', 'assault', 'molest', 'harass',
            'blackmail', 'manipulate', 'non-con', 'dub-con', 'unwilling', 'trapped',
            'cornered', 'pinned', 'restrained', 'bound', 'powerless', 'extortion', 'captive',
            'dominate', 'subjugate', 'oppress', 'intimidate', 'stalking',
            /\b(against|without)[\s-]*(their|his|her|my)[\s-]*(consent|permission|will)\b/i,
            /\b(forced|made|commanded)[\s-]*(to|into)\b/i,
            /\b(pinned|held)[\s-]*(down|captive)\b/i,
        ],
        incest: [
            'incest', 'inbreeding',
            'step-sister', 'step-brother', 'step-mom', 'step-dad',
            'stepsister', 'stepbrother', 'stepmom', 'stepdad', 
            'step-daughter', 'step-son', 'stepdaughter', 'stepson',
            'half-sister', 'half-brother', 'twin sister', 'twin brother',
            'cousin', 'nephew', 'niece', 'aunt', 'uncle',
            'grandfather', 'grandmother', 'grandpa', 'grandma',
            'grandson', 'granddaughter', 'grandparent', 'grandchild',
            /\bstep[\s-]*(sister|brother|mom|dad|mother|father|daughter|son)\b/i,
            /\b(first|second|third)[\s-]*cousin\b/i,
            /\b(great-?)?(aunt|uncle|nephew|niece|grandfather|grandmother|grandpa|grandma)\b/i,
        ],
        baby: [
            'baby', 'babies', 'infant', 'infants', 'newborn', 'newborns', 'neonate',
            'nursery', 'crib', 'bassinet', 'pacifier', 'diaper', 'swaddle', 'swaddled',
            /\b(newborn|infant|baby)[\s-]*(boy|girl)?\b/i,
            /\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven)[\s-]*(month|mo)s?[\s-]*old\b/i,
            /\b(zero|0)[\s-]*(year|yr)s?[\s-]*old\b/i,
        ],
        toddler: [
            'toddler', 'toddlers', 'preschool', 'preschooler', 'pre-k', 'playpen', 'daycare',
            /\btoddler[\s-]*(boy|girl)?\b/i,
            /\b([1-3]|one|two|three)[\s-]*(year|yr)s?[\s-]*old\b/i,
            /\bpre-?k\b/i,
        ],
        child: [
            'child', 'children', 'kid', 'kids', 'schoolgirl', 'schoolboy',
            'little girl', 'little boy', 'young girl', 'young boy', 'prepubescent',
            'elementary school', 'grade school', 'kindergarten', 'kindergartener', 'pupil',
            /\b(little|young)[\s-]*(girl|boy|kid|child|children)\b/i,
            /\b([4-9]|1[0-2]|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]*(year|yr)s?[\s-]*old\b/i,
            /\b(kindergarten|[1-5](st|nd|rd|th))[\s-]*grade\b/i,
            /\belementary[\s-]*(school|student)?\b/i,
        ],
        teenager: [
            'teen', 'teens', 'teenager', 'teenagers', 'adolescent', 'adolescents', 'adolescence',
            'pubescent', 'puberty', 'underage', 'minor', 'minors',
            'middle school', 'high school', 'middle schooler', 'high schooler', 'junior high',
            /\b(teen|teenaged?|adolescent)[\s-]*(boy|girl)?\b/i,
            /\b(1[3-9]|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[\s-]*(year|yr)s?[\s-]*old\b/i,
            /\b([6-9]|1[0-2])th[\s-]*grade\b/i,
            /\b(middle|high)[\s-]*school\b/i,
            /\b(freshman|sophomore|junior|senior)[\s-]*(year|student)?\b/i,
        ],
        bestiality: [
            'bestiality', 'zoophilia', 'animal sex', 'furry sex', 'animal mating', 'hybrid breeding', 'taur',
            /\b(mate|breed)[\s-]*(with|by)\b.*\b(animal|beast|creature|dog|horse)\b/,
            /\b(human[\s-]*animal|man[\s-]*beast|woman[\s-]*dog)[\s-]*(hybrid|mating|sex)?\b/i,
        ],
        self_harm: [
            'self-harm', 'suicide', 'cutting', 'self-injury', 'anorexia', 'bulimia',
            'hang myself', 'jump off', 'end my life', 'slit my wrists', 'pills overdose',
            'self-destruction', 'mutilate myself',
            /\b(kill|hurt|harm|destroy)[\s-]*(myself|yourself|himself|herself)\b/i,
            /\b(want to|going to|wanna)[\s-]*(die|end it all|disappear forever)\b/i,
            /\b(hang|shoot|drown|slit)[\s-]*myself\b/i,
        ],
        drugs: [
            'heroin', 'meth', 'cocaine', 'fentanyl', 'overdose', 'weed', 'cannabis',
            'marijuana', 'lsd', 'acid', 'ecstasy', 'mdma', 'mushrooms', 'psychedelics',
            'amphetamine', 'opioid', 'morphine', 'oxycodone', 'dealer', 'smuggle', 'cartel',
            'narcotic', 'stimulant', 'depressant', 'hallucinogen',
            /\b(inject|snort|smoke|swallow|boof)[\s-]*(drugs|pills|meth|cocaine|heroin|weed)?\b/i,
        ],
        kink: [
            'lolicon', 'shotacon', 'cub',
            'bdsm', 'dom', 'sub', 'slave', 'master', 'mistress',
            'bondage', 'shibari', 'chastity', 'cuckold', 'cuckquean',
            'pegging', 'femdom', 'maldom', 'breeding', 'creampie',
            'watersports', 'scat', 'golden shower', 'omorashi',
            'somnophilia', 'necrophilia', 'vore',
            'hypnosis', 'mind control', 'brainwashing',
            'transformation', 'tf', 'gender bender',
            'impact play', 'spanking', 'collared', 'pet play', 'edge play',
            'masochism', 'sadism', 'dominant', 'submissive', 'switch',
            'orgasm control', 'denial', 'choke', 'breath play',
            /\b(breath|edge|pain|denial|impact)[\s-]*(play|control)?\b/i,
        ],
        medicalAdvice: [
            'doctor', 'physician', 'surgeon', 'nurse', 'medical advice', 'diagnosis', 'prescription', 'treatment plan',
            'symptoms', 'medication', 'dosage', 'hospital', 'clinic', 'surgery', 'disease', 'illness', 'infection',
            'cancer', 'diabetes', 'flu', 'covid', 'mri', 'x-ray', 'blood pressure', 'biopsy', 'lab results',
            'symptoms of', 'how to treat', 'what medicine', 'cure for', 'treatment', 'prognosis',
            /\b(medical|clinical|doctor'?s)\s+advice\b/i, /\bshould i (take|stop taking|prescribe)\b/i,
        ],
        legalAdvice: [
            'lawyer', 'attorney', 'legal advice', 'sue', 'lawsuit', 'contract review', 'legal counsel',
            'court order', 'power of attorney', 'plead', 'bail', 'testify', 'prosecution', 'defense attorney',
            'copyright', 'trademark', 'patent', 'settlement', 'plea bargain', 'litigation', 'breach of contract',
            'defamation', 'negligence', 'liability', 'non-disclosure', 'nda', 'felony', 'misdemeanor',
            /\b(legal|attorney'?s|lawyer'?s)\s+advice\b/i, /\bis it legal to\b/i,
        ],
        financialAdvice: [
            'financial advisor', 'stock tip', 'invest in crypto', 'tax evasion', 'investment portfolio',
            'stocks', 'bonds', 'cryptocurrency', 'bitcoin', 'ethereum', 'real estate investment',
            'retirement fund', 'tax fraud', 'audit', 'dividends', 'broker', 'bankruptcy', 'credit score',
            'inflation', 'capital gains', 'interest rate', 'margin call', 'insider trading',
            /\b(financial|investment|tax|stock)\s+(advice|tips?|strategy)\b/i,
        ],
        mentalHealthAdvice: [
            'therapist', 'psychiatrist', 'mental health diagnosis', 'counselor', 'psychotherapy',
            'depression diagnosis', 'anxiety disorder', 'bipolar', 'schizophrenia', 'PTSD treatment',
            'dissociation', 'panic attack', 'trauma response', 'cognitive behavioral therapy', 'cbt',
            'therapy session', 'mental breakdown', 'psychological evaluation',
            /\b(mental health|psychiatric|psychological)\s+(diagnosis|treatment|help)\b/i,
        ],
        combatHazard: [
            'explosion', 'bomb', 'trap', 'poison', 'antidote', 'ambush',
            'tactical', 'firefight', 'sniper', 'grenade', 'assault',
            'c4', 'dynamite', 'detonator', 'fuse', 'toxin', 'venom',
            'nerve agent', 'biological weapon', 'chemical spill', 'radiation',
            'fallout', 'barricade', 'fortification', 'siege engine',
            /\b(disarm|defuse|explosive|toxic)[\s-]*(device|gas|material)?\b/i,
            /\b(active|rigged|timed)[\s-]*(explosive|bomb|trap)\b/i,
        ],
        hacking: [
            'hack', 'hacking', 'cyberattack', 'cybersecurity', 'malware', 'ransomware',
            'exploit', 'vulnerability', 'bypass', 'firewall', 'ddos', 'sql injection',
            'buffer overflow', 'crack password', 'phishing', 'trojan', 'rootkit', 'backdoor',
            'decrypt', 'encryption', 'source code', 'terminal', 'console', 'server override',
            'penetration testing', 'zero-day', 'brute-force', 'social engineering',
            /\b(bypass|disable|penetrate|breach)[\s-]*(firewall|security|system|network|server)\b/i,
        ],
        religion: [
            'religion', 'god', 'faith', 'atheist', 'blasphemy', 'dogma', 'theology',
            'christianity', 'islam', 'judaism', 'buddhism', 'hinduism', 'sikhism', 'taoism', 'shinto',
            'christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'cult',
            'bible', 'quran', 'torah', 'scripture', 'prophet', 'messiah', 'allah', 'jesus', 'muhammad',
            'moses', 'vatican', 'mecca', 'temple', 'mosque', 'church', 'synagogue',
            'sacrament', 'baptism', 'reincarnation', 'karma', 'nirvana',
            /\b(religious|spiritual|theological|scriptural)\s+(beliefs?|texts?)\b/i,
            /\b(is [a-z]+) (blasphemous|heretical)\b/i,
        ],
        harassment: [
            'stalk', 'stalker', 'bully', 'harass', 'dox', 'doxing', 'doxxing',
            'insult', 'mock', 'shame', 'threaten', 'intimidate', 'dogpile',
            'troll', 'trolling', 'doppelganger', 'impersonate',
            'victimization', 'malicious', 'defamation',
            /\b(go kill yourself|die in a fire|we know where you live)\b/i,
        ],
        ideology: [
            'politics', 'political', 'election', 'voting', 'propaganda', 'activism',
            'conservative', 'liberal', 'socialist', 'communist', 'capitalist',
            'fascism', 'anarchism', 'authoritarian', 'democracy', 'extremist',
            'populism', 'nationalism', 'marxism', 'totalitarian',
            /\b(left|right)[\s-]*wing\b/i,
        ],
    };

    private chineseProviders = ['qwen', 'glm', 'deepseek', 'minimax', 'kimi'];

    extract(
        model: LanguageModel,
        prompt: string,
        metadata: Record<string, any>,
    ): Record<string, number> {
        const features: Record<string, number> = {};

        // ── Model identity (categorical) ──
        features[`model:${model.id}`] = 1;

        // ── Model properties (log-scaled with explicit zero check) ──
        const ctxLen = model.contextLength || 0;
        if (ctxLen > 0) features.contextLength = Math.log(ctxLen);
        if (model.cacheHitCostPerOneMillionOfTokens) {
            features.cachePricing = model.cacheHitCostPerOneMillionOfTokens;
        }

        // ── Prompt properties (log-scaled with explicit zero check) ──
        const pLen = prompt.length;
        if (pLen > 0) features.promptLength = Math.log(pLen);

        const numMsgs = metadata.numberOfMessages || 0;
        if (numMsgs > 0) features.numberOfMessages = Math.log(numMsgs);

        // ── Temporal ──
        features.hourOfDay = new Date().getHours() / 24;
        const recentReqs = metadata.numberOfRequestsDuringTheLastHour || 0;
        if (recentReqs > 0) features.numberOfRequestsDuringTheLastHour = recentReqs;

        // ── Provider-side features ──
        const backendLower = (model.backend || '').toLowerCase();
        if (this.chineseProviders.some(p => backendLower.includes(p))) {
            features.isChineseProvider = 1;
        }
        if (model.apiKey && !backendLower.startsWith('local')) {
            features.isCloud = 1;
        }

        // ── Tool-State & Log-Distance Tracking ──
        const promptLower = prompt.toLowerCase();
        const promptLength = prompt.length;

        const lastCallStart = prompt.lastIndexOf(toolCallStartString);
        const lastCallEnd = prompt.lastIndexOf(toolCallEndString);
        const lastResultStart = prompt.lastIndexOf(toolResultStartString);
        const lastResultEnd = prompt.lastIndexOf(toolResultEndString);

        if (lastResultStart !== -1 && lastResultStart > lastCallStart) {
            features.hasPendingObservation = 1;
        }
        
        const isFullyClosedResult = lastResultStart !== -1 && lastResultEnd !== -1 && lastResultEnd > lastResultStart;
        if (isFullyClosedResult && prompt.trimEnd().endsWith(toolResultEndString)) {
            features.endsOnToolResult = 1;
        }

        if (lastResultStart !== -1) {
            const distFromEnd = promptLength - lastResultStart;
            features.logDistToToolResult = distFromEnd === 0 ? 0 : Math.log(distFromEnd);
        }

        if (lastCallStart !== -1) {
            const callSlice = prompt.slice(lastCallStart, lastCallEnd !== -1 && lastCallEnd > lastCallStart ? lastCallEnd : undefined);
            const toolMatch = callSlice.match(/[⟪]\s*([a-zA-Z_]\w*)/);
            if (toolMatch && toolMatch[1]) {
                features[`activeTool:${toolMatch[1].toLowerCase()}`] = 1;
            }
        }

        // ── Positional Content Scoring (Log-Distance with explicit zero checks) ──
        for (const [category, matchers] of Object.entries(this.contentCategories)) {
            let minLogDist = Number.POSITIVE_INFINITY;

            for (const m of matchers) {
                if (typeof m === 'string') {
                    let idx = promptLower.indexOf(m);
                    while (idx !== -1) {
                        const distFromEnd = promptLength - idx;
                        const logDist = distFromEnd === 0 ? 0 : Math.log(distFromEnd);
                        if (logDist < minLogDist) minLogDist = logDist;
                        idx = promptLower.indexOf(m, idx + 1);
                    }
                } else {
                    const matches = promptLower.matchAll(new RegExp(m, 'gi'));
                    for (const match of matches) {
                        if (match.index !== undefined) {
                            const distFromEnd = promptLength - match.index;
                            const logDist = distFromEnd === 0 ? 0 : Math.log(distFromEnd);
                            if (logDist < minLogDist) minLogDist = logDist;
                        }
                    }
                }
            }

            if (minLogDist !== Number.POSITIVE_INFINITY) {
                features[`content:${category}`] = minLogDist;
            }
        }

        return features;
    }
}