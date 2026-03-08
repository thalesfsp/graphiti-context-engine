import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('CircuitBreaker', () => {
  let circuit: CircuitBreaker;
  let failingFn: any;
  let succeedingFn: any;

  beforeEach(() => {
    // Fresh instance per test — no shared singleton state
    circuit = new CircuitBreaker();
    failingFn = vi.fn(async () => { throw new Error('fail'); });
    succeedingFn = vi.fn(async () => 'success');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should open after threshold failures', async () => {
    const fallback = 'fallback';
    
    // First 2 failures
    for (let i = 0; i < 2; i++) {
      const result = await circuit.call(failingFn, fallback);
      expect(result.result).toBe(fallback);
      expect(result.succeeded).toBe(false);
      expect(failingFn).toHaveBeenCalledTimes(i + 1);
    }
    
    // 3rd failure opens
    const result3 = await circuit.call(failingFn, fallback);
    expect(result3.result).toBe(fallback);
    expect(result3.succeeded).toBe(false);
    
    // Circuit open, next uses fallback without calling fn
    const result4 = await circuit.call(failingFn, fallback);
    expect(result4.result).toBe(fallback);
    expect(result4.succeeded).toBe(false);
    expect(failingFn).toHaveBeenCalledTimes(3); // no extra call
  });

  it('should use fallback when open', async () => {
    // Simulate open by 3 failures
    for (let i = 0; i < 3; i++) {
      await circuit.call(failingFn, 'fallback');
    }
    
    const result = await circuit.call(succeedingFn, 'fallback');
    expect(result.result).toBe('fallback');
    expect(result.succeeded).toBe(false);
    expect(succeedingFn).not.toHaveBeenCalled();
  });

  it('should reset after timeout', async () => {
    vi.useFakeTimers();
    
    // Open circuit — lastFailure is set using fake Date.now() (controlled time)
    for (let i = 0; i < 3; i++) {
      await circuit.call(failingFn, 'fallback');
    }
    
    // Advance less than RESET_TIMEOUT_MS = 30000
    vi.advanceTimersByTime(29999);
    const result1 = await circuit.call(succeedingFn, 'fallback');
    expect(result1.succeeded).toBe(false); // still open
    
    // Advance over the threshold
    vi.advanceTimersByTime(2); // total 30001ms — strictly > 30000
    const result2 = await circuit.call(succeedingFn, 'fallback');
    expect(result2.succeeded).toBe(true);
    expect(result2.result).toBe('success');
    expect(succeedingFn).toHaveBeenCalledTimes(1);
  });

  it('isHealthy returns true when closed', async () => {
    expect(circuit.isHealthy()).toBe(true);
  });
});
