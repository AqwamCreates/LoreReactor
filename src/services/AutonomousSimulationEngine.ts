// src/services/AutonomousSimulationEngine.ts
import type { Character, InteractionData, HistoryMessage, ChatMessage } from '../types';
import { getEffectiveInitiativeWeight, getEffectiveChatProbability, getEffectiveSkipProbability, getEffectiveMaximumChatStamina, getEffectiveChatImpatienceSensitivity, generateChatStaminaForMessage, consumeChatStaminaForMessage } from '../hooks/characterLogic';
import { getCurrentLocationIndex, findLocationByRegex, getReachableLocations, sampleReachableLocationByWeight, assignInitialLocationsIfNeeded } from '../hooks/locationLogic';
import { saveRawInteractionData } from '../store/storage';
import { v4 as uuidv4 } from 'uuid';

type AutonomousExecutor = (data: InteractionData, character: Character, signal: AbortSignal) => Promise<InteractionData | null>;

interface AutonomousConfig {
    tickIntervalMs: number;
    maxActionsPerTick: number;
}

const DEFAULT_CONFIG: AutonomousConfig = {
    tickIntervalMs: 10000,
    maxActionsPerTick: 3,
};

function hasTextContent(msg: HistoryMessage): msg is ChatMessage {
    return msg.messageType === 'chat';
}

function getLastInteractionForCharacter(history: HistoryMessage[], characterId: string): HistoryMessage | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].character.id === characterId) return history[i];
    }
    return undefined;
}

function getTurnsSinceLastSpoken(history: HistoryMessage[], characterId: string): number {
    let turns = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (!hasTextContent(msg)) continue;
        if (msg.character.id === characterId) return turns;
        turns++;
    }
    return turns;
}

function getTimeSinceLastActionMs(history: HistoryMessage[], characterId: string): number {
    const last = getLastInteractionForCharacter(history, characterId);
    if (!last) return Infinity;
    return Date.now() - last.lastUpdatedTimestamp;
}

function createSilentInteraction(
    character: Character,
    locationIndex: number | undefined,
    previousStamina: number | undefined,
    parentId: string | null | undefined,
): HistoryMessage {
    const now = Date.now();
    return {
        messageType: 'interaction',
        id: uuidv4(),
        character: { ...character },
        remainingChatStamina: previousStamina,
        locationIndex,
        parentInteractionMessageId: parentId ?? null,
        firstCreatedTimestamp: now,
        lastUpdatedTimestamp: now,
    };
}

function regenerateStaminaInPlace(data: InteractionData, character: Character): void {
    const maxStamina = getEffectiveMaximumChatStamina(character, data.Profile);
    if (maxStamina === Number.POSITIVE_INFINITY) return;

    for (let i = data.interactionHistory.length - 1; i >= 0; i--) {
        if (data.interactionHistory[i].character.id === character.id) {
            const entry = data.interactionHistory[i];
            if (entry.remainingChatStamina === undefined) return;
            if (entry.remainingChatStamina >= maxStamina) return;
            generateChatStaminaForMessage(character, entry);
            return;
        }
    }
}

export class AutonomousSimulationEngine {
    private timerId: ReturnType<typeof setInterval> | null = null;
    private abortController: AbortController | null = null;
    private config: AutonomousConfig;
    private executor: AutonomousExecutor | null = null;
    private isRunning = false;

    constructor(config?: Partial<AutonomousConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    start(
        executor: AutonomousExecutor,
        checkCanAct: () => boolean,
        getData: () => InteractionData | null,
        setData: (data: InteractionData) => void,
    ): void {
        if (this.isRunning) return;
        this.executor = executor;
        this.isRunning = true;
        this.abortController = new AbortController();

        this.timerId = setInterval(async () => {
            if (!this.isRunning) return;
            if (!checkCanAct()) return;

            const data = getData();
            if (!data || !data.Profile?.autonomousMode) return;

            try {
                await this.tick(data, setData, checkCanAct);
            } catch (e) {
                if ((e as Error).name !== 'AbortError') {
                    console.warn('Autonomous simulation tick failed:', e);
                }
            }
        }, this.config.tickIntervalMs);
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
        checkCanAct: () => boolean,
    ): Promise<void> {
        if (!this.executor || !this.abortController) return;

        let workingData = { ...currentData, interactionHistory: [...currentData.interactionHistory] };
        workingData = assignInitialLocationsIfNeeded(workingData);

        const profile = workingData.Profile;
        if (!profile) return;

        const allAI = workingData.participants.filter(p => p.id !== workingData.protagonist.id);
        if (allAI.length === 0) return;

        const protagonistLoc = getCurrentLocationIndex(workingData, workingData.protagonist);
        const hasLocations = workingData.locations && workingData.locations.length > 0;

        // Find the last chat message text for regex location evaluation
        const lastChatEntry = [...workingData.interactionHistory].reverse().find(m => hasTextContent(m));
        const triggeringMessageText = lastChatEntry && hasTextContent(lastChatEntry) ? lastChatEntry.textContent : undefined;

        const lastParentId = workingData.interactionHistory.length > 0
            ? workingData.interactionHistory[workingData.interactionHistory.length - 1].id
            : null;

        let actionsThisTick = 0;

        // Shuffle participants so no single character always goes first
        const shuffled = [...allAI].sort(() => Math.random() - 0.5);

        for (const character of shuffled) {
            if (!this.isRunning || !checkCanAct()) break;
            if (actionsThisTick >= this.config.maxActionsPerTick) break;
            if (this.abortController.signal.aborted) break;

            // Regenerate stamina before evaluation
            regenerateStaminaInPlace(workingData, character);

            // ─── Universal action gate: initiativeWeight + skipProbability ───
            const initiative = getEffectiveInitiativeWeight(character, profile);
            const effectiveSkip = getEffectiveSkipProbability(character, profile);
            const timeSinceLastMs = getTimeSinceLastActionMs(workingData.interactionHistory, character.id);

            // Longer inactivity = higher chance to act, scaled by initiative
            // Base: initiative / 10 gives 0.0–1.0 range, silence adds up to 4× multiplier
            const silenceHours = timeSinceLastMs / 3600000;
            const silenceMultiplier = 1 + Math.min(silenceHours * 2, 4);
            const actionChance = Math.min((initiative / 10) * silenceMultiplier, 1);

            // Does this character can do anything during this tick?
            if (Math.random() >= actionChance) continue;

            // Does the character decides to ignore doing anything?
            if (effectiveSkip > 0 && Math.random() < effectiveSkip) continue;

            // Character wants to act. Now decide WHAT based on chat-specific stats.
            const charLoc = hasLocations ? getCurrentLocationIndex(workingData, character) : undefined;
            const isCoLocated = !hasLocations || (charLoc !== undefined && protagonistLoc !== undefined && charLoc === protagonistLoc);

            // Chat-specific decision: only applies when co-located
            let wantsToSpeak = false;
            if (isCoLocated) {
                const effectiveProb = getEffectiveChatProbability(character, profile);
                const impatience = getEffectiveChatImpatienceSensitivity(character, profile);
                const turnsSinceSpoken = getTurnsSinceLastSpoken(workingData.interactionHistory, character.id);
                const chatSilenceMultiplier = 1 + Math.min(turnsSinceSpoken * impatience, 4);
                const speakChance = Math.min(effectiveProb * chatSilenceMultiplier, 1);
                wantsToSpeak = Math.random() < speakChance;
            }

            if (wantsToSpeak) {
                // ─── SPEAK (chat-specific stats already passed) ──────
                const resultData = await this.executor(workingData, character, this.abortController.signal);
                if (!resultData) continue;

                // Post-speech: consume stamina, resolve location
                const newLastEntry = resultData.interactionHistory[resultData.interactionHistory.length - 1];
                if (newLastEntry && newLastEntry.character.id === character.id && hasTextContent(newLastEntry)) {
                    const paragraphs = (newLastEntry.textContent.match(/\n\n/g) || []).length + 1;
                    if (paragraphs > 0) consumeChatStaminaForMessage(newLastEntry, paragraphs);

                    if (hasLocations) {
                        const currentLoc = getCurrentLocationIndex(resultData, character);
                        const regexLoc = findLocationByRegex(resultData.locations, newLastEntry.textContent, character);
                        const finalLoc = regexLoc !== undefined ? regexLoc : currentLoc;
                        resultData.interactionHistory[resultData.interactionHistory.length - 1] = {
                            ...newLastEntry,
                            locationIndex: finalLoc,
                        };
                    }
                }

                workingData = resultData;
                actionsThisTick++;

                try {
                    await saveRawInteractionData(workingData);
                    setData(workingData);
                } catch (e) {
                    console.error('Failed to save autonomous speech:', e);
                }
            } else if (hasLocations && charLoc !== undefined) {
                // ─── MOVE SILENTLY (universal stats only) ────────────
                const prevStamina = getLastInteractionForCharacter(workingData.interactionHistory, character.id)?.remainingChatStamina;

                const reachable = getReachableLocations(workingData.locations, charLoc, triggeringMessageText);
                const newLoc = sampleReachableLocationByWeight(reachable, character);

                if (newLoc !== undefined && newLoc !== charLoc) {
                    const silent = createSilentInteraction(character, newLoc, prevStamina, lastParentId);
                    workingData.interactionHistory.push(silent);
                    actionsThisTick++;

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
}