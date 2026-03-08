// import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { AgentMessage } from './types.js';
import { messageQueue } from './queue.js';
import crypto from 'node:crypto';

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
    const { sessionId, message, isHeartbeat } = params;
    
    // Extract message ID (from message metadata or generate)
    const messageId = this.extractMessageId(message);
    
    // Queue for background processing (no LLM, no HTTP)
    messageQueue.enqueue({
      sessionId,
      messageId,
      message,
      timestamp: new Date().toISOString(),
      isHeartbeat: isHeartbeat ?? false,
    });
    
    // Return immediately
    return { ingested: true };
  }

  private extractMessageId(message: AgentMessage): string {
    // Try to extract from message content/metadata
    // Fallback to hash of content
    if (typeof message.content === 'string') {
      return crypto.createHash('sha256')
        .update(message.content)
        .digest('hex')
        .slice(0, 16);
    }
    return crypto.randomUUID();
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
