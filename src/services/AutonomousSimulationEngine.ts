// src/services/AutonomousSimulationEngine.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability, getEffectiveSkipProbability, getEffectiveMaximumChatStamina, getEffectiveMaximumActionStamina, getEffectiveChatImpatienceSensitivity, generateChatStaminaForInteractionData, generateActionStaminaForInteractionData, consumeChatStaminaForMessage, consumeActionStaminaForMessage } from '../hooks/characterLogic';
import { getCurrentLocationIndex, findLocationByRegex, getReachableLocations, sampleReachableLocationByWeight, assignInitialLocationsIfNeeded } from '../hooks/locationLogic';
import { saveRawInteractionData } from '../hooks/storage';
import { v4 as uuidv4 } from 'uuid';

type AutonomousExecutor = (data: InteractionData, character: Character, signal: AbortSignal) => Promise<InteractionData | null>;

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

function getLastInteractionForCharacter(history: HistoryMessage[], characterId: string): HistoryMessage | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) return history[i];
    }
    return undefined;
}

function createSilentInteraction(
    character: Character,
    locationIndex: number | undefined,
    previousChatStamina: number | undefined,
    previousActionStamina: number | undefined,
    parentId: string | null | undefined,
): HistoryMessage {
    const now = Date.now();
    return {
        messageType: 'interaction',
        id: uuidv4(),
        character: { ...character },
        remainingChatStamina: previousChatStamina,
        remainingActionStamina: previousActionStamina,
        locationIndex,
        parentInteractionMessageId: parentId ?? null,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

/**
 * Compute selection weight for a character using combined stamina ratio.
 * Characters who have been active recently have lower stamina ratios → lower weight.
 * Characters who have been idle retain high stamina → higher weight.
 * Self-balancing: outgoing characters burn stamina fast, quiet characters rise naturally.
 */
function computeSelectionWeight(character: Character, data: InteractionData): number {
    const profile = data.Profile;
    const initiative = getEffectiveInitiativeWeight(character, profile);
    const skipProb = getEffectiveSkipProbability(character, profile);

    const maxChat = getEffectiveMaximumChatStamina(character, profile);
    const maxAction = getEffectiveMaximumActionStamina(character, profile);

    const lastMsg = getLastInteractionForCharacter(data.interactionHistory, character.id);
    const remainingChat = lastMsg?.remainingChatStamina ?? maxChat;
    const remainingAction = lastMsg?.remainingActionStamina ?? maxAction;

    // Combined stamina ratio: treats both pools as unified capacity
    const totalMax = maxChat + maxAction;
    const totalRemaining = remainingChat + remainingAction;
    const staminaRatio = totalMax > 0 ? totalRemaining / totalMax : 1;

    // Weight = initiative × stamina ratio × (1 - skip probability)
    return initiative * staminaRatio * (1 - skipProb);
}

/**
 * Select one character from the pool using weighted sampling without replacement.
 * Returns null if no valid candidates remain.
 */
function weightedSample(candidates: Character[], data: InteractionData): Character | null {
    const weights: { char: Character; weight: number }[] = [];
    let totalWeight = 0;

    for (const c of candidates) {
        const w = computeSelectionWeight(c, data);
        if (w > 0) {
            weights.push({ char: c, weight: w });
            totalWeight += w;
        }
    }

    if (weights.length === 0 || totalWeight <= 0) return null;

    let roll = Math.random() * totalWeight;
    for (const entry of weights) {
        roll -= entry.weight;
        if (roll <= 0) return entry.char;
    }

    return weights[weights.length - 1].char;
}

export class AutonomousSimulationEngine {
    private timerId: ReturnType<typeof setInterval> | null = null;
    private abortController: AbortController | null = null;
    private executor: AutonomousExecutor | null = null;
    private isRunning = false;

    start(
        executor: AutonomousExecutor,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
    ): void {
        if (this.isRunning) return;
        this.executor = executor;
        this.isRunning = true;
        this.abortController = new AbortController();

        const tickLoop = async () => {
            while (this.isRunning) {
                // Read interval from profile each tick so changes take effect live
                const data = getData();
                const intervalMs = data?.Profile?.autonomousInteractionIntervalMs ?? 10000;

                await new Promise(resolve => setTimeout(resolve, intervalMs));

                if (!this.isRunning) break;

                const currentData = getData();
                if (!currentData || !currentData.Profile?.autonomousMode) continue;

                try {
                    await this.tick(currentData, setData);
                } catch (e) {
                    if ((e as Error).name !== 'AbortError') {
                        console.warn('Autonomous simulation tick failed:', e);
                    }
                }
            }
        };

        tickLoop();
    }

    stop(): void {
        this.isRunning = false;
        if (this.timerId !== null) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.executor = null;
    }

    getIsRunning(): boolean {
        return this.isRunning;
    }

    private async tick(
        currentData: InteractionData,
        setData: (data: InteractionData) => void,
    ): Promise<void> {
        if (!this.executor || !this.abortController) return;

        let workingData = { ...currentData, interactionHistory: [...currentData.interactionHistory] };
        workingData = assignInitialLocationsIfNeeded(workingData);

        const profile = workingData.Profile;
        if (!profile) return;

        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        if (allAI.length === 0) return;

        // Regenerate stamina for all AI participants before selection
        for (const character of allAI) {
            generateChatStaminaForInteractionData(workingData, character);
            generateActionStaminaForInteractionData(workingData, character);
        }

        // Weighted sampling: select one character to act this tick
        const selected = weightedSample(allAI, workingData);
        if (!selected) return;

        const protagonistLoc = getCurrentLocationIndex(workingData, workingData.protagonist);
        const hasLocations = workingData.locations && workingData.locations.length > 0;

        // Find the last chat message text for regex location evaluation
        const lastChatEntry = [...workingData.interactionHistory].reverse().find(m => hasTextContent(m));
        const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? lastChatEntry.textContent : undefined;

        const lastParentId = workingData.interactionHistory.length > 0
            ? workingData.interactionHistory[workingData.interactionHistory.length - 1].id
            : null;

        // Decide action type: speak or move silently
        const charLoc = hasLocations ? getCurrentLocationIndex(workingData, selected) : undefined;
        const isCoLocated = !hasLocations || (charLoc !== undefined && protagonistLoc !== undefined && charLoc === protagonistLoc);

        // Chat-specific decision: only when co-located
        let wantsToSpeak = false;
        if (isCoLocated) {
            const effectiveProb = getEffectiveChatProbability(selected, profile);
            const impatience = getEffectiveChatImpatienceSensitivity(selected, profile);

            // Count spoken turns since this character last spoke
            let turnsSinceSpoken = 0;
            for (let i = workingData.interactionHistory.length - 1; i >= 0; i--) {
                const msg = workingData.interactionHistory[i];
                if (!hasTextContent(msg)) continue;
                if (msg.character.id === selected.id) break;
                turnsSinceSpoken++;
            }

            const chatSilenceMultiplier = 1 + Math.min(turnsSinceSpoken * impatience, 4);
            const speakChance = Math.min(effectiveProb * chatSilenceMultiplier, 1);
            wantsToSpeak = Math.random() < speakChance;
        }

        if (wantsToSpeak) {
            // ─── SPEAK ───────────────────────────────────────────────
            const resultData = await this.executor(workingData, selected, this.abortController.signal);
            if (!resultData) return;

            // Post-speech: consume chat stamina, resolve location
            const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
            if (newLastEntry && newLastEntry.character.id === selected.id && hasTextContent(newLastEntry)) {
                const paragraphs = (newLastEntry.textContent.match(/\n\n/g) || []).length + 1;
                if (paragraphs > 0) consumeChatStaminaForMessage(newLastEntry, paragraphs);

                if (hasLocations) {
                    const currentLoc = getCurrentLocationIndex(resultData, selected);
                    const regexLoc = findLocationByRegex(resultData.locations, newLastEntry.textContent, selected);
                    const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                    resultData.interactionHistory[resultData.interactionHistory.length - 1] = {
                        ...newLastEntry,
                        locationIndex: finalLoc,
                    };
                }
            }

            workingData = resultData;

            try {
                await saveRawInteractionData(workingData);
                setData(workingData);
            } catch (e) {
                console.error('Failed to save autonomous speech:', e);
            }
        } else if (hasLocations && charLoc !== undefined) {
            // ─── MOVE SILENTLY ───────────────────────────────────────
            const lastMsg = getLastInteractionForCharacter(workingData.interactionHistory, selected.id);
            const prevChatStamina = lastMsg?.remainingChatStamina;
            const prevActionStamina = lastMsg?.remainingActionStamina;

            const reachable = getReachableLocations(workingData.locations, charLoc, triggeringMessageText);
            const newLoc = sampleReachableLocationByWeight(reachable, selected);

            if (newLoc !== undefined && newLoc !== charLoc) {
                // Consume 1 action stamina for the move
                if (lastMsg && lastMsg.remainingActionStamina !== undefined) {
                    consumeActionStaminaForMessage(lastMsg, 1);
                }

                const silent = createSilentInteraction(
                    selected,
                    newLoc,
                    prevChatStamina,
                    lastMsg?.remainingActionStamina ?? prevActionStamina,
                    lastParentId,
                );
                workingData.interactionHistory.push(silent);

                try {
                    await saveRawInteractionData(workingData);
                    setData(workingData);
                } catch (e) {
                    console.error('Failed to save autonomous movement:', e);
                }
            }
        }
    }
}