import { getTrustWeight } from './trust.js';
/**
 * Detect contradictions between a new claim and existing claims.
 * This is a stub - real implementation would use LLM for semantic comparison.
 */
export async function detectContradictions(newClaim, existingClaims) {
    const contradictions = [];
    for (const existing of existingClaims) {
        // Skip if same claim
        if (existing.claim_id === newClaim.claim_id)
            continue;
        // Skip if different subjects (can't contradict)
        if (existing.subject !== newClaim.subject)
            continue;
        // Check for same predicate with different object (potential contradiction)
        if (existing.predicate === newClaim.predicate && existing.object !== newClaim.object) {
            contradictions.push({
                claim_a_id: existing.claim_id,
                claim_b_id: newClaim.claim_id,
                conflict_type: 'direct',
                confidence: 0.5, // Low confidence without LLM verification
                detected_at: new Date().toISOString(),
                resolution: 'unresolved',
            });
        }
    }
    // TODO: Use LLM for semantic contradiction detection
    // - "John lives in Seattle" vs "John lives in New York"
    // - "The meeting is at 3pm" vs "The meeting was rescheduled to 4pm"
    return contradictions;
}
/**
 * Resolve a contradiction based on trust tiers and recency.
 */
export function resolveContradiction(_contradiction, claimA, claimB) {
    // Higher trust wins
    const trustA = getTrustWeight(claimA.trust_tier || 'user_statement');
    const trustB = getTrustWeight(claimB.trust_tier || 'user_statement');
    if (trustA > trustB + 0.1)
        return 'claim_a_wins';
    if (trustB > trustA + 0.1)
        return 'claim_b_wins';
    // Same trust: more recent wins
    const dateA = new Date(claimA.created_at).getTime();
    const dateB = new Date(claimB.created_at).getTime();
    if (dateB > dateA)
        return 'claim_b_wins';
    if (dateA > dateB)
        return 'claim_a_wins';
    return 'unresolved';
}
//# sourceMappingURL=contradiction.js.map