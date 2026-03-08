import { describe, it, expect } from 'vitest';
import { detectTrustTier, getTrustWeight, compareTrust } from '../src/trust.js';

describe('Trust Tiers', () => {
  it('should detect system tier for system messages', () => {
    expect(detectTrustTier({ role: 'system', content: 'Rules' })).toBe('system');
  });

  it('should detect tool_output for tool messages', () => {
    expect(detectTrustTier({ role: 'tool', content: 'Result' })).toBe('tool_output');
  });

  it('should detect speculation from content patterns', () => {
    expect(detectTrustTier({ role: 'user', content: 'I think it might be X' })).toBe('speculation');
    expect(detectTrustTier({ role: 'user', content: 'Maybe this is the issue' })).toBe('speculation');
    expect(detectTrustTier({ role: 'user', content: 'It could be Y' })).toBe('speculation');
  });

  it('should default to user_statement', () => {
    expect(detectTrustTier({ role: 'user', content: 'The sky is blue' })).toBe('user_statement');
  });

  it('should return correct trust weights', () => {
    expect(getTrustWeight('system')).toBe(1.0);
    expect(getTrustWeight('tool_output')).toBe(0.9);
    expect(getTrustWeight('user_statement')).toBe(0.7);
    expect(getTrustWeight('speculation')).toBe(0.3);
  });

  it('should compare trust tiers correctly', () => {
    expect(compareTrust('speculation', 'system')).toBeGreaterThan(0);
    expect(compareTrust('system', 'speculation')).toBeLessThan(0);
    expect(compareTrust('system', 'system')).toBe(0);
  });
});
