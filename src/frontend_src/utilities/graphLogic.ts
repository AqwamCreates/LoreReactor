import { weightedSample } from './dynamicCharacterLogic';

export interface StochasticGraphNode<T> {
    id: string;
    weight: number;
    skipProbability?: number;
    breakProbability?: number;
    bindings?: string[];
    payload: T;
}

/**
 * Universal stochastic graph chaining engine.
 * Powers dialogue prompt chaining and character text injection graphs.
 */
export function traverseStochasticGraph<T>(
    nodes: StochasticGraphNode<T>[],
    startNodeId?: string,
    isValidCandidate?: (id: string) => boolean
): T[] {
    if (!nodes || nodes.length === 0) return [];

    const nodeMap = new Map<string, StochasticGraphNode<T>>();
    for (const node of nodes) {
        nodeMap.set(node.id, node);
    }

    let currentNode: StochasticGraphNode<T> | undefined;

    if (startNodeId) {
        currentNode = nodeMap.get(startNodeId);
    }

    if (!currentNode) {
        const startPool = nodes
            .filter(n => (n.weight > 0 ? n.weight : 1) > 0)
            .map(n => ({ item: n, weight: n.weight > 0 ? n.weight : 1 }));
        currentNode = weightedSample(startPool) ?? nodes[0];
    }

    const results: T[] = [];

    while (currentNode) {
        const skipProb = currentNode.skipProbability ?? 0;
        const isSkipped = skipProb > 0 && Math.random() < skipProb;

        if (!isSkipped && currentNode.payload !== undefined) {
            results.push(currentNode.payload);
        }

        const breakProb = currentNode.breakProbability ?? 0;
        if (breakProb > 0 && Math.random() < breakProb) {
            break;
        }

        const bindings = currentNode.bindings;
        if (!bindings || bindings.length === 0) {
            break;
        }

        const nextPool: { item: StochasticGraphNode<T>; weight: number }[] = [];
        for (const bindId of bindings) {
            if (isValidCandidate && !isValidCandidate(bindId)) continue;
            const targetNode = nodeMap.get(bindId);
            if (!targetNode) continue;
            const w = targetNode.weight > 0 ? targetNode.weight : 1;
            nextPool.push({ item: targetNode, weight: w });
        }

        if (nextPool.length === 0) {
            break;
        }

        currentNode = weightedSample(nextPool) ?? undefined;
    }

    return results;
}