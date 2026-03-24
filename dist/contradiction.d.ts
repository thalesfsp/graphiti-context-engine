import { Claim, Contradiction } from './types.js';
/**
 * Detect contradictions between a new claim and existing claims.
 * This is a stub - real implementation would use LLM for semantic comparison.
 */
export declare function detectContradictions(newClaim: Claim, existingClaims: Claim[]): Promise<Contradiction[]>;
/**
 * Resolve a contradiction based on trust tiers and recency.
 */
export declare function resolveContradiction(_contradiction: Contradiction, claimA: Claim, claimB: Claim): 'claim_a_wins' | 'claim_b_wins' | 'unresolved';
//# sourceMappingURL=contradiction.d.ts.map