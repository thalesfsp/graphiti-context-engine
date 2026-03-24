// import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { messageQueue } from './queue.js';
import crypto from 'node:crypto';
import { extractClaims, buildClaimsForIngestion } from './extractor.js';
import { ingestClaims as rawIngestClaims, ingestClaimsWithRetry, searchClaimsWithFallback as searchClaims, markSessionClaimsArchived } from './graphiti-client.js';
import { retryQueue } from './retry-queue.js';
import { extractQueryFromMessages, buildContextAddition } from './context-builder.js';
import { completeSubagentScope, getGroupIdForSession, resolveGroupIds } from './subagent-scope.js';
import { recordIngest, recordExtraction, recordSearch, recordError, getMetrics, getSearchLatencyPercentiles } from './metrics.js';
import { checkHealth } from './graphiti-client.js';
import { graphitiCircuit } from './circuit-breaker.js';
// ─── Benchmark logging ─────────────────────────────────────────────────────
// Always emitted (not gated behind GRAPHITI_DEBUG) so we can measure real
// production latency.  Format:  [graphiti-context-engine] [BENCH] <method>: <detail> (<ms>ms)
const BENCH_PREFIX = '[graphiti-context-engine] [BENCH]';
function bench(method, detail, ms) {
    console.log(`${BENCH_PREFIX} ${method}: ${detail} (${ms}ms)`);
}
export class GraphitiContextEngine {
    info = {
        id: 'graphiti-context-engine',
        name: 'Graphiti Context Engine',
        version: '1.0.0',
        description: 'Persistent knowledge graph memory using Graphiti + Neo4j',
        ownsCompaction: false,
        capabilities: {
            claimExtraction: true,
            trustTiers: true,
            contradictionDetection: true,
            subagentScoping: true,
            metrics: true,
        },
    };
    async bootstrap(_params) {
        return { bootstrapped: false };
    }
    async ingest(params) {
        const t0 = Date.now();
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
        bench('ingest', `queued msg ${messageId.slice(0, 8)}`, Date.now() - t0);
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
        const t0 = Date.now();
        const { sessionId, isHeartbeat } = params;
        if (isHeartbeat) {
            bench('afterTurn', 'skipped (heartbeat)', Date.now() - t0);
            return;
        }
        // Process retries first
        const tRetry = Date.now();
        try {
            await retryQueue.processRetries((claims, groupId) => rawIngestClaims(claims, groupId));
        }
        catch (error) {
            recordError(`Retry queue process failed: ${error instanceof Error ? error.message : String(error)}`);
            console.error('Failed to process retry queue:', error);
        }
        bench('afterTurn', 'retryQueue.processRetries', Date.now() - tRetry);
        const tQueue = Date.now();
        await this.processQueuedMessages(sessionId);
        bench('afterTurn', 'processQueuedMessages', Date.now() - tQueue);
        bench('afterTurn', 'total', Date.now() - t0);
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
        if (queued.length === 0) {
            bench('processQueuedMessages', 'empty queue', 0);
            return;
        }
        bench('processQueuedMessages', `draining ${queued.length} messages`, 0);
        for (const item of queued) {
            try {
                const text = this.extractTextContent(item.message);
                if (!text) {
                    bench('processQueuedMessages', `msg ${item.messageId.slice(0, 8)} skipped (no text)`, 0);
                    continue;
                }
                const tExtract = Date.now();
                const extraction = await extractClaims(text, item.sessionId, item.messageId);
                bench('processQueuedMessages', `extractClaims (${extraction.claims.length} claims from ${text.length} chars)`, Date.now() - tExtract);
                if (extraction.claims.length === 0)
                    continue;
                recordExtraction(extraction.claims.length);
                const claims = buildClaimsForIngestion(extraction, item.sessionId, item.messageId);
                const groupId = this.getGroupIdForSession(sessionId);
                const tIngest = Date.now();
                await ingestClaimsWithRetry(claims, groupId);
                bench('processQueuedMessages', `ingestClaims (${claims.length} claims → group ${groupId})`, Date.now() - tIngest);
            }
            catch (error) {
                recordError(`Claim extraction failed for ${item.messageId}: ${error instanceof Error ? error.message : String(error)}`);
                console.error(`Claim extraction failed for ${item.messageId}:`, error);
            }
        }
    }
    async assemble(params) {
        const t0 = Date.now();
        const { sessionId, messages, channelMeta } = params;
        let systemPromptAddition = '';
        try {
            // Extract query from recent messages
            const tQuery = Date.now();
            const query = extractQueryFromMessages(messages);
            bench('assemble', `extractQuery (${query ? query.length : 0} chars)`, Date.now() - tQuery);
            if (!query) {
                bench('assemble', 'total (no query)', Date.now() - t0);
                return { messages, estimatedTokens: 0 };
            }
            // Resolve group IDs: channel metadata (primary) → query keywords (secondary) → defaults
            const groupIds = resolveGroupIds(sessionId, { query, channelMeta });
            // Search Graphiti across resolved groups (with 2s timeout)
            const tSearch = Date.now();
            const claims = await searchClaims(query, groupIds, {
                limit: 20,
            });
            const searchMs = Date.now() - tSearch;
            recordSearch(searchMs);
            bench('assemble', `searchClaims (${claims.length} results, groups=[${groupIds.join(',')}])`, searchMs);
            // Debug logging — gated behind GRAPHITI_DEBUG env var
            if (process.env.GRAPHITI_DEBUG) {
                const queryPreview = query.length > 100 ? query.slice(0, 100) + '...' : query;
                console.log(`[graphiti-context-engine] [DEBUG] assemble: searching for "${queryPreview}" in groups=[${groupIds.join(', ')}]`);
                if (claims.length === 0) {
                    console.log(`[graphiti-context-engine] [DEBUG] assemble: no claims found (${searchMs}ms)`);
                }
                else {
                    console.log(`[graphiti-context-engine] [DEBUG] assemble: found ${claims.length} claims (${searchMs}ms):`);
                    const preview = claims.slice(0, 5).map(c => {
                        const display = c.fact && !c.subject
                            ? c.fact
                            : `${c.subject} ${c.predicate} ${c.object}`.trim();
                        return `  - [${c.confidence.toFixed(2)}] ${display}`;
                    });
                    preview.forEach(line => console.log(line));
                    if (claims.length > 5) {
                        console.log(`  ... and ${claims.length - 5} more`);
                    }
                }
            }
            // Build context addition
            const tBuild = Date.now();
            systemPromptAddition = buildContextAddition(claims);
            bench('assemble', `buildContextAddition (${systemPromptAddition.length} chars)`, Date.now() - tBuild);
        }
        catch (error) {
            recordError(error instanceof Error ? error.message : String(error));
            // Graceful degradation - just return messages without graph context
            console.warn('[graphiti-context-engine] assemble: search failed:', error);
        }
        // Estimate tokens (rough: 4 chars per token)
        const estimatedTokens = Math.ceil(systemPromptAddition.length / 4);
        bench('assemble', `total (${estimatedTokens} tokens injected)`, Date.now() - t0);
        return {
            messages,
            estimatedTokens,
            systemPromptAddition: systemPromptAddition || undefined,
        };
    }
    async compact(params) {
        const t0 = Date.now();
        const { sessionId } = params;
        try {
            const tQueue = Date.now();
            await this.processQueuedMessages(sessionId);
            bench('compact', 'processQueuedMessages', Date.now() - tQueue);
            // Mark session's recent claims as "archived" (optional - for tracking compacted content)
            // This is a soft marker, claims remain queryable but with lower priority
            const tArchive = Date.now();
            try {
                await markSessionClaimsArchived(sessionId);
                bench('compact', 'markSessionClaimsArchived', Date.now() - tArchive);
            }
            catch (error) {
                bench('compact', 'markSessionClaimsArchived (failed)', Date.now() - tArchive);
                console.warn('Failed to mark claims as archived:', error);
            }
        }
        catch (error) {
            console.error('compact() claim extraction phase failed:', error);
        }
        bench('compact', 'total', Date.now() - t0);
        // Return success - actual compaction is handled by legacy engine
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
        const t0 = Date.now();
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
        bench('onSubagentComplete', `subagent ${subagentId}`, Date.now() - t0);
    }
    getVersion() {
        return {
            version: this.info.version,
            buildDate: new Date().toISOString().split('T')[0],
        };
    }
}
//# sourceMappingURL=engine.js.map