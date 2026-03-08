import { describe, it, expect } from 'vitest';
import { GraphitiContextEngine } from '../src/engine.js';
import { messageQueue } from '../src/queue.js';

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

  it('afterTurn() should process queued messages', async () => {
    // Mock extractClaims and ingestClaims to avoid real calls
    const { extractClaims: mockExtract, buildClaimsForIngestion: mockBuild } = await import('../src/extractor.js');
    const { ingestClaims: mockIngest } = await import('../src/graphiti-client.js');
    
    const mockExtractSpy = vi.spyOn({ extractClaims: mockExtract }, 'extractClaims');
    const mockIngestSpy = vi.spyOn({ ingestClaims: mockIngest }, 'ingestClaims');
    
    // Enqueue a message
    const engine = new GraphitiContextEngine();
    await engine.ingest({ sessionId: 'test', message: { role: 'user', content: 'My name is John' } });

    // Run afterTurn
    await engine.afterTurn({ 
      sessionId: 'test', 
      sessionFile: '', 
      messages: [], 
      prePromptMessageCount: 0 
    });

    // Queue should be empty
    expect(messageQueue.size()).toBe(0);
    expect(mockExtractSpy).toHaveBeenCalled();
    expect(mockIngestSpy).not.toHaveBeenCalled(); // No claims expected from mock, but at least extraction called
  }, 10000);

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
