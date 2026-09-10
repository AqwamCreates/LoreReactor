import { useState } from 'react';
import type { Extension } from '../types';

const INITIAL_EXTENSIONS: Extension[] = [
];

export function useExtensionManager() {
    const [extensions, setExtensions] = useState<Extension[]>(INITIAL_EXTENSIONS);
    // Static data — always ready immediately
    const isLoading = false;

    const deleteExtension = async (id: string) => {
        setExtensions(prev => prev.filter(e => e.id !== id));
        return true;
    };

    const addExtension = (ext: Extension) => {
        setExtensions(prev => [...prev, ext]);
    };

    return { extensions, isLoading, deleteExtension, addExtension };
}