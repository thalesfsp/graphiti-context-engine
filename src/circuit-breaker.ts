interface CircuitState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30000; // 30 seconds

export class CircuitBreaker {
  private state: CircuitState = { failures: 0, lastFailure: 0, isOpen: false };
  
  async call<T>(fn: () => Promise<T>, fallback: T): Promise<{result: T; succeeded: boolean}> {
    // Check if circuit should reset
    if (this.state.isOpen && Date.now() - this.state.lastFailure > RESET_TIMEOUT_MS) {
      this.state.isOpen = false;
      this.state.failures = 0;
    }
    
    // If circuit is open, return fallback immediately
    if (this.state.isOpen) {
      console.warn('Circuit breaker open, using fallback');
      return { result: fallback, succeeded: false };
    }
    
    try {
      const result = await fn();
      // Success - reset failures
      this.state.failures = 0;
      return { result, succeeded: true };
    } catch (error) {
      this.state.failures++;
      this.state.lastFailure = Date.now();
      
      if (this.state.failures >= FAILURE_THRESHOLD) {
        this.state.isOpen = true;
        console.error(`Circuit breaker opened after ${FAILURE_THRESHOLD} failures`);
      }
      
      return { result: fallback, succeeded: false };
    }
  }
  
  isHealthy(): boolean {
    return !this.state.isOpen;
  }
}

export const graphitiCircuit = new CircuitBreaker();