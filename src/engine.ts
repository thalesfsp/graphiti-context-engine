// import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { AgentMessage, Claim } from './types.js';
import { messageQueue } from './queue.js';
import crypto from 'node:crypto';

import { extractClaims, buildClaimsForIngestion } from './extractor.js';
import { ingestClaims as rawIngestClaims, ingestClaimsWithRetry, searchClaimsWithFallback as searchClaims, markSessionClaimsArchived } from './graphiti-client.js';
import { retryQueue } from './retry-queue.js';
import { extractQueryFromMessages, buildContextAddition } from './context-builder.js';
import { completeSubagentScope, getGroupIdForSession } from './subagent-scope.js';

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
    ownsCompaction: false, // Let legacy handle actual compaction
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
    _sessionFile: string;
    messages: AgentMessage[];
    prePromptMessageCount: number;
    autoCompactionSummary?: string;
    isHeartbeat?: boolean;
    _tokenBudget?: number;
  }): Promise<void> {
    const { sessionId, isHeartbeat } = params;

    if (isHeartbeat) return;
    
    // Process retries first
    try {
      await retryQueue.processRetries((claims, groupId) => rawIngestClaims(claims, groupId));
    } catch (error) {
      console.error('Failed to process retry queue:', error);
    }
    
    await this.processQueuedMessages(sessionId);
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

  private getGroupIdForSession(sessionId: string, subagentId?: string): string {
    return getGroupIdForSession(sessionId, subagentId);
  }

  private async processQueuedMessages(sessionId: string): Promise<void> {
    const queued = messageQueue.drain();
    if (queued.length === 0) return;

    for (const item of queued) {
      try {
        const text = this.extractTextContent(item.message);
        if (!text) continue;

        const extraction = await extractClaims(text, item.sessionId, item.messageId);
        if (extraction.claims.length === 0) continue;

        const claims = buildClaimsForIngestion(extraction, item.sessionId, item.messageId);
        const groupId = this.getGroupIdForSession(sessionId);
        
        await ingestClaimsWithRetry(claims, groupId);
      } catch (error) {
        console.error(`Claim extraction failed for ${item.messageId}:`, error);
      }
    }
  }

  async assemble(params: {
    sessionId: string;
    messages: AgentMessage[];
    _tokenBudget?: number;
  }): Promise<AssembleResult> {
    const { sessionId, messages } = params;
    
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
        statuses: ['active'],
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
    _sessionFile: string;
    _tokenBudget?: number;
    _force?: boolean;
    currentTokenCount?: number;
    compactionTarget?: 'budget' | 'threshold';
    customInstructions?: string;
    legacyParams?: Record<string, unknown>;
  }): Promise<CompactResult> {
    const { sessionId } = params;
    
    try {
      await this.processQueuedMessages(sessionId);
      
      // 3. Mark session's recent claims as "archived" (optional - for tracking compacted content)
      // This is a soft marker, claims remain queryable but with lower priority
      try {
        await markSessionClaimsArchived(sessionId);
      } catch (error) {
        console.warn('Failed to mark claims as archived:', error);
      }
      
    } catch (error) {
      console.error('compact() claim extraction phase failed:', error);
    }
    
    // 4. Return success - actual compaction is handled by legacy engine
    // We set ownsCompaction: false in engine info, so OpenClaw will run legacy compaction
    return {
      ok: true,
      compacted: false, // We don't own compaction, legacy does
      reason: 'Claims extracted; delegating to legacy compaction',
    };
  }

  async onSubagentComplete(params: {
    subagentId: string;
    parentSessionId: string;
    summary?: string;
  }): Promise<void> {
    const { subagentId, parentSessionId, summary } = params;
    
    // 1. Mark scope as complete
    const completedScope = await completeSubagentScope(subagentId, summary || 'Subagent work completed');
    if (!completedScope) return;
    
    // 2. Create summary claim in PARENT graph (not subagent graph)
    const summaryClaim: Claim = {
      claim_id: `summary:${subagentId}`,
      subject: 'subagent',
      predicate: 'completed_work',
      object: completedScope.summary,
      qualifiers: {
        subagent_id: subagentId,
        claim_count: String(completedScope.claimCount),
      },
      confidence: 1.0,
      status: 'active',
      source_message_id: `subagent:${subagentId}`,
      source_session_id: parentSessionId,
      extractor_version: 'subagent-summary-v1',
      created_at: completedScope.completedAt,
      updated_at: completedScope.completedAt,
    };
    
    // Ingest summary into parent's group
    const parentGroupId = getGroupIdForSession(parentSessionId);
    await ingestClaimsWithRetry([summaryClaim], parentGroupId);
  }
}