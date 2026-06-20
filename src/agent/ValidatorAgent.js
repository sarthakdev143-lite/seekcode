'use strict';

class ValidatorAgent {
  constructor(validator, metrics = null, journal = null, traceLogger = null) {
    this.validator = validator;
    this.metrics = metrics;
    this.journal = journal;
    this.traceLogger = traceLogger;
  }

  async validate(options = {}) {
    const result = await this.validator.validate(options);
    if (this.metrics) this.metrics.recordValidation(result);
    if (this.journal) this.journal.record('validation', { ...options, success: result.success, phase: result.phase, error: result.error });
    
    if (this.traceLogger) {
      this.traceLogger._write({
        type: 'validation',
        phase: result.phase,
        success: result.success,
        error: result.error,
        ...options,
        timestamp: new Date().toISOString()
      });
    }
    
    return result;
  }
}

module.exports = { ValidatorAgent };
