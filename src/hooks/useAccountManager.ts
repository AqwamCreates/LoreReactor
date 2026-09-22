// src/hooks/useAccountManager.ts
import { useState, useCallback } from 'react';
import type { Account } from '../types';
import { loadAllRawAccounts, saveRawAccount, deleteRawAccount } from '../storage/serverStorage';
import { useSessionStore } from './useSessionStore';

export function useAccountManager() {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        try {
            const data = await loadAllRawAccounts();
            setAccounts(data);
        } catch (error) {
            console.error('Failed to load accounts', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const save = useCallback(async (account: Account) => {
        try {
            await saveRawAccount(account);
            await loadAll();
            return true;
        } catch (error) {
            console.error('Failed to save account', error);
            return false;
        }
    }, [loadAll]);

    const remove = useCallback(async (id: string) => {
        try {
            await deleteRawAccount(id);
            const currentAccountId = useSessionStore.getState().currentAccountId;
            if (currentAccountId === id) {
                useSessionStore.setState({ currentAccountId: null });
            }
            await loadAll();
            return true;
        } catch (error) {
            console.error('Failed to delete account', error);
            return false;
        }
    }, [loadAll]);

    useState(() => { loadAll(); });

    return {
        accounts,
        isLoading,
        saveAccount: save,
        deleteAccount: remove,
        refresh: loadAll,
    };
}