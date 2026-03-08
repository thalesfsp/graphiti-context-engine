import { Claim, ClaimStatus } from './types.js';
export declare function updateClaimStatus(claimId: string, status: ClaimStatus, supersededBy?: string): Promise<void>;
export declare function markClaimsSuperseded(oldClaimIds: string[], newClaimId: string): Promise<void>;
export declare function ingestClaims(claims: Claim[], groupId: string): Promise<{
    ingested: number;
    duplicates: number;
}>;
export declare function searchClaims(query: string, groupId: string, options?: {
    limit?: number;
    minConfidence?: number;
    statuses?: ClaimStatus[];
}): Promise<Claim[]>;
export declare function markSessionClaimsArchived(sessionId: string): Promise<void>;
export declare function ingestClaimsWithRetry(claims: Claim[], groupId: string): Promise<{
    ingested: number;
    duplicates: number;
}>;
export declare function searchClaimsWithFallback(query: string, groupId: string, options?: {
    limit?: number;
    minConfidence?: number;
    statuses?: ClaimStatus[];
}): Promise<Claim[]>;
export declare function checkHealth(): Promise<boolean>;
//# sourceMappingURL=graphiti-client.d.ts.map