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
        let set = this.listeners.get(event);
        if (!set) {
            set = new Set();
            this.listeners.set(event, set);
        }
        set.add(cb as EventCallback);
        return () => {
            const currentSet = this.listeners.get(event);
            if (currentSet) {
                currentSet.delete(cb as EventCallback);
                if (currentSet.size === 0) {
                    this.listeners.delete(event);
                }
            }
        };
    }

    once<K extends keyof MultiplayerEventMap>(event: K, cb: EventCallback<MultiplayerEventMap[K]>): () => void {
        const unsubscribe = this.on(event, (data) => {
            unsubscribe();
            return cb(data);
        });
        return unsubscribe;
    }

    emit<K extends keyof MultiplayerEventMap>(event: K, data: MultiplayerEventMap[K]): void {
        const set = this.listeners.get(event);
        if (set && set.size > 0) {
            // Snapshot listeners to prevent iteration bugs if callbacks unsubscribe during dispatch
            const snapshot = Array.from(set);
            for (const cb of snapshot) {
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