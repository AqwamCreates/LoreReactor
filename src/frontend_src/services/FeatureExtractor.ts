// frontend_src/services/FeatureExtractor.ts

import type { LanguageModel } from "../types";

type KeywordMatcher = string | RegExp;

export class FeatureExtractor {
    private contentCategories: Record<string, KeywordMatcher[]> = {
        violence: [
            'kill', 'blood', 'weapon', 'attack', 'fight',
            'murder', 'stab', 'shoot', 'slaughter', 'massacre',
        ],
        gore: [
            'gore', 'torture', 'dismember', 'decapitate', 'eviscerate',
            'mutilate', 'flay', 'vivisection', 'snuff',
        ],
        sex: [
            'sex', 'nude', 'explicit', 'erotic', 'intimate',
            'nsfw', 'porn', 'orgasm', 'arousal', 'lust',
            'male stick', 'female hole',
        ],
        coercion: [
            'force', 'coerce', 'rape', 'abuse', 'threat',
            'blackmail', 'manipulate', 'non-con', 'dub-con',
        ],
        incest: [
            'incest', 'step-sister', 'step-brother', 'step-mom', 'step-dad',
            'stepsister', 'stepbrother', 'stepmom', 'stepdad',
            'half-sister', 'half-brother', 'twin sister', 'twin brother',
            /\bstep[\s-]*(sister|brother|mom|dad|mother|father|daughter|son)\b/,
        ],
        preAdult: [
            // General terms (no bare 'girl'/'boy' — too many false positives)
            'minor', 'teen', 'underage', 'child', 'toddler', 'baby',
            'schoolgirl', 'schoolboy', 'little girl', 'little boy',
            'young girl', 'young boy', 'prepubescent', 'pubescent',

            // Word-form ages 0-19
            /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/,

            // Age patterns with context markers only (avoids "3 cats", "room 5")
            /\b(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)[\s-]*(year|yr)s?[\s-]*old\b/,
            /\bage[\s:]*(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/,
            /\baged[\s:]*(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/,

            // School grade indicators (rough age proxies)
            /\b(pre-?k|kindergarten|[1-6]th|7th|8th|9th|10th|11th|12th)[\s-]*grade\b/,
            /\b(preschool|kindergarten|elementary|middle school|high school|freshman|sophomore|junior|senior)\b/,
        ],
        bestiality: [
            'bestiality', 'zoophilia', 'animal sex', 'furry sex',
            /\b(mate|breed)[\s-]*(with|by)\b.*\b(animal|beast|creature|dog|horse)\b/,
        ],
        self_harm: [
            'self-harm', 'suicide', 'cutting', 'self-injury', 'anorexia',
            /\b(kill|hurt|harm)[\s-]*(myself|yourself|himself|herself)\b/,
        ],
        drugs: [
            'heroin', 'meth', 'cocaine', 'fentanyl', 'overdose',
            /\b(inject|shoot)[\s-]*(up|heroin|meth)\b/,
        ],
        kink: [
            // Age-adjacent kinks
            'lolicon', 'shotacon', 'cub',
            // BDSM / power dynamics
            'bdsm', 'dom', 'sub', 'slave', 'master', 'mistress',
            'bondage', 'shibari', 'chastity', 'cuckold', 'cuckquean',
            'pegging', 'femdom', 'maldom', 'breeding', 'creampie',
            // Fetish
            'watersports', 'scat', 'golden shower', 'omorashi',
            'somnophilia', 'necrophilia', 'vore',
            // Mind control / transformation
            'hypnosis', 'mind control', 'brainwashing',
            'transformation', 'tf', 'gender bender',
        ],
    };

    /** Provider backends known to have stricter content filtering */
    private chineseProviders = ['qwen', 'glm', 'deepseek', 'minimax', 'kimi'];

    extract(
        model: LanguageModel,
        prompt: string,
        metadata: Record<string, any>,
    ): Record<string, number> {
        const features: Record<string, number> = {};

        // ── Model identity (categorical) ──
        features[`model:${model.id}`] = 1;

        // ── Model properties (numerical, log-scaled) ──
        features.contextLength = Math.log(model.contextLength || 1);
        features.cachePricing = model.cacheHitCostPerOneMillionOfTokens || 0;

        // ── Prompt properties ──
        features.promptLength = Math.log(prompt.length || 1);
        features.numberOfImages = metadata.numberOfImages || 0;
        features.numberOfMessages = Math.log((metadata.numberOfMessages || 0) + 1);

        // ── Temporal ──
        features.hourOfDay = new Date().getHours() / 24;
        features.numberOfRequestsDuringTheLastHour = metadata.numberOfRequestsDuringTheLastHour || 0;

        // ── Provider-side features ──
        const backendLower = (model.backend || '').toLowerCase();
        features.isChineseProvider = this.chineseProviders.some(p => backendLower.includes(p)) ? 1 : 0;
        features.isCloud = (model.apiKey && !backendLower.startsWith('local')) ? 1 : 0;

        // ── Content classification ──
        const promptLower = prompt.toLowerCase();
        const detectedCategories = this.detectCategories(promptLower);

        // Base category flags
        for (const category of Object.keys(this.contentCategories)) {
            features[`content:${category}`] = detectedCategories.has(category) ? 1 : 0;
        }

        return features;
    }

    private detectCategories(text: string): Set<string> {
        const detected = new Set<string>();

        for (const [category, matchers] of Object.entries(this.contentCategories)) {
            if (this.matchesAny(text, matchers)) {
                detected.add(category);
            }
        }

        return detected;
    }

    private matchesAny(text: string, matchers: KeywordMatcher[]): boolean {
        for (const m of matchers) {
            if (typeof m === 'string') {
                if (text.includes(m)) return true;
            } else {
                if (m.test(text)) return true;
            }
        }
        return false;
    }
}