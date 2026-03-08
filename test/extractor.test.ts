import { describe, it, expect } from 'vitest';
import { buildClaimsForIngestion } from '../src/extractor.js';
import type { PartialClaim } from '../src/extractor.js';

describe('extractor', () => {
  describe('buildClaimsForIngestion', () => {
    it('should build claims with provenance', () => {
      const extraction = {
        claims: [
          { subject: 'John', predicate: 'name is', object: 'John Doe', confidence: 0.95 }
        ] as PartialClaim[],
      };

      const claims = buildClaimsForIngestion(extraction, 'test-session', 'test-msg', 'test-author');

      expect(claims).toHaveLength(1);
      expect(claims[0].claim_id).toBe('test-session-test-msg-0');
      expect(claims[0].subject).toBe('John');
      expect(claims[0].predicate).toBe('name is');
      expect(claims[0].object).toBe('John Doe');
      expect(claims[0].confidence).toBe(0.95);
      expect(claims[0].source_session_id).toBe('test-session');
      expect(claims[0].source_message_id).toBe('test-msg');
      expect(claims[0].source_author_id).toBe('test-author');
      expect(claims[0].extractor_version).toBe('v1.0');
      expect(claims[0].status).toBe('active');
      expect(claims[0].qualifiers).toEqual({});
      expect(claims[0].created_at).toBeDefined();
      expect(claims[0].updated_at).toBeDefined();
    });
  });
});