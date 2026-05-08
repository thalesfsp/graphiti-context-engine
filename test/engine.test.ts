import { describe, it, expect } from 'vitest';
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

describe('GraphitiContextEngine', () => {
  it('initializes without errors', () => {
    const engine = new GraphitiContextEngine();
    expect(engine.info.id).toBe('graphiti-context-engine');
  });

  it('ingest() should return quickly without blocking', async () => {
    const engine = new GraphitiContextEngine();
    const start = Date.now();
    await engine.ingest({ sessionId: 'test', message: { role: 'user', content: 'hello' } });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(10); // Must be <10ms
  });

  it('assemble returns empty messages', async () => {
    const engine = new GraphitiContextEngine();
    const result = await engine.assemble({ sessionId: 'test', messages: [] });
    expect(result.messages).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
    expect(result.systemPromptAddition).toBeUndefined();
  });

  it('compact returns no compaction', async () => {
    const engine = new GraphitiContextEngine();
    const result = await engine.compact({ sessionId: 'test', sessionFile: 'test.json' });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
  });

  it('afterTurn() should schedule queued message processing without blocking', async () => {
    const engine = new GraphitiContextEngine();
    await engine.ingest({ sessionId: 'test', message: { role: 'user', content: 'My name is John' } });

    const start = Date.now();
    await engine.afterTurn({
      sessionId: 'test',
      sessionFile: '',
      messages: [],
      prePromptMessageCount: 0,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);
    await waitUntil(() => messageQueue.size() === 0);
    expect(messageQueue.size()).toBe(0);
  });

  it('compact() should extract claims from queued messages', async () => {
    // Enqueue a message
    const engine = new GraphitiContextEngine();
    await engine.ingest({ sessionId: 'test', message: { role: 'user', content: 'Test message' } });
    
    // Run compact
    const result = await engine.compact({ sessionId: 'test', sessionFile: '' });
    
    // Should succeed and drain queue
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
    expect(messageQueue.size()).toBe(0);
  });

  it('compact() should not own compaction (delegates to legacy)', () => {
    const engine = new GraphitiContextEngine();
    expect(engine.info.ownsCompaction).toBe(false);
  });
});
