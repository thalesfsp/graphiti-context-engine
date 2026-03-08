// import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { messageQueue } from './queue.js';
import crypto from 'node:crypto';
import { extractClaims, buildClaimsForIngestion } from './extractor.js';
import { ingestClaims as rawIngestClaims, ingestClaimsWithRetry, searchClaimsWithFallback as searchClaims, markSessionClaimsArchived } from './graphiti-client.js';
import { retryQueue } from './retry-queue.js';
import { extractQueryFromMessages, buildContextAddition } from './context-builder.js';
import { completeSubagentScope, getGroupIdForSession } from './subagent-scope.js';
import { recordIngest, recordExtraction, recordSearch, recordError, getMetrics, getSearchLatencyPercentiles } from './metrics.js';
import { checkHealth } from './graphiti-client.js';
import { graphitiCircuit } from './circuit-breaker.js';
export class GraphitiContextEngine {
    info = {
        id: "graphiti-context-engine",
        name: "Graphiti Context Engine",
        version: "0.1.0",
        ownsCompaction: false, // Let legacy handle actual compaction
    };
    async bootstrap(_params) {
        return { bootstrapped: false };
    }
    async ingest(params) {
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
        recordIngest();
        // Return immediately
        return { ingested: true };
    }
    extractMessageId(message) {
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
    async afterTurn(params) {
        const { sessionId, isHeartbeat } = params;
        if (isHeartbeat)
            return;
        // Process retries first
        try {
            await retryQueue.processRetries((claims, groupId) => rawIngestClaims(claims, groupId));
        }
        catch (error) {
            recordError(`Retry queue process failed: ${error instanceof Error ? error.message : String(error)}`);
            console.error('Failed to process retry queue:', error);
        }
        await this.processQueuedMessages(sessionId);
    }
    extractTextContent(message) {
        if (typeof message.content === 'string') {
            return message.content;
        }
        // Handle array content (text blocks)
        if (Array.isArray(message.content)) {
            return message.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text)
                .join('\n');
        }
        return null;
    }
    getGroupIdForSession(sessionId, subagentId) {
        return getGroupIdForSession(sessionId, subagentId);
    }
    async processQueuedMessages(sessionId) {
        const queued = messageQueue.drain();
        if (queued.length === 0)
            return;
        for (const item of queued) {
            try {
                const text = this.extractTextContent(item.message);
                if (!text)
                    continue;
                const extraction = await extractClaims(text, item.sessionId, item.messageId);
                if (extraction.claims.length === 0)
                    continue;
                recordExtraction(extraction.claims.length);
                const claims = buildClaimsForIngestion(extraction, item.sessionId, item.messageId);
                const groupId = this.getGroupIdForSession(sessionId);
                await ingestClaimsWithRetry(claims, groupId);
            }
            catch (error) {
                recordError(`Claim extraction failed for ${item.messageId}: ${error instanceof Error ? error.message : String(error)}`);
                console.error(`Claim extraction failed for ${item.messageId}:`, error);
            }
        }
    }
    async assemble(params) {
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
            const start = Date.now();
            const claims = await searchClaims(query, groupId, {
                statuses: ['active'],
                limit: 20,
            });
            recordSearch(Date.now() - start);
            // Build context addition
            systemPromptAddition = buildContextAddition(claims);
        }
        catch (error) {
            recordError(error instanceof Error ? error.message : String(error));
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
    async compact(params) {
        const { sessionId } = params;
        try {
            await this.processQueuedMessages(sessionId);
            // 3. Mark session's recent claims as "archived" (optional - for tracking compacted content)
            // This is a soft marker, claims remain queryable but with lower priority
            try {
                await markSessionClaimsArchived(sessionId);
            }
            catch (error) {
                console.warn('Failed to mark claims as archived:', error);
            }
        }
        catch (error) {
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
    async getStats() {
        return {
            metrics: getMetrics(),
            latency: getSearchLatencyPercentiles(),
            graphiti_healthy: await checkHealth(),
            circuit_breaker_healthy: graphitiCircuit.isHealthy(),
        };
    }
    async onSubagentComplete(params) {
        const { subagentId, parentSessionId, summary } = params;
        // 1. Mark scope as complete
        const completedScope = await completeSubagentScope(subagentId, summary || 'Subagent work completed');
        if (!completedScope)
            return;
        // 2. Create summary claim in PARENT graph (not subagent graph)
        const summaryClaim = {
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
//# sourceMappingURL=engine.js.map