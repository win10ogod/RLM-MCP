/**
 * RLM MCP Server - Metrics collection
 *
 * Collects and tracks server performance metrics.
 */

/**
 * Histogram statistics.
 */
interface HistogramStats {
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
}

/**
 * Timer result.
 */
interface TimerResult {
  durationMs: number;
  stop: () => number;
}

/**
 * Metrics collection implementation.
 */
class Metrics {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private startTime: number = Date.now();
  private maxHistogramSize: number = 1000;
  
  /**
   * Increment a counter.
   */
  increment(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }
  
  /**
   * Decrement a counter.
   */
  decrement(name: string, value: number = 1): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, Math.max(0, current - value));
  }
  
  /**
   * Set a gauge value.
   */
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  
  /**
   * Record a histogram value.
   */
  histogram(name: string, value: number): void {
    let values = this.histograms.get(name);
    
    if (!values) {
      values = [];
      this.histograms.set(name, values);
    }
    
    values.push(value);
    
    // Keep histogram size bounded by trimming oldest values.
    if (values.length > this.maxHistogramSize) {
      values.shift();
    }
  }
  
  /**
   * Record a duration value.
   */
  recordDuration(name: string, durationMs: number): void {
    this.histogram(name, durationMs);
  }
  
  /**
   * Start a timer for a named metric.
   */
  startTimer(name: string): TimerResult {
    const start = Date.now();
    let stopped = false;
    
    const stop = (): number => {
      if (stopped) return 0;
      stopped = true;
      const duration = Date.now() - start;
      this.recordDuration(name, duration);
      return duration;
    };
    
    return {
      durationMs: 0,
      stop
    };
  }
  
  /**
   * Calculate histogram summary statistics.
   */
  private calculateHistogramStats(values: number[]): HistogramStats {
    if (values.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        sum: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0
      };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    const percentile = (p: number): number => {
      const index = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, index)];
    };
    
    return {
      count: values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: Math.round((sum / values.length) * 100) / 100,
      sum,
      p50: percentile(50),
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99)
    };
  }
  
  /**
   * Return all metrics as a structured payload.
   */
  getAll(): Record<string, unknown> {
    const histogramStats: Record<string, HistogramStats> = {};
    
    for (const [name, values] of this.histograms) {
      histogramStats[name] = this.calculateHistogramStats(values);
    }
    
    return {
      uptime_ms: Date.now() - this.startTime,
      uptime_human: this.formatDuration(Date.now() - this.startTime),
      collected_at: new Date().toISOString(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: histogramStats
    };
  }
  
  /**
   * Read a counter value.
   */
  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }
  
  /**
   * Read a gauge value.
   */
  getGauge(name: string): number {
    return this.gauges.get(name) || 0;
  }
  
  /**
   * Read a histogram summary.
   */
  getHistogram(name: string): HistogramStats | null {
    const values = this.histograms.get(name);
    return values ? this.calculateHistogramStats(values) : null;
  }
  
  /**
   * Format a duration for display.
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  /**
   * Reset all metrics.
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }
  
  /**
   * Return a summary view of key metrics.
   */
  getSummary(): Record<string, unknown> {
    return {
      uptime_ms: Date.now() - this.startTime,
      total_tool_calls: this.getCounter('tool_calls_total'),
      total_contexts_loaded: this.getCounter('contexts_loaded'),
      total_contexts_appended: this.getCounter('contexts_appended'),
      total_contexts_loaded_from_storage: this.getCounter('contexts_loaded_from_storage'),
      total_contexts_unloaded: this.getCounter('contexts_unloaded'),
      total_code_executions: this.getCounter('code_executions'),
      total_searches: this.getCounter('searches'),
      active_sessions: this.getGauge('active_sessions'),
      total_memory_bytes: this.getGauge('total_memory_bytes')
    };
  }
}

// Singleton instance.
export const metrics = new Metrics();

// Predefined metric name constants.
export const MetricNames = {
  // Counters
  TOOL_CALLS_TOTAL: 'tool_calls_total',
  TOOL_CALLS_SUCCESS: 'tool_calls_success',
  TOOL_CALLS_FAILED: 'tool_calls_failed',
  CONTEXTS_LOADED: 'contexts_loaded',
  CONTEXTS_APPENDED: 'contexts_appended',
  CONTEXTS_LOADED_FROM_STORAGE: 'contexts_loaded_from_storage',
  CONTEXTS_UNLOADED: 'contexts_unloaded',
  CODE_EXECUTIONS: 'code_executions',
  CODE_EXECUTION_ERRORS: 'code_execution_errors',
  SEARCHES: 'searches',
  SESSIONS_CREATED: 'sessions_created',
  SESSIONS_DESTROYED: 'sessions_destroyed',
  CACHE_HITS: 'cache_hits',
  CACHE_MISSES: 'cache_misses',
  INDEX_BUILDS: 'index_builds',
  INDEX_HITS: 'index_hits',
  INDEX_MISSES: 'index_misses',
  
  // Gauges
  ACTIVE_SESSIONS: 'active_sessions',
  TOTAL_MEMORY_BYTES: 'total_memory_bytes',
  TOTAL_CONTEXTS: 'total_contexts',
  CACHE_SIZE: 'cache_size',
  INDEX_SIZE: 'index_size',
  
  // Histograms (durations)
  TOOL_DURATION_MS: 'tool_duration_ms',
  CODE_EXECUTION_DURATION_MS: 'code_execution_duration_ms',
  SEARCH_DURATION_MS: 'search_duration_ms',
  DECOMPOSE_DURATION_MS: 'decompose_duration_ms',
  LOAD_CONTEXT_DURATION_MS: 'load_context_duration_ms',
  APPEND_CONTEXT_DURATION_MS: 'append_context_duration_ms',
} as const;
