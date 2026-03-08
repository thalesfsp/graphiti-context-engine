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
  groupId: string,
  options?: { 
    limit?: number; 
    minConfidence?: number;
    statuses?: ClaimStatus[];  // Default: ['active']
  }
): Promise<Claim[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1000); // 1s timeout for assemble
  
  try {
    const response = await fetch(`${GRAPHITI_URL}/claims/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        group_id: groupId,
        statuses: options?.statuses || ['active'],
        limit: options?.limit || 20,
        min_confidence: options?.minConfidence,
      }),
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`Graphiti search error: ${response.status}`);
    }
    
    const data: any = await response.json();
    return data.claims || [];
  } catch (error: unknown) {
    const err = error as Error;
    if (err.name === 'AbortError') {
      console.warn('Graphiti search timed out, returning empty claims', err);
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
  console.log(`Would mark claims for session ${sessionId} as archived`);
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

export async function searchClaimsWithFallback(query: string, groupId: string, options?: { 
    limit?: number; 
    minConfidence?: number;
    statuses?: ClaimStatus[];  
  }): Promise<Claim[]> {
  const cbResult = await graphitiCircuit.call(
    () => searchClaims(query, groupId, options),
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