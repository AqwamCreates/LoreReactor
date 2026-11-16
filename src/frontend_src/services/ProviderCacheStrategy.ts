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
    apiKey?: string;
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

// ─── Content Helpers ────────────────────────────────────────────────

function toContentParts(content: string | unknown[]): unknown[] {
    if (Array.isArray(content)) {
        return content;
    }
    if (typeof content === 'string') {
        return content.length > 0 ? [{ type: 'text', text: content }] : [];
    }
    return content != null ? [{ type: 'text', text: String(content) }] : [];
}

function mergeContents(prevContent: string | unknown[], nextContent: string | unknown[]): string | unknown[] {
    if (typeof prevContent === 'string' && typeof nextContent === 'string') {
        return prevContent ? `${prevContent}\n\n${nextContent}` : nextContent;
    }

    const prevParts = toContentParts(prevContent);
    const nextParts = toContentParts(nextContent);

    if (prevParts.length === 0) return nextParts;
    if (nextParts.length === 0) return prevParts;

    const combined = [...prevParts];
    const lastPrev = combined[combined.length - 1] as Record<string, unknown> | undefined;
    const firstNext = nextParts[0] as Record<string, unknown> | undefined;

    if (
        lastPrev && typeof lastPrev === 'object' && lastPrev.type === 'text' && typeof lastPrev.text === 'string' &&
        firstNext && typeof firstNext === 'object' && firstNext.type === 'text' && typeof firstNext.text === 'string'
    ) {
        combined[combined.length - 1] = {
            ...lastPrev,
            text: `${lastPrev.text}\n\n${firstNext.text}`,
        };
        combined.push(...nextParts.slice(1));
    } else {
        combined.push(...nextParts);
    }

    return combined;
}

function toAnthropicContentBlock(part: unknown): Record<string, unknown> {
    if (typeof part === 'string') {
        return { type: 'text', text: part };
    }
    if (!part || typeof part !== 'object') {
        return { type: 'text', text: String(part ?? '') };
    }
    const p = part as Record<string, unknown>;

    // Convert OpenAI-style { type: 'image_url', image_url: { url } } to Anthropic source format
    if (p.type === 'image_url' && p.image_url && typeof p.image_url === 'object') {
        const imgObj = p.image_url as Record<string, unknown>;
        const rawUrl = String(imgObj.url || '');

        if (rawUrl.startsWith('data:')) {
            const semicolonIdx = rawUrl.indexOf(';');
            const commaIdx = rawUrl.indexOf(',');
            const mediaType = semicolonIdx !== -1 ? rawUrl.slice(5, semicolonIdx) : 'image/jpeg';
            const base64Data = commaIdx !== -1 ? rawUrl.slice(commaIdx + 1) : '';

            return {
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64Data,
                },
            };
        }

        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
            return {
                type: 'image',
                source: {
                    type: 'url',
                    url: rawUrl,
                },
            };
        }
    }

    if (p.type === 'image' || p.type === 'text') {
        return { ...p };
    }

    return { type: 'text', text: JSON.stringify(p) };
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

/**
 * Anthropic Explicit Cache Strategy
 * 
 * Anthropic /v1/messages API requirements:
 * 1. System instructions must be passed via the top-level "system" parameter, not inside "messages" [1].
 * 2. Messages roles must alternate between "user" and "assistant" [3].
 * 3. Images use { type: "image", source: { type: "base64", media_type, data } } instead of image_url [2].
 * 4. Cache breakpoints are placed on content blocks:
 *      - Last block of the system prompt [4]
 *      - Last block of the final user message (conversation history boundary) [4]
 * 5. Requires headers: anthropic-beta, anthropic-version, and direct browser access headers [5].
 */
class AnthropicExplicitCacheStrategy implements ProviderCacheStrategy {
    supports(b: backend): boolean {
        return b === 'Anthropic';
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        // 1. Separate system messages from chat turns
        const systemBlocks: Record<string, unknown>[] = [];
        const nonSystemMessages: OpenAIMessage[] = [];

        for (const msg of ctx.messages) {
            if (msg.role === 'system') {
                const parts = toContentParts(msg.content);
                for (const part of parts) {
                    systemBlocks.push(toAnthropicContentBlock(part));
                }
            } else {
                nonSystemMessages.push(msg);
            }
        }

        // Attach cache_control to the final system prompt block
        if (systemBlocks.length > 0) {
            systemBlocks[systemBlocks.length - 1] = {
                ...systemBlocks[systemBlocks.length - 1],
                cache_control: { type: 'ephemeral' },
            };
        }

        // 2. Ensure alternating user/assistant turns and convert content blocks
        const alternatingMessages: OpenAIMessage[] = [];

        for (const msg of nonSystemMessages) {
            const role = msg.role === 'assistant' ? 'assistant' : 'user';
            const rawParts = toContentParts(msg.content);
            const anthropicParts = rawParts.map(toAnthropicContentBlock);

            if (alternatingMessages.length > 0 && alternatingMessages[alternatingMessages.length - 1].role === role) {
                const prev = alternatingMessages[alternatingMessages.length - 1];
                prev.content = [...toContentParts(prev.content), ...anthropicParts];
            } else {
                alternatingMessages.push({
                    role,
                    content: anthropicParts,
                });
            }
        }

        // Ensure the conversation begins with a user turn
        if (alternatingMessages.length === 0 || alternatingMessages[0].role !== 'user') {
            alternatingMessages.unshift({
                role: 'user',
                content: [{ type: 'text', text: 'Begin.' }],
            });
        }

        // 3. Attach cache_control to the last content block of the final user message
        for (let i = alternatingMessages.length - 1; i >= 0; i--) {
            if (alternatingMessages[i].role === 'user') {
                const parts = [...toContentParts(alternatingMessages[i].content)] as Record<string, unknown>[];
                if (parts.length > 0) {
                    parts[parts.length - 1] = {
                        ...parts[parts.length - 1],
                        cache_control: { type: 'ephemeral' },
                    };
                    alternatingMessages[i].content = parts;
                }
                break;
            }
        }

        const bodyPatch: Record<string, unknown> = {};
        if (systemBlocks.length > 0) {
            bodyPatch.system = systemBlocks;
        }

        const headers: Record<string, string> = {
            'anthropic-beta': 'prompt-caching-2024-07-31',
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
        };
        if (ctx.apiKey) {
            headers['x-api-key'] = ctx.apiKey;
        }

        return {
            headers,
            bodyPatch,
            messages: alternatingMessages,
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
 *   - Last message before generation trigger (conversation history boundary)
 */
class QwenExplicitCacheStrategy implements ProviderCacheStrategy {
    supports(b: backend): boolean {
        return b === 'Qwen';
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        const lastMsg = ctx.messages[ctx.messages.length - 1];
        const targetBoundaryIndex = (lastMsg.role === 'assistant' && ctx.messages.length > 1)
            ? ctx.messages.length - 2
            : ctx.messages.length - 1;

        const patched = ctx.messages.map((msg, i) => {
            // Marker 1: First system message (static prompt prefix)
            if (msg.role === 'system' && i === 0) {
                return wrapContentWithCacheControl(msg);
            }

            // Marker 2: Conversation history boundary before assistant reply
            if (i === targetBoundaryIndex && i > 0) {
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
 * Certain providers' OpenAI-compatible APIs (like Google) are strict regarding turn flow:
 * 1. Merges consecutive messages of the same role into a single message.
 * 2. Preserves multimodal array parts ({type: "image_url"}) without turning them into JSON strings.
 * 3. Converts prior system roles into user turns while preserving all text and vision blocks.
 * 4. Employs a "Dummy User" trick for trailing assistant messages to satisfy API validation.
 */
class SingleSystemStrategy implements ProviderCacheStrategy {
    private readonly backends: ReadonlySet<backend> = new Set(['Google', 'Cohere']);

    supports(b: backend): boolean {
        return this.backends.has(b);
    }

    apply(ctx: CacheContext): CacheStrategyResult {
        if (ctx.messages.length === 0) return {};

        const patched: OpenAIMessage[] = [];

        // 1. Convert system to user & merge consecutive identical roles without destroying arrays
        for (const msg of ctx.messages) {
            const role = msg.role === 'system' ? 'user' : msg.role;
            
            if (patched.length > 0 && patched[patched.length - 1].role === role) {
                const prev = patched[patched.length - 1];
                prev.content = mergeContents(prev.content, msg.content);
            } else {
                patched.push({
                    ...msg,
                    role,
                    content: Array.isArray(msg.content) ? [...msg.content] : msg.content,
                });
            }
        }

        // 2. The "Dummy User" trick for strict APIs (Google Gemini)
        if (ctx.backendName === 'Google' && patched.length > 0) {
            const lastMsg = patched[patched.length - 1];
            if (lastMsg.role === 'assistant') {
                patched.push({ role: 'user', content: 'Resume.' });
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