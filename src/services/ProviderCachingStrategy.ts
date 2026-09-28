// src/services/ProviderCachingStrategy.ts
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

export interface ProviderCachingStrategy {
    supports(backendName: backend): boolean;
    apply(context: CacheContext): CacheStrategyResult;
}

// ─── Strategies ─────────────────────────────────────────────────────

class SessionAffinityStrategy implements ProviderCachingStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['OpenRouter', 'Minimax', 'GLM']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (!ctx.sessionId) return {};
        return { bodyPatch: { session_id: ctx.sessionId } };
    }
}

class AnthropicExplicitCacheStrategy implements ProviderCachingStrategy {
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
class QwenExplicitCacheStrategy implements ProviderCachingStrategy {
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
 * Google Single-System Message Strategy
 * 
 * Google AI Platform's OpenAI-compatible API only respects the LAST system
 * message and silently discards all previous ones. This strategy keeps the
 * first system message as role:"system" and converts all subsequent system
 * messages to role:"user" so they are preserved in context without being dropped.
 * 
 * Content is passed raw/as-is without wrapping or prefix markers.
 */
class GoogleSingleSystemStrategy implements ProviderCachingStrategy {
    supports(b: backend): boolean {
        return b === 'Google';
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        let foundFirstSystem = false;
        const patched = ctx.messages.map((msg) => {
            if (msg.role === 'system') {
                if (!foundFirstSystem) {
                    foundFirstSystem = true;
                    return msg;
                }
                return { ...msg, role: 'user' };
            }
            return msg;
        });

        return { messages: patched };
    }
}

class ImplicitCacheStrategy implements ProviderCachingStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['DeepSeek', 'Kimi']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(): CacheStrategyResult {
        return {};
    }
}

class NoCacheStrategy implements ProviderCachingStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['Cohere', 'AI21', 'NovelAI']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(): CacheStrategyResult {
        return {};
    }
}

// ─── Factory ────────────────────────────────────────────────────────

const strategies: readonly ProviderCachingStrategy[] = [
    new AnthropicExplicitCacheStrategy(),
    new QwenExplicitCacheStrategy(),
    new GoogleSingleSystemStrategy(),
    new SessionAffinityStrategy(),
    new ImplicitCacheStrategy(),
    new NoCacheStrategy(),
] as const;

/** Default strategy for unknown/future backends that may support implicit caching */
const defaultStrategy: ProviderCachingStrategy = new ImplicitCacheStrategy();

export function getCachingStrategy(backendName: backend): ProviderCachingStrategy {
    return strategies.find(s => s.supports(backendName)) ?? defaultStrategy;
}