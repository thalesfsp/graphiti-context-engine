import type { AgentMessage } from "@mariozechner/pi-agent-core";
export interface ContextEngineInfo {
    id: string;
    name: string;
    version?: string;
    ownsCompaction?: boolean;
}
export interface AssembleResult {
    messages: AgentMessage[];
    estimatedTokens: number;
    systemPromptAddition?: string;
}
export interface IngestResult {
    ingested: boolean;
}
export interface CompactResult {
    ok: boolean;
    compacted: boolean;
    reason?: string;
    result?: {
        summary?: string;
        firstKeptEntryId?: string;
        tokensBefore: number;
        tokensAfter?: number;
        details?: unknown;
    };
}
export interface BootstrapResult {
    bootstrapped: boolean;
    importedMessages?: number;
    reason?: string;
}
export declare class GraphitiContextEngine {
    readonly info: ContextEngineInfo;
    bootstrap(params: {
        sessionId: string;
        sessionFile: string;
    }): Promise<BootstrapResult>;
    ingest(params: {
        sessionId: string;
        message: AgentMessage;
        isHeartbeat?: boolean;
    }): Promise<IngestResult>;
    afterTurn(params: {
        sessionId: string;
        sessionFile: string;
        messages: AgentMessage[];
        prePromptMessageCount: number;
        autoCompactionSummary?: string;
        isHeartbeat?: boolean;
        tokenBudget?: number;
    }): Promise<void>;
    assemble(params: {
        sessionId: string;
        messages: AgentMessage[];
        tokenBudget?: number;
    }): Promise<AssembleResult>;
    compact(params: {
        sessionId: string;
        sessionFile: string;
        tokenBudget?: number;
        force?: boolean;
        currentTokenCount?: number;
        compactionTarget?: "budget" | "threshold";
        customInstructions?: string;
    }): Promise<CompactResult>;
}
//# sourceMappingURL=engine.d.ts.map