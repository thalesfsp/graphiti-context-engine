// import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { AgentMessage } from './types.js';
import { messageQueue } from './queue.js';
import crypto from 'node:crypto';

import { extractClaims, buildClaimsForIngestion } from './extractor.js';
import { ingestClaims, searchClaims } from './graphiti-client.js';
import { extractQueryFromMessages, buildContextAddition } from './context-builder.js';

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
    const { sessionId, isHeartbeat } = params;

    // Skip heartbeats
    if (isHeartbeat) return;

    // Drain queued messages
    const queued = messageQueue.drain();
    if (queued.length === 0) return;

    // Process each message
    for (const item of queued) {
      try {
        // Extract text content
        const text = this.extractTextContent(item.message);
        if (!text) continue;

        // Extract claims via LLM
        const extraction = await extractClaims(
          text,
          item.sessionId,
          item.messageId,
          // TODO: get author ID from message metadata
        );

        if (extraction.claims.length === 0) continue;

        // Build claims with provenance
        const claims = buildClaimsForIngestion(
          extraction,
          item.sessionId,
          item.messageId
        );

        // POST to Graphiti (with timeout/retry)
        const groupId = this.getGroupIdForSession(sessionId);
        await ingestClaims(claims, groupId);

      } catch (error) {
        // Log but don't fail - graceful degradation
        console.error(`afterTurn extraction failed for ${item.messageId}:`, error);
      }
    }
  }

  private extractTextContent(message: AgentMessage): string | null {
    if (typeof message.content === 'string') {
      return message.content;
    }
    // Handle array content (text blocks)
    if (Array.isArray(message.content)) {
      return message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n');
    }
    return null;
  }

  private getGroupIdForSession(sessionId: string): string {
    // Extract group from session key (e.g., "agent:main:helix" -> "helix")
    // Default to "default" if can't parse
    const parts = sessionId.split(':');
    return parts[2] || 'default';
  }

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    tokenBudget?: number;
  }): Promise<AssembleResult> {
    const { sessionId, messages, tokenBudget } = params;
    
    let systemPromptAddition = '';
    
    try {
      // Extract query from recent messages
      const query = extractQueryFromMessages(messages);
      if (!query) {
        return { messages, estimatedTokens: 0 };
      }
      
      // Get group ID for this session
      const groupId = this.getGroupIdForSession(sessionId);
      
      // Search Graphiti (with 1s timeout)
      const claims = await searchClaims(query, groupId, {
        status: ['active'],
        limit: 20,
      });
      
      // Build context addition
      systemPromptAddition = buildContextAddition(claims);
      
    } catch (error) {
      // Graceful degradation - just return messages without graph context
      console.warn('assemble() failed to retrieve claims:', error);
    }
    
    // Estimate tokens (rough: 4 chars per token)
    const estimatedTokens = Math.ceil(systemPromptAddition.length / 4);
    
    return {
      messages,
      estimatedTokens,
      systemPromptAddition: systemPromptAddition || undefined,
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