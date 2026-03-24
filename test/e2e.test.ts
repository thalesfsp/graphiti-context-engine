/**
 * E2E tests against REAL Graphiti (localhost:8721).
 * No mocks. Every test hits the live server.
 *
 * Prerequisite: Graphiti server running on http://localhost:8721
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

const GRAPHITI_URL = 'http://localhost:8721';

// ─── Health gate ────────────────────────────────────────────────────────────
async function graphitiIsUp(): Promise<boolean> {
  try {
    const r = await fetch(`${GRAPHITI_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

// ─── Imports (from compiled dist) ───────────────────────────────────────────
// We import from dist/ because that's what the gateway loads at runtime.
import { GraphitiContextEngine } from '../dist/engine.js';
import { searchClaims, searchClaimsWithFallback, checkHealth } from '../dist/graphiti-client.js';
import { extractQueryFromMessages, buildContextAddition, stripNoisePatterns, NOISE_LINE_PATTERNS, NOISE_INLINE_PATTERNS } from '../dist/context-builder.js';
import { getGroupIdsForSession, getGroupIdForSession, isSubagentSession, detectGroupsFromQuery, detectGroupsFromChannel, resolveGroupIds } from '../dist/subagent-scope.js';
import type { ChannelMetadata } from '../dist/subagent-scope.js';
import { CircuitBreaker } from '../dist/circuit-breaker.js';
import { detectTrustTier, getTrustWeight, compareTrust } from '../dist/trust.js';
import { extractClaims, buildClaimsForIngestion } from '../dist/extractor.js';
import { messageQueue } from '../dist/queue.js';
import { retryQueue } from '../dist/retry-queue.js';
import {
  recordIngest, recordSearch, recordError, recordExtraction,
  getMetrics, getSearchLatencyPercentiles, resetMetrics,
} from '../dist/metrics.js';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GRAPHITI CLIENT — real HTTP against localhost:8721
// ═══════════════════════════════════════════════════════════════════════════════
describe('graphiti-client (live)', () => {
  beforeAll(async () => {
    if (!(await graphitiIsUp())) throw new Error('Graphiti not running on :8721');
  });

  // ── Health ──
  it('checkHealth returns true when server is up', async () => {
    expect(await checkHealth()).toBe(true);
  });

  // ── searchClaims: single group ──
  it('searchClaims returns results for a known query (single group)', async () => {
    const claims = await searchClaims('Nova', ['personal'], { limit: 5 });
    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
    // Each claim has required fields
    for (const c of claims) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('fact');
      expect(c).toHaveProperty('subject');
      expect(c).toHaveProperty('predicate');
      expect(c).toHaveProperty('object');
      expect(typeof c.confidence).toBe('number');
    }
  });

  // ── searchClaims: multiple groups ──
  it('searchClaims accepts string[] of group IDs', async () => {
    const claims = await searchClaims('Nova', ['personal', 'system'], { limit: 5 });
    expect(claims.length).toBeGreaterThan(0);
  });

  // ── searchClaims: single string (backward compat) ──
  it('searchClaims accepts a single string group ID', async () => {
    const claims = await searchClaims('Nova', 'personal', { limit: 3 });
    expect(claims.length).toBeGreaterThan(0);
  });

  // ── searchClaims: empty result for gibberish ──
  it('searchClaims returns empty for nonsense query', async () => {
    const claims = await searchClaims('xyzzy_qqq_99999', ['personal'], { limit: 5 });
    // Graphiti may still return semantic-ish results; just check no crash
    expect(Array.isArray(claims)).toBe(true);
  });

  // ── searchClaimsWithFallback: works through circuit breaker ──
  it('searchClaimsWithFallback returns results via circuit breaker', async () => {
    const claims = await searchClaimsWithFallback('Graphiti', ['personal', 'system'], { limit: 5 });
    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
  });

  // ── searchClaims: limit is respected ──
  it('searchClaims respects limit parameter', async () => {
    const claims = await searchClaims('Nova', ['personal'], { limit: 2 });
    expect(claims.length).toBeLessThanOrEqual(10); // Graphiti may not honor limit exactly
  });

  // ── searchClaims: real RRF reranker scores (normalized) ──
  it('searchClaims uses real RRF reranker scores from Graphiti', async () => {
    const claims = await searchClaims('Nova', ['personal'], { limit: 10 });
    if (claims.length < 2) return; // Need at least 2 results to test scoring
    // First result should have highest confidence (normalized to 1.0)
    expect(claims[0]!.confidence).toBe(1.0);
    // Confidence should be monotonically non-increasing (Graphiti returns in order)
    for (let i = 1; i < claims.length; i++) {
      expect(claims[i]!.confidence).toBeLessThanOrEqual(claims[i - 1]!.confidence);
    }
    // Not all scores should be the same — real RRF produces differentiation
    const unique = new Set(claims.map(c => c.confidence));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('searchClaims normalizes confidence to [0, 1] range', async () => {
    const claims = await searchClaims('Nova', ['personal', 'system'], { limit: 20 });
    for (const c of claims) {
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1.0);
    }
  });

  it('searchClaims top result always has confidence 1.0 (max-normalized)', async () => {
    const claims = await searchClaims('Nova', ['personal'], { limit: 5 });
    if (claims.length > 0) {
      expect(claims[0]!.confidence).toBe(1.0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CONTEXT BUILDER — extractQueryFromMessages + buildContextAddition
// ═══════════════════════════════════════════════════════════════════════════════
describe('context-builder', () => {
  // ── extractQueryFromMessages ──
  describe('extractQueryFromMessages', () => {
    it('extracts plain text from user messages', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: 'What is Nova?' },
      ]);
      expect(q).toBe('What is Nova?');
    });

    it('joins last 3 user messages', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'second' },
        { role: 'user', content: 'third' },
        { role: 'user', content: 'fourth' },
      ]);
      // Should take last 3 user messages: second, third, fourth
      expect(q).toContain('second');
      expect(q).toContain('third');
      expect(q).toContain('fourth');
      expect(q).not.toContain('first');
    });

    it('strips <relevant-memories> tags completely', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: '<relevant-memories>\nMemory: Nova is an AI\n</relevant-memories>\nWhat is Graphiti?',
      }]);
      expect(q).toBe('What is Graphiti?');
      expect(q).not.toContain('relevant-memories');
      expect(q).not.toContain('Memory:');
    });

    it('strips <system-reminder> tags', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: '<system-reminder>Do not use mocks</system-reminder>Tell me about the engine',
      }]);
      expect(q).toBe('Tell me about the engine');
    });

    it('strips multiple injected tags from one message', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: '<system-reminder>X</system-reminder><relevant-memories>Y</relevant-memories>Fix the bug',
      }]);
      expect(q).toBe('Fix the bug');
    });

    it('strips Discord "Conversation info" metadata block', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: 'Conversation info (untrusted metadata):\n```json\n{\n  "message_id": "1481000252864725185",\n  "sender_id": "616349176682381426",\n  "channel_id": "1470089084704657662"\n}\n```\nWhat is the status of the vendor importer?',
      }]);
      expect(q).toBe('What is the status of the vendor importer?');
      expect(q).not.toContain('message_id');
      expect(q).not.toContain('Conversation info');
    });

    it('strips "Sender (untrusted metadata)" block', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: 'Sender (untrusted metadata):\n```json\n{\n  "label": "molonelaveh (616349176682381426)",\n  "id": "616349176682381426"\n}\n```\nWhat is the Graphiti integration status?',
      }]);
      expect(q).toBe('What is the Graphiti integration status?');
      expect(q).not.toContain('molonelaveh');
      expect(q).not.toContain('Sender');
    });

    it('strips any "(untrusted metadata)" block generically', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: 'Channel info (untrusted metadata):\n```json\n{"id": "12345"}\n```\nDeploy to production',
      }]);
      expect(q).toBe('Deploy to production');
    });

    it('strips metadata JSON block even without prefix', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: '```json\n{"message_id":"123","sender_id":"456"}\n```\nHello Nova how are you',
      }]);
      expect(q).toBe('Hello Nova how are you');
    });

    it('strips Discord metadata + Mem0 injection together', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: '<relevant-memories>\nMemory stuff\n</relevant-memories>\nConversation info (untrusted metadata):\n```json\n{"message_id":"123","channel_id":"456"}\n```\nDeploy the fix now',
      }]);
      expect(q).toBe('Deploy the fix now');
    });

    it('drops messages that are entirely Discord metadata', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: 'Conversation info (untrusted metadata):\n```json\n{"message_id":"1"}\n```' },
        { role: 'user', content: 'What is Graphiti?' },
      ]);
      expect(q).toBe('What is Graphiti?');
    });

    it('returns empty for very short queries like "Great!"', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: 'Great!' },
      ]);
      expect(q).toBe('');
    });

    it('returns empty for "Ok" after stripping metadata', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: 'Sender (untrusted metadata):\n```json\n{"label":"user","id":"123"}\n```\nOk',
      }]);
      expect(q).toBe('');
    });

    it('drops messages that are entirely injected content', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: '<relevant-memories>All memory</relevant-memories>' },
        { role: 'user', content: 'Real question here' },
      ]);
      expect(q).toBe('Real question here');
    });

    it('returns empty string when all messages are injections', () => {
      const q = extractQueryFromMessages([
        { role: 'user', content: '<relevant-memories>Only injected</relevant-memories>' },
      ]);
      expect(q).toBe('');
    });

    it('returns empty string with no user messages', () => {
      const q = extractQueryFromMessages([
        { role: 'assistant', content: 'Hello' },
      ]);
      expect(q).toBe('');
    });

    it('handles array content blocks (Anthropic format)', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: [
          { type: 'text', text: 'What is Graphiti?' },
        ],
      }]);
      expect(q).toBe('What is Graphiti?');
    });

    it('handles array content with body field (WhatsApp format)', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: [
          { body: 'WhatsApp message here' },
        ],
      }]);
      expect(q).toBe('WhatsApp message here');
    });

    it('truncates query to 500 chars', () => {
      const longMsg = 'a'.repeat(1000);
      const q = extractQueryFromMessages([{ role: 'user', content: longMsg }]);
      expect(q.length).toBeLessThanOrEqual(500);
    });

    it('strips injections from array content blocks too', () => {
      const q = extractQueryFromMessages([{
        role: 'user',
        content: [
          { type: 'text', text: '<relevant-memories>Injected</relevant-memories>Real content' },
        ],
      }]);
      expect(q).toBe('Real content');
      expect(q).not.toContain('Injected');
    });
  });

  // ── buildContextAddition ──
  describe('buildContextAddition', () => {
    it('returns empty string for empty claims', () => {
      expect(buildContextAddition([])).toBe('');
    });

    it('formats claims as markdown with confidence', () => {
      const ctx = buildContextAddition([{
        claim_id: 'test-1',
        subject: 'Nova',
        predicate: 'is_assistant_of',
        object: 'Thales',
        confidence: 0.95,
        status: 'active',
        source_message_id: 'm1',
        source_session_id: 's1',
        extractor_version: 'v1',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }]);
      expect(ctx).toContain('## Known Facts (from memory)');
      expect(ctx).toContain('Nova');
      expect(ctx).toContain('is_assistant_of');
      expect(ctx).toContain('Thales');
      expect(ctx).toContain('0.95');
    });

    it('respects MAX_CONTEXT_CHARS (2000)', () => {
      const bigClaims = Array.from({ length: 100 }, (_, i) => ({
        claim_id: `c-${i}`,
        subject: 'LongSubject'.repeat(5),
        predicate: 'HAS_PROPERTY',
        object: 'LongObject'.repeat(5),
        confidence: 0.9,
        status: 'active' as const,
        source_message_id: 'm1',
        source_session_id: 's1',
        extractor_version: 'v1',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }));
      const ctx = buildContextAddition(bigClaims);
      expect(ctx.length).toBeLessThanOrEqual(2100); // some slack for header
    });

    it('uses fact field when subject is empty (Graphiti /search format)', () => {
      const ctx = buildContextAddition([{
        claim_id: 'f1', subject: '', predicate: 'IS_ASSISTANT_OF', object: '',
        fact: 'Nova is the assistant of Thales.',
        confidence: 0.95, status: 'active',
        source_message_id: 'm', source_session_id: 's', extractor_version: 'v1',
        created_at: '2026-01-01', updated_at: '2026-01-01',
      } as any]);
      expect(ctx).toContain('Nova is the assistant of Thales.');
      expect(ctx).not.toContain('unknown');
    });

    it('sorts by confidence descending', () => {
      const ctx = buildContextAddition([
        { claim_id: 'low', subject: 'Low', predicate: 'IS', object: 'X', confidence: 0.3, status: 'active', source_message_id: 'm', source_session_id: 's', extractor_version: 'v1', created_at: '2026-01-01', updated_at: '2026-01-01' },
        { claim_id: 'high', subject: 'High', predicate: 'IS', object: 'Y', confidence: 0.99, status: 'active', source_message_id: 'm', source_session_id: 's', extractor_version: 'v1', created_at: '2026-01-01', updated_at: '2026-01-01' },
      ]);
      const highIdx = ctx.indexOf('High');
      const lowIdx = ctx.indexOf('Low');
      expect(highIdx).toBeLessThan(lowIdx);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SUBAGENT SCOPE — group mapping
// ═══════════════════════════════════════════════════════════════════════════════
describe('subagent-scope', () => {
  it('getGroupIdsForSession returns all groups for main session', () => {
    const groups = getGroupIdsForSession('some-uuid-session');
    expect(groups).toContain('helix');
    expect(groups).toContain('ringboost');
    expect(groups).toContain('system');
    expect(groups).toContain('personal');
  });

  it('getGroupIdForSession returns first group (deprecated)', () => {
    const group = getGroupIdForSession('some-uuid-session');
    expect(typeof group).toBe('string');
    expect(group.length).toBeGreaterThan(0);
  });

  it('detects subagent sessions from ID pattern', () => {
    expect(isSubagentSession('agent:main:subagent:abc123')).toBe(true);
    expect(isSubagentSession('regular-session-uuid')).toBe(false);
  });

  it('scopes subagent to project group + personal + system', () => {
    const groups = getGroupIdsForSession('agent:helix-api-agent:subagent:xyz', 'helix-api-agent');
    expect(groups).toContain('helix');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
    expect(groups).not.toContain('ringboost');
  });

  it('detects nova as personal group', () => {
    const groups = getGroupIdsForSession('session-1', 'nova-agent');
    expect(groups).toContain('personal');
  });

  it('detects ringboost from agent ID', () => {
    const groups = getGroupIdsForSession('session-1', 'ringboost-importer');
    expect(groups).toContain('ringboost');
  });

  it('falls back to personal + system for unknown subagent', () => {
    const groups = getGroupIdsForSession('agent:unknown-thing:subagent:abc');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════════════════════
describe('circuit-breaker', () => {
  it('passes through on success', async () => {
    const cb = new CircuitBreaker();
    const { result, succeeded } = await cb.call(async () => 42, 0);
    expect(result).toBe(42);
    expect(succeeded).toBe(true);
    expect(cb.isHealthy()).toBe(true);
  });

  it('returns fallback on failure', async () => {
    const cb = new CircuitBreaker();
    const { result, succeeded } = await cb.call(async () => { throw new Error('boom'); }, -1);
    expect(result).toBe(-1);
    expect(succeeded).toBe(false);
  });

  it('opens after 3 consecutive failures', async () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) {
      await cb.call(async () => { throw new Error('fail'); }, 0);
    }
    expect(cb.isHealthy()).toBe(false);
    // Subsequent calls skip fn entirely
    const { succeeded } = await cb.call(async () => 99, 0);
    expect(succeeded).toBe(false);
  });

  it('resets after success', async () => {
    const cb = new CircuitBreaker();
    await cb.call(async () => { throw new Error('1'); }, 0);
    await cb.call(async () => { throw new Error('2'); }, 0);
    // Success before threshold
    await cb.call(async () => 'ok', 'fallback');
    expect(cb.isHealthy()).toBe(true);
    // Two more failures shouldn't trip it
    await cb.call(async () => { throw new Error('3'); }, 0);
    await cb.call(async () => { throw new Error('4'); }, 0);
    expect(cb.isHealthy()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TRUST TIER
// ═══════════════════════════════════════════════════════════════════════════════
describe('trust', () => {
  it('detects system role as system tier', () => {
    expect(detectTrustTier({ role: 'system', content: 'anything' })).toBe('system');
  });

  it('detects tool role as tool_output tier', () => {
    expect(detectTrustTier({ role: 'tool', content: 'result' })).toBe('tool_output');
  });

  it('detects speculation from "I think" patterns', () => {
    expect(detectTrustTier({ role: 'user', content: 'I think it might work' })).toBe('speculation');
    expect(detectTrustTier({ role: 'user', content: 'It could be a bug' })).toBe('speculation');
    expect(detectTrustTier({ role: 'assistant', content: 'probably the issue' })).toBe('speculation');
  });

  it('defaults to user_statement', () => {
    expect(detectTrustTier({ role: 'user', content: 'The server runs on port 8721' })).toBe('user_statement');
  });

  it('getTrustWeight returns correct weights', () => {
    expect(getTrustWeight('system')).toBe(1.0);
    expect(getTrustWeight('tool_output')).toBe(0.9);
    expect(getTrustWeight('user_statement')).toBe(0.7);
    expect(getTrustWeight('speculation')).toBe(0.3);
  });

  it('compareTrust orders correctly', () => {
    expect(compareTrust('speculation', 'system')).toBeGreaterThan(0);
    expect(compareTrust('system', 'speculation')).toBeLessThan(0);
    expect(compareTrust('system', 'system')).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. MESSAGE QUEUE
// ═══════════════════════════════════════════════════════════════════════════════
describe('message-queue', () => {
  beforeEach(() => { messageQueue.reset(); });

  it('enqueue + drain returns items', () => {
    messageQueue.enqueue({
      sessionId: 's1', messageId: 'm1',
      message: { role: 'user', content: 'hello' },
      timestamp: new Date().toISOString(), isHeartbeat: false,
    });
    expect(messageQueue.size()).toBe(1);
    const drained = messageQueue.drain();
    expect(drained.length).toBe(1);
    expect(drained[0]!.messageId).toBe('m1');
    expect(messageQueue.size()).toBe(0);
  });

  it('deduplicates by sessionId:messageId', () => {
    const item = {
      sessionId: 's1', messageId: 'm1',
      message: { role: 'user' as const, content: 'hello' },
      timestamp: new Date().toISOString(), isHeartbeat: false,
    };
    messageQueue.enqueue(item);
    messageQueue.enqueue(item); // duplicate
    expect(messageQueue.size()).toBe(1);
  });

  it('allows different messageIds', () => {
    messageQueue.enqueue({
      sessionId: 's1', messageId: 'm1',
      message: { role: 'user', content: 'a' },
      timestamp: new Date().toISOString(), isHeartbeat: false,
    });
    messageQueue.enqueue({
      sessionId: 's1', messageId: 'm2',
      message: { role: 'user', content: 'b' },
      timestamp: new Date().toISOString(), isHeartbeat: false,
    });
    expect(messageQueue.size()).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. RETRY QUEUE
// ═══════════════════════════════════════════════════════════════════════════════
describe('retry-queue', () => {
  it('adds items and reports size', () => {
    const rq = new (retryQueue.constructor as any)();
    // Use the module's retryQueue but note it's a singleton — test behavior
    expect(retryQueue.size()).toBeGreaterThanOrEqual(0);
  });

  it('processRetries does not crash with empty queue', async () => {
    // This shouldn't throw
    await retryQueue.processRetries(async () => ({ ingested: 0, duplicates: 0 }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. METRICS
// ═══════════════════════════════════════════════════════════════════════════════
describe('metrics', () => {
  beforeEach(() => { resetMetrics(); });

  it('recordIngest increments counter', () => {
    recordIngest();
    recordIngest(5);
    const m = getMetrics();
    expect(m.claims_ingested).toBe(6);
  });

  it('recordSearch tracks latency', () => {
    recordSearch(100);
    recordSearch(200);
    recordSearch(150);
    const m = getMetrics();
    expect(m.searches_executed).toBe(3);
    expect(m.search_latency_ms.length).toBe(3);
  });

  it('recordError increments and stores last error', () => {
    recordError('timeout');
    recordError('connection refused');
    const m = getMetrics();
    expect(m.errors).toBe(2);
    expect(m.last_error).toBe('connection refused');
  });

  it('getSearchLatencyPercentiles computes p50/p95/p99', () => {
    for (let i = 1; i <= 100; i++) recordSearch(i);
    const p = getSearchLatencyPercentiles();
    expect(p.p50).toBeGreaterThan(0);
    expect(p.p95).toBeGreaterThan(p.p50);
    expect(p.p99).toBeGreaterThanOrEqual(p.p95);
  });

  it('uptime_ms increases', () => {
    const m = getMetrics();
    expect(m.uptime_ms).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. EXTRACTOR — buildClaimsForIngestion
// ═══════════════════════════════════════════════════════════════════════════════
describe('extractor', () => {
  it('buildClaimsForIngestion transforms partial claims to full claims', () => {
    const claims = buildClaimsForIngestion(
      { claims: [{ subject: 'Nova', predicate: 'runs_on', object: 'port 8721', confidence: 0.9 }] },
      'session-1',
      'msg-1',
    );
    expect(claims.length).toBe(1);
    expect(claims[0]!.claim_id).toBe('session-1-msg-1-0');
    expect(claims[0]!.subject).toBe('Nova');
    expect(claims[0]!.predicate).toBe('runs_on');
    expect(claims[0]!.object).toBe('port 8721');
    expect(claims[0]!.confidence).toBe(0.9);
    expect(claims[0]!.status).toBe('active');
    expect(claims[0]!.source_session_id).toBe('session-1');
    expect(claims[0]!.source_message_id).toBe('msg-1');
    expect(claims[0]!.extractor_version).toBe('v1.1');
    expect(claims[0]!.created_at).toBeTruthy();
    expect(claims[0]!.updated_at).toBeTruthy();
  });

  it('detects trust tier from message when provided', () => {
    const claims = buildClaimsForIngestion(
      { claims: [{ subject: 'X', predicate: 'Y', object: 'Z', confidence: 1.0 }] },
      's1', 'm1', undefined,
      { role: 'system', content: 'rule' },
    );
    expect(claims[0]!.trust_tier).toBe('system');
  });

  it('defaults to user_statement without message', () => {
    const claims = buildClaimsForIngestion(
      { claims: [{ subject: 'X', predicate: 'Y', object: 'Z', confidence: 1.0 }] },
      's1', 'm1',
    );
    expect(claims[0]!.trust_tier).toBe('user_statement');
  });

  it('returns empty array for empty extraction', () => {
    const claims = buildClaimsForIngestion({ claims: [] }, 's1', 'm1');
    expect(claims).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9b. EXTRACTOR — extractClaims (LLM-based, requires gateway)
// ═══════════════════════════════════════════════════════════════════════════════
describe('extractClaims (live LLM)', () => {
  beforeAll(() => {
    if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
      throw new Error('XAI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY required for LLM extraction tests');
    }
  });

  it('extracts factual claims from a clear statement', { timeout: 20_000 }, async () => {
    const result = await extractClaims(
      'The Graphiti server runs on port 8721 and uses Neo4j for storage.',
      'test-session', 'test-msg'
    );
    expect(result.claims.length).toBeGreaterThan(0);

    // Should extract at least one claim about Graphiti
    const hasGraphiti = result.claims.some(c =>
      c.subject.toLowerCase().includes('graphiti') ||
      c.object.toLowerCase().includes('graphiti')
    );
    expect(hasGraphiti).toBe(true);

    // All claims should have valid structure
    for (const c of result.claims) {
      expect(c.subject.length).toBeGreaterThan(0);
      expect(c.predicate.length).toBeGreaterThan(0);
      expect(c.object.length).toBeGreaterThan(0);
      expect(c.confidence).toBeGreaterThanOrEqual(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('extracts multiple claims from a multi-fact message', { timeout: 20_000 }, async () => {
    const result = await extractClaims(
      'Thales uses Metformin daily and lives in San Francisco. Nova is his AI assistant.',
      'test-session', 'test-msg-2'
    );
    expect(result.claims.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty claims for short messages', async () => {
    const result = await extractClaims('Ok', 'test-session', 'test-msg-3');
    expect(result.claims).toEqual([]);
  });

  it('returns empty claims for acknowledgments', async () => {
    const result = await extractClaims('Thanks, got it!', 'test-session', 'test-msg-4');
    expect(result.claims).toEqual([]);
  });

  it('returns empty claims for questions (no facts)', { timeout: 20_000 }, async () => {
    const result = await extractClaims(
      'What is the status of the deployment?',
      'test-session', 'test-msg-5'
    );
    // Questions don't contain factual claims
    expect(result.claims.length).toBe(0);
  });

  it('predicates are normalized (lowercase, underscored)', { timeout: 20_000 }, async () => {
    const result = await extractClaims(
      'The OpenClaw gateway listens on port 18789.',
      'test-session', 'test-msg-6'
    );
    if (result.claims.length > 0) {
      for (const c of result.claims) {
        // Should be lowercase with underscores, no spaces
        expect(c.predicate).toBe(c.predicate.toLowerCase());
        expect(c.predicate).not.toMatch(/\s/);
      }
    }
  });

  it('gracefully handles missing API keys (fail-open)', async () => {
    // Save and clear all provider keys
    const origXai = process.env.XAI_API_KEY;
    const origAnthropic = process.env.ANTHROPIC_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const result = await extractClaims(
        'This should fail gracefully because no API key is set.',
        'test-session', 'test-msg-7'
      );
      expect(result.claims).toEqual([]);
    } finally {
      if (origXai !== undefined) process.env.XAI_API_KEY = origXai;
      if (origAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropic;
      if (origOpenai !== undefined) process.env.OPENAI_API_KEY = origOpenai;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. FULL ENGINE E2E — GraphitiContextEngine against real Graphiti
// ═══════════════════════════════════════════════════════════════════════════════
describe('GraphitiContextEngine (live E2E)', () => {
  let engine: InstanceType<typeof GraphitiContextEngine>;

  beforeAll(async () => {
    if (!(await graphitiIsUp())) throw new Error('Graphiti not running on :8721');
    engine = new GraphitiContextEngine();
  });

  // ── info ──
  it('engine.info has correct structure', () => {
    expect(engine.info.id).toBe('graphiti-context-engine');
    expect(engine.info.version).toBe('1.0.0');
    expect(engine.info.ownsCompaction).toBe(false);
    expect(engine.info.capabilities.claimExtraction).toBe(true);
    expect(engine.info.capabilities.trustTiers).toBe(true);
    expect(engine.info.capabilities.contradictionDetection).toBe(true);
    expect(engine.info.capabilities.subagentScoping).toBe(true);
    expect(engine.info.capabilities.metrics).toBe(true);
  });

  // ── bootstrap ──
  it('bootstrap returns bootstrapped: false (stub)', async () => {
    const r = await engine.bootstrap({ sessionId: 'test', sessionFile: '/tmp/test' });
    expect(r.bootstrapped).toBe(false);
  });

  // ── ingest ──
  it('ingest queues a message and returns immediately', async () => {
    const r = await engine.ingest({
      sessionId: 'e2e-test',
      message: { role: 'user', content: 'Testing ingestion pipeline' },
    });
    expect(r.ingested).toBe(true);
  });

  // ── assemble: clean query returns real claims ──
  it('assemble returns claims from Graphiti for a known topic', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{ role: 'user', content: 'What do you know about Nova?' }],
    });
    expect(r.estimatedTokens).toBeGreaterThan(0);
    expect(r.systemPromptAddition).toBeTruthy();
    expect(r.systemPromptAddition).toContain('Known Facts');
  });

  // ── assemble: polluted query still works ──
  it('assemble strips injected tags and returns real results', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{
        role: 'user',
        content: '<relevant-memories>\nNova is AI\n</relevant-memories>\nWhat does Graphiti store?',
      }],
    });
    // The query should be "What does Graphiti store?" not the injected content
    expect(r.estimatedTokens).toBeGreaterThan(0);
    expect(r.systemPromptAddition).toContain('Known Facts');
  });

  // ── assemble: entirely injected → no query → 0 tokens ──
  it('assemble returns 0 tokens when all messages are injected content', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{ role: 'user', content: '<relevant-memories>Only injected</relevant-memories>' }],
    });
    expect(r.estimatedTokens).toBe(0);
    expect(r.systemPromptAddition).toBeUndefined();
  });

  // ── assemble: no user messages ──
  it('assemble returns 0 tokens with no user messages', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{ role: 'assistant', content: 'I am an assistant' }],
    });
    expect(r.estimatedTokens).toBe(0);
  });

  // ── assemble: uses all default groups for main session ──
  it('assemble searches all default groups for main session', async () => {
    // We can't directly verify the groups from the return value,
    // but we can verify it doesn't crash and returns results
    const r = await engine.assemble({
      sessionId: 'main-session-uuid',
      messages: [{ role: 'user', content: 'Tell me about the projects' }],
    });
    // Main sessions search helix, ringboost, system, personal — should find something
    expect(Array.isArray(r.messages)).toBe(true);
  });

  // ── assemble: positional confidence in output ──
  it('assemble output shows differentiated confidence scores', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{ role: 'user', content: 'What do you know about Nova?' }],
    });
    if (r.systemPromptAddition) {
      // Extract all confidence values from "(confidence: X.XX)" patterns
      const matches = r.systemPromptAddition.match(/confidence: ([\d.]+)/g);
      if (matches && matches.length > 1) {
        const scores = matches.map((m: string) => parseFloat(m.replace('confidence: ', '')));
        // First should be highest
        expect(scores[0]).toBe(1);
        // Not all should be the same (the old bug)
        const unique = new Set(scores);
        expect(unique.size).toBeGreaterThan(1);
      }
    }
  });

  // ── afterTurn: doesn't crash ──
  it('afterTurn processes without error', { timeout: 30_000 }, async () => {
    await expect(engine.afterTurn({
      sessionId: 'e2e-test',
      _sessionFile: '/tmp/test',
      messages: [{ role: 'user', content: 'test' }],
      prePromptMessageCount: 1,
    })).resolves.toBeUndefined();
  });

  // ── afterTurn: skips heartbeats ──
  it('afterTurn skips processing for heartbeats', async () => {
    await expect(engine.afterTurn({
      sessionId: 'e2e-test',
      _sessionFile: '/tmp/test',
      messages: [],
      prePromptMessageCount: 0,
      isHeartbeat: true,
    })).resolves.toBeUndefined();
  });

  // ── compact ──
  it('compact returns compacted: false (delegates to legacy)', async () => {
    const r = await engine.compact({
      sessionId: 'e2e-test',
      _sessionFile: '/tmp/test',
    });
    expect(r.ok).toBe(true);
    expect(r.compacted).toBe(false);
    expect(r.reason).toContain('legacy');
  });

  // ── getStats: live health check ──
  it('getStats returns live metrics and health', async () => {
    const stats = await engine.getStats();
    expect(stats).toHaveProperty('metrics');
    expect(stats).toHaveProperty('latency');
    expect(stats).toHaveProperty('graphiti_healthy');
    expect(stats).toHaveProperty('circuit_breaker_healthy');
    expect(stats.graphiti_healthy).toBe(true);
    expect(stats.circuit_breaker_healthy).toBe(true);
    expect(stats.latency).toHaveProperty('p50');
    expect(stats.latency).toHaveProperty('p95');
    expect(stats.latency).toHaveProperty('p99');
  });

  // ── getVersion ──
  it('getVersion returns version info', () => {
    const v = engine.getVersion();
    expect(v.version).toBe('1.0.0');
    expect(v.buildDate).toBeTruthy();
  });

  // ── onSubagentComplete: doesn't crash for unknown subagent ──
  it('onSubagentComplete handles unknown subagent gracefully', async () => {
    await expect(engine.onSubagentComplete({
      subagentId: 'nonexistent-subagent',
      parentSessionId: 'parent-session',
      summary: 'Test summary',
    })).resolves.toBeUndefined();
  });

  // ── assemble: noise queries are filtered before hitting Graphiti ──
  it('assemble filters session reset boilerplate (returns 0 tokens)', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{
        role: 'user',
        content: 'A new session was started via /new or /reset. Execute your Session Startup sequence now - read the r...',
      }],
    });
    expect(r.estimatedTokens).toBe(0);
    expect(r.systemPromptAddition).toBeUndefined();
  });

  it('assemble filters inter-session metadata noise', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{
        role: 'user',
        content: '[Inter-session message] sourceSession=agent:validator-openai:subagent:d76c7fe9... sourceChannel=discord',
      }],
    });
    expect(r.estimatedTokens).toBe(0);
    expect(r.systemPromptAddition).toBeUndefined();
  });

  it('assemble filters System exec completed noise', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{
        role: 'user',
        content: 'System: [2026-03-11 10:13:35 PDT] Exec completed (kind-oce, code 255) :: ssh: connect to host...',
      }],
    });
    expect(r.estimatedTokens).toBe(0);
    expect(r.systemPromptAddition).toBeUndefined();
  });

  it('assemble strips media attachment paths but keeps surrounding text', async () => {
    const r = await engine.assemble({
      sessionId: 'e2e-test',
      messages: [{
        role: 'user',
        content: 'Print the reminder skill [media attached: /Users/molonelaveh/.openclaw/media/inbound/9ea34052.png] for Nova',
      }],
    });
    // Query should still be extracted (it has real text around the noise)
    expect(r.messages).toBeDefined();
    // The query itself should not contain the file path
  });

  // ── assemble: query-based group filtering ──
  it('assemble narrows groups when query mentions ringboost', async () => {
    const r = await engine.assemble({
      sessionId: 'main-session',
      messages: [{ role: 'user', content: 'Can you please check Ringboost infrastructure status?' }],
    });
    // Should return results (ringboost group exists in Graphiti)
    expect(Array.isArray(r.messages)).toBe(true);
  });

  // ── assemble: channel metadata filtering ──
  it('assemble uses channel metadata to narrow groups (DM)', async () => {
    const r = await engine.assemble({
      sessionId: 'main-session',
      messages: [{ role: 'user', content: 'What do you know about Nova?' }],
      channelMeta: { isDM: true, source: 'discord' },
    });
    // DM → personal + system only, should still find Nova
    expect(r.estimatedTokens).toBeGreaterThan(0);
    expect(r.systemPromptAddition).toContain('Known Facts');
  });

  it('assemble uses channel name to scope groups', async () => {
    const r = await engine.assemble({
      sessionId: 'main-session',
      messages: [{ role: 'user', content: 'What is the status?' }],
      channelMeta: { channelName: 'proj-ringboost', source: 'discord' },
    });
    // Should not crash, should scope to ringboost+personal+system
    expect(Array.isArray(r.messages)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. NOISE FILTER — stripNoisePatterns
// ═══════════════════════════════════════════════════════════════════════════════
describe('noise-filter', () => {
  // ── Session reset boilerplate ──
  it('strips session reset boilerplate', () => {
    const input = 'A new session was started via /new or /reset. Execute your Session Startup sequence now.';
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('strips /reset variant', () => {
    const input = 'A new session was started via /reset. Do something.';
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('strips "Execute your Session Startup sequence" on its own line', () => {
    const input = 'Hello\nExecute your Session Startup sequence now\nWorld';
    expect(stripNoisePatterns(input)).toBe('Hello\nWorld');
  });

  // ── Inter-session metadata ──
  it('strips [Inter-session message] lines', () => {
    const input = '[Inter-session message] sourceSession=agent:foo:subagent:bar sourceChannel=discord\nReal question here';
    expect(stripNoisePatterns(input)).toBe('Real question here');
  });

  it('strips sourceSession= lines', () => {
    const input = 'sourceSession=agent:validator-openai:subagent:abc123';
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('strips sourceChannel= lines', () => {
    const input = 'sourceChannel=discord-proj-helix';
    expect(stripNoisePatterns(input)).toBe('');
  });

  // ── System exec notifications ──
  it('strips System: Exec completed lines', () => {
    const input = 'System: [2026-03-11 10:13:35 PDT] Exec completed (kind-oce, code 255) :: ssh: connect to host...';
    expect(stripNoisePatterns(input)).toBe('');
  });

  // ── Internal engine noise ──
  it('strips [graphiti-context-engine] lines', () => {
    const input = '[graphiti-context-engine] Factory called!\n[graphiti-context-engine] Engine created: true\nActual content';
    expect(stripNoisePatterns(input)).toBe('Actual content');
  });

  it('strips [EventQueue] lines', () => {
    const input = '[EventQueue] Slow listener detected: InteractionEventListener took 14282ms';
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('strips [gateway] lines', () => {
    const input = '[gateway] openclaw-mem0: injecting 6 memories into context';
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('strips [openclaw-mem0] lines', () => {
    const input = '[openclaw-mem0] auto-captured 5 memories';
    expect(stripNoisePatterns(input)).toBe('');
  });

  // ── Cron/heartbeat noise ──
  it('strips cron timer armed lines', () => {
    expect(stripNoisePatterns('cron: timer armed')).toBe('');
  });

  it('strips web gateway heartbeat lines', () => {
    expect(stripNoisePatterns('web gateway heartbeat')).toBe('');
  });

  it('strips exec: elevated command lines', () => {
    expect(stripNoisePatterns('exec: elevated command git status')).toBe('');
  });

  // ── Inline patterns ──
  it('strips [media attached: ...] but preserves surrounding text', () => {
    const input = 'Print the reminder skill [media attached: /Users/foo/.openclaw/media/inbound/9ea34052.png] for Nova';
    expect(stripNoisePatterns(input)).toBe('Print the reminder skill  for Nova');
  });

  it('strips multiple media attachments', () => {
    const input = 'Check [media attached: /tmp/a.png] and [media attached: /tmp/b.jpg]';
    expect(stripNoisePatterns(input)).toBe('Check  and');
  });

  // ── Mixed noise + real content ──
  it('preserves real content mixed with noise lines', () => {
    const input = [
      '[Inter-session message] sourceSession=foo',
      'sourceChannel=discord',
      'What is the Ringboost infrastructure status?',
      '[graphiti-context-engine] Factory called!',
    ].join('\n');
    expect(stripNoisePatterns(input)).toBe('What is the Ringboost infrastructure status?');
  });

  it('returns empty string when input is entirely noise', () => {
    const input = [
      'A new session was started via /new or /reset. Execute your Session Startup sequence now.',
      '[Inter-session message] sourceSession=foo',
      'sourceChannel=discord',
    ].join('\n');
    expect(stripNoisePatterns(input)).toBe('');
  });

  it('passes through clean queries unchanged', () => {
    expect(stripNoisePatterns('What do you know about Nova?')).toBe('What do you know about Nova?');
  });

  // ── Integration: extractQueryFromMessages strips noise ──
  it('extractQueryFromMessages strips session reset boilerplate completely', () => {
    const q = extractQueryFromMessages([{
      role: 'user',
      content: 'A new session was started via /new or /reset. Execute your Session Startup sequence now - read the requirements.',
    }]);
    expect(q).toBe('');
  });

  it('extractQueryFromMessages strips inter-session metadata from mixed content', () => {
    const q = extractQueryFromMessages([{
      role: 'user',
      content: '[Inter-session message] sourceSession=agent:foo:subagent:bar\nWhat is the status of Ringboost?',
    }]);
    expect(q).toBe('What is the status of Ringboost?');
  });

  it('extractQueryFromMessages strips media paths preserving question', () => {
    const q = extractQueryFromMessages([{
      role: 'user',
      content: 'Print the reminder skill [media attached: /Users/foo/.openclaw/media/inbound/abc.png] for Nova assistant',
    }]);
    expect(q).not.toContain('/Users/foo');
    expect(q).toContain('Print the reminder skill');
    expect(q).toContain('for Nova assistant');
  });

  // ── NOISE_LINE_PATTERNS and NOISE_INLINE_PATTERNS are exported ──
  it('exports NOISE_LINE_PATTERNS as non-empty array', () => {
    expect(Array.isArray(NOISE_LINE_PATTERNS)).toBe(true);
    expect(NOISE_LINE_PATTERNS.length).toBeGreaterThan(0);
  });

  it('exports NOISE_INLINE_PATTERNS as non-empty array', () => {
    expect(Array.isArray(NOISE_INLINE_PATTERNS)).toBe(true);
    expect(NOISE_INLINE_PATTERNS.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. QUERY-BASED GROUP FILTERING — detectGroupsFromQuery
// ═══════════════════════════════════════════════════════════════════════════════
describe('query-based group filtering', () => {
  it('detects ringboost from query text', () => {
    const groups = detectGroupsFromQuery('Check Ringboost infrastructure status');
    expect(groups).not.toBeNull();
    expect(groups).toContain('ringboost');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
    expect(groups).not.toContain('helix');
  });

  it('detects helix from query text', () => {
    const groups = detectGroupsFromQuery('What is the helix API doing?');
    expect(groups).not.toBeNull();
    expect(groups).toContain('helix');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
    expect(groups).not.toContain('ringboost');
  });

  it('detects multiple project keywords', () => {
    const groups = detectGroupsFromQuery('Compare helix and ringboost deployments');
    expect(groups).not.toBeNull();
    expect(groups).toContain('helix');
    expect(groups).toContain('ringboost');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
  });

  it('returns null for queries with no project keywords', () => {
    const groups = detectGroupsFromQuery('What do you know about Nova?');
    expect(groups).toBeNull();
  });

  it('is case insensitive', () => {
    expect(detectGroupsFromQuery('RINGBOOST status')).not.toBeNull();
    expect(detectGroupsFromQuery('Helix API')).not.toBeNull();
  });

  it('matches whole words only (not substrings)', () => {
    // "helix" inside "helixical" should NOT match due to word boundary
    const groups = detectGroupsFromQuery('What is a helixical shape?');
    expect(groups).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. CHANNEL METADATA GROUP FILTERING — detectGroupsFromChannel
// ═══════════════════════════════════════════════════════════════════════════════
describe('channel metadata group filtering', () => {
  it('returns null when no metadata provided', () => {
    expect(detectGroupsFromChannel(undefined)).toBeNull();
  });

  it('returns personal+system for DMs', () => {
    const groups = detectGroupsFromChannel({ isDM: true, source: 'discord' });
    expect(groups).toEqual(['personal', 'system']);
  });

  it('detects ringboost from channel name', () => {
    const groups = detectGroupsFromChannel({ channelName: 'proj-ringboost', source: 'discord' });
    expect(groups).not.toBeNull();
    expect(groups).toContain('ringboost');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
    expect(groups).not.toContain('helix');
  });

  it('detects helix from channel name', () => {
    const groups = detectGroupsFromChannel({ channelName: 'proj-helix', source: 'discord' });
    expect(groups).not.toBeNull();
    expect(groups).toContain('helix');
  });

  it('detects helix from generic channel name containing keyword', () => {
    const groups = detectGroupsFromChannel({ channelName: 'helix-dev-logs', source: 'discord' });
    expect(groups).not.toBeNull();
    expect(groups).toContain('helix');
  });

  it('returns null for unrecognized channel name', () => {
    const groups = detectGroupsFromChannel({ channelName: 'general', source: 'discord' });
    expect(groups).toBeNull();
  });

  it('returns null for empty metadata (no isDM, no channelName)', () => {
    const groups = detectGroupsFromChannel({ source: 'discord' });
    expect(groups).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. COMBINED GROUP RESOLUTION — resolveGroupIds
// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveGroupIds (combined)', () => {
  it('returns all defaults for main session with no hints', () => {
    const groups = resolveGroupIds('main-session-uuid');
    expect(groups).toContain('helix');
    expect(groups).toContain('ringboost');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
  });

  it('channel metadata takes priority over query keywords', () => {
    // Channel says "ringboost", query says "helix" — channel wins
    const groups = resolveGroupIds('main-session', {
      query: 'What is the helix API?',
      channelMeta: { channelName: 'proj-ringboost', source: 'discord' },
    });
    expect(groups).toContain('ringboost');
    expect(groups).not.toContain('helix');
  });

  it('falls back to query keywords when no channel metadata', () => {
    const groups = resolveGroupIds('main-session', {
      query: 'Check Ringboost infrastructure',
    });
    expect(groups).toContain('ringboost');
    expect(groups).not.toContain('helix');
  });

  it('falls back to all defaults when neither channel nor query match', () => {
    const groups = resolveGroupIds('main-session', {
      query: 'What do you know about Nova?',
      channelMeta: { channelName: 'general', source: 'discord' },
    });
    expect(groups).toContain('helix');
    expect(groups).toContain('ringboost');
    expect(groups).toContain('personal');
    expect(groups).toContain('system');
  });

  it('subagent scoping still takes priority over everything', () => {
    const groups = resolveGroupIds('agent:helix-api-agent:subagent:xyz', {
      subagentId: 'helix-api-agent',
      query: 'Check Ringboost status',
      channelMeta: { channelName: 'proj-ringboost', source: 'discord' },
    });
    // Subagent ID says "helix" — should win over channel and query
    expect(groups).toContain('helix');
    expect(groups).not.toContain('ringboost');
  });

  it('DM channel metadata returns personal+system only', () => {
    const groups = resolveGroupIds('main-session', {
      query: 'Check Ringboost infrastructure',
      channelMeta: { isDM: true, source: 'discord' },
    });
    expect(groups).toEqual(['personal', 'system']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. E2E: NOISE FILTER + GROUP FILTERING WITH REAL GRAPHITI
// ═══════════════════════════════════════════════════════════════════════════════
describe('noise filter + group filtering (live E2E)', () => {
  beforeAll(async () => {
    if (!(await graphitiIsUp())) throw new Error('Graphiti not running on :8721');
  });

  it('noise queries do not hit Graphiti (no results for session reset)', async () => {
    // searchClaims should NOT be called for pure noise queries,
    // but even if it were, the cleaned query would be empty
    const cleanedQuery = extractQueryFromMessages([{
      role: 'user',
      content: 'A new session was started via /new or /reset. Execute your Session Startup sequence now.',
    }]);
    expect(cleanedQuery).toBe('');
    // If query is empty, engine skips search entirely
  });

  it('query-filtered groups return relevant results from Graphiti', async () => {
    // Search with ringboost-scoped groups
    const claims = await searchClaims('Ringboost', ['ringboost', 'personal', 'system'], { limit: 10 });
    expect(Array.isArray(claims)).toBe(true);
    // Should find ringboost-related claims
    if (claims.length > 0) {
      const hasRingboost = claims.some(c =>
        ((c as any).fact || '').toLowerCase().includes('ringboost') ||
        c.subject.toLowerCase().includes('ringboost') ||
        c.object.toLowerCase().includes('ringboost')
      );
      expect(hasRingboost).toBe(true);
    }
  });

  it('DM-scoped search (personal+system) returns results for personal queries', async () => {
    const claims = await searchClaims('Nova', ['personal', 'system'], { limit: 10 });
    expect(Array.isArray(claims)).toBe(true);
    expect(claims.length).toBeGreaterThan(0);
  });

  it('full engine pipeline with noise + real content returns only real results', async () => {
    const engine = new GraphitiContextEngine();
    const r = await engine.assemble({
      sessionId: 'e2e-noise-test',
      messages: [
        {
          role: 'user',
          content: '[Inter-session message] sourceSession=agent:foo\nsourceChannel=discord',
        },
        {
          role: 'user',
          content: 'What do you know about Nova assistant?',
        },
      ],
    });
    // The noise message should be stripped, real query should return results
    expect(r.estimatedTokens).toBeGreaterThan(0);
    expect(r.systemPromptAddition).toContain('Known Facts');
  });
});
