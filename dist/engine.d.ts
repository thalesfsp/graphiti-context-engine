import type { AgentMessage } from './types.js';
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
    bootstrap(_params: {
        sessionId: string;
        sessionFile: string;
    }): Promise<BootstrapResult>;
    ingest(params: {
        sessionId: string;
        message: AgentMessage;
        isHeartbeat?: boolean;
    }): Promise<IngestResult>;
    private extractMessageId;
    afterTurn(params: {
        sessionId: string;
        sessionFile: string;
        messages: AgentMessage[];
        prePromptMessageCount: number;
        autoCompactionSummary?: string;
        isHeartbeat?: boolean;
        tokenBudget?: number;
    }): Promise<void>;
    private extractTextContent;
    private getGroupIdForSession;
    private processQueuedMessages;
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
        compactionTarget?: 'budget' | 'threshold';
        customInstructions?: string;
        legacyParams?: Record<string, unknown>;
    }): Promise<CompactResult>;
}
//# sourceMappingURL=engine.d.ts.map