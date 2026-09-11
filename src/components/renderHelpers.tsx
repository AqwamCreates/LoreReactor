// src/components/renderHelpers.tsx
import type React from 'react';
import type { LanguageModel, BudgetStrategy, Profile, InteractionData } from '../types';
import { cloudBackends } from '../languageModelInformation';

export function getRenderSubTextForTriStates(value: number, text: string): React.ReactNode {
    if (value === 0) return null;
    if (value < 0) return `${text} Disabled`;
    return `${text} Enabled`;
}

export function renderModelSubtext(
    model: LanguageModel,
    runningModels: Record<string, { isRunning?: boolean; isIdle?: boolean }>,
    selectedModelId: string | null,
): React.ReactNode {
    const ms = runningModels[model.id];
    const isCloud = !!model.apiKey && model.backend && cloudBackends.includes(model.backend);

    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8, flexWrap: 'wrap' }}>
            {!!model.mmproj && <span style={{ fontSize: '0.7rem', background: '#8b5cf6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Multi-Modal</span>}
            {isCloud && <span style={{ fontSize: '0.7rem', background: '#3b82f6', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Cloud</span>}
            {ms?.isRunning && ms?.isIdle && <span style={{ fontSize: '0.7rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Idle</span>}
            {ms?.isRunning && !ms?.isIdle && <span style={{ fontSize: '0.7rem', background: '#f59e0b', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Loading</span>}
            {selectedModelId === model.id && !ms?.isRunning && !isCloud && <span style={{ fontSize: '0.7rem', background: '#6b7280', color: '#fff', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Selected (Not Loaded)</span>}
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Context: {(model.contextLength / 1024).toFixed(0)}k</span>
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Backend: {model.backend || 'other'}</span>
            <span>{model.description}</span>
        </span>
    );
}

export function renderBudgetStrategySubtext(strategy: BudgetStrategy): React.ReactNode {
    const totalModels = (strategy.onlineModels?.length ?? 0) + (strategy.localModels?.length ?? 0);

    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.8 }}>
            <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>Language Models: {totalModels} • Online: {strategy.switchProbability}% • Budget: ${strategy.maximumBudget}</span>
        </span>
    );
}

export function renderProfileSubtext(profile: Profile): React.ReactNode {
    const tools = profile?.tools
    const enableWebSearchText = getRenderSubTextForTriStates(tools.web, "Web Search");
    const enableCalculatorText = getRenderSubTextForTriStates(tools.calculator, "Calculator");
    const enablePickText = getRenderSubTextForTriStates(tools.pick, "Pick");
    const enableRollText = getRenderSubTextForTriStates(tools.Dice, "Dice"); 
    const enableMemoryReadingText = getRenderSubTextForTriStates(profile.enableMemoryReading, "Memory Read");
    const enableMemoryWritingText = getRenderSubTextForTriStates(profile.enableMemoryWriting, "Memory Write");

    const flags: string[] = [];
    if (profile.forceNameReveal) flags.push('Force Names');
    if (profile.enableCharacterExpression) flags.push('Expressions');
    if (profile.useCurrentDateAndTime) flags.push('Clock');
    if (profile.useWeather) flags.push('Weather');
    if (profile.useTimeElapsed) flags.push('Time Elapsed');
    if (profile.cacheInvalidationReductionLevel >= 1) flags.push(`Cache L${profile.cacheInvalidationReductionLevel}`);
    if (enableWebSearchText) flags.push(enableWebSearchText as string);
    if (enableCalculatorText) flags.push(enableCalculatorText as string);
    if (enablePickText) flags.push(enablePickText as string);
    if (enableRollText) flags.push(enableRollText as string);
    if (enableMemoryReadingText) flags.push(enableMemoryReadingText as string);
    if (enableMemoryWritingText) flags.push(enableMemoryWritingText as string);
    if (profile.forceEqualInitiative || profile.chatProbability !== -1 || profile.maximumChatStamina !== -1 || profile.nameSensitivity !== -1 || profile.chatImpatienceSensitivity !== -1 || profile.skipProbability !== -1 || profile.memoryRetentionWeight !== -1 || profile.contextSensitivity !== -1) flags.push('Chat Stats Override');

    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.8, flexWrap: 'wrap' }}>
            {flags.length > 0
                ? flags.map(f => <span key={f} style={{ fontSize: '0.65rem', background: 'var(--accent-bg)', color: 'var(--accent)', padding: '1px 5px', borderRadius: '3px' }}>{f}</span>)
                : <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>No special settings</span>}
        </span>
    );
}

export function renderChatSubtext(c: InteractionData): string {
    const parts: string[] = [];
    if (c.parentInteractionDataId) parts.push(`Branch of ${c.parentInteractionDataId.substring(0, 8)}...`);
    parts.push(`${c.numberOfMessages ?? c.interactionHistory.length} message${(c.numberOfMessages ?? c.interactionHistory.length) > 1 ? 's' : ''}`);
    parts.push(`${c.participants?.length ?? 0} character${(c.participants?.length ?? 0) !== 1 ? 's' : ''}`);
    if ((c.contexts?.length ?? 0) > 0) parts.push(`${c.contexts?.length} context${c.contexts?.length !== 1 ? 's' : ''}`);
    return parts.join(' • ');
}

export function renderContextSubtext(i: {
    regularExpressionActivationTrigger?: string;
    images?: unknown[];
    searchTerms?: unknown[];
    urls?: unknown[];
    text?: string;
}): string {
    const parts: string[] = [];
    const imageCount = i.images?.length ?? 0;
    const searchTermCount = i.searchTerms?.length ?? 0;
    const urlCount = i.urls?.length ?? 0;
    if (!i.regularExpressionActivationTrigger) parts.push('📌'); else parts.push('⚡');
    if (imageCount > 0) parts.push(`🖼️${imageCount}`);
    if (searchTermCount > 0) parts.push(`🔎${searchTermCount}`);
    if (urlCount > 0) parts.push(`🔗${urlCount}`);
    parts.push(`${i.text?.substring(0, 50) || ''}...`);
    return parts.join(' ');
}

export function renderLocationSubtext(loc: {
    regularExpressionActivationTrigger?: string;
    images?: unknown[];
    text?: string;
    characterBindings?: string[];
}): string {
    const parts: string[] = [];
    if (loc.regularExpressionActivationTrigger) parts.push('⚡');
    else parts.push('📍');
    const imageCount = loc.images?.length ?? 0;
    if (imageCount > 0) parts.push(`🖼️${imageCount}`);
    const bindingCount = loc.characterBindings?.length ?? 0;
    if (bindingCount > 0) parts.push(`👤${bindingCount}`);
    parts.push(`${loc.text?.substring(0, 50) || ''}...`);
    return parts.join(' ');
}

export function renderExtensionSubtext(ext: { extensionType: string; description: string }): React.ReactNode {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px', opacity: 0.8 }}>
            <span style={{ fontSize: '0.65rem', background: 'var(--border)', padding: '2px 3px', borderRadius: '4px', textTransform: 'uppercase' }}>{ext.extensionType.replace(/_/g, ' ')}</span>
            <span>{ext.description}</span>
        </span>
    );
}