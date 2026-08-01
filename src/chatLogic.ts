// src/services/chatLogic.ts
import { v4 as uuidv4 } from 'uuid';
import type { Character, ChatData, ChatMessage, StopPattern } from './types';
import { detectName } from './nameDetection';

export function getCharacterPromptId(character: Character, participants: Character[]): string {
    const index = participants.findIndex(p => p.id === character.id);
    return index !== -1 ? `Character ${index + 1}` : 'Unknown';
}

export function getFatigueInstruction(currentChatStamina: number, maximumChatStamina: number): string {
    if (maximumChatStamina === Number.POSITIVE_INFINITY) return "";
    const ratio = currentChatStamina / maximumChatStamina;
    if (ratio > 0.7) return "";
    if (ratio > 0.4) return "[System Note: You are starting to feel slightly winded. Keep your responses concise and focused. Don't ramble.]";
    if (ratio > 0.1) return "[System Note: You are quite exhausted. Your speech should be halting, brief, or you might suggest someone else take over. Avoid long monologues.]";
    return "[System Note: You are completely drained. You barely have the energy to speak. If you must reply, make it a whisper, a grunt, or defer entirely to another character. Do not initiate new topics.]";
}

export function findPreviousChatMessage(chatData: ChatData, characterId: string): ChatMessage | null {
    const chatMessageHistory = chatData.chatMessageHistory;
    for (let i = chatMessageHistory.length - 1; i >= 0; i--) {
        if (chatMessageHistory[i].character.id === characterId) return chatMessageHistory[i];
    }
    return null;
}

export function buildPromptFromHistory(chatData: ChatData, character: Character): string {
    const lines: string[] = [];
    const name = character.name;
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const charId = getCharacterPromptId(character, chatData.participants);

    if (chatData.instructions?.length) {
        lines.push(chatData.instructions.map(i => `[Instruction: ${i.content}]`).join('\n'));
    }
    if (character.systemPrompt) lines.push(`[${name} System Prompt: ${character.systemPrompt}]`);
    if (character.description) lines.push(`[${name} Description: ${character.description}]`);

    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const currentChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;

    lines.push(`[Continue the conversation as ${charId} / ${name}. Stay in character at all costs and at all times. Keep your name hidden unless explicitly revealed. Your response must be in character and adhere strictly to all formatting rules. Continue the conversation now.]`);
    
    if (currentChatStamina !== undefined && maximumChatStamina !== Number.POSITIVE_INFINITY) {
        const fatigue = getFatigueInstruction(currentChatStamina, maximumChatStamina);
        if (fatigue) lines.push(fatigue);
    }

    const mappings = chatData.participants.map(p => {
        const id = getCharacterPromptId(p, chatData.participants);
        const isCurrent = id === charId;
        const isRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
        const displayName = isRevealed || isCurrent ? p.name : '[name unknown]';
        return `${id} = ${displayName}`;
    }).join('; ');
    
    lines.push(`[Identity Map: ${mappings}]`);

    for (const message of chatData.chatMessageHistory) {
        const pid = getCharacterPromptId(message.character, chatData.participants);
        lines.push(`${pid}: ${message.textContent}`);
    }
    lines.push(`${charId}:`);
    return lines.join('\n');
}

export function convertIdsToDisplayNames(text: string, chatData: ChatData): string {
    let result = text;
    chatData.participants.forEach((p, i) => {
        const id = `Character ${i + 1}`;
        const isRevealed = chatData.chatMessageHistory.some(m => m.character.id === p.id && m.isNameRevealed);
        if (isRevealed) {
        result = result.replace(new RegExp(`\\b${id}\\b`, 'g'), p.name);
        }
    });
    return result;
}

export function createChatMessage(chatData: ChatData, character: Character, textContent: string): ChatMessage {
    const previousMessage = findPreviousChatMessage(chatData, character.id);
    const wasRevealed = previousMessage?.isNameRevealed ?? false;
    const isRevealed = wasRevealed || detectName(chatData.chatMessageHistory, character.id, character.name, textContent);
    const maximumChatStamina = character.maximumChatStamina ?? Number.POSITIVE_INFINITY;
    const remainingChatStamina = previousMessage?.remainingChatStamina ?? maximumChatStamina;
    const lastMessageId = chatData.chatMessageHistory.length > 0 ? chatData.chatMessageHistory[chatData.chatMessageHistory.length - 1].id : null;

    return {
        id: uuidv4(),
        character: { ...character },
        textContent,
        remainingChatStamina: remainingChatStamina,
        isNameRevealed: isRevealed,
        timestamp: Date.now(),
        parentChatMessageId: lastMessageId,
    };
}

export function prepareRequestBody(chatData: ChatData, character: Character, imageBase64?: string | null): any {
    const sampler = character.sampler;
    const participants = chatData.participants;
    
    // 1. Calculate dynamic roleplay stops.
    const roleplayStops = participants.flatMap(p => {
        const id = getCharacterPromptId(p, participants);
        return [`\n${id}:`, `\n${p.name}:`];
    });

    // 2. Get custom stops from parameters (if any exist there).
    // We extract 'stop' from parameters so we don't lose user-defined custom stops.
    const { stop: paramStops, ...otherParams } = sampler?.parameters || {};
    
    // 3. Merge them safely.
    // Priority: Roleplay Stops (essential) + Custom Param Stops (optional).
    const finalStops = [
        '<|end_of_turn|>',
        '<|start_of_turn|>',
        ...roleplayStops,
        ...(Array.isArray(paramStops) ? paramStops : []), // Add any extra stops from params
        ...(sampler?.stopPatterns?.map((sp: StopPattern) => sp.pattern) ?? []),
    ];

    // Remove duplicates just in case
    const uniqueStops = Array.from(new Set(finalStops));

    // 4. Construct Body
    const body: any = {
        // Spread the CLEANED parameters (without 'stop')
        ...otherParams, 
        prompt: buildPromptFromHistory(chatData, character),
        n_predict: sampler?.maximumNumberOfTokens ?? 512,
        stream: true,
        stop: uniqueStops,
    };

    if (imageBase64) {
        body.image_data = [{ data: imageBase64, id: 12 }];
    }
    return body;
}

export function addMessageToChatData(chatData: ChatData, newChatMessage: ChatMessage): ChatData {
  return {
    ...chatData,
    chatMessageHistory: [...chatData.chatMessageHistory, newChatMessage],
    last_updated_timestamp: Date.now(),
  };
}

export function editChatMessageInChatData(chatData: ChatData, messageId: string, newText: string): ChatData {
    const { chatMessageHistory } = chatData;
    const index = chatMessageHistory.findIndex(m => m.id === messageId);
    if (index === -1) return chatData;
    return {
        ...chatData,
        chatMessageHistory: chatMessageHistory.map((message, idx) => {
            if (idx === index) return { ...message, textContent: newText, kvCachePath: undefined };
            if (idx > index) return { ...message, kvCachePath: undefined };
            return message;
        })
    };
}

export function deleteChatMessage(chatData: ChatData, messageId: string): { newHistory: ChatMessage[], invalidatedIds: string[] } {
    const chatMessageHistory = chatData.chatMessageHistory;
    const targetIndex = chatMessageHistory.findIndex(m => m.id === messageId);
    if (targetIndex === -1) return { newHistory: chatMessageHistory, invalidatedIds: [] };

    const newHistory = chatMessageHistory.filter(m => m.id !== messageId);
    const finalHistory = newHistory.map((message, idx) => {
        if (idx >= targetIndex) return { ...message, kvCachePath: undefined };
        return message;
    });

    return { newHistory: finalHistory, invalidatedIds: [messageId] };
}

export function branchChatMessage(chatData: ChatData, branchPointMessageId: string): ChatData {
    const branchIndex = chatData.chatMessageHistory.findIndex(m => m.id === branchPointMessageId);
    if (branchIndex === -1) throw new Error('Branch point message not found');

    const currentTimestamp = Date.now();
    return {
        id: uuidv4(),
        title: `${chatData.title} [#${branchIndex + 1}]`,
        protagonist: chatData.protagonist,
        participants: chatData.participants,
        chatMessageHistory: chatData.chatMessageHistory.slice(0, branchIndex + 1),
        first_created_timestamp: currentTimestamp,
        last_updated_timestamp: currentTimestamp,
    };
}