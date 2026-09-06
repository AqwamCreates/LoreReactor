// src/components/EntitySelectList.tsx
import { useMemo } from 'react';
import './main.css';

interface EntitySelectListItem {
    id: string;
    name?: string;
    description?: string;
    text?: string;
    lastUpdatedTimestamp?: number;
}

interface EntitySelectListProps<T extends EntitySelectListItem> {
    label: string;
    items: T[];
    selectedIds: string[];
    onToggle: (id: string) => void;
    searchQuery: string;
    onSearchChange: (val: string) => void;
    disabled?: boolean;
}

/** Extract a short description snippet from an entity for display in the selection list. */
function getEntityDescription(item: EntitySelectListItem): string {
    const raw = item.description || item.text || '';
    if (!raw) return '';
    return raw.length > 80 ? raw.substring(0, 80) + '...' : raw;
}

/**
 * Renders a searchable, numbered, priority-sorted entity selection list.
 * Selected items appear at the top in selection order; unselected items follow by lastUpdatedTimestamp descending.
 * Name and description are left-aligned; number badge is on the right side near the scrollbar.
 */
export function EntitySelectList<T extends EntitySelectListItem>({
    label,
    items,
    selectedIds,
    onToggle,
    searchQuery,
    onSearchChange,
    disabled = false,
}: EntitySelectListProps<T>) {
    const safeItems = items ?? [];
    const safeSelectedIds = selectedIds ?? [];

    const sortedItems = useMemo(() => {
        const selectedOrdered = safeSelectedIds
            .map(id => safeItems.find(item => item.id === id))
            .filter((item): item is T => item !== undefined);

        const unselected = safeItems
            .filter(item => !safeSelectedIds.includes(item.id))
            .sort((a, b) => (b.lastUpdatedTimestamp ?? 0) - (a.lastUpdatedTimestamp ?? 0));

        return [...selectedOrdered, ...unselected];
    }, [safeItems, safeSelectedIds]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return sortedItems;
        const q = searchQuery.toLowerCase();
        return sortedItems.filter(item =>
            (item.name || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q) ||
            (item.text || '').toLowerCase().includes(q)
        );
    }, [sortedItems, searchQuery]);

    return (
        <div className="entity-select-list">
            <label className="editor-label editor-label-small">{label}</label>
            <input
                type="text"
                value={searchQuery}
                onChange={e => onSearchChange(e.target.value)}
                className="editor-input entity-select-search"
                placeholder={`Search ${label.toLowerCase()}...`}
                disabled={disabled}
            />
            <div className="entity-select-scroll">
                {filteredItems.length === 0 && (
                    <div className="entity-select-empty">
                        {searchQuery ? 'No matches found.' : 'No items available.'}
                    </div>
                )}
                {filteredItems.map(item => {
                    const isSelected = safeSelectedIds.includes(item.id);
                    const selectionIndex = isSelected ? safeSelectedIds.indexOf(item.id) + 1 : null;
                    const desc = getEntityDescription(item);

                    return (
                        <div
                            key={item.id}
                            onClick={() => !disabled && onToggle(item.id)}
                            className={`entity-select-row ${isSelected ? 'entity-select-row-selected' : ''} ${disabled ? 'entity-select-row-disabled' : ''}`}
                        >
                            <div className="entity-select-content">
                                <span className={`entity-select-name ${isSelected ? 'entity-select-name-selected' : ''}`}>
                                    {item.name || 'Untitled'}
                                </span>
                                <span className="entity-select-desc">{desc || '\u00A0'}</span>
                            </div>
                            <span className={`entity-select-badge ${isSelected ? 'entity-select-badge-active' : ''}`}>
                                {selectionIndex ?? ''}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}