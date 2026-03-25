import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateClaimStatus, markClaimsSuperseded, searchClaims } from '../src/graphiti-client.js';
import type { ClaimStatus } from '../src/types.js';

global.fetch = vi.fn();

describe('Claim Status Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    });
  });

  it('should update claim status', async () => {
    await updateClaimStatus('claim-123', 'archived');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/claims/claim-123'),
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: expect.stringContaining('"status":"archived"'),
      })
    );
  });

  it('should mark claims as superseded', async () => {
    const oldClaims = ['claim-1', 'claim-2'];
    const newClaim = 'claim-3';

    await markClaimsSuperseded(oldClaims, newClaim);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(1,
      expect.stringContaining('/claims/claim-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining(`"status":"superseded","superseded_by":"${newClaim}"`),
      })
    );
  });

  it('should search using edge nodes endpoint and map to claims', async () => {
    const mockEdges = [{ uuid: 'c1', fact: 'test fact', name: 'TEST_PREDICATE', source_node_uuid: 'src', target_node_uuid: 'tgt' }];
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ results: mockEdges }),
    });

    const result = await searchClaims('test query', 'group-1');

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/search'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"group_ids":["group-1"]'),
      })
    );
    expect(result[0]?.claim_id).toBe('c1');
    expect(result[0]?.predicate).toBe('TEST_PREDICATE');
  });
});
