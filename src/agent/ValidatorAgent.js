'use strict';

class ValidatorAgent {
  constructor(validator, metrics = null, journal = null) {
    this.validator = validator;
    this.metrics = metrics;
    this.journal = journal;
  }

  async validate(context = {}) {
    const result = await this.validator.validate();
    if (this.metrics) this.metrics.recordValidation(result);
    if (this.journal) this.journal.record('validation', { ...context, success: result.success, phase: result.phase, error: result.error });
    return result;
  }
}

module.exports = { ValidatorAgent };
