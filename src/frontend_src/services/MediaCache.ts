// frontend-src/services/MediaCache.ts
import { MultiplayerEvents } from './MultiplayerEvents';
import type { MediaResponsePayload } from '../hooks/useMultiplayerConnection';

class MediaCacheService {
    private cache: Map<string, string> = new Map(); // pathOrFilename -> dataUrl

    constructor() {
        // Automatically cache any media streamed from the host
        MultiplayerEvents.on('mediaResponseReceived', (payload: MediaResponsePayload) => {
            this.cache.set(payload.pathOrFilename, payload.base64Data);
            MultiplayerEvents.emit('mediaCacheUpdated', payload.pathOrFilename);
        });
    }

    get(pathOrFilename: string): string | undefined {
        return this.cache.get(pathOrFilename);
    }

    set(pathOrFilename: string, dataUrl: string) {
        this.cache.set(pathOrFilename, dataUrl);
    }

    has(pathOrFilename: string): boolean {
        return this.cache.has(pathOrFilename);
    }

    clear() {
        this.cache.clear();
    }
}

export const mediaCache = new MediaCacheService();