import { describe, it, expect } from 'vitest';
import { GraphitiContextEngine } from '../src/engine.js';

describe('GraphitiContextEngine', () => {
  it('initializes without errors', () => {
    const engine = new GraphitiContextEngine();
    expect(engine.info.id).toBe('graphiti-context-engine');
  });

  it('ingest returns ingested true', async () => {
    const engine = new GraphitiContextEngine();
    const result = await engine.ingest({ sessionId: 'test', message: {} as any });
    expect(result.ingested).toBe(true);
  });

  it('assemble returns empty messages', async () => {
    const engine = new GraphitiContextEngine();
    const result = await engine.assemble({ sessionId: 'test', messages: [] });
    expect(result.messages).toEqual([]);
    expect(result.estimatedTokens).toBe(0);
  });

  it('compact returns no compaction', async () => {
    const engine = new GraphitiContextEngine();
    const result = await engine.compact({ sessionId: 'test', sessionFile: 'test.json' });
    expect(result.ok).toBe(true);
    expect(result.compacted).toBe(false);
  });
});
