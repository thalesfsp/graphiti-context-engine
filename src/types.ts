export type TrustTier = 'system' | 'tool_output' | 'user_statement' | 'speculation';

export const TRUST_WEIGHTS: Record<TrustTier, number> = {
  system: 1.0,
  tool_output: 0.9,
  user_statement: 0.7,
  speculation: 0.3,
};

export type ClaimStatus = 'active' | 'superseded' | 'archived' | 'retracted';

export interface ClaimUpdate {
  status?: ClaimStatus;
  superseded_by?: string; // claim_id of newer claim
  updated_at: string;
}

export interface PartialClaim {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface Claim {
  claim_id: string; // UUID
  subject: string; // Entity name (e.g., "Greice")
  predicate: string; // Relationship (e.g., "birthday", "is_wife_of")
  object: string; // Value (e.g., "March 15", "T")
  qualifiers?: Record<string, string>; // Optional metadata (e.g., {"also_known_as": "Grace"})
  confidence: number; // 0.0-1.0
  status: ClaimStatus;
  source_message_id: string; // OpenClaw message ID
  source_session_id: string; // OpenClaw session ID
  source_author_id?: string; // OpenClaw user/author ID
  extractor_version: string; // e.g., "v1.0"
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  trust_tier?: TrustTier;

}

// Minimal AgentMessage stub for typing
export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | unknown[];
  // Add other fields as needed
}

export interface SubagentScope {
  parentSessionId: string;
  subagentId: string;
  groupId: string;  // Computed: `${parentSessionId}:${subagentId}`
  startedAt: string;
  status: 'active' | 'completed' | 'failed';
}

export interface SubagentSummary {
  subagentId: string;
  parentSessionId: string;
  summary: string;  // LLM-generated summary of subagent work
  claimCount: number;
  startedAt: string;
  completedAt: string;
}
