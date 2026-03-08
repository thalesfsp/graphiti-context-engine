const EXTRACTOR_VERSION = 'v1.0';
export async function extractClaims(_text, _sessionId, _messageId, _authorId) {
    // For now, use a simple prompt-based extraction
    // In production, this would call OpenClaw's LLM
    // TODO: Actually call LLM here
    // TODO: Actually call LLM here
    // For scaffold, return empty claims
    return { claims: [] };
}
export function buildClaimsForIngestion(extractionResult, sessionId, messageId, authorId) {
    const now = new Date().toISOString();
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
    }));
}
//# sourceMappingURL=extractor.js.map