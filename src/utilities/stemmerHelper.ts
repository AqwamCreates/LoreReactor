// src/utilities/stemmerHelper.ts
export const STOP_STEMS = new Set(['he', 'she', 'they', 'i', 'you', 'we', 'it', 'him', 'her', 'them', 'me', 'us', 'say', 'ask', 'repl', 'whisper', 'mut', 'shout', 'yell', 'think', 'respond', 'answer', 'call', 'cri', 'exclaim', 'murmur', 'mumbl', 'state', 'remark', 'comment', 'not', 'observ', 'mention', 'add', 'continu', 'be', 'have', 'do', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'in', 'on', 'at', 'to', 'from', 'with', 'by', 'for', 'of', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'if', 'then', 'than', 'this', 'that', 'these', 'those', 'here', 'there', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'my', 'your', 'hi', 'our', 'their']);

export function stemWord(word: string): string {
    let w = word.toLowerCase();
    if (w.length < 3) return w;
    if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (w.endsWith('es') && w.length > 3) w = w.slice(0, -2);
    else if (w.endsWith('s') && w.length > 3) w = w.slice(0, -1);
    if (w.endsWith('ing') && w.length > 4) { w = w.slice(0, -3); if (w.endsWith('e')) w = w.slice(0, -1); } 
    else if (w.endsWith('ed') && w.length > 4) { w = w.slice(0, -2); if (w.endsWith('e')) w = w.slice(0, -1); } 
    else if (w.endsWith('ly') && w.length > 4) { w = w.slice(0, -2); }
    if (w.endsWith('bb') || w.endsWith('dd') || w.endsWith('ff') || w.endsWith('gg') || w.endsWith('mm') || w.endsWith('nn') || w.endsWith('pp') || w.endsWith('rr') || w.endsWith('tt')) w = w.slice(0, -1);
    if (w.endsWith('tion') && w.length > 5) w = w.slice(0, -4);
    else if (w.endsWith('ness') && w.length > 5) w = w.slice(0, -4);
    else if (w.endsWith('ment') && w.length > 5) w = w.slice(0, -4);
    else if (w.endsWith('ful') && w.length > 4) w = w.slice(0, -3);
    else if (w.endsWith('able') && w.length > 5) w = w.slice(0, -4);
    return w;
}

export function getStemmedContentWords(text: string): string[] {
    return text.toLowerCase().replace(/[*_~"()\[\]{}.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 2).map(stemWord).filter(w => !STOP_STEMS.has(w));
}