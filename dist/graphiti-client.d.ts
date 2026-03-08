import { Claim } from './types.js';
export declare function ingestClaims(claims: Claim[], groupId: string): Promise<{
    ingested: number;
    duplicates: number;
}>;
export declare function searchClaims(query: string, groupId: string, options?: {
    status?: string[];
    limit?: number;
}): Promise<Claim[]>;
export declare function markSessionClaimsArchived(sessionId: string): Promise<void>;
export declare function ingestClaimsWithRetry(claims: Claim[], groupId: string): Promise<{
    ingested: number;
    duplicates: number;
}>;
export declare function searchClaimsWithFallback(query: string, groupId: string, options?: any): Promise<Claim[]>;
export declare function checkHealth(): Promise<boolean>;
//# sourceMappingURL=graphiti-client.d.ts.map