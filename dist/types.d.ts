export interface Claim {
    claim_id: string;
    subject: string;
    predicate: string;
    object: string;
    qualifiers?: Record<string, string>;
    confidence: number;
    status: "active" | "superseded" | "disputed";
    source_message_id: string;
    source_session_id: string;
    source_author_id?: string;
    extractor_version: string;
    created_at: string;
    updated_at: string;
}
export interface AgentMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | unknown[];
}
//# sourceMappingURL=types.d.ts.map