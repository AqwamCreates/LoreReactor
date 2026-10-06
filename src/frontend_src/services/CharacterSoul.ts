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

        this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
    }

    private scheduleNextTick(
        executor: (data: InteractionData, character: Character, signal: AbortSignal) => Promise<HandleServerResponseResult | null>,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
        onSpeakerChange?: (char: Character | null) => void,
    ): void {
        if (!this.isRunning) return;

        this.timeoutId = setTimeout(async () => {
            if (!this.isRunning || !checkCanAct()) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                return;
            }

            const data = getData();
            
            // ─── THE GATEKEEPER ───
            if (!data || !data.profile?.autonomousMode || !this.abortController) {
                this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                return;
            }

            try {
                const protagonistIds = new Set(data.protagonistIds || []);
                const aiParticipants = data.participants.filter(p => !protagonistIds.has(p.id));
                
                if (aiParticipants.length === 0) {
                    this.timeoutId = setTimeout(() => {
                        this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                    }, 5000);
                    return;
                }

                // Find the most urgent AI character to determine the tick pacing
                let mostUrgentChar = aiParticipants[0];
                let maxScore = -1;

                for (const char of aiParticipants) {
                    const score = computeGlobalScore(char, data);
                    if (score > maxScore) {
                        maxScore = score;
                        mostUrgentChar = char;
                    }
                }

                // If no one has any urgency, fallback to a baseline derived from the first AI char
                if (maxScore <= 0) {
                    this.timeoutId = setTimeout(() => {
                        this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                    }, computeAutonomousTickDelay(mostUrgentChar, data));
                    return;
                }

                // Compute dynamic delay based on THIS SPECIFIC character's stats and the live interaction data
                const dynamicDelay = computeAutonomousTickDelay(mostUrgentChar, data);

                // Execute the turn sequence safely
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

                // Schedule the next tick using the dynamically calculated delay
                this.timeoutId = setTimeout(() => {
                    this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                }, dynamicDelay);

            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.warn('CharacterSoul evaluation failed:', e);
                }
                // On error, fallback to a safe medium delay before retrying
                this.timeoutId = setTimeout(() => {
                    this.scheduleNextTick(executor, checkCanAct, getData, setData, onSpeakerChange);
                }, 3000);
            }
        }, 5000); // Initial wait
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