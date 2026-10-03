// src/components/ToolPermissionModal.tsx
import { useState } from 'react';
import type { tool } from '../types';
import type { DetectedToolsResult, ToolRule, ToolSecurityTier } from '../utilities/toolDetection';
import '../main.css';

interface ToolPermissionModalProps {
    characterName: string;
    detectedTools: DetectedToolsResult;
    onConfirm: (grantedTools: Record<tool, boolean>) => void;
    onClose: () => void;
}

export function ToolPermissionModal({
    characterName,
    detectedTools,
    onConfirm,
    onClose,
}: ToolPermissionModalProps) {
    // Initial state: in-world readonly and mutating checked by default; all others unchecked
    const [selectedTools, setSelectedTools] = useState<Record<tool, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        for (const r of detectedTools.inWorldReadonly) initial[r.tool] = true;
        for (const r of detectedTools.inWorldMutating) initial[r.tool] = true;
        for (const r of detectedTools.ambient) initial[r.tool] = false;
        for (const r of detectedTools.entityAdmin) initial[r.tool] = false;
        for (const r of detectedTools.osPrivileged) initial[r.tool] = false;
        return initial as Record<tool, boolean>;
    });

    const toggleTool = (t: tool) => {
        setSelectedTools(prev => ({ ...prev, [t]: !prev[t] }));
    };

    const handleSelectTier = (tier: ToolSecurityTier, enable: boolean) => {
        setSelectedTools(prev => {
            const next = { ...prev };
            const list = tier === 'os_privileged' ? detectedTools.osPrivileged 
                       : tier === 'entity_admin' ? detectedTools.entityAdmin
                       : tier === 'ambient' ? detectedTools.ambient 
                       : tier === 'in_world_mutating' ? detectedTools.inWorldMutating
                       : detectedTools.inWorldReadonly;
            for (const r of list) next[r.tool] = enable;
            return next;
        });
    };

    const handleGrantInWorldOnly = () => {
        const inWorldOnly: Record<string, boolean> = {};
        for (const r of detectedTools.inWorldReadonly) inWorldOnly[r.tool] = true;
        for (const r of detectedTools.inWorldMutating) inWorldOnly[r.tool] = true;
        for (const r of detectedTools.ambient) inWorldOnly[r.tool] = false;
        for (const r of detectedTools.entityAdmin) inWorldOnly[r.tool] = false;
        for (const r of detectedTools.osPrivileged) inWorldOnly[r.tool] = false;
        onConfirm(inWorldOnly as Record<tool, boolean>);
        onClose();
    };

    const handleConfirmSelected = () => {
        onConfirm(selectedTools);
        onClose();
    };

    const hasOsPrivileged = detectedTools.osPrivileged.length > 0;
    const hasEntityAdmin = detectedTools.entityAdmin.length > 0;
    const hasAmbient = detectedTools.ambient.length > 0;
    const hasInWorldMutating = detectedTools.inWorldMutating.length > 0;
    const hasInWorldReadonly = detectedTools.inWorldReadonly.length > 0;

    const renderToolItem = (rule: ToolRule, tier: ToolSecurityTier) => {
        const isChecked = !!selectedTools[rule.tool];
        
        let highlightBorder: string | undefined;
        let highlightBg: string | undefined;

        if (isChecked) {
            if (tier === 'os_privileged') {
                highlightBorder = '#ff4444';
                highlightBg = 'rgba(255, 68, 68, 0.08)';
            } else if (tier === 'entity_admin') {
                highlightBorder = '#f59e0b';
                highlightBg = 'rgba(245, 158, 11, 0.08)';
            } else if (tier === 'in_world_mutating') {
                highlightBorder = '#3b82f6';
                highlightBg = 'rgba(59, 130, 246, 0.08)';
            } else if (tier === 'ambient') {
                highlightBorder = 'var(--accent-border)';
                highlightBg = 'var(--accent-bg)';
            }
        }

        const isDanger = tier === 'os_privileged';
        const isWarning = tier === 'entity_admin';
        const isMutating = tier === 'in_world_mutating';

        return (
            <div
                key={rule.tool}
                className="manager-item"
                onClick={() => toggleTool(rule.tool)}
                style={{
                    cursor: 'pointer',
                    background: highlightBg,
                    borderColor: highlightBorder,
                    marginBottom: '6px',
                    padding: '8px 12px',
                    minHeight: '40px',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                    <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleTool(rule.tool)}
                        className="editor-checkbox-input"
                        style={isDanger && isChecked ? { backgroundColor: '#ef4444', borderColor: '#ef4444' } 
                             : isWarning && isChecked ? { backgroundColor: '#f59e0b', borderColor: '#f59e0b' } 
                             : isMutating && isChecked ? { backgroundColor: '#3b82f6', borderColor: '#3b82f6' }
                             : undefined}
                        onClick={e => e.stopPropagation()}
                    />
                    <div className="manager-item-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span className="manager-item-title" style={{ fontSize: '0.8rem' }}>
                                {rule.label}
                            </span>
                            <code style={{ fontSize: '0.6rem', padding: '1px 5px' }}>{rule.tool}</code>
                        </div>
                        {rule.riskDescription && (
                            <div 
                                className="manager-item-sub" 
                                style={{ 
                                    fontSize: '0.65rem', 
                                    opacity: isDanger ? 0.9 : 0.6, 
                                    color: isDanger && isChecked ? '#ff6b6b' : isWarning && isChecked ? '#fbbf24' : isMutating && isChecked ? '#93c5fd' : undefined,
                                    whiteSpace: 'normal',
                                    marginTop: '2px'
                                }}
                            >
                                {rule.riskDescription}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px' }}>
                <div className="modal-header">
                    <h2>🛡️ Tool Permissions: {characterName}</h2>
                    <button type="button" className="close-button" onClick={onClose} title="Cancel">×</button>
                </div>

                <div className="modal-body editor-modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
                    {/* Top Security Banner for Host Takeover */}
                    {hasOsPrivileged && (
                        <div className="model-status-banner model-status-warning" style={{ margin: '0 0 16px 0', padding: '10px 14px', textAlign: 'left', borderRadius: '8px' }}>
                            <span className="model-status-icon" style={{ fontSize: '1.4rem' }}>🚨</span>
                            <div className="model-status-text" style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#ff6b6b' }}>Host OS Takeover Tools Detected</div>
                                <div style={{ fontSize: '0.65rem', opacity: 0.9, marginTop: '2px', lineHeight: 1.4 }}>
                                    This character card matched tools capable of executing terminal scripts, taking physical mouse/keyboard control, or capturing webcam images. Unchecked by default for your safety.
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Section 1: Host OS & Hardware Takeover */}
                    {hasOsPrivileged && (
                        <div className="editor-section" style={{ border: '1px solid rgba(255, 68, 68, 0.4)', background: 'rgba(255, 68, 68, 0.02)', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span className="editor-section-title" style={{ color: '#ff6b6b', opacity: 1, margin: 0 }}>
                                    🚨 Host OS & Hardware Actuators ({detectedTools.osPrivileged.length})
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('os_privileged', true)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px', color: '#ff6b6b' }}
                                    >
                                        Select All
                                    </button>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('os_privileged', false)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {detectedTools.osPrivileged.map(rule => renderToolItem(rule, 'os_privileged'))}
                            </div>
                        </div>
                    )}

                    {/* Section 2: App & Entity Administration */}
                    {hasEntityAdmin && (
                        <div className="editor-section" style={{ border: '1px solid rgba(245, 158, 11, 0.3)', background: 'rgba(245, 158, 11, 0.02)', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span className="editor-section-title" style={{ color: '#f59e0b', opacity: 1, margin: 0 }}>
                                    🏛️ App & Entity Administration ({detectedTools.entityAdmin.length})
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('entity_admin', true)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px', color: '#f59e0b' }}
                                    >
                                        Select All
                                    </button>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('entity_admin', false)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {detectedTools.entityAdmin.map(rule => renderToolItem(rule, 'entity_admin'))}
                            </div>
                        </div>
                    )}

                    {/* Section 3: Ambient Sensors & Web */}
                    {hasAmbient && (
                        <div className="editor-section" style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span className="editor-section-title" style={{ margin: 0 }}>
                                    👁️ Ambient Sensors & Web Tools ({detectedTools.ambient.length})
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('ambient', true)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Select All
                                    </button>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('ambient', false)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {detectedTools.ambient.map(rule => renderToolItem(rule, 'ambient'))}
                            </div>
                        </div>
                    )}

                    {/* Section 4: In-World State Mutators */}
                    {hasInWorldMutating && (
                        <div className="editor-section" style={{ border: '1px solid rgba(59, 130, 246, 0.3)', background: 'rgba(59, 130, 246, 0.02)', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span className="editor-section-title" style={{ color: '#3b82f6', opacity: 1, margin: 0 }}>
                                    📦 In-World State Mutators ({detectedTools.inWorldMutating.length})
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('in_world_mutating', true)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px', color: '#3b82f6' }}
                                    >
                                        Select All
                                    </button>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('in_world_mutating', false)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {detectedTools.inWorldMutating.map(rule => renderToolItem(rule, 'in_world_mutating'))}
                            </div>
                        </div>
                    )}

                    {/* Section 5: In-World Read-Only Narrative */}
                    {hasInWorldReadonly && (
                        <div className="editor-section" style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span className="editor-section-title" style={{ margin: 0 }}>
                                    🎲 In-World Read-Only Narrative ({detectedTools.inWorldReadonly.length})
                                </span>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('in_world_readonly', true)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Select All
                                    </button>
                                    <button 
                                        type="button" 
                                        className="toolbar-button" 
                                        onClick={() => handleSelectTier('in_world_readonly', false)}
                                        style={{ fontSize: '0.6rem', padding: '1px 6px', height: '22px' }}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {detectedTools.inWorldReadonly.map(rule => renderToolItem(rule, 'in_world_readonly'))}
                            </div>
                        </div>
                    )}

                    {!hasOsPrivileged && !hasEntityAdmin && !hasAmbient && !hasInWorldMutating && !hasInWorldReadonly && (
                        <div className="empty-state" style={{ padding: '30px' }}>
                            No specific tool keywords were detected in this character card.
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--social-bg)', display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>
                        Cancel
                    </button>
                    {(hasOsPrivileged || hasEntityAdmin || hasInWorldMutating) && (
                        <button type="button" className="editor-button editor-button-cancel" onClick={handleGrantInWorldOnly} style={{ color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>
                            🛡️ Allow Read-Only Only
                        </button>
                    )}
                    <button type="button" className="editor-button editor-button-save" onClick={handleConfirmSelected}>
                        Confirm & Save Permissions
                    </button>
                </div>
            </div>
        </div>
    );
}