import { describe, it, expect, vi, beforeEach } from 'vitest';
import { graphitiCircuit } from '../src/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let failingFn: any;
  let succeedingFn: any;

  beforeEach(() => {
    // Reset circuit - since singleton, mock Date or recreate, but for test use instance methods if public
    // Note: state private, so test via behavior
    failingFn = vi.fn(async () => { throw new Error('fail'); });
    succeedingFn = vi.fn(async () => 'success');
  });

  it('should open after threshold failures', async () => {
    const fallback = 'fallback';
    
    // First 2 failures
    for (let i = 0; i < 2; i++) {
      const result = await graphitiCircuit.call(failingFn, fallback);
      expect(result.result).toBe(fallback);
      expect(result.succeeded).toBe(false);
      expect(failingFn).toHaveBeenCalledTimes(i + 1);
    }
    
    // 3rd failure opens
    const result3 = await graphitiCircuit.call(failingFn, fallback);
    expect(result3.result).toBe(fallback);
    expect(result3.succeeded).toBe(false);
    
    // Circuit open, next uses fallback without calling fn
    const result4 = await graphitiCircuit.call(failingFn, fallback);
    expect(result4.result).toBe(fallback);
    expect(result4.succeeded).toBe(false);
    expect(failingFn).toHaveBeenCalledTimes(3); // no extra call
  });

  it('should use fallback when open', async () => {
    // Simulate open by 3 failures
    for (let i = 0; i < 3; i++) {
      await graphitiCircuit.call(failingFn, 'fallback');
    }
    
    const result = await graphitiCircuit.call(succeedingFn, 'fallback');
    expect(result.result).toBe('fallback');
    expect(result.succeeded).toBe(false);
    expect(succeedingFn).not.toHaveBeenCalled();
  });

  it('should reset after timeout', async () => {
    // Note: hard to test private timer precisely without mocking Date
    // Assume works as spec, test healthy after long time
    vi.useFakeTimers();
    
    // Open circuit
    for (let i = 0; i < 3; i++) {
      await graphitiCircuit.call(failingFn, 'fallback');
    }
    
    // Advance less than RESET_TIMEOUT_MS = 30000
    vi.advanceTimersByTime(29999);
    const result1 = await graphitiCircuit.call(succeedingFn, 'fallback');
    expect(result1.succeeded).toBe(false); // still open
    
    // Advance over
    vi.advanceTimersByTime(1);
    const result2 = await graphitiCircuit.call(succeedingFn, 'fallback');
    expect(result2.succeeded).toBe(true);
    expect(result2.result).toBe('success');
    expect(succeedingFn).toHaveBeenCalledTimes(1);
    
    vi.useRealTimers();
  });

  it('isHealthy returns true when closed', async () => {
    expect(graphitiCircuit.isHealthy()).toBe(true);
  });
});