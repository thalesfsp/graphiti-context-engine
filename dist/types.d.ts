export type TrustTier = 'system' | 'tool_output' | 'user_statement' | 'speculation';
export declare const TRUST_WEIGHTS: Record<TrustTier, number>;
export type ClaimStatus = 'active' | 'superseded' | 'archived' | 'retracted';
export interface ClaimUpdate {
    status?: ClaimStatus;
    superseded_by?: string;
    updated_at: string;
}
export interface PartialClaim {
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
}
export interface Claim {
    claim_id: string;
    subject: string;
    predicate: string;
    object: string;
    qualifiers?: Record<string, string>;
    confidence: number;
    status: ClaimStatus;
    source_message_id: string;
    source_session_id: string;
    source_author_id?: string;
    extractor_version: string;
    created_at: string;
    updated_at: string;
    trust_tier?: TrustTier;
}
export interface AgentMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | unknown[];
}
export interface SubagentScope {
    parentSessionId: string;
    subagentId: string;
    groupId: string;
    startedAt: string;
    status: 'active' | 'completed' | 'failed';
}
export interface SubagentSummary {
    subagentId: string;
    parentSessionId: string;
    summary: string;
    claimCount: number;
    startedAt: string;
    completedAt: string;
}
export interface Contradiction {
    claim_a_id: string;
    claim_b_id: string;
    conflict_type: 'direct' | 'temporal' | 'supersession';
    confidence: number;
    detected_at: string;
    resolution?: 'claim_a_wins' | 'claim_b_wins' | 'merge' | 'unresolved';
}
//# sourceMappingURL=types.d.ts.map