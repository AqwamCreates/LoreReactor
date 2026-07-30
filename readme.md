# Lore Reactor

Author: Aqwam Harish Aiman

## Things To Keep In Mind

### Storage Requirements

Unlike other LLM WebUIs where they only produce KV cache when needed, Lore Reactor will save KV cache for every single messages for fast resume. As a result, it could eat up your local storage quickly. We recommend you to actually do symbolic link for kv-cache folder for this project to your external storage.

### Concurrent Slot Limits

Each open chat window occupies one llama.cpp context slot in GPU VRAM. At <10B Q4 with 4K context, expect ~300–500MB VRAM per slot. If you run out of VRAM, close unused branch windows or reduce ```--parallel N``` in your server config.

## Features

### Context-Related

* The character's profile images inject speaker-conditionally on first chat, with embeddings cached per-character for instant reuse.

* Per-message KV cache persistence: Every message saves its own KV cache snapshot. Resuming any chat or branch loads instantly (<150ms) without re-processing context. Editing a message destroys forward caches while preserving narrative state (name/appearance reveals are never reset).

* Internal ID prompt safety: All characters are referenced as Character N internally in prompts, with display names converted back post-generation. This prevents attribution collapse with unrevealed characters, similar names, or multi-character conversations. An identity map in the system block teaches the model real names progressively.

### Character-Related

* Per-character sampler profiles (dictionary format) override generation parameters independently.

* Each character has independent ```initiativeWeight``` (determines speaking order when multiple characters respond) and ```chatProbability```(independent chance of responding per turn). These are orthogonal axes — a shy-but-quick character behaves differently from a boisterous-but-deferential one.

### Sampler-Related

* Multiple samplers can use the same stop pattern configuration.

### Immersion-Related

* Branch-to-new-window with position labeling: Branching clones conversation history into an independent session labeled by message position (e.g., [#47]). Original chat remains untouched. Multiple branches can be open simultaneously with independent KV cache slots.

* Appearance-only visual grounding: Character appearance is conveyed exclusively through injected profile images on first speech, so zero text description tokens consumed. The isAppearanceRevealed state flag tracks visual discovery as a narrative event independent of cache validity.

* Character names appear beneath their profile picture starting from the message after they first say their name. This preserves the surprise of reading the revelation in-dialogue before seeing it reflected in the UI.

## Architecture Notes

### Why Per-Message KV Caches?

At ≤10B Q4, individual KV cache files are 50–150MB. Disk I/O is faster than GPU re-prefill for these sizes. Trading trivial storage cost for instant resume eliminates the primary friction point of local roleplay.

### Why Separate initiativeWeight and chatProbability?

"Should this character speak?" and "when should they speak?" are orthogonal personality axes. A shy-but-quick character differs from a boisterous-but-deferential one. Conflating these into a single weight produces unrealistic group dynamics.

### Why Internal IDs Instead of Names?

Small models (<10B) have weak attention discrimination between similar names. Uniform positional identifiers eliminate attribution failures entirely. The identity map provides progressive name learning without sacrificing prompt safety.

### Why Image-Only Appearance?

Text descriptions consume tokens permanently and risk contradicting the visual. Speaker-conditional image injection with embedding caching gives the model visual grounding at first speech with zero ongoing token cost. Subsequent turns load cached embeddings in <10ms.