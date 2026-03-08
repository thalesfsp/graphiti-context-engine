// import type { AgentMessage } from "@mariozechner/pi-agent-core";

export interface ContextEngineInfo {
  id: string;
  name: string;
  version?: string;
  ownsCompaction?: boolean;
}

type AgentMessage = Record<string, unknown>;\n\nexport interface AssembleResult {
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

export class GraphitiContextEngine {
  readonly info: ContextEngineInfo = {
    id: "graphiti-context-engine",
    name: "Graphiti Context Engine",
    version: "0.1.0",
  };

  async bootstrap(_params: { sessionId: string; sessionFile: string }): Promise<BootstrapResult> {
    return { bootstrapped: false };
  }

  async ingest(params: {
    sessionId: string;
    message: AgentMessage;
    isHeartbeat?: boolean;
  }): Promise<IngestResult> {
    // Stub: always ingest
    return { ingested: true };
  }

  async afterTurn(params: {
    sessionId: string;
    sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    tokenBudget?: number;
  }): Promise<void> {
    // No-op stub
  }

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    // Stub: return empty context
    return {
      messages: [],
      estimatedTokens: 0,
    };
  }

  async compact(params: {
    sessionId: string;
    sessionFile: string;
    tokenBudget?: number;
    force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: "budget" | "threshold";
    customInstructions?: string;
  }): Promise<CompactResult> {
    // Stub: no compaction
    return { ok: true, compacted: false };
  }
}
