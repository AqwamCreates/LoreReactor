import type { tool } from "../types";

export const toolLabels: Record<tool, string> = {
    whisper: "Whisper", think: "Think", pick: 'Random Pick', clock: "Clock", calendar: 'Calendar', coin: 'Coin Flip', dice: 'Roll Dice',
    random: 'Random Number', rng: 'RNG Table', move: 'Move', timer: 'Timer',
    stopwatch: 'Stopwatch', schedule: 'Schedule', calculator: 'Calculator', web: 'Web Search', dialogue: 'Dialogue',
    knowledge: 'Knowledge', memory: 'Memory', lookup: 'Look Up',
    map: 'Map', audio: 'Audio', clothing: 'Clothing', note: 'Note', inventory: 'Inventory', trade: 'Trade',
    invite: 'Invite Participant', kick: 'Kick Participant', 
    oracle: "Oracle", teleport: 'Teleport',
    key: 'Key', summon: 'Summon Character',
    narrate: 'Narrate', inspect: 'Inspect', administrator: 'Administrator',
    creator: 'Creator', destroyer: 'Destroyer',
    gpu: 'GPU', system_info: 'System Info', notify: 'Notify', clipboard: 'Clipboard', screenshot: 'Screenshot',
    browser: 'Open Browser', read_file: 'Read File', write_file: 'Write File', shell: "Shell",
};