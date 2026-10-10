// frontend_src/hooks/useServerSync.ts
import { useEffect } from 'react';
import { clientId, localURL } from '../../configurations';
import { loadRawInteractionData } from '../storages/serverStorage';
import { useSessionStore } from './useSessionStore';

type Refreshers = Record<string, (() => void) | undefined>;

interface SyncProps {
  refreshers: Refreshers;
}

export function useServerSync({ refreshers }: SyncProps) {
  useEffect(() => {
    const es = new EventSource(`${localURL}/sync`);

    es.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.clientId === clientId) return;

        const { path } = data;
        
        if (path.startsWith('interaction_data/') || path.startsWith('interaction_messages/')) {
          let changedChatId: string | null = null;
          if (path.startsWith('interaction_data/')) {
            changedChatId = path.split('/')[1].replace('.json', '');
          }

          const currentInteractionData = useSessionStore.getState().interactionData;
          const activeChatId = currentInteractionData?.id ?? null;

          if (changedChatId && changedChatId === activeChatId) {
            try {
              const freshChat = await loadRawInteractionData(changedChatId);
              if (freshChat) {
                useSessionStore.getState().setInteractionData(freshChat);
              }
            } catch (e) {
              console.error('Failed to hot-reload active chat from server sync:', e);
            }
          } else {
            refreshers.chats?.();
          }
        } 
        else if (path.startsWith('character_data/')) refreshers.characters?.();
        else if (path.startsWith('context_data/')) refreshers.contexts?.();
        else if (path.startsWith('location_data/')) refreshers.locations?.();
        else if (path.startsWith('language_model_data/')) refreshers.models?.();
        else if (path.startsWith('sampler_data/')) refreshers.samplers?.();
        else if (path.startsWith('world_data/')) refreshers.worlds?.();
        else if (path.startsWith('profile_data/')) refreshers.profiles?.();
        else if (path.startsWith('prompt_block_data/')) refreshers.promptBlocks?.();
        else if (path.startsWith('audio_track_data/')) refreshers.audioTracks?.();
        else if (path.startsWith('budget_strategies/')) refreshers.budgetStrategies?.();
        else if (path.startsWith('stop_pattern_data/')) refreshers.stopPatterns?.();
        else if (path.startsWith('multiplayer_data/')) refreshers.multiplayerData?.();
        else if (path.startsWith('multiplayer_character_data/')) refreshers.multiplayerCharacters?.();
        
      } catch (e) {
        console.error('Sync parse error', e);
      }
    };

    es.onerror = () => {
      console.warn('Server sync connection lost. EventSource will auto-reconnect.');
    };

    return () => es.close();
  }, [refreshers]);
}