// src/frontend_src/hooks/useEntitySync.tsx
import { useEffect, useRef } from 'react';
import type {
    Character,
    Context,
    Location,
    AudioTrack,
    TokenSampler,
    StopPattern,
    RetrievalConfiguration,
    Profile,
    InteractionData,
    HistoryMessage,
} from '../types';
import { useChatStore } from './useChatStore';

interface UseEntitySyncOptions {
    activeChatRestored: boolean;
    allCharacters: Character[];
    loadFullCharacter?: (id: string) => Promise<Character | null>;
    allContexts: Context[];
    allLocations: Location[];
    allAudioTracks: AudioTrack[];
    allTokenSamplers: TokenSampler[];
    allStopPatterns: StopPattern[];
    allRetrievalConfigurations: RetrievalConfiguration[];
    allProfiles: Profile[];
    currentCharacter: Character | null;
    setInteractionData: (data: InteractionData) => void;
    setSelectedCharacter: (char: Character | null) => void;
}

function syncStopPattern(
    stopPattern: StopPattern,
    stopPatternMap: Map<string, StopPattern>
): { value: StopPattern; changed: boolean } {
    const fresh = stopPatternMap.get(stopPattern.id);
    if (fresh && fresh.lastUpdatedTimestamp !== stopPattern.lastUpdatedTimestamp) {
        return { value: fresh, changed: true };
    }
    return { value: stopPattern, changed: false };
}

function syncStopPatternArray(
    stopPatterns: StopPattern[] | undefined,
    stopPatternMap: Map<string, StopPattern>
): { value: StopPattern[] | undefined; changed: boolean } {
    if (!stopPatterns?.length) return { value: stopPatterns, changed: false };
    let changed = false;
    const next = stopPatterns.map(sp => {
        const res = syncStopPattern(sp, stopPatternMap);
        if (res.changed) changed = true;
        return res.value;
    });
    return { value: changed ? next : stopPatterns, changed };
}

function syncTokenSampler(
    sampler: TokenSampler | undefined,
    tokenSamplerMap: Map<string, TokenSampler>,
    stopPatternMap: Map<string, StopPattern>
): { value: TokenSampler | undefined; changed: boolean } {
    if (!sampler) return { value: sampler, changed: false };

    const fresh = tokenSamplerMap.get(sampler.id);
    let next = (fresh && fresh.lastUpdatedTimestamp !== sampler.lastUpdatedTimestamp) ? fresh : sampler;
    let changed = next !== sampler;

    const syncedStops = syncStopPatternArray(next.stopPatterns, stopPatternMap);
    if (syncedStops.changed && syncedStops.value) {
        next = { ...next, stopPatterns: syncedStops.value };
        changed = true;
    }

    return { value: next, changed };
}

function syncRetrievalConfiguration(
    config: RetrievalConfiguration | undefined,
    retrievalConfigMap: Map<string, RetrievalConfiguration>
): { value: RetrievalConfiguration | undefined; changed: boolean } {
    if (!config) return { value: config, changed: false };
    const fresh = retrievalConfigMap.get(config.id);
    if (fresh && fresh.lastUpdatedTimestamp !== config.lastUpdatedTimestamp) {
        return { value: fresh, changed: true };
    }
    return { value: config, changed: false };
}

function syncCharacterNestedEntities(
    character: Character,
    tokenSamplerMap: Map<string, TokenSampler>,
    stopPatternMap: Map<string, StopPattern>,
    retrievalConfigMap: Map<string, RetrievalConfiguration>
): { value: Character; changed: boolean } {
    const lmSampler = syncTokenSampler(character.languageModelTokenSampler, tokenSamplerMap, stopPatternMap);
    const ttsSampler = syncTokenSampler(character.textToSpeechModelTokenSampler, tokenSamplerMap, stopPatternMap);
    const stopPatterns = syncStopPatternArray(character.stopPatterns, stopPatternMap);
    const dialogueRc = syncRetrievalConfiguration(character.dialogueRetrievalConfiguration, retrievalConfigMap);
    const starterRc = syncRetrievalConfiguration(character.starterPromptRetrievalConfiguration, retrievalConfigMap);
    const knowledgeRc = syncRetrievalConfiguration(character.knowledgeRetrievalConfiguration, retrievalConfigMap);
    const memoryRc = syncRetrievalConfiguration(character.memoryRetrievalConfiguration, retrievalConfigMap);

    const changed =
        lmSampler.changed ||
        ttsSampler.changed ||
        stopPatterns.changed ||
        dialogueRc.changed ||
        starterRc.changed ||
        knowledgeRc.changed ||
        memoryRc.changed;

    if (!changed) return { value: character, changed: false };

    return {
        value: {
            ...character,
            languageModelTokenSampler: lmSampler.value,
            textToSpeechModelTokenSampler: ttsSampler.value,
            stopPatterns: stopPatterns.value,
            dialogueRetrievalConfiguration: dialogueRc.value,
            starterPromptRetrievalConfiguration: starterRc.value,
            knowledgeRetrievalConfiguration: knowledgeRc.value,
            memoryRetrievalConfiguration: memoryRc.value,
        },
        changed: true,
    };
}

function syncProfileNestedEntities(
    profile: Profile,
    tokenSamplerMap: Map<string, TokenSampler>,
    stopPatternMap: Map<string, StopPattern>,
    retrievalConfigMap: Map<string, RetrievalConfiguration>
): { value: Profile; changed: boolean } {
    const charLmSampler = syncTokenSampler(profile.characterLanguageModelTokenSampler, tokenSamplerMap, stopPatternMap);
    const charTtsSampler = syncTokenSampler(profile.characterTextToSpeechModelTokenSampler, tokenSamplerMap, stopPatternMap);
    const webSampler = syncTokenSampler(profile.webSummarizationTokenSampler, tokenSamplerMap, stopPatternMap);
    const chatSummarySampler = syncTokenSampler(profile.interactionDataSummarizationTokenSampler, tokenSamplerMap, stopPatternMap);

    const charStop = profile.characterStopPattern
        ? syncStopPattern(profile.characterStopPattern, stopPatternMap)
        : { value: undefined, changed: false };
    const webStop = profile.webSummarizationStopPattern
        ? syncStopPattern(profile.webSummarizationStopPattern, stopPatternMap)
        : { value: undefined, changed: false };
    const chatSummaryStop = profile.interactionDataSummarizationStopPattern
        ? syncStopPattern(profile.interactionDataSummarizationStopPattern, stopPatternMap)
        : { value: undefined, changed: false };

    const dialogueRc = syncRetrievalConfiguration(profile.characterDialogueRetrievalConfiguration, retrievalConfigMap);
    const starterRc = syncRetrievalConfiguration(profile.characterStarterPromptRetrievalConfiguration, retrievalConfigMap);
    const knowledgeRc = syncRetrievalConfiguration(profile.characterKnowledgeRetrievalConfiguration, retrievalConfigMap);
    const memoryRc = syncRetrievalConfiguration(profile.characterMemoryRetrievalConfiguration, retrievalConfigMap);

    const changed =
        charLmSampler.changed ||
        charTtsSampler.changed ||
        webSampler.changed ||
        chatSummarySampler.changed ||
        charStop.changed ||
        webStop.changed ||
        chatSummaryStop.changed ||
        dialogueRc.changed ||
        starterRc.changed ||
        knowledgeRc.changed ||
        memoryRc.changed;

    if (!changed) return { value: profile, changed: false };

    return {
        value: {
            ...profile,
            characterLanguageModelTokenSampler: charLmSampler.value,
            characterTextToSpeechModelTokenSampler: charTtsSampler.value,
            webSummarizationTokenSampler: webSampler.value,
            interactionDataSummarizationTokenSampler: chatSummarySampler.value,
            characterStopPattern: charStop.value,
            webSummarizationStopPattern: webStop.value,
            interactionDataSummarizationStopPattern: chatSummaryStop.value,
            characterDialogueRetrievalConfiguration: dialogueRc.value,
            characterStarterPromptRetrievalConfiguration: starterRc.value,
            characterKnowledgeRetrievalConfiguration: knowledgeRc.value,
            characterMemoryRetrievalConfiguration: memoryRc.value,
        },
        changed: true,
    };
}

export function useEntitySync(options: UseEntitySyncOptions) {
    const {
        activeChatRestored,
        allCharacters,
        loadFullCharacter,
        allContexts,
        allLocations,
        allAudioTracks,
        allTokenSamplers,
        allStopPatterns,
        allRetrievalConfigurations,
        allProfiles,
        currentCharacter,
        setInteractionData,
        setSelectedCharacter,
    } = options;

    const initialSyncSkippedRef = useRef(false);
    const knownParticipantIdsRef = useRef<Set<string>>(new Set());
    const syncSeqRef = useRef(0);

    useEffect(() => {
        if (!activeChatRestored) return;
        if (!initialSyncSkippedRef.current) { initialSyncSkippedRef.current = true; return; }

        const currentChat = useChatStore.getState().interactionData;
        if (!currentChat) return;

        const currentSeq = ++syncSeqRef.current;

        // Seed known participants on first real sync
        if (knownParticipantIdsRef.current.size === 0 && currentChat.participants.length > 0) {
            for (const p of currentChat.participants) knownParticipantIdsRef.current.add(p.id);
        }

        // Build O(1) lookup maps in entity order
        const charMap = new Map<string, Character>();
        for (const c of allCharacters) charMap.set(c.id, c);

        const contextMap = new Map<string, Context>();
        for (const c of allContexts) contextMap.set(c.id, c);

        const locationMap = new Map<string, Location>();
        for (const l of allLocations) locationMap.set(l.id, l);

        const audioTrackMap = new Map<string, AudioTrack>();
        for (const t of allAudioTracks) audioTrackMap.set(t.id, t);

        const tokenSamplerMap = new Map<string, TokenSampler>();
        for (const ts of allTokenSamplers) tokenSamplerMap.set(ts.id, ts);

        const stopPatternMap = new Map<string, StopPattern>();
        for (const sp of allStopPatterns) stopPatternMap.set(sp.id, sp);

        const retrievalConfigMap = new Map<string, RetrievalConfiguration>();
        for (const rc of allRetrievalConfigurations) retrievalConfigMap.set(rc.id, rc);

        const profileMap = new Map<string, Profile>();
        for (const p of allProfiles) profileMap.set(p.id, p);

        const runSync = async () => {
            let changed = false;

            // ─── 1. Sync Participants (Hydrate full character on timestamp change + nested sub-entities) ───
            let participantsChanged = false;
            const freshParticipants = await Promise.all(
                currentChat.participants.map(async p => {
                    const freshShell = charMap.get(p.id);
                    let nextChar = p;

                    if (freshShell && freshShell.lastUpdatedTimestamp !== p.lastUpdatedTimestamp) {
                        const hydrated = loadFullCharacter ? await loadFullCharacter(p.id) : null;
                        nextChar = hydrated || freshShell;
                        participantsChanged = true;
                    }

                    const nestedSync = syncCharacterNestedEntities(
                        nextChar,
                        tokenSamplerMap,
                        stopPatternMap,
                        retrievalConfigMap
                    );
                    if (nestedSync.changed) {
                        nextChar = nestedSync.value;
                        participantsChanged = true;
                    }

                    return nextChar;
                })
            );

            // Abort if a newer sync started or the active chat changed while awaiting hydration
            if (currentSeq !== syncSeqRef.current) return;
            const latestChat = useChatStore.getState().interactionData;
            if (!latestChat || latestChat.id !== currentChat.id) return;

            const updated: InteractionData = { ...latestChat };

            // Track any new participants added externally
            for (const p of freshParticipants) knownParticipantIdsRef.current.add(p.id);

            if (participantsChanged) {
                updated.participants = freshParticipants;

                // Keep message-level character snapshots synchronized with updated participants
                const updatedParticipantMap = new Map<string, Character>();
                for (const p of freshParticipants) updatedParticipantMap.set(p.id, p);

                const nextHistories: Record<string, HistoryMessage[]> = {};
                for (const [locId, msgs] of Object.entries(latestChat.interactionHistories || {})) {
                    nextHistories[locId] = msgs.map(m => {
                        const freshMsgChar = m.character?.id ? updatedParticipantMap.get(m.character.id) : undefined;
                        return freshMsgChar ? { ...m, character: freshMsgChar } : m;
                    });
                }
                updated.interactionHistories = nextHistories;
                changed = true;
            }

            // ─── 2. Sync Contexts ───
            if (latestChat.contexts?.length) {
                let contextsChanged = false;
                const freshContexts = latestChat.contexts.map(context => {
                    const fresh = contextMap.get(context.id);
                    if (fresh && fresh.lastUpdatedTimestamp !== context.lastUpdatedTimestamp) {
                        contextsChanged = true;
                        return fresh;
                    }
                    return context;
                });
                if (contextsChanged) {
                    updated.contexts = freshContexts;
                    changed = true;
                }
            }

            // ─── 3. Sync Locations ───
            if (latestChat.locations?.length) {
                let locationsChanged = false;
                const freshLocations = latestChat.locations.map(location => {
                    const fresh = locationMap.get(location.id);
                    if (fresh && fresh.lastUpdatedTimestamp !== location.lastUpdatedTimestamp) {
                        locationsChanged = true;
                        return fresh;
                    }
                    return location;
                });
                if (locationsChanged) {
                    updated.locations = freshLocations;
                    changed = true;
                }
            }

            // ─── 4. Sync Audio Tracks ───
            if (latestChat.audioTracks?.length) {
                let audioTracksChanged = false;
                const freshAudioTracks = latestChat.audioTracks.map(track => {
                    const fresh = audioTrackMap.get(track.id);
                    if (fresh && fresh.lastUpdatedTimestamp !== track.lastUpdatedTimestamp) {
                        audioTracksChanged = true;
                        return fresh;
                    }
                    return track;
                });
                if (audioTracksChanged) {
                    updated.audioTracks = freshAudioTracks;
                    changed = true;
                }
            }

            // ─── 5. Sync Profile (+ nested TokenSamplers, StopPatterns, RetrievalConfigurations) ───
            if (latestChat.profile) {
                const freshProfile = profileMap.get(latestChat.profile.id);
                let nextProfile = (freshProfile && freshProfile.lastUpdatedTimestamp !== latestChat.profile.lastUpdatedTimestamp)
                    ? freshProfile
                    : latestChat.profile;
                let profileChanged = nextProfile !== latestChat.profile;

                const nestedProfileSync = syncProfileNestedEntities(
                    nextProfile,
                    tokenSamplerMap,
                    stopPatternMap,
                    retrievalConfigMap
                );
                if (nestedProfileSync.changed) {
                    nextProfile = nestedProfileSync.value;
                    profileChanged = true;
                }

                if (profileChanged) {
                    updated.profile = nextProfile;
                    changed = true;
                }
            }

            // ─── 6. Sync Selected / Current Character (Prefer hydrated participant) ───
            if (currentCharacter) {
                const hydratedFromParticipants = freshParticipants.find(p => p.id === currentCharacter.id);
                if (hydratedFromParticipants && hydratedFromParticipants !== currentCharacter) {
                    setSelectedCharacter(hydratedFromParticipants);
                } else {
                    const freshCurrentShell = charMap.get(currentCharacter.id);
                    if (freshCurrentShell && freshCurrentShell.lastUpdatedTimestamp !== currentCharacter.lastUpdatedTimestamp) {
                        const hydratedCurrent = loadFullCharacter ? await loadFullCharacter(currentCharacter.id) : null;
                        if (currentSeq !== syncSeqRef.current) return;
                        setSelectedCharacter(hydratedCurrent || freshCurrentShell);
                    }
                }
            }

            if (changed) {
                updated.lastUpdatedTimestamp = Date.now();
                setInteractionData(updated);
            }
        };

        void runSync();
    }, [
        activeChatRestored,
        allCharacters,
        loadFullCharacter,
        allContexts,
        allLocations,
        allAudioTracks,
        allTokenSamplers,
        allStopPatterns,
        allRetrievalConfigurations,
        allProfiles,
        currentCharacter,
        setInteractionData,
        setSelectedCharacter,
    ]);
}