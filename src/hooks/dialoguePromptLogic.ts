// src/hooks/dialoguePromptLogic.ts
import type { DialoguePrompt } from '../types';

/**
 * Evaluates whether a single dialogue prompt is active based on its regex triggers
 * and the current conversation search space.
 */
export function isDialoguePromptActive(
    dp: DialoguePrompt,
    searchSpace: string,
): boolean {
    const activationTriggers = dp.regularExpressionActivationTriggers ?? [];
    const deactivationTriggers = dp.regularExpressionDeactivationTriggers ?? [];
    const exclusionActivationTriggers = dp.regularExpressionExclusionActivationTriggers ?? [];
    const exclusionDeactivationTriggers = dp.regularExpressionExclusionDeactivationTriggers ?? [];

    // No activation triggers = always active
    if (activationTriggers.length === 0) return true;

    // Check activation
    let activated = false;
    for (const trigger of activationTriggers) {
        if (!trigger.trigger.trim()) continue;
        try {
            if (new RegExp(trigger.trigger).test(searchSpace)) { activated = true; break; }
        } catch { /* skip invalid regex */ }
    }
    if (!activated) return false;

    // Check deactivation
    for (const trigger of deactivationTriggers) {
        if (!trigger.trigger.trim()) continue;
        try {
            if (new RegExp(trigger.trigger).test(searchSpace)) return false;
        } catch { /* skip invalid regex */ }
    }

    // Check exclusion activation
    if (exclusionActivationTriggers.length > 0) {
        let exclusionActivated = false;
        for (const trigger of exclusionActivationTriggers) {
            if (!trigger.trigger.trim()) continue;
            try {
                if (new RegExp(trigger.trigger).test(searchSpace)) { exclusionActivated = true; break; }
            } catch { /* skip invalid regex */ }
        }
        if (exclusionActivated) {
            // Check exclusion deactivation — if NOT deactivated, exclude this prompt
            let exclusionDeactivated = false;
            for (const trigger of exclusionDeactivationTriggers) {
                if (!trigger.trigger.trim()) continue;
                try {
                    if (new RegExp(trigger.trigger).test(searchSpace)) { exclusionDeactivated = true; break; }
                } catch { /* skip invalid regex */ }
            }
            if (!exclusionDeactivated) return false;
        }
    }

    return true;
}

/**
 * Returns all active dialogue prompts from a character's dialogue prompt list,
 * evaluated against the given search space.
 */
export function getActiveDialoguePrompts(
    dialoguePrompts: DialoguePrompt[] | undefined,
    searchSpace: string,
): DialoguePrompt[] {
    if (!dialoguePrompts || dialoguePrompts.length === 0) return [];
    return dialoguePrompts.filter(dp => isDialoguePromptActive(dp, searchSpace));
}

/**
 * Collects content from active dialogue prompts, applying skip probability.
 * Returns an array of non-empty content strings.
 */
export function collectActiveDialoguePromptContent(
    dialoguePrompts: DialoguePrompt[] | undefined,
    searchSpace: string,
): string[] {
    const active = getActiveDialoguePrompts(dialoguePrompts, searchSpace);
    const contents: string[] = [];
    for (const dp of active) {
        const skipProb = dp.dialoguePromptSkipProbability ?? 0;
        if (skipProb > 0 && Math.random() < skipProb) continue;
        if (dp.content?.trim()) {
            contents.push(dp.content.trim());
        }
    }
    return contents;
}

export function buildDialogueSearchSpace(textContentArray: string[]): string {
    return textContentArray.join('\n');
}