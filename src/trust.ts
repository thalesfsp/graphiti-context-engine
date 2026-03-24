import { TrustTier, TRUST_WEIGHTS, AgentMessage } from './types.js';

export function detectTrustTier(message: AgentMessage): TrustTier {
  // System messages (instructions, rules)
  if (message.role === 'system') return 'system';
  
  // Tool outputs (function results)
  if (message.role === 'tool') return 'tool_output';
  
  // Check content patterns for speculation
  const content = typeof message.content === 'string' ? message.content : '';
  const speculationPatterns = [
    /I think/i,
    /probably/i,
    /might be/i,
    /maybe/i,
    /I assume/i,
    /I believe/i,
    /possibly/i,
    /could be/i,
  ];
  
  if (speculationPatterns.some(p => p.test(content))) {
    return 'speculation';
  }
  
  // Default: user statement
  return 'user_statement';
}

export function getTrustWeight(tier: TrustTier): number {
  return TRUST_WEIGHTS[tier];
}

export function compareTrust(a: TrustTier, b: TrustTier): number {
  return TRUST_WEIGHTS[b] - TRUST_WEIGHTS[a]; // Higher weight = higher priority
}