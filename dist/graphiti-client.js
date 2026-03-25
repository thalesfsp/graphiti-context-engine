const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8721';
const TIMEOUT_MS = 5000;
export async function updateClaimStatus(claimId, status, supersededBy) {
    const response = await fetch(`${GRAPHITI_URL}/claims/${claimId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            status,
            superseded_by: supersededBy,
            updated_at: new Date().toISOString(),
        }),
    });
    if (!response.ok) {
        throw new Error(`Failed to update claim ${claimId}: ${response.status}`);
    }
}
export async function markClaimsSuperseded(oldClaimIds, newClaimId) {
    for (const claimId of oldClaimIds) {
        await updateClaimStatus(claimId, 'superseded', newClaimId);
    }
}
export async function ingestClaims(claims, groupId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(`${GRAPHITI_URL}/claims/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ claims, group_id: groupId }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Graphiti error: ${response.status}`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function searchClaims(query, groupIds, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000); // 1s timeout for assemble
    try {
        const groups = Array.isArray(groupIds) ? groupIds : [groupIds];
        const response = await fetch(`${GRAPHITI_URL}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query,
                group_ids: groups,
                num_results: options?.limit || 20,
            }),
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Graphiti search error: ${response.status}`);
        }
        const data = await response.json();
        // Transform Graphiti edges to engine Claims
        const claims = (data.results || []).map((edge) => ({
            claim_id: edge.uuid,
            subject: edge.source_node_uuid, // fallback, actual name not strictly in edge format without joining
            predicate: edge.name,
            object: edge.fact || edge.target_node_uuid,
            confidence: edge.score ?? 1.0,
            status: 'active',
            source_message_id: 'unknown',
            source_session_id: 'unknown',
            extractor_version: 'graphiti-search',
            created_at: edge.created_at || new Date().toISOString(),
            updated_at: edge.updated_at || new Date().toISOString(),
        }));
        return claims;
    }
    catch (error) {
        const err = error;
        if (err.name === 'AbortError') {
            console.warn('Graphiti search timed out, returning empty claims', err);
        }
        return []; // Graceful degradation
    }
    finally {
        clearTimeout(timeout);
    }
}
export async function markSessionClaimsArchived(sessionId) {
    // This is optional - marks claims from this session as archived
    // For now, skip this as the PATCH endpoint updates individual claims
    // A bulk endpoint would be needed: POST /claims/archive-session
    console.log(`Would mark claims for session ${sessionId} as archived`);
}
import { graphitiCircuit } from './circuit-breaker.js';
import { retryQueue } from './retry-queue.js';
export async function ingestClaimsWithRetry(claims, groupId) {
    const cbResult = await graphitiCircuit.call(() => ingestClaims(claims, groupId), { ingested: 0, duplicates: 0 });
    if (!cbResult.succeeded) {
        retryQueue.add(claims, groupId);
    }
    return cbResult.result;
}
export async function searchClaimsWithFallback(query, groupIds, options) {
    const cbResult = await graphitiCircuit.call(() => searchClaims(query, groupIds, options), []);
    return cbResult.result;
}
export async function checkHealth() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const response = await fetch(`${GRAPHITI_URL}/health`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok && graphitiCircuit.isHealthy();
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=graphiti-client.js.map