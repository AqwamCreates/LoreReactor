import type { tool } from '../types';

export const toolLabels: Record<tool, string> = {
    whisper: 'Whisper', think: 'Think', pick: 'Random Pick', clock: 'Clock', calendar: 'Calendar', coin: 'Coin Flip', dice: 'Roll Dice',
    random: 'Random Number', rng: 'RNG Table', move: 'Move', timer: 'Timer',
    stopwatch: 'Stopwatch', schedule: 'Schedule', calculator: 'Calculator', web: 'Web Search', dialogue: 'Dialogue',
    knowledge: 'Knowledge', memory: 'Memory', lookup: 'Look Up',
    map: 'Map', audio: 'Audio', clothing: 'Clothing', note: 'Note', inventory: 'Inventory', trade: 'Trade',
    invite: 'Invite Participant', kick: 'Kick Participant', 
    oracle: 'Oracle', teleport: 'Teleport',
    key: 'Key', summon: 'Summon Character',
    narrate: 'Narrate', inspect: 'Inspect', administrator: 'Administrator',
    creator: 'Creator', destroyer: 'Destroyer',
    text_to_speech: 'Text-To-Speech', gpu: 'GPU', system_info: 'System Info', notify: 'Notify', volume_control: 'Volume Control', lock_screen: 'Lock Screen',
    clipboard: 'Clipboard', screenshot: 'Screenshot', webcam: 'Webcam',
    network_scanner: 'Network Scanner', file_watcher: 'File Watcher', window_monitor: 'Window Monitor', process_monitor: 'Process Monitor',
    trash: 'Trash', browser: 'Open Browser', read_file: 'Read File', write_file: 'Write File', shell: 'Shell', virtual_input: 'Virtual Input', hardware_control: 'Hardware Control'
};