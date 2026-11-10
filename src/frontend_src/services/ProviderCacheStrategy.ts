// src/frontend_src/services/ProviderCacheStrategy.ts
import type { backend } from "../types";

// ─── Types ──────────────────────────────────────────────────────────

export interface OpenAIMessage {
    role: string;
    content: string | unknown[];
    cache_control?: { type: string };
}

export interface CacheContext {
    backendName: backend;
    modelPath?: string;
    sessionId?: string;
    messages: OpenAIMessage[];
}

export interface CacheStrategyResult {
    headers?: Record<string, string>;
    bodyPatch?: Record<string, unknown>;
    messages?: OpenAIMessage[];
}

export interface ProviderCacheStrategy {
    supports(backendName: backend): boolean;
    apply(context: CacheContext): CacheStrategyResult;
}

// ─── Strategies ─────────────────────────────────────────────────────

class SessionAffinityStrategy implements ProviderCacheStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['OpenRouter', 'Minimax', 'GLM']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (!ctx.sessionId) return {};
        return { bodyPatch: { session_id: ctx.sessionId } };
    }
}

class AnthropicExplicitCacheStrategy implements ProviderCacheStrategy {
    supports(b: backend): boolean {
        return b === 'Anthropic';
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        const patched = ctx.messages.map((msg, i) => {
            if (msg.role === 'system' || (msg.role === 'user' && i <= 1)) {
                return { ...msg, cache_control: { type: 'ephemeral' } };
            }
            return msg;
        });
        return {
            headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
            messages: patched,
        };
    }
}

/**
 * Qwen Explicit Cache Strategy
 * 
 * Qwen/DashScope explicit cache uses cache_control markers on individual
 * content blocks within the messages array. Content must be wrapped as
 * [{type:"text", text:..., cache_control:{type:"ephemeral"}}] for the
 * marker to take effect. Up to 4 markers per request; backward lookback
 * limited to 20 content blocks from each marker. Cache TTL is 5 minutes,
 * reset on hit. Creation billed at 125% of input price; hits at 10%.
 * 
 * Markers are placed on:
 *   - First system message (static prompt prefix)
 *   - Last assistant/user message before generation trigger (conversation history boundary)
 */
class QwenExplicitCacheStrategy implements ProviderCacheStrategy {
    supports(b: backend): boolean {
        return b === 'Qwen';
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        const patched = ctx.messages.map((msg, i) => {
            // Marker 1: First system message (static prompt prefix)
            if (msg.role === 'system' && i === 0) {
                return wrapContentWithCacheControl(msg);
            }

            // Marker 2: Last non-trigger message before the final assistant generation trigger
            // This caches the conversation history boundary so multi-turn prefixes are reused
            if (i === ctx.messages.length - 2 && msg.role !== 'assistant') {
                return wrapContentWithCacheControl(msg);
            }

            return msg;
        });

        return { messages: patched };
    }
}

/**
 * Wraps a message's string content into the array format required by
 * Qwen's explicit cache API: [{type:"text", text:..., cache_control:{type:"ephemeral"}}]
 * If content is already an array (e.g., multimodal), attaches cache_control
 * to the first text block.
 */
function wrapContentWithCacheControl(msg: OpenAIMessage): OpenAIMessage {
    if (typeof msg.content === 'string') {
        return {
            ...msg,
            content: [
                {
                    type: 'text',
                    text: msg.content,
                    cache_control: { type: 'ephemeral' },
                },
            ],
        };
    }

    // Content is already an array (multimodal or previously wrapped)
    if (Array.isArray(msg.content)) {
        const wrapped = [...msg.content];
        // Attach cache_control to the first text block
        for (let i = 0; i < wrapped.length; i++) {
            const block = wrapped[i] as Record<string, unknown>;
            if (block && block.type === 'text') {
                wrapped[i] = { ...block, cache_control: { type: 'ephemeral' } };
                break;
            }
        }
        return { ...msg, content: wrapped };
    }

    return msg;
}

/**
 * Single-System Message Strategy
 * 
 * Certain providers' OpenAI-compatible APIs (like Google) are extremely strict:
 * 1. They silently discard or error on prior system messages.
 * 2. They require strictly alternating roles (User -> Assistant).
 * 3. They reject requests where the final message is an 'assistant' turn (prefill).
 * 
 * This strategy:
 * - Converts all `system` roles to `user`.
 * - Merges consecutive messages of the same role into a single message.
 * - Employs a "Dummy User" trick for trailing assistant messages to satisfy API validation.
 */
class SingleSystemStrategy implements ProviderCacheStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['Google', 'Cohere']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        const patched: OpenAIMessage[] = [];

        // 1. Convert system to user & merge consecutive identical roles
        for (const msg of ctx.messages) {
            const role = msg.role === 'system' ? 'user' : msg.role;
            
            if (patched.length > 0 && patched[patched.length - 1].role === role) {
                const prev = patched[patched.length - 1];
                
                if (typeof prev.content === 'string' && typeof msg.content === 'string') {
                    prev.content = `${prev.content}\n\n${msg.content}`;
                } else if (Array.isArray(prev.content) && Array.isArray(msg.content)) {
                    prev.content = [...prev.content, ...msg.content];
                } else {
                    const pText = typeof prev.content === 'string' ? prev.content : JSON.stringify(prev.content);
                    const cText = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                    prev.content = `${pText}\n\n${cText}`;
                }
            } else {
                // Deep copy to prevent mutating the original reference
                patched.push({ ...msg, role });
            }
        }

        // 2. The "Dummy User" trick for strict APIs (Google Gemini)
        if (ctx.backendName === 'Google' && patched.length > 0) {
            const lastMsg = patched[patched.length - 1];
            if (lastMsg.role === 'assistant') {
                // Append a harmless dummy user message to satisfy the strict "must end with user turn" rule without corrupting the assistant's previous tool execution state.
                patched.push({role: 'user', content: 'Complete.'});
            }
        }

        return { messages: patched };
    }
}

class ImplicitCacheStrategy implements ProviderCacheStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['DeepSeek', 'Kimi']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(): CacheStrategyResult {
        return {};
    }
}

class NoCacheStrategy implements ProviderCacheStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['AI21', 'NovelAI']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(): CacheStrategyResult {
        return {};
    }
}

// ─── Factory ────────────────────────────────────────────────────────

const strategies: readonly ProviderCacheStrategy[] = [
    new AnthropicExplicitCacheStrategy(),
    new QwenExplicitCacheStrategy(),
    new SingleSystemStrategy(),
    new SessionAffinityStrategy(),
    new ImplicitCacheStrategy(),
    new NoCacheStrategy(),
] as const;

/** Default strategy for unknown/future backends that may support implicit caching */
const defaultStrategy: ProviderCacheStrategy = new ImplicitCacheStrategy();

export function getCachingStrategy(backendName: backend): ProviderCacheStrategy {
    return strategies.find(s => s.supports(backendName)) ?? defaultStrategy;
}