import { useState, useEffect, type Context } from 'react';
import { loadAllRawContexts, saveRawContext, deleteRawContext } from '../../infrastructure';

export function useContextManager() {
    const [contexts, setContexts] = useState<Context[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadContexts = async () => {
        setIsLoading(true);
        try {
        const data = await loadAllRawContexts();
        setContexts(data);
        } catch (err) {
        console.error("Failed to load contexts", err);
        } finally {
        setIsLoading(false);
        }
    };

    const saveContext = async (context: Context) => {
        try {
        await saveRawContext(context);
        await loadContexts();
        return true;
        } catch (err) {
        console.error("Failed to save context", err);
        return false;
        }
    };

    const deleteContext = async (id: string) => {
        try {
        await deleteRawContext(id);
        await loadContexts();
        return true;
        } catch (err) {
        console.error("Failed to delete context", err);
        return false;
        }
    };

    useEffect(() => {
        loadContexts();
    }, []);

    return { contexts, isLoading, saveContext, deleteContext, refresh: loadContexts };
}