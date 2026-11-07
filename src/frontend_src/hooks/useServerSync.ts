// src/frontend_src/hooks/useServerSync.ts

import { useEffect, useRef } from 'react';
import { clientId, localURL } from '../../configurations';
import { loadRawInteractionData } from '../storages/serverStorage';
import { isServerAvailable } from '../utilities/serverAvailability';
import { useChatStore } from './useChatStore';
import { useGenerationStore } from './useGenerationStore';

type Refreshers = Record<string, (() => void) | undefined>;

interface SyncProps {
  refreshers: Refreshers;
}

export function useServerSync({ refreshers }: SyncProps) {
  const refreshersRef = useRef<Refreshers>(refreshers);
  useEffect(() => {
    refreshersRef.current = refreshers;
  }, [refreshers]);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;

    (async () => {
      if (!(await isServerAvailable()) || cancelled) return;

      es = new EventSource(`${localURL}/sync`);

      es.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.clientId === clientId) return;

          const { path } = data;
          const currentRefreshers = refreshersRef.current;

          if (path.startsWith('interaction_data/') || path.startsWith('interaction_messages/')) {
            let changedChatId: string | null = null;
            if (path.startsWith('interaction_data/')) {
              changedChatId = path.split('/')[1].replace('.json', '');
            }

            const currentInteractionData = useChatStore.getState().interactionData;
            const activeChatId = currentInteractionData?.id ?? null;

            if (changedChatId && changedChatId === activeChatId) {
              const isGenerating = useGenerationStore.getState().isLoading;
              if (isGenerating) {
                return;
              }

              try {
                const freshChat = await loadRawInteractionData(changedChatId);
                const currentChat = useChatStore.getState().interactionData;

                if (
                  freshChat &&
                  currentChat &&
                  freshChat.lastUpdatedTimestamp < currentChat.lastUpdatedTimestamp
                ) {
                  return;
                }

                if (freshChat) {
                  useChatStore.getState().setInteractionData(freshChat);
                }
              } catch (e) {
                console.error('Failed to hot-reload active chat from server sync:', e);
              }
            } else {
              currentRefreshers.chats?.();
            }
          }
          else if (path.startsWith('character_data/')) currentRefreshers.characters?.();
          else if (path.startsWith('context_data/')) currentRefreshers.contexts?.();
          else if (path.startsWith('location_data/')) currentRefreshers.locations?.();
          else if (path.startsWith('audio_track_data/')) currentRefreshers.audioTracks?.();
          else if (path.startsWith('world_data/')) currentRefreshers.worlds?.();
          else if (path.startsWith('profile_data/')) currentRefreshers.profiles?.();
          else if (path.startsWith('prompt_block_data/')) currentRefreshers.promptBlocks?.();
          else if (path.startsWith('language_model_data/')) currentRefreshers.models?.();
          else if (path.startsWith('spatiotemporal_model_data/')) currentRefreshers.spatiotemporalModels?.();
          else if (path.startsWith('token_sampler_data/')) currentRefreshers.tokenSamplers?.();
          else if (path.startsWith('stop_pattern_data/')) currentRefreshers.stopPatterns?.();
          else if (path.startsWith('retrieval_configuration_data/')) currentRefreshers.retrievalConfigurations?.();
          else if (path.startsWith('budget_strategies/')) currentRefreshers.budgetStrategies?.();
          else if (path.startsWith('multiplayer_data/')) currentRefreshers.multiplayerData?.();
          else if (path.startsWith('multiplayer_character_data/')) currentRefreshers.multiplayerCharacters?.();
          else if (path.startsWith('entity_folders/')) currentRefreshers.entityFolders?.();
        } catch (e) {
          console.error('Sync parse error', e);
        }
      };

      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED) return;
        isServerAvailable(true).then((available) => {
          if (!available && es) {
            es.close();
            es = null;
          }
        });
      };
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);
}