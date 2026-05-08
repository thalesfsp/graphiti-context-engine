import { describe, it, expect, beforeEach } from 'vitest';
import { GraphitiContextEngine } from '../src/engine.js';
import { messageQueue } from '../src/queue.js';

async function waitUntil(predicate: () => boolean, timeoutMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Integration: Full Pipeline', () => {
  let engine: GraphitiContextEngine;

  beforeEach(() => {
    engine = new GraphitiContextEngine();
    // Clear queue between tests
    messageQueue.drain();
  });

  it('should complete full ingest → afterTurn → assemble cycle', async () => {
    // 1. Ingest a message
    const ingestResult = await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'user', content: 'My name is John and I live in Seattle' },
    });
    expect(ingestResult.ingested).toBe(true);
    expect(messageQueue.size()).toBe(1);

    // 2. Run afterTurn (schedules queue processing without blocking)
    const start = Date.now();
    await engine.afterTurn({
      sessionId: 'test-session',
      sessionFile: '',
      messages: [],
      prePromptMessageCount: 0,
    });
    expect(Date.now() - start).toBeLessThan(10);

    await waitUntil(() => messageQueue.size() === 0);
    expect(messageQueue.size()).toBe(0);

    // 3. Assemble (retrieves context)
    const assembleResult = await engine.assemble({
      sessionId: 'test-session',
      messages: [{ role: 'user', content: 'Where do I live?' }],
    });
    expect(assembleResult.messages).toBeDefined();
    expect(assembleResult.estimatedTokens).toBeGreaterThanOrEqual(0);
  });

  it('should handle compact correctly', async () => {
    await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'user', content: 'Test message for compaction' },
    });

    const compactResult = await engine.compact({
      sessionId: 'test-session',
      sessionFile: '',
    });

    expect(compactResult.ok).toBe(true);
    expect(compactResult.compacted).toBe(false); // Delegates to legacy
    expect(messageQueue.size()).toBe(0);
  });

  it('should gracefully degrade when Graphiti is unavailable', async () => {
    // This tests the circuit breaker / fallback behavior
    // Even if Graphiti is down, these should not throw

    const assembleResult = await engine.assemble({
      sessionId: 'test-session',
      messages: [{ role: 'user', content: 'Test query' }],
    });

    // Should return empty/default, not throw
    expect(assembleResult.messages).toBeDefined();
  });

  it('should skip heartbeat in afterTurn', async () => {
    await engine.ingest({
      sessionId: 'test-session',
      message: { role: 'user', content: 'Heartbeat message' },
      isHeartbeat: true,
    });
    expect(messageQueue.size()).toBe(1);

    await engine.afterTurn({
      sessionId: 'test-session',
      sessionFile: '',
      messages: [],
      prePromptMessageCount: 0,
      isHeartbeat: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    // afterTurn skips processing for heartbeats, queue remains
    expect(messageQueue.size()).toBe(1);
  });
});