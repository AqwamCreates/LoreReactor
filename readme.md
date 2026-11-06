# LoreReactor: Let The AIs Control Your World!

Author: Aqwam Harish Aiman

Email: aqwam.harish.aiman@gmail.com

LinkedIn: https://www.linkedin.com/in/aqwam-harish-aiman/
	
YouTube: https://www.youtube.com/channel/UCUrwoxv5dufEmbGsxyEUPZw

## Introduction

LoreReactor is a web UI + standalone app for language model roleplay that has a lot of configurations you can make! 

You can also use it directly with limited functionalities on GitHub Pages [here](aqwamcreates.github.io/LoreReactor).

Created using Typescript, Vite, React, Node.js, Express.js and Tauri.

Licensed under a custom source-available license. Not an open-source one.

## Preview

* [Screenshots](screenshots.md)

## Warning

LoreReactor grants AI characters unprecedented access to your host OS, hardware, and physical environment. Use the Tool Permission section wisely. We are not responsible if your AI waifu / husbando locks you out of your PC.

## Capabilities

| Aspect                                | Standalone App | Web UI        | GitHub Pages  |
|---------------------------------------|----------------|---------------|---------------|
| Desktop Overlay                       | Supported      | Not Supported | Not Supported |
| OS Tools                              | Supported      | Supported     | Not Supported |
| Local Non-WebGPU / Non-WASM Inference | Supported      | Supported     | Not Supported |
| Accessible From Other Devices         | Not Supported  | Supported     | Not Supported | 

## Quick Setup

First, you need to run ```git clone AqwamCreates/LoreReactor```.

Then, you need to run ```cd LoreReactor```.

Then, you need to run ```npm run install``` or ```npm install```.

Finally, you need to run this code depending on your operating system.

| Operating System | Windows               | Mac / Linux          |
|------------------|-----------------------|----------------------|
| Website          | ```start/start.bat``` | ```start/start.sh``` |
| Binaries         | ```start/build.bat``` | ```start/build.sh``` |

You then can use LoreReactor directly or install the local backends first. The cloud setup have been fully prepared for you.

## Features

### Characters

* Each character have their own memories and information based on their own perspectives, so the characters will not know other characters' memories and information.

* Supports per-location group chats.

* Characters can use their own Token Sampler or shared Token Samplers.

* Each character has these character stats:

| Character Stats          | Properties                                                |
|--------------------------|-----------------------------------------------------------|
| ```maximumChatStamina``` | Controls the maximum number of paragraphs per message.    |
| ```initiativeWeight```   | Controls speaking order when multiple characters respond. |
| ```chatProbability```    | Controls the chance of responding per turn.               |

These are orthogonal axes — a shy-but-quick character behaves differently from a boisterous-but-deferential one. We also have other bunch of stats as well!

* Internal ID prompt safety: All characters are referenced as Character N internally in prompts, with display names converted back post-generation. This prevents attribution collapse with unrevealed characters, similar names, or multi-character conversations. An identity map in the system block teaches the model real names progressively.

### Tools

* Over 50 tools that includes OS-level controls and web searches. This includes running shells, controlling your inputs and opening your web browsers.

### Models

* Uses user-defined language models and spatiotemporal models either locally or from the cloud.

* Uses WebGPU / WASM for sentimental analysis, embedding and speech-to-text tasks.

* Use llama-tts.cpp for text-to-speech tasks.

* Helps controlling your costs by using both of your free tiers and premium tiers thorugh budget strategies.

### Chats

* Each chat session can have independent Characters, Contexts, Locations and Audio Tracks.

* A chat session can use multiple instructions that can be triggered using regular expressions and binding to entities like Characters, Contexts and Locations. These instructions can also include images as well.

* Messages can also be filtered based on regular expression and co-located Characters criteria.

* Save the chat session as a template through the World objects for future roleplays.

### Immersion

* Branch-to-new-window with position labeling: Branching clones conversation history into an independent session. Original chat remains untouched.

* Character names appear beneath their profile picture starting from the message after they first say their name. This preserves the surprise of reading the revelation in-dialogue before seeing it reflected in the UI.

* Multiple view modes to match the atmosphere of your roleplay:

	* Ladder mode: Classical text message app style.

	* Cinematic mode: Focused on face-to-face interaction.

 	* Visual Novel mode: See characters' movements and interactions based on the locations.

	* Card mode: Dungeon master style without any profile pictures.

### Quality-Of-Life

* Uses Factorization Machines to determine the best model to choose from based on censorship and user-acceptance criteria.

	* The selected model would be rewarded when the user continues chatting without any interruption.

 	* Otherwise, the selected model would be punished when the user regenerates the message, receives censorship messages or have broken response.

* Uses Naive Bayes to determine how you would like to format your roleplay, making LoreReactor able to predict your desired formatting in a click of a button.

* Uses Markov to cut costs by using the entirety of the characters' own messages as training data to produce character-specific messages without the need for language model inference.

### Data

* Imports all kinds of character cards and convert them into LoreReactor-compatible ones.

* Capable of exporting and importing LoreReactor data including bulk character, context, location, audio track and world selections in JSON format. This means you will be able to share the full world with other people without manually needing to attach individual lore books to each characters.

## Architecture Notes

### Why Separate initiativeWeight, chatProbability and maximumChatStamina?

"When should they speak?", "should this character speak?", and "can they speak?" are orthogonal personality axes. A shy-but-quick character differs from a loud-but-deferential one. Conflating these into a single weight produces unrealistic group dynamics.

### Why IDs Instead Of Names For Internal Prompt Creation?

Small models (≤10B) have weak attention discrimination between similar names. Uniform positional identifiers eliminate attribution failures entirely. The identity map provides progressive name learning without sacrificing prompt safety.

## Image models, coming soon!

## If You Wonder Why This Has Been Discontinued, Have A Look Here

https://github.com/AqwamCreates/DataPredict/blob/main/docs/WhyDidThisLibraryWasCreatedInTheFirstPlace.md
