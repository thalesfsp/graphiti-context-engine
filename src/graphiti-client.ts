import { Claim, ClaimStatus } from './types.js';

const GRAPHITI_URL = process.env.GRAPHITI_URL || 'http://localhost:8721';
const TIMEOUT_MS = 5000;

export async function updateClaimStatus(
  claimId: string, 
  status: ClaimStatus,
  supersededBy?: string
): Promise<void> {
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

export async function markClaimsSuperseded(
  oldClaimIds: string[],
  newClaimId: string
): Promise<void> {
  for (const claimId of oldClaimIds) {
    await updateClaimStatus(claimId, 'superseded', newClaimId);
  }
}

export async function ingestClaims(claims: Claim[], groupId: string): Promise<{ ingested: number; duplicates: number }> {
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
    
    return await response.json() as { ingested: number; duplicates: number };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchClaims(
  query: string,
  groupIds: string | string[],  // Accept single or array of group IDs
  options?: { 
    limit?: number; 
    minConfidence?: number;
    statuses?: ClaimStatus[];  // @deprecated - ignored by /search endpoint
  }
): Promise<Claim[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout for assemble
  
  // Normalize to array
  const groups = Array.isArray(groupIds) ? groupIds : [groupIds];
  
  try {
    // Use /search endpoint with group_ids array
    const response = await fetch(`${GRAPHITI_URL}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        group_ids: groups,
        limit: options?.limit || 20,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Graphiti search error: ${response.status}`);
    }
    
    const data: any = await response.json();
    
    // Transform /search results to Claim format
    // Graphiti /search returns: uuid, fact, name, source_node_uuid, target_node_uuid, score
    // score = RRF reranker score from graphiti.search_() — can exceed 1.0 when a result
    // ranks high in multiple search methods (BM25 + cosine_similarity).
    // We normalize to [0, 1] by dividing by the max score in the batch.
    // Fallback: positional decay 1.0→0.5 if server doesn't expose score yet.
    const results = data.results || data.edges || [];
    const count = results.length;
    // Find max score for normalization (RRF scores can be > 1.0)
    const maxScore = results.reduce((max: number, r: any) => Math.max(max, r.score ?? 0), 0);
    return results.map((r: any, index: number) => ({
      id: r.uuid || r.id || crypto.randomUUID(),
      fact: r.fact || r.description || `${r.name || 'RELATES_TO'}: no description`,
      subject: r.source_node_name || r.subject || '',
      predicate: r.name || r.predicate || 'RELATES_TO',
      object: r.target_node_name || r.object || '',
      confidence: maxScore > 0
        ? +(r.score / maxScore).toFixed(2)
        : (count > 1 ? +(1.0 - (index / (count - 1)) * 0.5).toFixed(2) : 1.0),
      status: 'active' as ClaimStatus,
      groupId: groups[0] || 'personal',
      createdAt: r.created_at || new Date().toISOString(),
    }));
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      console.warn('Graphiti search timed out, returning empty claims', err);
    } else {
      console.warn('Graphiti search failed:', err.message);
    }
    return []; // Graceful degradation
  } finally {
    clearTimeout(timeout);
  }
}

export async function markSessionClaimsArchived(sessionId: string): Promise<void> {
  // This is optional - marks claims from this session as archived
  // For now, skip this as the PATCH endpoint updates individual claims
  // A bulk endpoint would be needed: POST /claims/archive-session
  if (process.env.GRAPHITI_DEBUG) {
    console.log(`[graphiti-context-engine] [DEBUG] Would mark claims for session ${sessionId} as archived`);
  }
}

import { graphitiCircuit } from './circuit-breaker.js';
import { retryQueue } from './retry-queue.js';

export async function ingestClaimsWithRetry(claims: Claim[], groupId: string): Promise<{ ingested: number; duplicates: number }> {
  const cbResult = await graphitiCircuit.call(
    () => ingestClaims(claims, groupId),
    { ingested: 0, duplicates: 0 }
  );
  if (!cbResult.succeeded) {
    retryQueue.add(claims, groupId);
  }
  return cbResult.result;
}

export async function searchClaimsWithFallback(query: string, groupIds: string | string[], options?: { 
    limit?: number; 
    minConfidence?: number;
    statuses?: ClaimStatus[];  
  }): Promise<Claim[]> {
  const cbResult = await graphitiCircuit.call(
    () => searchClaims(query, groupIds, options),
    []
  );
  return cbResult.result;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    
    const response = await fetch(`${GRAPHITI_URL}/health`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return response.ok && graphitiCircuit.isHealthy();
  } catch {
    return false;
  }
}