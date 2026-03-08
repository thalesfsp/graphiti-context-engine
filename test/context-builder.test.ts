import { describe, it, expect } from 'vitest';
import { buildContextAddition, extractQueryFromMessages } from '../src/context-builder.js';
import type { Claim, AgentMessage } from '../src/types.js';

describe('context-builder', () => {
  describe('buildContextAddition', () => {
    it('should build context string from claims', () => {
      const claims: Claim[] = [
        {
          claim_id: '1',
          subject: 'Greice',
          predicate: 'birthday',
          object: 'March 15',
          confidence: 0.9,
          status: 'active',
          source_message_id: 'msg1',
          source_session_id: 'sess1',
          extractor_version: 'v1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ];
      const context = buildContextAddition(claims);
      expect(context).toContain('Greice birthday March 15');
      expect(context).toContain('confidence: 0.9');
    });

    it('should truncate to MAX_CONTEXT_CHARS', () => {
      const manyClaims: Claim[] = [];
      for (let i = 0; i < 100; i++) {
        manyClaims.push({
          claim_id: i.toString(),
          subject: `Subject${i}`,
          predicate: 'is',
          object: `Object${i}`,
          confidence: 0.9,
          status: 'active',
          source_message_id: `msg${i}`,
          source_session_id: 'sess1',
          extractor_version: 'v1',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        });
      }
      const context = buildContextAddition(manyClaims);
      expect(context.length).toBeLessThanOrEqual(2000);
    });

    it('should sort by confidence then recency', () => {
      const claims: Claim[] = [
        { claim_id: 'low', subject: 'A', predicate: 'is', object: 'low', confidence: 0.5, status: 'active', source_message_id: '1', source_session_id: 's', extractor_version: 'v1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
        { claim_id: 'high-old', subject: 'B', predicate: 'is', object: 'high-old', confidence: 0.9, status: 'active', source_message_id: '2', source_session_id: 's', extractor_version: 'v1', created_at: '2026-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' },
        { claim_id: 'high-new', subject: 'C', predicate: 'is', object: 'high-new', confidence: 0.9, status: 'active', source_message_id: '3', source_session_id: 's', extractor_version: 'v1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
      ];
      const context = buildContextAddition(claims);
      expect(context).toContain('C is high-new'); // high-new first among high conf
      expect(context).toContain('B is high-old');
      expect(context).toContain('A is low'); // lower conf last
    });

    it('should return empty string for no claims', () => {
      expect(buildContextAddition([])).toBe('');
    });
  });

  describe('extractQueryFromMessages', () => {
    it('should extract from last 3 user messages', () => {
      const messages: AgentMessage[] = [
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'msg1' },
        { role: 'user', content: 'msg2' },
        { role: 'user', content: 'msg3' },
        { role: 'user', content: 'msg4' },
      ];
      const query = extractQueryFromMessages(messages);
      expect(query).toBe('msg2 msg3 msg4');
    });

    it('should handle non-string content', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: ['not string'] as any },
      ];
      const query = extractQueryFromMessages(messages);
      expect(query).toBe('');
    });

    it('should truncate query to 500 chars', () => {
      const longMsg = 'a'.repeat(600);
      const messages: AgentMessage[] = [{ role: 'user', content: longMsg }];
      const query = extractQueryFromMessages(messages);
      expect(query.length).toBe(500);
    });
  });
});