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
}

/**
 * Comprehensive collection of chat and instruction templates for open-weight LLMs.
 * Sources: HuggingFace tokenizer configs, jndiogo/LLM-chat-templates, mbrenndoerfer.com
 *
 * Chat-Instruct mode is composed at runtime from instructionTemplate + chatTemplate.
 * No separate chatInstructionTemplate field needed.
 */
export const MODEL_TEMPLATES: ModelTemplate[] = [
    // ─── ChatML (OpenAI-style) ──────────────────────────────────────
    {
        key: 'chatml',
        label: 'ChatML',
        instructionTemplate: '### Instruction:\n{instruction}\n\n### Response:\n',
        chatTemplate: '<|im_start|>{role}\n{content}<|im_end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['Qwen', 'Qwen2', 'Qwen2.5', 'Hermes-2', 'Dolphin', 'Orca2', 'Yi', 'StableLM-2', 'Rocket', 'NousHermes'],
        stopPatterns: ['<|im_end|>'],
    },

    // ─── Llama 3.x ──────────────────────────────────────────────────
    {
        key: 'llama3',
        label: 'Llama 3 / 3.1 / 3.2 / 3.3',
        instructionTemplate: '<|start_header_id|>user<|end_header_id|>\n\n{instruction}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n',
        chatTemplate: '<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>',
        supportsSystemRole: true,
        modelFamilies: ['Llama-3', 'Llama-3.1', 'Llama-3.2', 'Llama-3.3', 'Llama-3-Vision'],
        stopPatterns: ['<|eot_id|>'],
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

    // ─── Mistral / Mixtral ──────────────────────────────────────────
    {
        key: 'mistral',
        label: 'Mistral / Mixtral Instruct',
        instructionTemplate: '[INST] {instruction} [/INST]',
        chatTemplate: '[INST] {content} [/INST]',
        supportsSystemRole: false,
        modelFamilies: ['Mistral', 'Mixtral', 'Mistral-Nemo'],
        stopPatterns: ['[/INST]'],
    },

    // ─── Gemma ──────────────────────────────────────────────────────
    {
        key: 'gemma',
        label: 'Gemma / Gemma 2 / Gemma 3',
        instructionTemplate: '<start_of_turn>user\n{instruction}<end_of_turn>\n<start_of_turn>model\n',
        chatTemplate: '<start_of_turn>{role}\n{content}<end_of_turn>\n',
        supportsSystemRole: false,
        modelFamilies: ['Gemma', 'Gemma-2', 'Gemma-3'],
        stopPatterns: ['<end_of_turn>'],
    },

    // ─── Phi-3 / Phi-3.5 ───────────────────────────────────────────
    {
        key: 'phi3',
        label: 'Phi-3 / Phi-3.5',
        instructionTemplate: '<|user|>\n{instruction}<|end|>\n<|assistant|>\n',
        chatTemplate: '<|{role}|>\n{content}<|end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['Phi-3', 'Phi-3.5'],
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

    // ─── DeepSeek V2 / V3 ──────────────────────────────────────────
    {
        key: 'deepseek',
        label: 'DeepSeek V2 / V3',
        instructionTemplate: '<|user|>{instruction}<|end|>\n<|assistant|>',
        chatTemplate: '<|{role}|>{content}<|end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['DeepSeek-V2', 'DeepSeek-V3', 'DeepSeek-Coder'],
        stopPatterns: ['<|end|>'],
    },

    // ─── Command-R / Command-R+ ─────────────────────────────────────
    {
        key: 'command-r',
        label: 'Command-R / Command-R+',
        instructionTemplate: '<|START_OF_TURN_TOKEN|><|USER_TOKEN|>{instruction}<|END_OF_TURN_TOKEN|><|START_OF_TURN_TOKEN|><|CHATBOT_TOKEN|>',
        chatTemplate: '<|START_OF_TURN_TOKEN|><|{role}_TOKEN|>{content}<|END_OF_TURN_TOKEN|>',
        supportsSystemRole: true,
        modelFamilies: ['Command-R', 'Command-R-Plus', 'Aya'],
        stopPatterns: ['<|END_OF_TURN_TOKEN|>'],
    },

    // ─── Zephyr ─────────────────────────────────────────────────────
    {
        key: 'zephyr',
        label: 'Zephyr',
        instructionTemplate: '<|user|>\n{instruction}</s>\n<|assistant|>\n',
        chatTemplate: '<|{role}|>\n{content}</s>\n',
        supportsSystemRole: true,
        modelFamilies: ['Zephyr', 'Zephyr-Gemma'],
        stopPatterns: ['</s>'],
    },

    // ─── OpenChat 3.5 ──────────────────────────────────────────────
    {
        key: 'openchat35',
        label: 'OpenChat 3.5 / Starling',
        instructionTemplate: 'GPT4 Correct User: {instruction}<|end_of_turn|>GPT4 Correct Assistant:',
        chatTemplate: 'GPT4 Correct {Role}: {content}<|end_of_turn|>',
        supportsSystemRole: false,
        modelFamilies: ['OpenChat-3.5', 'Starling-LM'],
        stopPatterns: ['<|end_of_turn|>'],
    },

    // ─── OpenChat 3.6 ──────────────────────────────────────────────
    {
        key: 'openchat36',
        label: 'OpenChat 3.6',
        instructionTemplate: '<|start_header_id|>GPT4 Correct User<|end_header_id|>\n\n{instruction}<|eot_id|><|start_header_id|>GPT4 Correct Assistant<|end_header_id|>\n\n',
        chatTemplate: '<|start_header_id|>GPT4 Correct {Role}<|end_header_id|>\n\n{content}<|eot_id|>',
        supportsSystemRole: true,
        modelFamilies: ['OpenChat-3.6'],
        stopPatterns: ['<|eot_id|>'],
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

    // ─── Vicuna v1.1 ───────────────────────────────────────────────
    {
        key: 'vicuna',
        label: 'Vicuna v1.1 / Wizard-Vicuna',
        instructionTemplate: 'USER: {instruction}\nASSISTANT:',
        chatTemplate: '{ROLE}: {content}\n',
        supportsSystemRole: false,
        modelFamilies: ['Vicuna', 'Wizard-Vicuna'],
        stopPatterns: ['USER:'],
    },

    // ─── Falcon ─────────────────────────────────────────────────────
    {
        key: 'falcon',
        label: 'Falcon Instruct',
        instructionTemplate: 'User: {instruction}\nAssistant:',
        chatTemplate: '{Role}: {content}',
        supportsSystemRole: false,
        modelFamilies: ['Falcon', 'Falcon-Instruct'],
        stopPatterns: ['User:'],
    },

    // ─── AmberChat ──────────────────────────────────────────────────
    {
        key: 'amberchat',
        label: 'AmberChat',
        instructionTemplate: '### Human: {instruction}\n### Assistant:',
        chatTemplate: '### {Role}: {content}\n',
        supportsSystemRole: false,
        modelFamilies: ['AmberChat'],
        stopPatterns: ['### Human:'],
    },

    // ─── Qwen (legacy, pre-ChatML) ─────────────────────────────────
    {
        key: 'qwen-legacy',
        label: 'Qwen Legacy (Pre-ChatML)',
        instructionTemplate: '<|im_start|>user\n{instruction}<|im_end|>\n<|im_start|>assistant\n',
        chatTemplate: '<|im_start|>{role}\n{content}<|im_end|>\n',
        supportsSystemRole: true,
        modelFamilies: ['Qwen-1', 'Qwen-1.5'],
        stopPatterns: ['<|im_end|>'],
    },
];

/** Lookup helper: get template by key */
export function getModelTemplate(key: string): ModelTemplate | undefined {
    return MODEL_TEMPLATES.find(t => t.key === key);
}

/**
 * Auto-detect the best matching template for a given model name/path.
 * Matches against modelFamilies using case-insensitive substring search.
 * Returns the template key, or empty string if no match found.
 */
export function autoDetectTemplate(modelNameOrPath: string): string {
    if (!modelNameOrPath || !modelNameOrPath.trim()) return '';

    const normalized = modelNameOrPath.toLowerCase();

    // Check each template's model families — first match wins
    // Templates are ordered by specificity (newer/more specific first)
    for (const template of MODEL_TEMPLATES) {
        for (const family of template.modelFamilies) {
            if (normalized.includes(family.toLowerCase())) {
                return template.key;
            }
        }
    }

    return '';
}

/** Get dropdown options for instruction template selector. Includes Auto as first option. */
export function getInstructionTemplateOptions(): { value: string; label: string }[] {
    return [
        { value: '', label: 'None' },
        { value: 'auto', label: 'Auto (detect from model name)' },
        ...MODEL_TEMPLATES
            .filter(t => t.instructionTemplate)
            .map(t => ({ value: t.key, label: t.label })),
    ];
}

/** Get dropdown options for chat template selector. Includes Auto as first option. */
export function getChatTemplateOptions(): { value: string; label: string }[] {
    return [
        { value: '', label: 'None' },
        { value: 'auto', label: 'Auto (detect from model name)' },
        ...MODEL_TEMPLATES
            .filter(t => t.chatTemplate)
            .map(t => ({ value: t.key, label: t.label })),
    ];
}