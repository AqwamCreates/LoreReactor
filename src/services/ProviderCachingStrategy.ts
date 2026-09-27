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

class ImplicitCacheStrategy implements ProviderCachingStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['DeepSeek', 'Google', 'Kimi']);

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
    new SessionAffinityStrategy(),
    new ImplicitCacheStrategy(),
    new NoCacheStrategy(),
] as const;

/** Default strategy for unknown/future backends that may support implicit caching */
const defaultStrategy: ProviderCachingStrategy = new ImplicitCacheStrategy();

export function getCachingStrategy(backendName: backend): ProviderCachingStrategy {
    return strategies.find(s => s.supports(backendName)) ?? defaultStrategy;
}