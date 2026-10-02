// src/utilities/chatSessionLogic.ts
import type {
    InteractionData,
    HistoryMessage,
    ChatMessage,
    WhisperMessage,
    Profile,
    StopPattern,
    PromptBlock,
    Character,
} from '../types';
import { getGlobalMessageHistory } from './timelineLogic';

export const NO_ARG_TOOLS = ['coin', 'calendar', 'dice'];
export const HOST_ONLY_TOOLS = ['administrator', 'creator', 'destroyer'];

export function hasTextContent(msg: HistoryMessage): msg is ChatMessage | WhisperMessage {
    return msg.messageType === 'chat' || msg.messageType === 'whisper';
}

export function calculateLatencyFactor(
    timeSinceLastTokenMs: number,
    averageTTFTMs: number,
    msPerToken: number
): number {
    const painPoint = averageTTFTMs * 2;
    const zValue = timeSinceLastTokenMs - painPoint;
    const scaledZValue = zValue / msPerToken;
    return 1 / (1 + Math.exp(scaledZValue));
}

/**
 * Finalizes a message in history.
 * Supports saving processedTextContent separately from textContent.
 */
export function finalizeMessageById(
    data: InteractionData,
    messageId: string,
    wasAborted: boolean,
    fallbackRawText?: string,
    fallbackDisplayText?: string
): InteractionData {
    if (wasAborted && !fallbackRawText) return data;

    const newHistories = { ...data.interactionHistories };
    for (const [locId, msgs] of Object.entries(newHistories) as [string, HistoryMessage[]][]) {
        const idx = msgs.findIndex(m => m.id === messageId && hasTextContent(m));
        if (idx !== -1) {
            const existingMsg = msgs[idx] as ChatMessage | WhisperMessage;

            const finalRawContent = (fallbackRawText && fallbackRawText.length >= existingMsg.textContent.length)
                ? fallbackRawText
                : existingMsg.textContent;

            let finalProcessedContent: string | undefined = undefined;
            if (fallbackDisplayText && fallbackDisplayText !== finalRawContent) {
                finalProcessedContent = fallbackDisplayText;
            } else if (existingMsg.processedTextContent && existingMsg.processedTextContent !== finalRawContent) {
                finalProcessedContent = existingMsg.processedTextContent;
            }

            newHistories[locId] = [...msgs];
            newHistories[locId][idx] = {
                ...existingMsg,
                textContent: finalRawContent,
                processedTextContent: finalProcessedContent,
                lastUpdatedTimestamp: Date.now(),
            } as ChatMessage | WhisperMessage;
            break;
        }
    }
    return { ...data, interactionHistories: newHistories, lastUpdatedTimestamp: Date.now() };
}

export function findLastAIMessageId(
    data: InteractionData,
    protagonistIds?: string[] | Set<string>,
): string | null {
    const protagSet = protagonistIds instanceof Set
        ? protagonistIds
        : new Set(protagonistIds || (data.protagonists?.map(p => p.id) ?? []));
    const history = getGlobalMessageHistory(data);
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (hasTextContent(msg) && !protagSet.has(msg.character.id)) {
            return msg.id;
        }
    }
    return null;
}

export function broadcastToolStateChanges(
    before: InteractionData,
    after: InteractionData,
    broadcastFn?: (state: Partial<InteractionData>) => void
) {
    if (!broadcastFn) return;
    const diff: Partial<InteractionData> = {};
    let hasChanges = false;

    if (before.locations !== after.locations) {
        diff.locations = after.locations;
        hasChanges = true;
    }
    if (before.participants !== after.participants) {
        diff.participants = after.participants;
        hasChanges = true;
    }
    if (before.audioTracks !== after.audioTracks) {
        diff.audioTracks = after.audioTracks;
        hasChanges = true;
    }
    if (before.contexts !== after.contexts) {
        diff.contexts = after.contexts;
        hasChanges = true;
    }
    if (before.profile !== after.profile) {
        diff.profile = after.profile;
        hasChanges = true;
    }

    if (hasChanges) {
        broadcastFn(diff);
    }
}

export function evaluateAutoResumeSignals(
    profile: Profile | undefined,
    text: string,
    currentResumeCount: number
): { shouldResume: boolean; patternsToInject: string[] } {
    const signals = profile?.autoResumeSignals;
    if (!signals || signals.length === 0) {
        return { shouldResume: false, patternsToInject: [] };
    }

    let shouldResume = false;
    const patternsToInject = new Set<string>();

    for (const signal of signals) {
        const maxResumes = signal.maximumNumberOfAutoResumes ?? 10;
        if (currentResumeCount >= maxResumes) {
            continue;
        }

        const activationTrigger = signal.regularExpressionActivationTrigger?.trim();
        const deactivationTrigger = signal.regularExpressionDeactivationTrigger?.trim();
        const stopPattern = signal.stopPattern?.trim();
        const minimumLength = signal.minimumLength ? Number.parseInt(signal.minimumLength, 10) : 0;

        let isActivated = false;
        let activationIndex = 0;

        if (!activationTrigger) {
            isActivated = true;
        } else {
            try {
                const regex = new RegExp(activationTrigger);
                const match = regex.exec(text);
                if (match) {
                    isActivated = true;
                    activationIndex = match.index + match[0].length;
                }
            } catch (e) {
                console.warn(`Invalid activation regex: ${activationTrigger}`, e);
            }
        }

        if (!isActivated) continue;

        if (stopPattern) {
            patternsToInject.add(stopPattern);
        }

        let isDeactivated = false;
        const trimmedText = text.trimEnd();

        if (deactivationTrigger) {
            const textAfterActivation = text.slice(activationIndex);
            const minLen = Number.isNaN(minimumLength) ? 0 : minimumLength;
            if (textAfterActivation.length >= minLen) {
                try {
                    const endsWithRegex = new RegExp(`${deactivationTrigger}$`);
                    if (endsWithRegex.test(trimmedText) || trimmedText.endsWith(deactivationTrigger)) {
                        isDeactivated = true;
                    }
                } catch {
                    if (trimmedText.endsWith(deactivationTrigger)) {
                        isDeactivated = true;
                    }
                }
            }
        } else if (stopPattern) {
            if (trimmedText.endsWith(stopPattern)) {
                isDeactivated = true;
            }
        }

        if (!isDeactivated) {
            shouldResume = true;
        }
    }

    return { shouldResume, patternsToInject: Array.from(patternsToInject) };
}

export function injectStopSignals(data: InteractionData, patterns: string[]): InteractionData {
    if (patterns.length === 0) return data;

    const newData = { ...data };
    const newParticipants = newData.participants.map(p => {
        const existingPatterns = p.stopPatterns?.filter(sp => !sp.id.startsWith('auto-resume-stop-')) || [];
        const newPatterns: StopPattern[] = patterns.map((s, i) => ({
            id: `auto-resume-stop-${i}`,
            name: `Auto Resume Stop ${i}`,
            pattern: s,
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
        }));
        return {
            ...p,
            stopPatterns: [...existingPatterns, ...newPatterns],
        };
    });
    newData.participants = newParticipants;
    return newData;
}

export interface GenerationTurnOptions {
    data: InteractionData;
    protagonistId: string;
    allPromptBlocks?: PromptBlock[];
    respondingCharacter?: Character;
    isProtagonistCharId?: (charId: string) => boolean;
    errorPrefix?: string;
    lockAlreadyAcquired?: boolean;
}