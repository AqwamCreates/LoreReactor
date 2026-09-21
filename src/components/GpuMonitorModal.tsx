// src/components/GpuMonitorModal.tsx

import { useGpuMonitor } from '../hooks/useGpuMonitor';
import '../main.css';

interface GpuMonitorModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function ProgressBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
    const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    return (
        <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                <span>{label}</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{percent.toFixed(1)}%</span>
            </div>
            <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${percent}%`, background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
            </div>
        </div>
    );
}

function StatRow({ label, value, unit }: { label: string; value: string | number | null; unit?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
            <span style={{ opacity: 0.7 }}>{label}</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                {value !== null && value !== undefined ? `${value}${unit || ''}` : '—'}
            </span>
        </div>
    );
}

export function GpuMonitorModal({ isOpen, onClose }: GpuMonitorModalProps) {
    const { status, isPolling, error } = useGpuMonitor(isOpen);

    if (!isOpen) return null;

    const utilizationColor = !status ? 'var(--border)' :
        status.utilizationPercent > 90 ? '#ef4444' :
        status.utilizationPercent > 70 ? '#f59e0b' :
        status.utilizationPercent > 40 ? '#3b82f6' : '#22c55e';

    const memoryColor = !status || status.memoryTotalMB === 0 ? 'var(--border)' :
        (status.memoryUsedMB / status.memoryTotalMB) > 0.9 ? '#ef4444' :
        (status.memoryUsedMB / status.memoryTotalMB) > 0.7 ? '#f59e0b' : '#3b82f6';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                <div className="modal-header">
                    <h2>GPU Monitor</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Close</button>
                    </div>
                </div>

                <div className="modal-body editor-modal-body">
                    {!status && !error && isPolling && (
                        <div style={{ textAlign: 'center', padding: '40px 20px', opacity: 0.6 }}>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⏳</div>
                            <div>Detecting GPU...</div>
                        </div>
                    )}

                    {error && !status && (
                        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⚠️</div>
                            <div style={{ color: '#ef4444', marginBottom: '8px' }}>GPU monitoring unavailable</div>
                            <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{error}</div>
                            <div style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: '12px' }}>
                                Ensure nvidia-smi, rocm-smi, xpu-smi, or powermetrics is installed and accessible.
                            </div>
                        </div>
                    )}

                    {status && (
                        <div>
                            {/* GPU Name & Vendor */}
                            <div style={{
                                padding: '12px 16px',
                                background: 'var(--social-bg)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                marginBottom: '16px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                            }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{status.name}</div>
                                    <div style={{ fontSize: '0.7rem', opacity: 0.5, textTransform: 'uppercase' }}>{status.vendor}</div>
                                </div>
                                <div style={{
                                    fontSize: '0.65rem',
                                    padding: '2px 8px',
                                    borderRadius: '10px',
                                    background: isPolling ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                    color: isPolling ? '#22c55e' : '#ef4444',
                                    fontWeight: 'bold',
                                }}>
                                    {isPolling ? '● LIVE' : '○ STALE'}
                                </div>
                            </div>

                            {/* Utilization Bar */}
                            <ProgressBar
                                value={status.utilizationPercent}
                                max={100}
                                color={utilizationColor}
                                label="GPU Utilization"
                            />

                            {/* Memory Bar */}
                            <ProgressBar
                                value={status.memoryUsedMB}
                                max={status.memoryTotalMB}
                                color={memoryColor}
                                label={`VRAM (${status.memoryUsedMB} / ${status.memoryTotalMB} MB)`}
                            />

                            {/* Stats Grid */}
                            <div style={{
                                padding: '12px 16px',
                                background: 'var(--social-bg)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                marginTop: '8px',
                            }}>
                                <StatRow label="Temperature" value={status.temperatureC} unit="°C" />
                                <StatRow label="Power Draw" value={status.powerWatts} unit="W" />
                                <StatRow label="Memory Used" value={status.memoryUsedMB} unit=" MB" />
                                <StatRow label="Memory Total" value={status.memoryTotalMB} unit=" MB" />
                                <StatRow
                                    label="Last Updated"
                                    value={new Date(status.timestamp).toLocaleTimeString()}
                                />
                            </div>

                            {/* Apple Silicon Note */}
                            {status.vendor === 'apple' && status.memoryUsedMB === 0 && (
                                <div style={{
                                    fontSize: '0.65rem',
                                    opacity: 0.5,
                                    marginTop: '12px',
                                    padding: '8px 12px',
                                    background: 'var(--social-bg)',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border)',
                                    fontStyle: 'italic',
                                }}>
                                    ℹ️ Apple Silicon uses unified memory. Individual GPU memory usage requires IOKit access and cannot be reported without elevated privileges.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}