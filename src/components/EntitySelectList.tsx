// src/components/EntitySelectList.tsx
import { useMemo } from 'react';
import '../main.css';

interface EntitySelectListItem {
    id: string;
    name?: string;
    description?: string;
    text?: string;
    lastUpdatedTimestamp?: number;
}

interface EntitySelectListProps<T extends EntitySelectListItem> {
    label: string;
    description?: string;
    items: T[];
    selectedIds: string[];
    onToggle: (identifier: string) => void;
    searchQuery: string;
    onSearchChange: (value: string) => void;
    disabled?: boolean;
}

/** Extract a short description snippet from an entity for display in the selection list. */
function getEntityDescription(item: EntitySelectListItem): string {
    const rawDescription = item.description || item.text || '';
    if (!rawDescription) return '';
    return rawDescription.length > 80 ? `${rawDescription.substring(0, 80)}...` : rawDescription;
}

/**
 * Renders a searchable, numbered, priority-sorted entity selection list.
 * Selected items appear at the top in selection order; unselected items follow by lastUpdatedTimestamp descending.
 * Name and description are left-aligned; number badge is on the right side near the scrollbar.
 */
export function EntitySelectList<T extends EntitySelectListItem>({
    label,
    description,
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
            .sort((firstItem, secondItem) => (secondItem.lastUpdatedTimestamp ?? 0) - (firstItem.lastUpdatedTimestamp ?? 0));

        return [...selectedOrdered, ...unselected];
    }, [safeItems, safeSelectedIds]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return sortedItems;
        const normalizedQuery = searchQuery.toLowerCase();
        return sortedItems.filter(item =>
            (item.name || '').toLowerCase().includes(normalizedQuery) ||
            (item.description || '').toLowerCase().includes(normalizedQuery) ||
            (item.text || '').toLowerCase().includes(normalizedQuery)
        );
    }, [sortedItems, searchQuery]);

    return (
        <div className="entity-select-list">
            <label className="editor-label editor-label-small">{label}</label>
            {description && (
                <div className="entity-ref-hint" style={{ marginBottom: '6px' }}>
                    {description}
                </div>
            )}
            <input
                type="text"
                value={searchQuery}
                onChange={event => onSearchChange(event.target.value)}
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
                    const descriptionText = getEntityDescription(item);

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
                                <span className="entity-select-desc">{descriptionText || '\u00A0'}</span>
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