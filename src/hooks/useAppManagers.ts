// src/hooks/useAppManagers.ts
import { useChatListManager } from './useChatListManager';
import { useCharacterManager } from './useCharacterManager';
import { useContextManager } from './useContextManager';
import { useLocationManager } from './useLocationManager';
import { useAudioTrackManager } from './useAudioTrackManager';
import { useWorldManager } from './useWorldManager';
import { useModelManager } from './useModelManager';
import { useSamplerManager } from './useSamplerManager';
import { usePromptBlockManager } from './usePromptBlockManager';
import { useStopPatternManager } from './useStopPatternManager';
import { useBudgetStrategyManager } from './useBudgetStrategyManager';
import { useProfileManager } from './useProfileManager';
import { useExtensionManager } from './useExtensionManager';
import { useMemoryManager } from './useMemoryManager';
import { useAccountManager } from './useAccountManager';
import { useMultiplayerDataManager } from './useMultiplayerDataManager';
import { useActiveExtensions } from './useActiveExtensions';
import { useEntityModals } from './useEntityModals';

export function useAppManagers() {
    const chatList = useChatListManager();
    const characters = useCharacterManager();
    const contexts = useContextManager();
    const locations = useLocationManager();
    const audioTracks = useAudioTrackManager();
    const worlds = useWorldManager();
    const models = useModelManager();
    const samplers = useSamplerManager();
    const promptBlocks = usePromptBlockManager();
    const stopPatterns = useStopPatternManager();
    const budgetStrategies = useBudgetStrategyManager();
    const profiles = useProfileManager();
    const extensions = useExtensionManager();
    const memories = useMemoryManager();
    const accounts = useAccountManager();
    const multiplayerData = useMultiplayerDataManager();

    const activeExtensions = useActiveExtensions(extensions.extensions);

    const entityModals = useEntityModals({
        character: { saveFunction: characters.saveCharacter, deleteFunction: characters.deleteCharacter, entityLabel: 'Character' },
        context: { saveFunction: contexts.saveContext, deleteFunction: contexts.deleteContext, entityLabel: 'Context' },
        location: { saveFunction: locations.saveLocation, deleteFunction: locations.deleteLocation, entityLabel: 'Location' },
        audioTrack: { saveFunction: audioTracks.saveAudioTrack, deleteFunction: audioTracks.deleteAudioTrack, entityLabel: 'Audio Track' },
        world: { saveFunction: worlds.saveWorld, deleteFunction: worlds.deleteWorld, entityLabel: 'World' },
        model: { saveFunction: models.saveModel, deleteFunction: models.deleteModel, entityLabel: 'Model' },
        sampler: { saveFunction: samplers.saveSampler, deleteFunction: samplers.deleteSampler, entityLabel: 'Sampler' },
        promptBlock: { saveFunction: promptBlocks.savePromptBlock, deleteFunction: promptBlocks.deletePromptBlock, entityLabel: 'Prompt Block' },
        stopPattern: { saveFunction: stopPatterns.saveStopPattern, deleteFunction: stopPatterns.deleteStopPattern, entityLabel: 'Stop Pattern' },
        budgetStrategy: { saveFunction: budgetStrategies.saveStrategy, deleteFunction: budgetStrategies.deleteStrategy, entityLabel: 'Budget Strategy' },
        profile: { saveFunction: profiles.saveProfile, deleteFunction: profiles.deleteProfile, entityLabel: 'Profile' },
        account: { saveFunction: accounts.saveAccount, deleteFunction: accounts.deleteAccount, entityLabel: 'Account' },
        multiplayerData: { saveFunction: multiplayerData.saveMultiplayerData, deleteFunction: multiplayerData.deleteMultiplayerData, entityLabel: 'Multiplayer Data' },
    });

    return {
        chatList, characters, contexts, locations, audioTracks, worlds,
        models, samplers, promptBlocks, stopPatterns, budgetStrategies,
        profiles, extensions, memories, accounts, multiplayerData,
        activeExtensions, entityModals,
    };
}