// frontend_src/services/CharacterSoul.ts
import type { InteractionData, Character } from '../types';
import { runTurnSequence } from './InteractionOrchestrator';
import { computeGlobalScore, computeAutonomousTickDelay } from '../utilities/dynamicCharacterLogic';
import type { HandleServerResponseResult } from '../hooks/useChatEngine';

export class CharacterSoul {
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private abortController: AbortController | null = null;
    private isRunning = false;

    start(
        executor: (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
        onSpeakerChange?: (char: Character | null) => void,
    ): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.abortController = new AbortController();

        const initialData = getData();
        const initialDelay = initialData?.profile?.autonomousInteractionIntervalMs || 1000;

        this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, initialDelay);
    }

    private scheduleNextTick(
        executor: (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
        onSpeakerChange?: (char: Character | null) => void,
        delay = 1000
    ): void {
        if (!this.isRunning) return;

        this.timeoutId = setTimeout(async () => {
            if (!this.isRunning) return;

            const data = getData();

            // ─── THE GATEKEEPER ───
            if (!data || !data.profile?.autonomousMode) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, 2000);
                return;
            }

            if (!checkCanAct()) {
                // If model is currently busy responding, poll lightly at the base interval
                const retryDelay = data.profile.autonomousInteractionIntervalMs || 1000;
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, retryDelay);
                return;
            }

            try {
                const protagonistIds = new Set(data.protagonistIds || []);
                const aiParticipants = data.participants.filter(p => !protagonistIds.has(p.id));

                if (aiParticipants.length === 0) {
                    this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, 3000);
                    return;
                }

                let mostUrgentChar = aiParticipants[0];
                let maxScore = -1;

                for (const char of aiParticipants) {
                    const score = computeGlobalScore(char, data);
                    if (score > maxScore) {
                        maxScore = score;
                        mostUrgentChar = char;
                    }
                }

                const dynamicDelay = computeAutonomousTickDelay(mostUrgentChar, data);

                // Re-create a fresh AbortController per sequence to avoid latching aborted states
                if (!this.abortController || this.abortController.signal.aborted) {
                    this.abortController = new AbortController();
                }

                const result = await runTurnSequence(
                    data,
                    executor,
                    this.abortController,
                    onSpeakerChange,
                    setData
                );

                if (result) {
                    setData(result.interactionData);
                }

                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, dynamicDelay);

            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.warn('CharacterSoul evaluation failed:', e);
                }
                const fallbackDelay = data?.profile?.autonomousInteractionIntervalMs || 1500;
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, fallbackDelay);
            }
        }, delay);
    }

    stop(): void {
        this.isRunning = false;
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    getIsRunning(): boolean {
        return this.isRunning;
    }
}