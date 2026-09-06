// src/services/SentimentAnalysisEngine.ts
import { pipeline } from '@huggingface/transformers';

const EMOTION_LABELS = [
    'admiration', 'amusement', 'anger', 'annoyance', 'approval',
    'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
    'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
    'gratitude', 'grief', 'joy', 'love', 'nervousness',
    'optimism', 'pride', 'realization', 'relief', 'remorse',
    'sadness', 'surprise', 'neutral'
] as const;

export type EmotionLabel = typeof EMOTION_LABELS[number];

export interface SentimentResult {
    emotions: Record<EmotionLabel, number>;
    topEmotion: EmotionLabel;
    topScore: number;
}

const HF_MODEL_ID = 'Cohee/distilbert-base-uncased-go-emotions-onnx';

type TextClassificationPipeline = (text: string | string[]) => Promise<Array<{ label: string; score: number }>>;

export class SentimentAnalysisEngine {
    private classifier: TextClassificationPipeline | null = null;
    private loading: Promise<void> | null = null;
    private loadError: string | null = null;

    /**
     * Initialize the sentiment engine. Downloads and loads the model via
     * @huggingface/transformers pipeline. Safe to call multiple times.
     */
    async initialize(): Promise<void> {
        if (this.classifier) return;
        if (this.loading) return this.loading;

        this.loading = (async () => {
            try {
                console.log('[SentimentEngine] Loading pipeline from HuggingFace...');
                this.classifier = await pipeline('text-classification', HF_MODEL_ID, {
                    dtype: 'fp32',
                }) as TextClassificationPipeline;
                console.log('[SentimentEngine] Ready.');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[SentimentEngine] Initialization failed:', msg);
                this.loadError = msg;
                this.classifier = null;
            }
        })();

        return this.loading;
    }

    /**
     * Analyze text and return emotion scores.
     * Returns null if engine is not initialized or analysis fails.
     */
    async analyze(text: string): Promise<SentimentResult | null> {
        if (!this.classifier) return null;

        try {
            // Pipeline returns [{ label, score }] for single text input
            // For multi-label models like go_emotions, we need topk=null to get all labels
            const results = await this.classifier(text);

            // Build full emotion map from pipeline output
            const emotions = {} as Record<EmotionLabel, number>;
            let topEmotion: EmotionLabel = 'neutral';
            let topScore = Number.NEGATIVE_INFINITY;

            // Initialize all labels to 0
            for (const label of EMOTION_LABELS) {
                emotions[label] = 0;
            }

            // Fill in scores from pipeline output
            // The pipeline may return one result (top-1) or multiple depending on model config
            const resultList = Array.isArray(results) ? results : [results];
            for (const item of resultList) {
                const label = item.label.toLowerCase() as EmotionLabel;
                if (label in emotions) {
                    emotions[label] = item.score;
                    if (item.score > topScore) {
                        topScore = item.score;
                        topEmotion = label;
                    }
                }
            }

            // If pipeline only returned top-1, topEmotion is already set correctly
            // Remaining labels stay at 0
            return { emotions, topEmotion, topScore };
        } catch (e) {
            console.warn('[SentimentEngine] Analysis failed:', e);
            return null;
        }
    }

    /**
     * Check if the engine is ready for inference.
     */
    isReady(): boolean {
        return this.classifier !== null;
    }

    /**
     * Get the last initialization error, if any.
     */
    getError(): string | null {
        return this.loadError;
    }
}