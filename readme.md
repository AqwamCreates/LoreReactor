# Lore Reactor

> The familiarity of ChatGPT-style chat. The depth of a SillyTavern UI. The customization of Oogabooga way.

Author: Aqwam Harish Aiman

## Quick Setup

First, you need to run ```git clone AqwamCreates/LoreReactor```.

Then you need to run this code depending on your operating system.

| Operating System | Windows               | Mac / Linux          |
|------------------|-----------------------|----------------------|
| Command          | ```start/start.bat``` | ```start/start.sh``` |

You then can use LoreReactor directly or install the local backends first. The cloud setup have been fully prepared for you.

## Features

### Context-Related

* The character's profile images inject speaker-conditionally on first chat, with embeddings cached per-character for instant reuse.

* Internal ID prompt safety: All characters are referenced as Character N internally in prompts, with display names converted back post-generation. This prevents attribution collapse with unrevealed characters, similar names, or multi-character conversations. An identity map in the system block teaches the model real names progressively.

### Character-Related

* Per-character sampler profiles override generation parameters independently.

* Each character has independent ```maximumChatStamina``` (determines the maximum number of paragraphs per message), ```initiativeWeight``` (determines speaking order when multiple characters respond) and ```chatProbability```(independent chance of responding per turn). These are orthogonal axes — a shy-but-quick character behaves differently from a boisterous-but-deferential one. We also have other bunch of stats as well!

### Chat-Related

* A chat can use multiple instructions that can be triggered using regular expressions. These instructions can also include images as well.

### Sampler-Related

* Multiple samplers can use the same stop pattern configuration.

### Immersion-Related

* Branch-to-new-window with position labeling: Branching clones conversation history into an independent session. Original chat remains untouched.

* Character names appear beneath their profile picture starting from the message after they first say their name. This preserves the surprise of reading the revelation in-dialogue before seeing it reflected in the UI.

## Architecture Notes

### Why Separate initiativeWeight, chatProbability and maximumChatStamina?

"When should they speak?", "should this character speak?", and "can they speak?" are orthogonal personality axes. A shy-but-quick character differs from a boisterous-but-deferential one. Conflating these into a single weight produces unrealistic group dynamics.

### Why IDs Instead Of Names For Internal Prompt Creation?

Small models (≤10B) have weak attention discrimination between similar names. Uniform positional identifiers eliminate attribution failures entirely. The identity map provides progressive name learning without sacrificing prompt safety.
