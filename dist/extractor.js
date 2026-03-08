import { detectTrustTier } from './trust.js';
const EXTRACTOR_VERSION = 'v1.0';
// Stub for now
export async function detectSupersession(_newClaim, _existingClaims) {
    // TODO: LLM-based contradiction detection
    return { supersedes: [] };
}
export async function extractClaims(_text, _sessionId, _messageId, _authorId) {
    // For now, use a simple prompt-based extraction
    // In production, this would call OpenClaw's LLM
    // TODO: Actually call LLM here
    // TODO: Actually call LLM here
    // For scaffold, return empty claims
    return { claims: [] };
}
export function buildClaimsForIngestion(extractionResult, sessionId, messageId, authorId, message // Add message param
) {
    const now = new Date().toISOString();
    const trustTier = message ? detectTrustTier(message) : 'user_statement';
    return extractionResult.claims.map((c, i) => ({
        claim_id: `${sessionId}-${messageId}-${i}`,
        subject: c.subject,
        predicate: c.predicate,
        object: c.object,
        qualifiers: {},
        confidence: c.confidence,
        status: 'active',
        source_message_id: messageId,
        source_session_id: sessionId,
        source_author_id: authorId,
        extractor_version: EXTRACTOR_VERSION,
        created_at: now,
        updated_at: now,
        trust_tier: trustTier,
    }));
}
//# sourceMappingURL=extractor.js.map