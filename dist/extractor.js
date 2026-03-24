import { detectTrustTier } from './trust.js';
const EXTRACTOR_VERSION = 'v1.1';
// Stub for now
export async function detectSupersession(_newClaim, _existingClaims) {
    // TODO: LLM-based contradiction detection
    return { supersedes: [] };
}
/**
 * Resolve ALL available LLM providers for extraction (ordered by priority).
 * Used for fallback: if the primary provider fails (rate limit, 429, etc.),
 * we try the next one.
 *
 * Priority:
 *   1. ANTHROPIC_OAT_KEY   → Claude Haiku 4.5 (subscription-backed, free)
 *   2. XAI_API_KEY         → xAI / Grok 4.1 Fast (plenty of credits)
 *   3. ANTHROPIC_API_KEY   → Anthropic / Claude Haiku 4.5 (pay-per-token)
 *   4. OPENAI_API_KEY      → OpenAI / GPT-4o-mini (fallback)
 *
 * Env vars for full override:
 *   GRAPHITI_EXTRACTION_URL + GRAPHITI_EXTRACTION_KEY — bypasses all
 *   GRAPHITI_EXTRACTION_MODEL — override model for any provider
 */
function resolveProviders() {
    // Explicit override — full control, no fallbacks
    if (process.env.GRAPHITI_EXTRACTION_URL && process.env.GRAPHITI_EXTRACTION_KEY) {
        return [{
                url: process.env.GRAPHITI_EXTRACTION_URL,
                key: process.env.GRAPHITI_EXTRACTION_KEY,
                model: process.env.GRAPHITI_EXTRACTION_MODEL || 'gpt-4o-mini',
                name: 'custom',
            }];
    }
    const providers = [];
    // Anthropic OAT — Claude Haiku 4.5 (PRIMARY: subscription-backed, free!)
    if (process.env.ANTHROPIC_OAT_KEY) {
        providers.push({
            url: 'https://api.anthropic.com/v1/messages',
            key: process.env.ANTHROPIC_OAT_KEY,
            model: process.env.GRAPHITI_EXTRACTION_MODEL || 'claude-haiku-4-5-20251001',
            name: 'anthropic-oat',
        });
    }
    // xAI — Grok 4.1 Fast (fallback #1: plenty of credits)
    if (process.env.XAI_API_KEY) {
        providers.push({
            url: 'https://api.x.ai/v1/chat/completions',
            key: process.env.XAI_API_KEY,
            model: process.env.GRAPHITI_EXTRACTION_MODEL || 'grok-4-1-fast',
            name: 'xai',
        });
    }
    // Anthropic API key — Claude Haiku 4.5 (fallback #2: pay-per-token)
    if (process.env.ANTHROPIC_API_KEY) {
        providers.push({
            url: 'https://api.anthropic.com/v1/messages',
            key: process.env.ANTHROPIC_API_KEY,
            model: process.env.GRAPHITI_EXTRACTION_MODEL || 'claude-haiku-4-5-20251001',
            name: 'anthropic',
        });
    }
    // OpenAI — GPT-4o-mini (fallback #3)
    if (process.env.OPENAI_API_KEY) {
        providers.push({
            url: 'https://api.openai.com/v1/chat/completions',
            key: process.env.OPENAI_API_KEY,
            model: process.env.GRAPHITI_EXTRACTION_MODEL || 'gpt-4o-mini',
            name: 'openai',
        });
    }
    return providers;
}
const EXTRACTION_TIMEOUT_MS = 15_000;
const EXTRACTION_PROMPT = `You are a fact extractor. Given a conversation message, extract concrete, factual claims as structured triples.

Rules:
- Only extract FACTUAL claims (not opinions, questions, or speculation)
- Each claim must have: subject, predicate, object
- Subject: the entity the fact is about (person name, project name, service name, etc.)
- Predicate: the relationship or property (e.g., "uses", "is_located_at", "prefers", "runs_on")
- Object: the value or target (e.g., "Go", "port 8721", "dark mode")
- Confidence: 0.0-1.0 based on how certain the statement is
- Skip greetings, acknowledgments, and meta-conversation ("ok", "thanks", "let me check")
- Skip claims that are too vague or context-dependent to be useful standalone
- Return an empty array if no factual claims are found

Respond with ONLY a JSON array. No markdown, no explanation.

Example input: "Thales uses Mounjaro and takes 500mg Metformin daily. The Graphiti server runs on port 8721."
Example output: [{"subject":"Thales","predicate":"uses","object":"Mounjaro","confidence":0.9},{"subject":"Thales","predicate":"takes_daily","object":"500mg Metformin","confidence":0.9},{"subject":"Graphiti server","predicate":"runs_on","object":"port 8721","confidence":0.95}]`;
/**
 * Call a single LLM provider. Returns parsed claims on success,
 * null on non-retryable failure (bad response format), or throws on
 * retryable errors (429, 5xx, timeout) so the caller can try the next provider.
 */
async function callProvider(provider, text) {
    let response;
    let content;
    const isAnthropic = provider.name === 'anthropic' || provider.name === 'anthropic-oat';
    if (isAnthropic) {
        // Anthropic Messages API — different format
        response = await fetch(provider.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': provider.key,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: provider.model,
                system: EXTRACTION_PROMPT,
                messages: [
                    { role: 'user', content: text.slice(0, 2000) },
                ],
                temperature: 0.1,
                max_tokens: 1000,
            }),
            signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
        });
    }
    else {
        // OpenAI-compatible API (xAI, OpenAI, custom)
        response = await fetch(provider.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${provider.key}`,
            },
            body: JSON.stringify({
                model: provider.model,
                messages: [
                    { role: 'system', content: EXTRACTION_PROMPT },
                    { role: 'user', content: text.slice(0, 2000) },
                ],
                temperature: 0.1,
                max_tokens: 1000,
            }),
            signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
        });
    }
    // Retryable errors — throw so caller tries next provider
    if (response.status === 429 || response.status >= 500) {
        throw new Error(`${provider.name} returned ${response.status}`);
    }
    if (!response.ok) {
        if (process.env.GRAPHITI_DEBUG) {
            console.log(`[graphiti-context-engine] [DEBUG] extractClaims: ${provider.name} returned ${response.status}`);
        }
        throw new Error(`${provider.name} returned ${response.status}`);
    }
    if (isAnthropic) {
        const data = await response.json();
        content = data.content?.find(b => b.type === 'text')?.text?.trim();
    }
    else {
        const data = await response.json();
        content = data.choices?.[0]?.message?.content?.trim();
    }
    if (!content)
        return null;
    // Strip markdown code fences if the LLM wraps JSON in ```json\n...\n```
    const fenceMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch?.[1]) {
        content = fenceMatch[1].trim();
    }
    // Parse the JSON array from the LLM response
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed))
        return null;
    // Validate and normalize each claim
    return parsed
        .filter(c => c.subject && typeof c.subject === 'string' &&
        c.predicate && typeof c.predicate === 'string' &&
        c.object && typeof c.object === 'string' &&
        typeof c.confidence === 'number')
        .map(c => ({
        subject: c.subject.trim(),
        predicate: c.predicate.trim().toLowerCase().replace(/\s+/g, '_'),
        object: c.object.trim(),
        confidence: Math.min(1, Math.max(0, c.confidence)),
    }));
}
export async function extractClaims(text, _sessionId, _messageId, _authorId) {
    // Skip very short or clearly non-factual messages
    if (text.length < 20)
        return { claims: [] };
    // Skip messages that are clearly just commands or acknowledgments
    const lowerText = text.toLowerCase().trim();
    if (/^(ok|thanks|great|yes|no|sure|got it|done|hello|hi|hey)\b/i.test(lowerText)) {
        return { claims: [] };
    }
    const providers = resolveProviders();
    if (providers.length === 0) {
        if (process.env.GRAPHITI_DEBUG) {
            console.log('[graphiti-context-engine] [DEBUG] extractClaims: no LLM API key found, skipping');
        }
        return { claims: [] };
    }
    // Try each provider in priority order (fallback on 429/5xx/timeout)
    for (const provider of providers) {
        try {
            const result = await callProvider(provider, text);
            if (result) {
                if (process.env.GRAPHITI_DEBUG) {
                    console.log(`[graphiti-context-engine] [DEBUG] extractClaims (${provider.name}/${provider.model}): extracted ${result.length} claims from ${text.length} chars`);
                }
                return { claims: result };
            }
            // null means non-retryable failure (e.g. parse error), try next
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.log(`[graphiti-context-engine] extractClaims: ${provider.name} failed (${msg}), trying next provider...`);
            continue;
        }
    }
    // All providers exhausted
    return { claims: [] };
}
export function buildClaimsForIngestion(extractionResult, sessionId, messageId, authorId, message) {
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