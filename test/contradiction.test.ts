import { describe, it, expect } from 'vitest';
import { detectContradictions, resolveContradiction } from '../src/contradiction.js';
import type { Claim } from '../src/types.js';

describe('Contradiction Detection', () => {
  it('should detect direct contradiction on same subject+predicate', async () => {
    const existing: Claim = {
      claim_id: 'c1',
      subject: 'John',
      predicate: 'lives_in',
      object: 'Seattle',
      confidence: 1.0,
      status: 'active',
      source_message_id: 'msg1',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const newClaim: Claim = {
      claim_id: 'c2',
      subject: 'John',
      predicate: 'lives_in',
      object: 'New York',
      confidence: 1.0,
      status: 'active',
      source_message_id: 'msg2',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    
    const contradictions = await detectContradictions(newClaim, [existing]);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].conflict_type).toBe('direct');
  });
  
  it('should not detect contradiction for different subjects', async () => {
    const existing: Partial<Claim> = { 
      subject: 'John', 
      predicate: 'lives_in', 
      object: 'Seattle',
      claim_id: 'c1',
      confidence: 1.0,
      status: 'active' as const,
      source_message_id: 'msg1',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const newClaim: Partial<Claim> = { 
      subject: 'Jane', 
      predicate: 'lives_in', 
      object: 'New York',
      claim_id: 'c3',
      confidence: 1.0,
      status: 'active' as const,
      source_message_id: 'msg3',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };
    
    const contradictions = await detectContradictions(newClaim as Claim, [existing as Claim]);
    expect(contradictions).toHaveLength(0);
  });
  
  it('should resolve by trust tier', () => {
    const systemClaim: Partial<Claim> = { 
      trust_tier: 'system', 
      created_at: '2026-01-01T00:00:00Z',
      claim_id: 'c4',
      subject: 'test',
      predicate: 'test',
      object: 'test',
      confidence: 1.0,
      status: 'active' as const,
      source_message_id: 'msg4',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const userClaim: Partial<Claim> = { 
      trust_tier: 'user_statement', 
      created_at: '2026-01-02T00:00:00Z',
      claim_id: 'c5',
      subject: 'test',
      predicate: 'test',
      object: 'other',
      confidence: 1.0,
      status: 'active' as const,
      source_message_id: 'msg5',
      source_session_id: 'sess1',
      extractor_version: 'v1',
      updated_at: '2026-01-02T00:00:00Z',
    };
    
    const result = resolveContradiction({} as any, systemClaim as Claim, userClaim as Claim);
    expect(result).toBe('claim_a_wins');
  });
});
