import { useState } from 'react';
import type { Extension } from '../types';

const now = Date.now()

// Initial static data (move this to a config file later if needed)
const INITIAL_EXTENSIONS: Extension[] = [
    { id: 'ext_2', name: 'TTS Reader', description: 'Read aloud using browser speech', extensionType: 'Accessibility', firstCreatedTimestamp: now, lastUpdatedTimestamp: now},
    { id: 'ext_3', name: 'Scene Illustrator', description: 'Generate images from scene descriptions', extensionType: 'Image Generation API', firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
    { id: 'ext_4', name: 'Light Mode Toggle', description: 'Force light mode for this session', extensionType: 'Extra', firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
    { id: 'ext_5', name: 'Sentiment Analysis', description: 'Tag messages with emotional context', extensionType: 'Extra', firstCreatedTimestamp: now, lastUpdatedTimestamp: now },
];

export function useExtensionManager() {
    const [extensions, setExtensions] = useState<Extension[]>(INITIAL_EXTENSIONS);

    const deleteExtension = async (id: string) => {
        // In a real app, this would call an API. For now, we filter local state.
        setExtensions(prev => prev.filter(e => e.id !== id));
        return true;
    };

    const addExtension = (ext: Extension) => {
        setExtensions(prev => [...prev, ext]);
    };

    return { extensions, deleteExtension, addExtension };
}