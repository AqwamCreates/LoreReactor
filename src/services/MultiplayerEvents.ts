// src/services/MultiplayerEvents.ts
import type { HistoryMessage } from '../types';

type EventCallback<T = any> = (data: T) => void | Promise<void>;

export interface MultiplayerEventMap {
    peerMessageReceived: HistoryMessage;
    broadcastMessage: HistoryMessage;
}

class MultiplayerEventBus {
    private listeners = new Map<keyof MultiplayerEventMap, Set<EventCallback>>();

    on<K extends keyof MultiplayerEventMap>(event: K, cb: EventCallback<MultiplayerEventMap[K]>): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const set = this.listeners.get(event)!;
        set.add(cb as EventCallback);
        return () => {
            set.delete(cb as EventCallback);
        };
    }

    emit<K extends keyof MultiplayerEventMap>(event: K, data: MultiplayerEventMap[K]): void {
        const set = this.listeners.get(event);
        if (set) {
            for (const cb of set) {
                try {
                    const res = cb(data);
                    if (res instanceof Promise) {
                        res.catch(err => console.error(`[MultiplayerEventBus] Error in async event '${String(event)}':`, err));
                    }
                } catch (err) {
                    console.error(`[MultiplayerEventBus] Error in event '${String(event)}':`, err);
                }
            }
        }
    }

    clear(): void {
        this.listeners.clear();
    }
}

export const MultiplayerEvents = new MultiplayerEventBus();