// frontend_src/services/CharacterSoul.ts
import type { InteractionData, Character } from '../types';
import { runTurnSequence } from './InteractionOrchestrator';
import { computeGlobalScore, computeAutonomousTickDelay } from '../utilities/dynamicCharacterLogic';
import type { HandleServerResponseResult } from '../hooks/useChatEngine';

export class CharacterSoul {
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private abortController: AbortController | null = null;
    private isRunning = false;
    private isExecuting = false;
    private acquireLock: (() => boolean) | null = null;
    private releaseLock: (() => void) | null = null;

    start(
        executor: (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
        onSpeakerChange?: (char: Character | null) => void,
        acquireLock?: () => boolean,
        releaseLock?: () => void,
    ): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isExecuting = false;
        this.abortController = new AbortController();
        this.acquireLock = acquireLock ?? null;
        this.releaseLock = releaseLock ?? null;

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

        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }

        this.timeoutId = setTimeout(async () => {
            this.timeoutId = null;
            if (!this.isRunning || this.isExecuting) return;

            const data = getData();

            // ─── THE GATEKEEPER ───
            if (!data || !data.profile?.autonomousMode) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, 2000);
                return;
            }

            const baseInterval = data.profile.autonomousInteractionIntervalMs || 1000;

            if (!checkCanAct()) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, baseInterval);
                return;
            }

            if (this.acquireLock && !this.acquireLock()) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, baseInterval);
                return;
            }

            this.isExecuting = true;

            try {
                const protagonistIds = new Set(data.protagonistIds || []);
                const aiParticipants = data.participants.filter(p => !protagonistIds.has(p.id));

                if (aiParticipants.length === 0) {
                    this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, Math.max(baseInterval, 3000));
                    return;
                }

                if (!this.abortController || this.abortController.signal.aborted) {
                    this.abortController = new AbortController();
                }

                // Explicitly pass { singleTurn: true } so autonomous ticks ONLY execute 1 character
                const result = await runTurnSequence(
                    data,
                    executor,
                    this.abortController,
                    onSpeakerChange,
                    setData,
                    { singleTurn: true }
                );

                if (!this.isRunning || this.abortController?.signal.aborted) {
                    return;
                }

                const updatedData = result?.interactionData ?? data;
                if (result) {
                    setData(updatedData);
                }

                let mostUrgentChar = aiParticipants[0];
                let maxScore = -1;

                for (const char of aiParticipants) {
                    const score = computeGlobalScore(char, updatedData);
                    if (score > maxScore) {
                        maxScore = score;
                        mostUrgentChar = char;
                    }
                }

                const dynamicDelay = computeAutonomousTickDelay(mostUrgentChar, updatedData);

                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, dynamicDelay);

            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.warn('CharacterSoul evaluation failed:', e);
                }
                if (this.isRunning && !this.abortController?.signal.aborted) {
                    const fallbackDelay = data?.profile?.autonomousInteractionIntervalMs || 1500;
                    this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange, fallbackDelay);
                }
            } finally {
                this.isExecuting = false;
                this.releaseLock?.();
            }
        }, delay);
    }

    stop(): void {
        this.isRunning = false;
        this.isExecuting = false;
        if (this.timeoutId !== null) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.releaseLock?.();
    }

    getIsRunning(): boolean {
        return this.isRunning;
    }
}