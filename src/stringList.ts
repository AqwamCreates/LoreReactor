export const contextStartString = "{";
export const contextEndString = "}";
export const turnStartString = "{";
export const turnEndString = "}";

export const memoryWriteTrigger = "<memory>";

export const commonThinkStartString = "<think>";
export const commonThinkEndString = "</think>";
export const gemmaThinkStartString = "<|channel>";
export const gemmaThinkEndString = "<channel|>";

export const thinkStartString = `${gemmaThinkStartString}${commonThinkStartString}`;
export const thinkEndString = `${commonThinkEndString}${gemmaThinkEndString}`;