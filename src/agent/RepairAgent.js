'use strict';

const { ErrorFingerprint } = require('../recovery/ErrorFingerprint');
const logger = require('../logger');

class RepairAgent {
  constructor(gateway, validatorAgent, options = {}) {
    this.gateway = gateway;
    this.validatorAgent = validatorAgent;
    this.journal = options.journal || null;
    this.checkpoints = options.checkpoints || null;
    this.fingerprints = new Map();
    this.maxRetries = options.maxRetries || 3;
  }

  async repair(validation, step, baseContext) {
    let currentValidation = validation;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const fingerprint = ErrorFingerprint.hash(currentValidation.error || currentValidation.output || '');
      const attempts = (this.fingerprints.get(fingerprint) || 0) + 1;
      this.fingerprints.set(fingerprint, attempts);
      this.journal?.record('repair-attempt', { fingerprint, attempts, phase: currentValidation.phase, error: currentValidation.error });

      if (attempts > 1) {
        logger.warn(`Stopping repair: identical failure repeated (${fingerprint})`);
        return false;
      }

      const repairPrompt = [
        'A validation check failed after a step.',
        '',
        'PHASE FAILED: ' + currentValidation.phase,
        'ERROR OUTPUT:',
        currentValidation.error,
        '',
        'LAST STEP EXECUTED:',
        step,
        '',
        'PROJECT CONTEXT:',
        baseContext,
        '',
        'Diagnose and fix the error using tools. Output ONLY a repair summary.'
      ].join('\n');

      await this.gateway.chat(repairPrompt);
      currentValidation = await this.validatorAgent.validate({ source: 'repair', fingerprint });
      if (currentValidation.success) {
        this.journal?.record('repair-success', { fingerprint });
        this.checkpoints?.create('repair-success', { validationStatus: { success: true } });
        return true;
      }
    }

    return false;
  }

  async repairReview(task, review, baseContext) {
    const findings = review.findings || [];
    if (!findings.length) return false;

    this.journal?.record('review-repair-attempt', { findings });
    const prompt = [
      'The Reviewer Agent found issues after implementation.',
      'Fix the findings using tools. Output ONLY a repair summary.',
      '',
      'TASK:',
      task,
      '',
      'REVIEW FINDINGS:',
      JSON.stringify(findings, null, 2),
      '',
      'PROJECT CONTEXT:',
      baseContext
    ].join('\n');

    await this.gateway.chat(prompt);
    const validation = await this.validatorAgent.validate({ source: 'review-repair' });
    const success = validation.success;
    this.journal?.record('review-repair-validation', { success, phase: validation.phase, error: validation.error });
    return success;
  }
}

module.exports = { RepairAgent };
