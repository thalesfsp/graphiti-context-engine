import { Claim } from './types.js';

const EXTRACTOR_VERSION = 'v1.0';

export interface PartialClaim {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

export interface ExtractionResult {
  claims: PartialClaim[];
}

export async function extractClaims(
  _text: string,
  _sessionId: string,
  _messageId: string,
  _authorId?: string
): Promise<ExtractionResult> {
  // For now, use a simple prompt-based extraction
  // In production, this would call OpenClaw's LLM
  


  // TODO: Actually call LLM here
  // TODO: Actually call LLM here
  // For scaffold, return empty claims
  return { claims: [] };
}

export function buildClaimsForIngestion(
  extractionResult: ExtractionResult,
  sessionId: string,
  messageId: string,
  authorId?: string
): Claim[] {
  const now = new Date().toISOString();
  
  return extractionResult.claims.map((c, i) => ({
    claim_id: `${sessionId}-${messageId}-${i}`,
    subject: c.subject,
    predicate: c.predicate,
    object: c.object,
    qualifiers: {},
    confidence: c.confidence,
    status: 'active' as const,
    source_message_id: messageId,
    source_session_id: sessionId,
    source_author_id: authorId,
    extractor_version: EXTRACTOR_VERSION,
    created_at: now,
    updated_at: now,
  }));
}