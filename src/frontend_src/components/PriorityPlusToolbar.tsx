// src/frontend_src/components/PriorityPlusToolbar.tsx
import type React from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export interface ToolbarItem {
    /** Stable identifier used for measurement bookkeeping */
    id: string;
    /** Lower number = higher priority = stays inline the longest when space is tight */
    priority: number;
    /** Text shown inside the collapsed "More" menu */
    label: string;
    /** Icon shown inside the collapsed "More" menu */
    icon?: React.ReactNode;
    /** Renders the inline control exactly as it should appear in the bar */
    render: () => React.ReactNode;
    /** Click handler invoked from the collapsed menu entry */
    onActivate?: () => void;
    /** Optional custom collapsed-menu content (overrides icon+label) */
    renderMenu?: () => React.ReactNode;
    /** Non-interactive status chip (rendered as a div in the collapsed menu) */
    isStatus?: boolean;
    /** Conditionally remove the item entirely */
    hidden?: boolean;
}

interface PriorityPlusToolbarProps {
    items: ToolbarItem[];
    className?: string;
    /** Gap in px between inline controls */
    gap?: number;
    overflowTitle?: string;
}

const OVERFLOW_ID = '__pp_overflow__';

/**
 * Priority+ toolbar.
 *
 * Renders every item into an off-screen measuring strip, observes both the
 * strip children and the live container, then keeps as many high-priority
 * items inline as the container can actually hold. Everything else collapses
 * into a single overflow menu — the bar therefore can never overflow its
 * parent, regardless of viewport or window size.
 */
export function PriorityPlusToolbar({
    items,
    className = '',
    gap = 6,
    overflowTitle = 'More controls',
}: PriorityPlusToolbarProps) {
    const sortedItems = useMemo(
        () =>
            items
                .filter((i) => !i.hidden)
                .slice()
                .sort((a, b) => a.priority - b.priority),
        [items],
    );

    const signature = useMemo(() => sortedItems.map((i) => i.id).join('|'), [sortedItems]);

    const containerRef = useRef<HTMLDivElement>(null);
    const measureNodes = useRef<Map<string, HTMLElement>>(new Map());

    const [widths, setWidths] = useState<Record<string, number>>({});
    const [containerWidth, setContainerWidth] = useState(0);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    // ── Observe every candidate control (including the hidden overflow button) ──
    useLayoutEffect(() => {
        const nodes = measureNodes.current;
        if (nodes.size === 0) return;

        const readWidth = (entry: ResizeObserverEntry): number => {
            const box = (entry as ResizeObserverEntry & { borderBoxSize?: readonly { inlineSize: number }[] })
                .borderBoxSize;
            if (Array.isArray(box) && box.length > 0) return box[0].inlineSize;
            return (entry.target as HTMLElement).getBoundingClientRect().width;
        };

        const observer = new ResizeObserver((entries) => {
            const next: Record<string, number> = {};
            for (const entry of entries) {
                const id = (entry.target as HTMLElement).dataset.ppId;
                if (!id) continue;
                next[id] = readWidth(entry);
            }

            setWidths((prev) => {
                let dirty = false;
                for (const key of Object.keys(next)) {
                    if (Math.abs((prev[key] ?? -1) - next[key]) > 0.5) {
                        dirty = true;
                        break;
                    }
                }
                return dirty ? { ...prev, ...next } : prev;
            });
        });

        nodes.forEach((node) => observer.observe(node));
        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [signature]);

    // ── Observe available width ─────────────────────────────────────────────
    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        setContainerWidth(el.getBoundingClientRect().width);

        const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? 0;
            setContainerWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // ── Close the collapsed menu on outside click / Escape ──────────────────
    useEffect(() => {
        if (!isMenuOpen) return;

        const onPointerDown = (e: MouseEvent | TouchEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setIsMenuOpen(false);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsMenuOpen(false);
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('touchstart', onPointerDown, { passive: true });
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('touchstart', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isMenuOpen]);

    const overflowWidth = widths[OVERFLOW_ID] ?? 36;

    // ── Partition items into inline vs. collapsed ───────────────────────────
    const { inlineItems, collapsedItems, isMeasuring } = useMemo(() => {
        const ids = sortedItems.map((i) => i.id);
        const measuredAll = ids.length > 0 && ids.every((id) => widths[id] !== undefined);

        if (!measuredAll || containerWidth <= 0) {
            return { inlineItems: sortedItems, collapsedItems: [] as ToolbarItem[], isMeasuring: true };
        }

        const widthOf = (id: string) => widths[id] ?? 0;
        const naturalTotal =
            ids.reduce((sum, id) => sum + widthOf(id), 0) + gap * Math.max(0, ids.length - 1);

        if (naturalTotal <= containerWidth) {
            return { inlineItems: sortedItems, collapsedItems: [] as ToolbarItem[], isMeasuring: false };
        }

        const budget = containerWidth - overflowWidth - gap;
        let used = 0;
        const keep: ToolbarItem[] = [];

        for (const item of sortedItems) {
            const cost = widthOf(item.id) + (keep.length > 0 ? gap : 0);
            if (used + cost > budget) break;
            used += cost;
            keep.push(item);
        }

        return {
            inlineItems: keep,
            collapsedItems: sortedItems.slice(keep.length),
            isMeasuring: false,
        };
    }, [sortedItems, widths, containerWidth, gap, overflowWidth]);

    const setMeasureRef = (id: string) => (el: HTMLElement | null) => {
        if (el) measureNodes.current.set(id, el);
        else measureNodes.current.delete(id);
    };

    return (
        <>
            {/* Off-screen measuring strip: keeps natural widths of every candidate */}
            <div className="pp-measure" aria-hidden="true">
                {sortedItems.map((item) => (
                    <span
                        key={`measure-${item.id}`}
                        className="pp-measure-item"
                        data-pp-id={item.id}
                        ref={setMeasureRef(item.id)}
                    >
                        {item.render()}
                    </span>
                ))}
                <span
                    className="pp-measure-item"
                    data-pp-id={OVERFLOW_ID}
                    ref={setMeasureRef(OVERFLOW_ID)}
                >
                    <button type="button" className="pp-overflow-button" tabIndex={-1}>
                        <span className="pp-overflow-glyph">⋯</span>
                        <span className="pp-overflow-count">9</span>
                    </button>
                </span>
            </div>

            <div
                ref={containerRef}
                className={`pp-toolbar ${isMeasuring ? 'pp-toolbar-measuring' : ''} ${className}`}
                style={{ gap }}
            >
                {inlineItems.map((item) => (
                    <div key={item.id} className="pp-toolbar-slot">
                        {item.render()}
                    </div>
                ))}

                {collapsedItems.length > 0 && (
                    <div className="pp-overflow-wrap" ref={wrapRef}>
                        <button
                            type="button"
                            className={`pp-overflow-button ${isMenuOpen ? 'pp-overflow-button-active' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsMenuOpen((prev) => !prev);
                            }}
                            title={overflowTitle}
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                        >
                            <span className="pp-overflow-glyph">⋯</span>
                            <span className="pp-overflow-count">{collapsedItems.length}</span>
                        </button>

                        {isMenuOpen && (
                            <div className="pp-overflow-menu" role="menu">
                                {collapsedItems.map((item) => (
                                    <div key={item.id} className="pp-overflow-menu-row" role="none">
                                        {item.renderMenu ? (
                                            item.renderMenu()
                                        ) : item.isStatus ? (
                                            <div className="pp-overflow-menu-status">{item.render()}</div>
                                        ) : (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                className="pp-overflow-menu-item"
                                                onClick={() => {
                                                    setIsMenuOpen(false);
                                                    item.onActivate?.();
                                                }}
                                            >
                                                {item.icon && (
                                                    <span className="pp-overflow-menu-icon">{item.icon}</span>
                                                )}
                                                <span className="pp-overflow-menu-label">{item.label}</span>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}

export default PriorityPlusToolbar;