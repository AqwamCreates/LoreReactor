import type {
    InteractionData,
    HistoryMessage,
    Profile,
    StopPattern,
    Character,
    TextMessage,
} from '../types';
import { getLanguageModelEngine } from '../services/LanguageModelEngine';
import { getModelTemplate } from '../dictionaries/modelTemplates';
import { deriveDelimiters } from './promptLogic';
import { getGlobalMessageHistory } from './timelineLogic';
import { toolResultStartString, toolResultEndString } from '../dictionaries/stringList';

export const NO_ARG_TOOLS = ['coin', 'calendar', 'dice'];
export const HOST_ONLY_TOOLS = ['administrator', 'creator', 'destroyer'];

export interface GenerationTurnOptions {
    data: InteractionData;
    protagonistId: string;
    respondingCharacter?: Character;
    existingCharacterText?: string;
    isProtagonistCharId?: (charId: string) => boolean;
    errorPrefix?: string;
    lockAlreadyAcquired?: boolean;
}

export function hasTextContent(msg: HistoryMessage): msg is TextMessage {
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

export function formatToolObservation(canonicalInvocation: string, resultContent: string): string {
    return `${canonicalInvocation}${toolResultStartString}result: ${resultContent}${toolResultEndString} `;
}

export function resolveEffectiveStopTokens(
    customStopPattern?: StopPattern,
    additionalStops: string[] = []
): string[] {
    const activeModel = getLanguageModelEngine().getContext();
    const effectiveChatTemplateKey = activeModel?.chatTemplate;
    const resolvedChatTemplate = effectiveChatTemplateKey ? getModelTemplate(effectiveChatTemplateKey) : undefined;
    const delimiters = deriveDelimiters(resolvedChatTemplate);

    const templateStops = resolvedChatTemplate?.stopPatterns || [];
    const profileStops = customStopPattern?.pattern ? [customStopPattern.pattern] : [];

    const stops = [
        ...templateStops,
        ...profileStops,
        delimiters.turnEnd,
        delimiters.thinkStart,
        delimiters.thinkEnd,
        ...additionalStops,
    ].filter(s => s.length > 0);

    return Array.from(new Set(stops));
}

export function finalizeMessageById(
    data: InteractionData,
    messageId: string,
    wasAborted: boolean,
    fallbackRawText?: string
): InteractionData {
    if (wasAborted && !fallbackRawText) return data;

    const newHistories = { ...data.interactionHistories };
    for (const [locId, msgs] of Object.entries(newHistories) as [string, HistoryMessage[]][]) {
        const idx = msgs.findIndex(m => m.id === messageId && hasTextContent(m));
        if (idx !== -1) {
            const existingMsg = msgs[idx] as TextMessage;
            const finalRawContent = (fallbackRawText && fallbackRawText.length >= existingMsg.textContent.length)
                ? fallbackRawText
                : existingMsg.textContent;

            newHistories[locId] = [...msgs];
            newHistories[locId][idx] = {
                ...existingMsg,
                textContent: finalRawContent,
                lastUpdatedTimestamp: Date.now(),
            } as TextMessage;
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
        : new Set(protagonistIds || data.protagonistIds || []);
    const history = getGlobalMessageHistory(data);
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (hasTextContent(msg) && !protagSet.has(msg.character.id)) return msg.id;
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

    if (before.locations !== after.locations) { diff.locations = after.locations; hasChanges = true; }
    if (before.participants !== after.participants) { diff.participants = after.participants; hasChanges = true; }
    if (before.audioTracks !== after.audioTracks) { diff.audioTracks = after.audioTracks; hasChanges = true; }
    if (before.contexts !== after.contexts) { diff.contexts = after.contexts; hasChanges = true; }
    if (before.profile !== after.profile) { diff.profile = after.profile; hasChanges = true; }

    if (hasChanges) broadcastFn(diff);
}

export function evaluateAutoResumeSignals(
    profile: Profile | undefined,
    text: string,
    currentResumeCount: number
): { shouldResume: boolean; patternsToInject: string[] } {
    const signals = profile?.autoResumeSignals;
    if (!signals || signals.length === 0) return { shouldResume: false, patternsToInject: [] };

    let shouldResume = false;
    const patternsToInject = new Set<string>();

    for (const signal of signals) {
        const maxResumes = signal.maximumNumberOfAutoResumes ?? 10;
        if (currentResumeCount >= maxResumes) continue;

        const activationTrigger = signal.regularExpressionActivationTrigger;
        const deactivationTrigger = signal.regularExpressionDeactivationTrigger;
        const stopPattern = signal.stopPattern;
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
        if (stopPattern) patternsToInject.add(stopPattern);

        let isDeactivated = false;
        if (deactivationTrigger) {
            const textAfterActivation = text.slice(activationIndex);
            const minLen = Number.isNaN(minimumLength) ? 0 : minimumLength;
            if (textAfterActivation.length >= minLen) {
                try {
                    const endsWithRegex = new RegExp(`${deactivationTrigger}$`);
                    if (endsWithRegex.test(text) || text.endsWith(deactivationTrigger)) isDeactivated = true;
                } catch {
                    if (text.endsWith(deactivationTrigger)) isDeactivated = true;
                }
            }
        } else if (stopPattern && text.endsWith(stopPattern)) {
            isDeactivated = true;
        }

        if (!isDeactivated) shouldResume = true;
    }

    return { shouldResume, patternsToInject: Array.from(patternsToInject) };
}

export function injectStopSignals(data: InteractionData, patterns: string[]): InteractionData {
    if (patterns.length === 0) return data;
    const newData = { ...data };
    newData.participants = newData.participants.map(p => {
        const existingPatterns = p.stopPatterns?.filter(sp => !sp.id.startsWith('auto-resume-stop-')) || [];
        const newPatterns: StopPattern[] = patterns.map((s, i) => ({
            id: `auto-resume-stop-${i}`,
            name: `Auto Resume Stop ${i}`,
            pattern: s,
            firstCreatedTimestamp: Date.now(),
            lastUpdatedTimestamp: Date.now(),
        }));
        return { ...p, stopPatterns: [...existingPatterns, ...newPatterns] };
    });
    return newData;
}