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
    this.errorMemory = options.errorMemory || null;
    this.maxRetries = options.maxRetries || 3;
  }

  async repair(validation, step, baseContext) {
    let currentValidation = validation;
    const initialCheckpoint = this.checkpoints?.create('pre-repair', { reason: 'Before starting repair' });

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const fingerprint = ErrorFingerprint.hash(currentValidation.error || currentValidation.output || '');
      this.errorMemory?.record(currentValidation);
      const attempts = (this.fingerprints.get(fingerprint) || 0) + 1;
      this.fingerprints.set(fingerprint, attempts);
      this.journal?.record('repair-attempt', { fingerprint, attempts, phase: currentValidation.phase, error: currentValidation.error });

      const knownFix = await this.errorMemory?.applyKnownFix(currentValidation);
      if (knownFix?.applied) {
        currentValidation = await this.validatorAgent.validate({ source: 'error-memory', fingerprint });
        if (currentValidation.success) {
          this.errorMemory.record({ error: fingerprint, phase: 'known-fix' }, true, knownFix);
          this.journal?.record('repair-success', { fingerprint, knownFix });
          this.checkpoints?.create('repair-success', { validationStatus: { success: true }, knownFix });
          return true;
        }
      }

      if (attempts > 1) {
        logger.warn(`Stopping repair: identical failure repeated (${fingerprint})`);
        break;
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
        'STRATEGY: Do not try the same thing twice. Backtrack if necessary.',
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

    // BACKTRACKING: If we reached here, repair failed. Revert to pre-repair state.
    if (initialCheckpoint) {
      logger.error('Repair failed. Backtracking to pre-repair state.');
      this.journal?.record('backtrack', { reason: 'Repair failed after all attempts' });
      // In a real system, this would trigger a git revert or file restoration.
      // For now, we'll mark it as a failure to the orchestrator.
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
