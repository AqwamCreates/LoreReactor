import { useState } from 'react';
import type { Extension } from '../types';

// Initial static data (move this to a config file later if needed)
const INITIAL_EXTENSIONS: Extension[] = [
    { id: 'ext_1', name: 'Auto-Translate', description: 'Translate responses to your language', extensionType: 'language_model_api' },
    { id: 'ext_2', name: 'TTS Reader', description: 'Read aloud using browser speech', extensionType: 'accessibility' },
    { id: 'ext_3', name: 'Scene Illustrator', description: 'Generate images from scene descriptions', extensionType: 'image_generation_api' },
    { id: 'ext_4', name: 'Light Mode Toggle', description: 'Force light mode for this session', extensionType: 'extra' },
    { id: 'ext_5', name: 'Sentiment Analysis', description: 'Tag messages with emotional context', extensionType: 'extra' },
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