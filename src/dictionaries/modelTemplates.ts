// src/dictionaries/modelTemplates.ts

export interface ModelTemplate {
    key: string;
    label: string;
    /** Single-turn instruction template. Use {instruction} and optionally {system}, {input} placeholders. */
    instructionTemplate?: string;
    /** Per-message chat template. Use {role} and {content} placeholders. */
    chatTemplate?: string;
    /** Whether this template supports a native system role (vs folding into first user message). */
    supportsSystemRole: boolean;
    /** Model families that use this template. Used for auto-detection only, not shown in UI. */
    modelFamilies: string[];
    /** Model-specific stop tokens/patterns to prevent the model from generating into the next turn or template boundary. */
    stopPatterns?: string[];
    /** The token/string used to start a thinking/reasoning block. */
    thinkStart?: string;
    /** The token/string used to end a thinking/reasoning block. */
    thinkEnd?: string;
}

export const MODEL_TEMPLATES: ModelTemplate[] = [
    // ─── ChatML (OpenAI-style / Qwen / Hermes / Dolphin) ─────────────
    // No native thinking tokens. Qwen3 uses <think>/</think> only in its
    // dedicated reasoning template (see qwen-3.5-3.6 below).
    {
        key: 'chatml',
        label: 'ChatML (Qwen, Hermes, Dolphin)',
        instructionTemplate: '<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n',
        chatTemplate: '<|im_start|>{role}\n{content}<|im_end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['Qwen', 'Qwen2', 'Qwen2.5', 'Hermes-2', 'Hermes-3', 'Dolphin', 'Orca2', 'Yi', 'StableLM-2', 'Rocket', 'NousHermes'],
        stopPatterns: ['<|im_end|>'],
    },

    // ─── Qwen 3.5 / 3.6 (Reasoning toggle) ─────────────────────────
    // Uses <think>/</think>. Reasoning is OFF by default; enable with
    // <|reasoning|> in system/user message, disable with <|no_reasoning|>.
    {
        key: 'qwen-3.5-3.6',
        label: 'Qwen 3.5 / 3.6',
        instructionTemplate: '<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n',
        chatTemplate: '<|im_start|>{role}\n{content}<|im_end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['Qwen3.5', 'Qwen3.6', 'Qwen3', 'Qwen2.5'],
        stopPatterns: ['<|im_end|>'],
        thinkStart: '<think>',
        thinkEnd: '</think>',
    },

    // ─── Llama 3.x / Llama 3.2 Vision / Llama 3.3 ───────────────────
    // Not a reasoning model. No thinking tokens.
    {
        key: 'llama3',
        label: 'Llama 3 / 3.1 / 3.2 / 3.3',
        instructionTemplate: '<|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{instruction}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
        chatTemplate: '<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>',
        supportsSystemRole: true,
        modelFamilies: ['Llama-3', 'Llama-3.1', 'Llama-3.2', 'Llama-3.3'],
        stopPatterns: ['<|eot_id|>', '<|eom_id|>'],
    },

    // ─── Llama 4 (Scout / Maverick) ─────────────────────────────────
    // NOT a reasoning model. No thinking tokens. Token names renamed from Llama 3.
    {
        key: 'llama4',
        label: 'Llama 4 (Scout / Maverick)',
        instructionTemplate: '<|begin_of_text|><|header_start|>system<|header_end|>\n\n{system}<|eot|><|header_start|>user<|header_end|>\n\n{instruction}<|eot|><|header_start|>assistant<|header_end|>\n\n',
        chatTemplate: '<|header_start|>{role}<|header_end|>\n\n{content}<|eot|>',
        supportsSystemRole: true,
        modelFamilies: ['Llama-4', 'Llama-4-Scout', 'Llama-4-Maverick', 'Llama-4.1'],
        stopPatterns: ['<|eot|>'],
    },

    // ─── DeepSeek V4 / V3.1 / R1 (Unicode tokens) ───────────────────
    // Uses <think>/</think>. Reasoning disabled by default; enable via
    // chat_template_kwargs: {thinking: true}. Unicode full-width pipe ｜ (U+FF5C)
    // and separator ▁ (U+2581) are REQUIRED — ASCII | or _ will break parsing.
    {
        key: 'deepseek-v4',
        label: 'DeepSeek V4 / V3.1 (Hybrid Thinking)',
        instructionTemplate: '<｜begin▁of▁sentence｜><｜User｜>{instruction}<｜Assistant｜>',
        chatTemplate: '<｜begin▁of▁sentence｜><｜{role}｜>{content}<｜end▁of▁sentence｜>',
        supportsSystemRole: true,
        modelFamilies: ['DeepSeek-V4', 'DeepSeek-V3.1', 'DeepSeek-R1-0528', 'DeepSeek-V3', 'DeepSeek-R1', 'DeepSeek-V2', 'DeepSeek-Coder'],
        stopPatterns: ['<｜end▁of▁sentence｜>', '<｜User｜>'],
        thinkStart: '<think>',
        thinkEnd: '</think>',
    },

    // ─── DeepSeek V3 / R1 (Legacy ASCII format - kept for compat) ──
    {
        key: 'deepseek-r1-legacy',
        label: 'DeepSeek V3 / R1 (Legacy ASCII)',
        instructionTemplate: '<|begin_of_sentence|><|user|>{instruction}<|assistant|>',
        chatTemplate: '<|{role}|>{content}<|end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['DeepSeek-R1-Legacy', 'DeepSeek-V3-Legacy'],
        stopPatterns: ['<|end|>', '<|eot_id|>'],
        thinkStart: '<think>',
        thinkEnd: '</think>',
    },

    // ─── Gemma / Gemma 2 / Gemma 3 ──────────────────────────────────
    // Not reasoning models. No thinking tokens.
    {
        key: 'gemma',
        label: 'Gemma / Gemma 2 / Gemma 3',
        instructionTemplate: '<start_of_turn>user\n{instruction}<end_of_turn>\n<start_of_turn>model\n',
        chatTemplate: '<start_of_turn>{role}\n{content}<end_of_turn>\n',
        supportsSystemRole: false,
        modelFamilies: ['Gemma', 'Gemma-2', 'Gemma-3', 'CodeGemma', 'Paligemma'],
        stopPatterns: ['<end_of_turn>'],
    },

    // ─── Gemma 4 (Channel-based thinking) ───────────────────────────
    // Thinking uses <|channel>thought ... <channel|>, NOT <think>/</think>.
    // Activated via <|think|> in system prompt.
    {
        key: 'gemma4',
        label: 'Gemma 4',
        instructionTemplate: '<|turn>system\n{system}<turn|><|turn>user\n{instruction}<turn|><|turn>model\n',
        chatTemplate: '<|turn>{role}\n{content}<turn|>',
        supportsSystemRole: true,
        modelFamilies: ['Gemma-4'],
        stopPatterns: ['<turn|>', '<|tool_response>'],
        thinkStart: '<|channel>thought',
        thinkEnd: '<channel|>',
    },

    // ─── Phi-3 / Phi-3.5 ────────────────────────────────────────────
    // Not reasoning models. No thinking tokens.
    {
        key: 'phi3',
        label: 'Phi-3 / Phi-3.5',
        instructionTemplate: '<|im_start|>system<|im_sep|>{system}<|im_end|><|im_start|>user<|im_sep|>{instruction}<|im_end|><|im_start|>assistant<|im_sep|>',
        chatTemplate: '<|im_start|>{role}<|im_sep|>{content}<|im_end|>',
        supportsSystemRole: true,
        modelFamilies: ['Phi-3', 'Phi-3.5'],
        stopPatterns: ['<|im_end|>'],
    },

    // ─── Phi-4 (Base, no reasoning) ─────────────────────────────────
    // Not a reasoning model. EOS is <|im_end|>, NOT <|endoftext|>.
    {
        key: 'phi4',
        label: 'Phi-4',
        instructionTemplate: '<|im_start|>system<|im_sep|>{system}<|im_end|><|im_start|>user<|im_sep|>{instruction}<|im_end|><|im_start|>assistant<|im_sep|>',
        chatTemplate: '<|im_start|>{role}<|im_sep|>{content}<|im_end|>',
        supportsSystemRole: true,
        modelFamilies: ['Phi-4'],
        stopPatterns: ['<|im_end|>'],
    },

    // ─── Phi-4 Reasoning / Reasoning-Plus ───────────────────────────
    // Uses <think>/</think>.
    {
        key: 'phi4-reasoning',
        label: 'Phi-4 Reasoning / Reasoning-Plus',
        instructionTemplate: '<|im_start|>system<|im_sep|>{system}<|im_end|><|im_start|>user<|im_sep|>{instruction}<|im_end|><|im_start|>assistant<|im_sep|>',
        chatTemplate: '<|im_start|>{role}<|im_sep|>{content}<|im_end|>',
        supportsSystemRole: true,
        modelFamilies: ['Phi-4-reasoning', 'Phi-4-reasoning-plus'],
        stopPatterns: ['<|im_end|>'],
        thinkStart: '<think>',
        thinkEnd: '</think>',
    },

    // ─── Phi-4 Mini (Different format from base Phi-4) ──────────────
    // Uses <|system|>/<|end|>, NOT <|im_start|>.
    {
        key: 'phi4-mini',
        label: 'Phi-4 Mini',
        instructionTemplate: '<|system|>{system}<|end|><|user|>{instruction}<|end|><|assistant|>',
        chatTemplate: '<|{role}|>{content}<|end|>',
        supportsSystemRole: true,
        modelFamilies: ['Phi-4-mini'],
        stopPatterns: ['<|end|>'],
    },

    // ─── Phi-2 ──────────────────────────────────────────────────────
    {
        key: 'phi2',
        label: 'Phi-2',
        instructionTemplate: 'Instruct: {instruction}\nOutput:',
        chatTemplate: '{role}: {content}\n',
        supportsSystemRole: false,
        modelFamilies: ['Phi-2'],
        stopPatterns: ['\nInstruct:'],
    },

    // ─── Command-R / Command-R+ / Aya ───────────────────────────────
    {
        key: 'command-r',
        label: 'Command-R / Command-R+ / Aya',
        instructionTemplate: '<|START_OF_TURN_TOKEN|><|SYSTEM_TOKEN|>{system}<|END_OF_TURN_TOKEN|><|START_OF_TURN_TOKEN|><|USER_TOKEN|>{instruction}<|END_OF_TURN_TOKEN|><|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        chatTemplate: '<|START_OF_TURN_TOKEN|><|{role}_TOKEN|>{content}<|END_OF_TURN_TOKEN|>',
        supportsSystemRole: true,
        modelFamilies: ['Command-R', 'Command-R-Plus', 'Aya'],
        stopPatterns: ['<|END_OF_TURN_TOKEN|>'],
    },

    // ─── Zephyr ─────────────────────────────────────────────────────
    {
        key: 'zephyr',
        label: 'Zephyr',
        instructionTemplate: '<|system|>\n{system}</s>\n<|user|>\n{instruction}</s>\n<|assistant|>\n',
        chatTemplate: '<|{role}|>\n{content}</s>\n',
        supportsSystemRole: true,
        modelFamilies: ['Zephyr', 'Zephyr-Gemma'],
        stopPatterns: ['</s>'],
    },

    // ─── OpenChat 3.5 / Starling ────────────────────────────────────
    {
        key: 'openchat35',
        label: 'OpenChat 3.5 / Starling',
        instructionTemplate: 'GPT4 Correct User: {instruction}<|end_of_turn|>GPT4 Correct Assistant:',
        chatTemplate: 'GPT4 Correct {role}: {content}<|end_of_turn|>',
        supportsSystemRole: false,
        modelFamilies: ['OpenChat-3.5', 'Starling-LM'],
        stopPatterns: ['<|end_of_turn|>'],
    },

    // ─── Alpaca ─────────────────────────────────────────────────────
    {
        key: 'alpaca',
        label: 'Alpaca',
        instructionTemplate: '### Instruction:\n{instruction}\n\n### Response:\n',
        supportsSystemRole: false,
        modelFamilies: ['Alpaca', 'WizardLM-Alpaca'],
        stopPatterns: ['### Instruction:', '### Response:'],
    },

    // ─── Vicuna v1.1 / Wizard-Vicuna ────────────────────────────────
    {
        key: 'vicuna',
        label: 'Vicuna v1.1 / Wizard-Vicuna',
        instructionTemplate: 'USER: {instruction}\nASSISTANT:',
        chatTemplate: '{role}: {content}\n',
        supportsSystemRole: false,
        modelFamilies: ['Vicuna', 'Wizard-Vicuna'],
        stopPatterns: ['USER:'],
    },

    // ─── Falcon Instruct ────────────────────────────────────────────
    {
        key: 'falcon',
        label: 'Falcon Instruct',
        instructionTemplate: 'User: {instruction}\nAssistant:',
        chatTemplate: '{role}: {content}',
        supportsSystemRole: false,
        modelFamilies: ['Falcon', 'Falcon-Instruct'],
        stopPatterns: ['User:'],
    },

    // ─── Mistral / Mixtral / Mistral-Nemo ───────────────────────────
    {
        key: 'mistral',
        label: 'Mistral / Mixtral / Mistral-Nemo',
        instructionTemplate: '<s>[INST] {instruction} [/INST]',
        chatTemplate: '[INST] {content} [/INST]',
        supportsSystemRole: false,
        modelFamilies: ['Mistral', 'Mixtral', 'Mistral-Nemo', 'Codestral'],
        stopPatterns: ['[/INST]'],
    },

    // ─── Mistral Magistral / Ministral Reasoning ────────────────────
    // Official 2509 format uses [THINK]/[/THINK] (square brackets).
    // The <think> format is legacy-only and NOT the official instruction format.
    {
        key: 'mistral-reasoning',
        label: 'Mistral Magistral / Ministral Reasoning',
        instructionTemplate: '[INST] {instruction} [/INST]',
        chatTemplate: '[INST] {content} [/INST]',
        supportsSystemRole: false,
        modelFamilies: ['Magistral', 'Ministral-3-Reasoning'],
        stopPatterns: ['[/INST]', '[/THINK]'],
        thinkStart: '[THINK]',
        thinkEnd: '[/THINK]',
    },

    // ─── Llama 2 / CodeLlama ────────────────────────────────────────
    {
        key: 'llama2',
        label: 'Llama 2 / CodeLlama',
        instructionTemplate: '[INST] <<SYS>>\n{system}\n<</SYS>>\n\n{instruction} [/INST]',
        chatTemplate: '[INST] {content} [/INST]',
        supportsSystemRole: false,
        modelFamilies: ['Llama-2', 'CodeLlama'],
        stopPatterns: ['[/INST]'],
    },
];

/** Lookup helper: get template by key */
export function getModelTemplate(key: string): ModelTemplate | undefined {
    return MODEL_TEMPLATES.find(t => t.key === key);
}

/**
 * Auto-detect the best matching template for a given model name/path.
 */
export function autoDetectTemplate(modelNameOrPath: string): string {
    if (!modelNameOrPath || !modelNameOrPath.trim()) return '';
    const normalized = modelNameOrPath.toLowerCase();
    for (const template of MODEL_TEMPLATES) {
        for (const family of template.modelFamilies) {
            if (normalized.includes(family.toLowerCase())) {
                return template.key;
            }
        }
    }
    return '';
}

export function getInstructionTemplateOptions(): { value: string; label: string }[] {
    return [
        { value: '', label: 'None' },
        { value: 'auto', label: 'Auto (detect from model name)' },
        ...MODEL_TEMPLATES.filter(t => t.instructionTemplate).map(t => ({ value: t.key, label: t.label })),
    ];
}

export function getChatTemplateOptions(): { value: string; label: string }[] {
    return [
        { value: '', label: 'None' },
        { value: 'auto', label: 'Auto (detect from model name)' },
        ...MODEL_TEMPLATES.filter(t => t.chatTemplate).map(t => ({ value: t.key, label: t.label })),
    ];
}