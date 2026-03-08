import type { AgentMessage } from './types.js';
import type { EngineMetrics } from './metrics.js';
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
        _sessionFile: string;
        messages: AgentMessage[];
        prePromptMessageCount: number;
        autoCompactionSummary?: string;
        isHeartbeat?: boolean;
        _tokenBudget?: number;
    }): Promise<void>;
    private extractTextContent;
    private getGroupIdForSession;
    private processQueuedMessages;
    assemble(params: {
        sessionId: string;
        messages: AgentMessage[];
        _tokenBudget?: number;
    }): Promise<AssembleResult>;
    compact(params: {
        sessionId: string;
        _sessionFile: string;
        _tokenBudget?: number;
        _force?: boolean;
        currentTokenCount?: number;
        compactionTarget?: 'budget' | 'threshold';
        customInstructions?: string;
        legacyParams?: Record<string, unknown>;
    }): Promise<CompactResult>;
    getStats(): Promise<{
        metrics: EngineMetrics;
        latency: {
            p50: number;
            p95: number;
            p99: number;
        };
        graphiti_healthy: boolean;
        circuit_breaker_healthy: boolean;
    }>;
    onSubagentComplete(params: {
        subagentId: string;
        parentSessionId: string;
        summary?: string;
    }): Promise<void>;
}
//# sourceMappingURL=engine.d.ts.map