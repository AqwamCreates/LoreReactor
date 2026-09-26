// src/components/EntitySelect.tsx
import { useMemo } from 'react';
import '../main.css';

interface EntitySelectItem {
    id: string;
    name?: string;
    description?: string;
    text?: string;
    lastUpdatedTimestamp?: number;
}

interface EntitySelectProps<T extends EntitySelectItem> {
    label: string;
    description?: string;
    items: T[];
    selectedId: string | null;
    onSelect: (identifier: string) => void;
    searchQuery: string;
    onSearchChange: (value: string) => void;
    disabled?: boolean;
    allowNone?: boolean;
    noneLabel?: string;
    noneDescription?: string;
    renderDescription?: (item: T) => string;
}

/** Extract a short description snippet from an entity for display in the selection list. */
function getEntityDescription(item: EntitySelectItem): string {
    const rawDescription = item.description || item.text || '';
    if (!rawDescription) return '';
    return rawDescription.length > 80 ? `${rawDescription.substring(0, 80)}...` : rawDescription;
}

/**
 * Renders a searchable, single-selection entity list.
 * The currently selected item is pinned to the top; unselected items follow by lastUpdatedTimestamp descending.
 * Reserves vertical space when descriptions are empty to guarantee consistent row heights.
 */
export function EntitySelect<T extends EntitySelectItem>({
    label,
    description,
    items,
    selectedId,
    onSelect,
    searchQuery,
    onSearchChange,
    disabled = false,
    allowNone = false,
    noneLabel = 'None',
    noneDescription,
    renderDescription,
}: EntitySelectProps<T>) {
    const safeItems = items ?? [];

    const sortedItems = useMemo(() => {
        if (!selectedId) {
            return [...safeItems].sort((firstItem, secondItem) => 
                (secondItem.lastUpdatedTimestamp ?? 0) - (firstItem.lastUpdatedTimestamp ?? 0)
            );
        }

        const selectedItem = safeItems.find(item => item.id === selectedId);
        const unselectedItems = safeItems
            .filter(item => item.id !== selectedId)
            .sort((firstItem, secondItem) => 
                (secondItem.lastUpdatedTimestamp ?? 0) - (firstItem.lastUpdatedTimestamp ?? 0)
            );

        return selectedItem ? [selectedItem, ...unselectedItems] : unselectedItems;
    }, [safeItems, selectedId]);

    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return sortedItems;
        const normalizedQuery = searchQuery.toLowerCase();
        return sortedItems.filter(item => {
            const nameMatches = (item.name || '').toLowerCase().includes(normalizedQuery);
            const descriptionMatches = (item.description || '').toLowerCase().includes(normalizedQuery);
            const textMatches = (item.text || '').toLowerCase().includes(normalizedQuery);
            const customDescriptionMatches = renderDescription 
                ? renderDescription(item).toLowerCase().includes(normalizedQuery) 
                : false;
            return nameMatches || descriptionMatches || textMatches || customDescriptionMatches;
        });
    }, [sortedItems, searchQuery, renderDescription]);

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
                {allowNone && (
                    <div
                        onClick={() => !disabled && onSelect('')}
                        className={`entity-select-row ${!selectedId ? 'entity-select-row-selected' : ''} ${disabled ? 'entity-select-row-disabled' : ''}`}
                    >
                        <div className="entity-select-content">
                            <span className={`entity-select-name ${!selectedId ? 'entity-select-name-selected' : ''}`}>
                                {noneLabel}
                            </span>
                            <span className="entity-select-desc">
                                {noneDescription || '\u00A0'}
                            </span>
                        </div>
                        <span className={`entity-select-badge ${!selectedId ? 'entity-select-badge-active' : ''}`}>
                            {!selectedId ? '✓' : ''}
                        </span>
                    </div>
                )}
                {filteredItems.length === 0 && (
                    <div className="entity-select-empty">
                        {searchQuery ? 'No matches found.' : 'No items available.'}
                    </div>
                )}
                {filteredItems.map(item => {
                    const isSelected = selectedId === item.id;
                    const descriptionText = renderDescription ? renderDescription(item) : getEntityDescription(item);

                    return (
                        <div
                            key={item.id}
                            onClick={() => !disabled && onSelect(item.id)}
                            className={`entity-select-row ${isSelected ? 'entity-select-row-selected' : ''} ${disabled ? 'entity-select-row-disabled' : ''}`}
                        >
                            <div className="entity-select-content">
                                <span className={`entity-select-name ${isSelected ? 'entity-select-name-selected' : ''}`}>
                                    {item.name || 'Untitled'}
                                </span>
                                <span className="entity-select-desc">{descriptionText || '\u00A0'}</span>
                            </div>
                            <span className={`entity-select-badge ${isSelected ? 'entity-select-badge-active' : ''}`}>
                                {isSelected ? '✓' : ''}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}