'use strict';
// src/agent/RepairAgent.js — Enhanced with persistent memory integration
// Fixes:
// 1. Removed over-aggressive fingerprint bail (was stopping after 1 attempt)
// 2. Added proper error feedback loop
// 3. Integrated ProjectMemory for cross-session error tracking

const { ErrorFingerprint } = require('../recovery/ErrorFingerprint');
const logger = require('../logger');

class RepairAgent {
  constructor(gateway, validatorAgent, options = {}) {
    this.gateway        = gateway;
    this.validatorAgent = validatorAgent;
    this.journal        = options.journal        || null;
    this.checkpoints    = options.checkpoints    || null;
    this.fingerprints   = new Map();
    this.errorMemory    = options.errorMemory    || null;
    this.projectMemory  = options.projectMemory  || null;  // NEW: cross-session memory
    this.maxRetries     = options.maxRetries     || 3;
  }

  async repair(validation, step, baseContext) {
    let currentValidation = validation;
    let lastFingerprint = '';

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const fingerprint = ErrorFingerprint.hash(currentValidation.error || currentValidation.output || '');
      lastFingerprint = fingerprint;
      const attempts = (this.fingerprints.get(fingerprint) || 0) + 1;
      this.fingerprints.set(fingerprint, attempts);

      this.errorMemory?.record(currentValidation);
      this.journal?.record('repair-attempt', { fingerprint, attempt, phase: currentValidation.phase, error: currentValidation.error });

      // Record to cross-session memory
      this.projectMemory?.recordError(fingerprint, currentValidation.error || currentValidation.output || '');
      this.projectMemory?.markBroken(
        `${currentValidation.phase} failure: ${(currentValidation.error || '').slice(0, 100)}`,
        { attempts: 1 }
      );

      // FIX: Removed the `if (attempts > 1) break` which was stopping repair after just 1 LLM call.
      // We now only bail if the SAME fingerprint has been tried MORE THAN maxRetries times across
      // the current session (not across all sessions), indicating a stuck loop.
      if (attempts > this.maxRetries) {
        logger.warn(`Stopping repair: identical failure repeated ${attempts} times (fingerprint: ${fingerprint})`);
        break;
      }

      // Try a known fix first (e.g. auto npm install for missing modules)
      const knownFix = await this.errorMemory?.applyKnownFix(currentValidation);
      if (knownFix?.applied) {
        currentValidation = await this.validatorAgent.validate({ source: 'error-memory', fingerprint });
        if (currentValidation.success) {
          this.errorMemory.record({ error: fingerprint, phase: 'known-fix' }, true, knownFix);
          this.projectMemory?.resolveError(fingerprint);
          this.projectMemory?.markFixed(
            `${currentValidation.phase} failure: ${(currentValidation.error || '').slice(0, 100)}`
          );
          this.journal?.record('repair-success', { fingerprint, knownFix });
          this.checkpoints?.create('repair-success', { validationStatus: { success: true }, knownFix });
          return true;
        }
      }

      // Build a rich repair prompt that includes prior attempts context
      const priorAttemptNote = attempt > 1
        ? `\nNOTE: This is repair attempt ${attempt}/${this.maxRetries}. Your previous repair did NOT fix the issue. Try a different approach.\n`
        : '';

      const repairPrompt = [
        'A validation check failed. You must fix it using tools.',
        priorAttemptNote,
        'PHASE FAILED: ' + currentValidation.phase,
        '',
        'ERROR OUTPUT (read carefully):',
        currentValidation.error || currentValidation.output || '(no error text)',
        '',
        'FULL BUILD OUTPUT (if available):',
        (currentValidation.output || '').slice(0, 2000),
        '',
        'STEP THAT CAUSED THIS FAILURE:',
        step,
        '',
        'PROJECT CONTEXT:',
        baseContext,
        '',
        'REPAIR STRATEGY:',
        '1. Read the actual error carefully — find the root cause, not a symptom.',
        '2. Read the failing file(s) before editing them.',
        '3. Do NOT try the same approach twice — if attempt 1 failed, change your strategy.',
        '4. After fixing, run the relevant command to verify your fix works.',
        '5. If missing package: use run_command to npm install it, then verify.',
        '6. Output a short repair summary in the SAME response as your tool call(s) once the fix is implemented. If the repair is not fully complete and verified, you MUST output a tool call. Only output plain text without tool calls when the repair is 100% complete.',
      ].join('\n');

      logger.info(`Repair attempt ${attempt}/${this.maxRetries} for: ${currentValidation.phase}`);
      await this.gateway.chat(repairPrompt, 'repair', 'R1');
      currentValidation = await this.validatorAgent.validate({ source: 'repair', fingerprint, attempt });

      if (currentValidation.success) {
        this.projectMemory?.resolveError(fingerprint);
        this.projectMemory?.markFixed(
          `${validation.phase} failure: ${(validation.error || '').slice(0, 100)}`
        );
        this.journal?.record('repair-success', { fingerprint, attempt });
        this.checkpoints?.create('repair-success', { validationStatus: { success: true } });
        return true;
      }
    }

    // All repair attempts failed — record the persistent failure in cross-session memory
    this.projectMemory?.markBroken(
      `${validation.phase} failure: ${(validation.error || '').slice(0, 100)}`,
      { attempts: this.maxRetries }
    );

    // Escalate to human for interactive debugging / guidance / skip
    while (true) {
      const guidance = await this._escalateToHuman(currentValidation, step);
      if (guidance.toLowerCase() === 'skip') {
        logger.warn('Skipping validation failure on human instruction.');
        return true; // pretend it succeeded so orchestrator continues
      }
      if (guidance.toLowerCase() === 'quit') {
        logger.error('Execution aborted by user.');
        process.exit(1);
      }
      
      if (guidance) {
        const guidancePrompt = [
          'A validation check is still failing, and the human user provided the following direct feedback/guidance to help you fix it:',
          '',
          `USER FEEDBACK: "${guidance}"`,
          '',
          'PHASE FAILED: ' + currentValidation.phase,
          'ERROR OUTPUT (read carefully):',
          currentValidation.error || currentValidation.output || '(no error text)',
          '',
          'Please use this guidance and your tools to resolve the issue now. When done, verify your changes compile / build.',
        ].join('\n');
        
        logger.info(`Running repair with human guidance...`);
        await this.gateway.chat(guidancePrompt, 'repair', 'R1');
        currentValidation = await this.validatorAgent.validate({ source: 'repair-guidance', fingerprint: lastFingerprint });
        
        if (currentValidation.success) {
          if (lastFingerprint) this.projectMemory?.resolveError(lastFingerprint);
          this.projectMemory?.markFixed(
            `${validation.phase} failure: ${(validation.error || '').slice(0, 100)}`
          );
          this.journal?.record('repair-success', { guidance, source: 'human-escalation' });
          return true;
        }
      }
    }
  }

  async _escalateToHuman(validation, step) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  ⚠️  REPAIR EXHAUSTED — HUMAN ESCALATION REQUIRED');
    console.log('═'.repeat(60));
    console.log(`Phase failed  : ${validation.phase}`);
    console.log(`Error output  : ${validation.error || validation.output || '(no error text)'}`);
    console.log(`Caused by step: ${step}`);
    console.log('─'.repeat(60));
    console.log('Please choose an action:');
    console.log('  - Type a text hint/guidance to send to the agent for another retry');
    console.log('  - Type "skip" to skip this step and proceed to the next step');
    console.log('  - Type "quit" to abort and terminate execution');
    console.log('═'.repeat(60));

    return new Promise(resolve => {
      rl.question('\nYour instruction/action: ', answer => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  async repairReview(task, review, baseContext) {
    const findings = review.findings || [];
    if (!findings.length) return false;

    this.journal?.record('review-repair-attempt', { findings });

    const prompt = [
      'The Reviewer Agent found issues after implementation.',
      'Fix the following findings using tools. Output ONLY a repair summary.',
      '',
      'TASK:',
      task,
      '',
      'REVIEW FINDINGS:',
      JSON.stringify(findings, null, 2),
      '',
      'PROJECT CONTEXT:',
      baseContext,
      '',
      'INSTRUCTIONS:',
      '1. Read the affected files before editing.',
      '2. Fix each finding. Use surgical replace_in_file, not full rewrites.',
      '3. Verify your changes compile / pass lint.',
    ].join('\n');

    await this.gateway.chat(prompt, 'repair', 'R1');
    const validation = await this.validatorAgent.validate({ source: 'review-repair' });
    const success = validation.success;
    this.journal?.record('review-repair-validation', { success, phase: validation.phase, error: validation.error });
    return success;
  }
}

module.exports = { RepairAgent };
