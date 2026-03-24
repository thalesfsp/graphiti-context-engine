import { getTrustWeight } from './trust.js';
const MAX_CONTEXT_CHARS = 2000; // ~500 tokens max for injected claims
const MIN_QUERY_LENGTH = 10; // Skip very short queries ("Great!", "Ok") that return noise
export function buildContextAddition(claims) {
    if (claims.length === 0)
        return '';
    // Sort by confidence (highest first), then trust, then recency
    const sorted = claims.sort((a, b) => {
        // Primary: confidence (already exists)
        const confDiff = b.confidence - a.confidence;
        if (Math.abs(confDiff) > 0.1)
            return confDiff;
        // Secondary: trust tier
        const trustA = getTrustWeight(a.trust_tier || 'user_statement');
        const trustB = getTrustWeight(b.trust_tier || 'user_statement');
        const trustDiff = trustB - trustA;
        if (Math.abs(trustDiff) > 0.1)
            return trustDiff;
        // Tertiary: recency (already exists)
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    // Build context string with truncation
    let context = '## Known Facts (from memory)\n';
    let charCount = context.length;
    for (const claim of sorted) {
        // Prefer fact (full sentence from Graphiti) over subject/predicate/object decomposition
        const display = claim.fact && claim.subject === ''
            ? claim.fact
            : `${claim.subject} ${claim.predicate} ${claim.object}`.trim();
        const line = `- ${display} (confidence: ${claim.confidence})\n`;
        if (charCount + line.length > MAX_CONTEXT_CHARS)
            break;
        context += line;
        charCount += line.length;
    }
    return context;
}
// ─── Noise patterns: queries that should be skipped or stripped ─────────────
// These patterns match internal OpenClaw messages, session boilerplate, and
// inter-session metadata that pollute Graphiti search results.
// Based on empirical log analysis (2026-03-11): 54% of queries were noise.
/** Lines matching these patterns are stripped from the query entirely. */
export const NOISE_LINE_PATTERNS = [
    // Session startup boilerplate (9x/day)
    /^A new session was started via \/(?:new|reset)\./,
    /Execute your Session Startup sequence/,
    // Inter-session metadata headers (9x/day)
    /^\[Inter-session message\]/,
    /^sourceSession=/,
    /^sourceChannel=/,
    // System exec notifications (2x/day)
    /^System:\s*\[\d{4}-\d{2}-\d{2}.*?\]\s*Exec completed/,
    // Internal engine/gateway noise
    /^\[graphiti-context-engine\]/,
    /^\[EventQueue\]/,
    /^\[gateway\]/,
    /^\[openclaw-mem0\]/,
    // Cron/heartbeat noise
    /^cron:\s*timer armed/i,
    /^web gateway heartbeat/i,
    /^exec:\s*elevated command/i,
];
/** Inline patterns removed from within a line (preserving surrounding text). */
export const NOISE_INLINE_PATTERNS = [
    // Media attachment paths — keep text before/after but remove the path
    /\[media attached:\s*\/[^\]]+\]/g,
];
/**
 * Strip noise lines and inline patterns from query text.
 * Returns cleaned text with noise lines removed entirely and
 * inline patterns surgically excised.
 */
export function stripNoisePatterns(text) {
    // Split into lines, filter out noise lines, rejoin
    const lines = text.split('\n');
    const cleaned = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed)
            return true; // keep blank lines (collapsed later)
        return !NOISE_LINE_PATTERNS.some(p => p.test(trimmed));
    });
    let result = cleaned.join('\n');
    // Remove inline patterns
    for (const pattern of NOISE_INLINE_PATTERNS) {
        result = result.replace(pattern, '');
    }
    return result.replace(/\n{3,}/g, '\n').trim();
}
// XML-style tags injected by Mem0, system, or other plugins that pollute search queries
const INJECTED_TAG_PATTERN = /<(?:relevant-memories|system-reminder|memory-context|context-injection|openclaw-mem0|known-facts)[^>]*>[\s\S]*?<\/(?:relevant-memories|system-reminder|memory-context|context-injection|openclaw-mem0|known-facts)>/gi;
// Fallback: strip any remaining XML-ish tags that look like system injections
const GENERIC_SYSTEM_TAG_PATTERN = /<\/?(?:relevant-memories|system-reminder|memory-context|context-injection|openclaw-mem0|known-facts)[^>]*>/gi;
// Discord/WhatsApp/channel metadata injected by OpenClaw providers
// Matches: "Conversation info (untrusted metadata):\n```json\n{...}\n```"
// Also: "Sender (untrusted metadata):\n```json\n{...}\n```"
// Generic: "Anything (untrusted metadata):\n```json\n{...}\n```"
const UNTRUSTED_METADATA_PATTERN = /\w[\w\s]*\(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```/gi;
// Generic fenced JSON code blocks that look like metadata (sender_id, message_id, etc.)
const METADATA_JSON_BLOCK_PATTERN = /```json\s*\{\s*"(?:message_id|sender_id|channel_id|guild_id|timestamp|label|id)"[\s\S]*?\}\s*```/gi;
/**
 * Strip system-injected content from a message string.
 * Multiple injection sources:
 * - Mem0: <relevant-memories>...</relevant-memories>
 * - System: <system-reminder>...</system-reminder>
 * - Discord/WhatsApp: "Conversation info (untrusted metadata):\n```json\n{...}\n```"
 */
function stripInjectedContent(text) {
    let cleaned = text
        .replace(INJECTED_TAG_PATTERN, '') // Remove XML-tagged blocks (Mem0, system)
        .replace(GENERIC_SYSTEM_TAG_PATTERN, '') // Remove orphaned XML tags
        .replace(UNTRUSTED_METADATA_PATTERN, '') // Remove Discord/WhatsApp metadata blocks
        .replace(METADATA_JSON_BLOCK_PATTERN, ''); // Remove any remaining metadata JSON blocks
    // Strip noise patterns (session boilerplate, inter-session metadata, internal logs)
    cleaned = stripNoisePatterns(cleaned);
    return cleaned
        .replace(/\n{3,}/g, '\n') // Collapse excessive newlines left behind
        .trim();
}
export function extractQueryFromMessages(messages) {
    // Get last few user messages for query
    const userMessages = messages
        .filter(m => m.role === 'user')
        .slice(-3); // Last 3 user messages
    // DEBUG: Log content types for empirical verification
    if (process.env.DEBUG_CONTENT_TYPES) {
        for (const m of userMessages) {
            console.log('[graphiti-context-engine] DEBUG content type:', {
                role: m.role,
                contentType: typeof m.content,
                isArray: Array.isArray(m.content),
                sample: typeof m.content === 'string'
                    ? m.content.slice(0, 100)
                    : JSON.stringify(m.content).slice(0, 200),
            });
        }
    }
    const query = userMessages
        .map(m => {
        let text = '';
        if (typeof m.content === 'string') {
            text = m.content;
        }
        else if (Array.isArray(m.content)) {
            // Handle array content (multimodal messages, content blocks)
            text = m.content
                .map(block => {
                if (typeof block === 'string')
                    return block;
                // Anthropic/OpenAI content block format
                if (block && typeof block === 'object' && 'text' in block) {
                    return block.text;
                }
                // WhatsApp/other formats might use different keys
                if (block && typeof block === 'object' && 'body' in block) {
                    return block.body;
                }
                return '';
            })
                .join(' ');
        }
        // Strip injected system/memory content before using as search query
        return stripInjectedContent(text);
    })
        .filter(text => text.length > 0) // Drop messages that were entirely injected content
        .join(' ')
        .trim() // prevents " " being treated as valid query
        .slice(0, 500); // Limit query length
    // Skip queries that are too short to produce meaningful semantic search results.
    // Single words like "Great!", "Ok", "Thanks" return random noise from Graphiti.
    if (query.length < MIN_QUERY_LENGTH)
        return '';
    return query;
}
//# sourceMappingURL=context-builder.js.map