import { TRUST_WEIGHTS } from './types.js';
export function detectTrustTier(message) {
    // System messages (instructions, rules)
    if (message.role === 'system')
        return 'system';
    // Tool outputs (function results)
    if (message.role === 'tool')
        return 'tool_output';
    // Check content patterns for speculation
    const content = typeof message.content === 'string' ? message.content : '';
    const speculationPatterns = [
        /I think/i,
        /probably/i,
        /might be/i,
        /maybe/i,
        /I assume/i,
        /I believe/i,
        /possibly/i,
        /could be/i,
    ];
    if (speculationPatterns.some(p => p.test(content))) {
        return 'speculation';
    }
    // Default: user statement
    return 'user_statement';
}
export function getTrustWeight(tier) {
    return TRUST_WEIGHTS[tier];
}
export function compareTrust(a, b) {
    return TRUST_WEIGHTS[b] - TRUST_WEIGHTS[a]; // Higher weight = higher priority
}
//# sourceMappingURL=trust.js.map