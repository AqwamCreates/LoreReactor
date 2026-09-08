//src/typeGuard.ts

import type { InteractionMessage, ChatMessage } from "../types";

export function isChatMessage(msg: InteractionMessage | ChatMessage): msg is ChatMessage {
    return 'textContent' in msg && typeof (msg as ChatMessage).textContent === 'string';
}