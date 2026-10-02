// src/utilities/searchURLBuilder
import type { searchEngine } from "../types";

const searchEngineUrls: Record<searchEngine, string> = {

    'Google': 'https://www.google.com/search?q=',
    'Bing': 'https://www.bing.com/search?q=',
    'DuckDuckGo': 'https://html.duckduckgo.com/html/?q=',
    'Yandex': 'https://yandex.com/search/?text=',
    'Baidu': 'https://www.baidu.com/s?wd='

}

export const searchEngines: searchEngine[] = Object.keys(searchEngineUrls) as searchEngine[]

export function buildSearchUrl(terms: string[], searchEngine?: searchEngine): string {
    const query = encodeURIComponent(terms.join(' '));
    const effectiveSearchEngine: searchEngine = searchEngine || 'Google'
    return searchEngineUrls[effectiveSearchEngine] + query
}