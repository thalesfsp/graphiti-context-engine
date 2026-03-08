import { getTrustWeight } from './trust.js';
const MAX_CONTEXT_CHARS = 2000; // ~500 tokens max for injected claims
export function buildContextAddition(claims) {
    if (claims.length === 0)
        return '';
    // Sort by confidence (highest first), then trust, then recency
    const sorted = claims.sort((a, b) => {
        // Primary: confidence (already exists)
        const confDiff = b.confidence - a.confidence;
        if (Math.abs(confDiff) > 0.1)
            return confDiff;
        // Secondary: trust tier
        const trustA = getTrustWeight(a.trust_tier || 'user_statement');
        const trustB = getTrustWeight(b.trust_tier || 'user_statement');
        const trustDiff = trustB - trustA;
        if (Math.abs(trustDiff) > 0.1)
            return trustDiff;
        // Tertiary: recency (already exists)
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    // Build context string with truncation
    let context = '## Known Facts (from memory)\n';
    let charCount = context.length;
    for (const claim of sorted) {
        const line = `- ${claim.subject} ${claim.predicate} ${claim.object} (confidence: ${claim.confidence})\n`;
        if (charCount + line.length > MAX_CONTEXT_CHARS)
            break;
        context += line;
        charCount += line.length;
    }
    return context;
}
export function extractQueryFromMessages(messages) {
    // Get last few user messages for query
    const userMessages = messages
        .filter(m => m.role === 'user')
        .slice(-3); // Last 3 user messages
    return userMessages
        .map(m => typeof m.content === 'string' ? m.content : '')
        .join(' ')
        .slice(0, 500); // Limit query length
}
//# sourceMappingURL=context-builder.js.map