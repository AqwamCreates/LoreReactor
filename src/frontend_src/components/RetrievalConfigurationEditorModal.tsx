// src/frontend_src/components/RetrievalConfigurationEditorModal.tsx
import { useState } from 'react';
import type { RetrievalConfiguration, retrievalStrategy } from '../types';
import { SliderInput } from './SliderInput';
import { v4 as uuidv4 } from 'uuid';
import '../main.css';

interface RetrievalConfigurationEditorModalProps {
    onClose: () => void;
    onSave: (config: RetrievalConfiguration) => void;
    existingConfiguration?: RetrievalConfiguration | null;
}

export function RetrievalConfigurationEditorModal({
    onClose,
    onSave,
    existingConfiguration,
}: RetrievalConfigurationEditorModalProps) {
    return (
        <RetrievalConfigurationEditorModalInner
            onClose={onClose}
            onSave={onSave}
            existingConfiguration={existingConfiguration}
        />
    );
}

function RetrievalConfigurationEditorModalInner({
    onClose,
    onSave,
    existingConfiguration,
}: Omit<RetrievalConfigurationEditorModalProps, 'isOpen'>) {
    const [name, setName] = useState(existingConfiguration?.name || '');
    const [description, setDescription] = useState(existingConfiguration?.description || '');
    
    const [retrievalStrategy, setRetrievalStrategy] = useState<retrievalStrategy>(
        existingConfiguration?.retrievalStrategy || 'dense'
    );
    const [topK, setTopK] = useState<number>(existingConfiguration?.topK ?? 5);
    const [similarityThreshold, setSimilarityThreshold] = useState<number>(
        existingConfiguration?.similarityThreshold ?? 0.65
    );
    const [tokenBudget, setTokenBudget] = useState<number>(
        existingConfiguration?.tokenBudget ?? 1024
    );

    const [errors, setErrors] = useState<{ name?: string }>({});

    const validate = (): boolean => {
        const newErrors: { name?: string } = {};
        if (!name) {
            newErrors.name = 'Name is required';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const buildConfigurationFromForm = (isNewClone: boolean): RetrievalConfiguration | null => {
        if (!validate()) return null;

        const now = Date.now();
        return {
            id: isNewClone ? uuidv4() : (existingConfiguration?.id || uuidv4()),
            name: isNewClone ? `${name} (Clone)` : name,
            description: description || undefined,
            retrievalStrategy,
            topK,
            similarityThreshold,
            tokenBudget,
            firstCreatedTimestamp: isNewClone ? now : (existingConfiguration?.firstCreatedTimestamp || now),
            lastUpdatedTimestamp: now,
        };
    };

    const handleSubmit = () => {
        const config = buildConfigurationFromForm(false);
        if (!config) return;
        onSave(config);
        onClose();
    };

    const handleClone = () => {
        const clonedConfig = buildConfigurationFromForm(true);
        if (!clonedConfig) return;
        onSave(clonedConfig);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content editor-modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{existingConfiguration ? 'Edit Retrieval Configuration' : 'Create New Retrieval Configuration'}</h2>
                    <div className="editor-modal-actions">
                        <button type="button" className="editor-button editor-button-cancel" onClick={onClose}>Cancel</button>
                        {existingConfiguration && (
                            <button type="button" className="editor-button editor-button-cancel" onClick={handleClone}>
                                Clone
                            </button>
                        )}
                        <button type="button" className="editor-button editor-button-save" onClick={handleSubmit}>Save</button>
                    </div>
                </div>
                <div className="modal-body editor-modal-body">
                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Name <span style={{ color: '#ff4444' }}>*</span></label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                            className={`editor-input ${errors.name ? 'error' : ''}`}
                            placeholder="e.g., Strict Lore Retrieval"
                        />
                        {errors.name && <div className="editor-error-message">{errors.name}</div>}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label className="editor-label">Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="editor-textarea"
                            placeholder="Describe how this retrieval configuration behaves"
                            rows={2}
                        />
                    </div>

                    <div className="editor-section">
                        <div className="editor-section-title">Retrieval Strategy</div>
                        <select 
                            value={retrievalStrategy} 
                            onChange={(e) => setRetrievalStrategy(e.target.value as retrievalStrategy)} 
                            className="editor-select"
                            style={{ marginBottom: '8px' }}
                        >
                            <option value="dense">Dense (Semantic Vector Search)</option>
                            <option value="sparse">Sparse (Keyword Search)</option>
                            <option value="hybrid">Hybrid (Dense + Sparse Keyword)</option>
                            <option value="maximal marginal relevance">Maximal Marginal Relevance (Diversity)</option>
                        </select>
                        <div style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                            {retrievalStrategy === 'dense' && 'Standard cosine/dot-product similarity search.'}
                            {retrievalStrategy === 'sparse' && 'Standard keyword search.'}
                            {retrievalStrategy === 'hybrid' && 'Combines semantic embeddings with keyword matching for exact phrase recall.'}
                            {retrievalStrategy === 'maximal marginal relevance' && 'Balances relevance with diversity to prevent retrieving duplicate or highly similar chunks.'}
                        </div>
                    </div>

                    <div className="editor-section">
                        <div className="editor-section-title">Search Parameters</div>
                        
                        <div style={{ marginBottom: '16px' }}>
                            <SliderInput
                                label="Top K (Max Results)"
                                value={topK}
                                minimumValue={1}
                                maximumValue={50}
                                stepValue={1}
                                decimals={0}
                                onChange={setTopK}
                            />
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px' }}>
                                Maximum number of relevant items to retrieve before applying token budget limits.
                            </div>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <SliderInput
                                label="Similarity Threshold"
                                value={similarityThreshold}
                                minimumValue={0}
                                maximumValue={1}
                                stepValue={0.01}
                                decimals={2}
                                onChange={setSimilarityThreshold}
                            />
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px' }}>
                                Minimum similarity score (0.0 to 1.0) required for an item to be included. Items below this are discarded.
                            </div>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <SliderInput
                                label="Token Budget"
                                value={tokenBudget}
                                minimumValue={0}
                                maximumValue={8192}
                                stepValue={64}
                                decimals={0}
                                onChange={setTokenBudget}
                            />
                            <div style={{ fontSize: '0.65rem', opacity: 0.6, marginTop: '4px' }}>
                                Maximum number of tokens allowed for the retrieved context. Excess items are truncated. Set to 0 for unlimited.
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}