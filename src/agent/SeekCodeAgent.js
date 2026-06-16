// seekcode/src/agent/SeekCodeAgent.js
const { GatewayClient } = require('../gateway-client');
const { classify, INTENTS } = require('../intent/classifier');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const { ContextManager } = require('../context/ContextManager');
const { SecuritySandbox } = require('../security/SecuritySandbox');
const config = require('../config');
const logger = require('../logger');

// Cross-session persistent memory
const { ProjectMemory } = require('../session/ProjectMemory');
const { WorkLog } = require('../session/WorkLog');
const { SituationReport } = require('../session/SituationReport');
const { setProjectPath } = require('./tools');

let TraceLogger = null;
try { TraceLogger = require('../trace-logger').TraceLogger; } catch { }

class SeekCodeAgent {
  constructor(projectPath) {
    this.projectPath = projectPath;
    setProjectPath(projectPath);
    this.gateway = new GatewayClient(this.projectPath);
    this.analyzer = null;
    this.conversationHistory = [];
    this.contextManager = new ContextManager({
      maxContextTokens: config.MAX_CONTEXT_TOKENS || 1000000,
      projectPath: this.projectPath,
    });
    this.sandbox = new SecuritySandbox({
      policy: config.SECURITY_POLICY,
      docker: { image: config.DOCKER_IMAGE || 'node:20-alpine', network: config.ALLOW_NETWORK ? 'bridge' : 'none' }
    });
    this.traceLogger = null;
    
    // Initialize persistent cross-session memory
    this.projectMemory = new ProjectMemory(this.projectPath);
    this.workLog = new WorkLog(this.projectPath);
    this._situationReporter = new SituationReport(this.projectPath);
    this.situationReport = null;
    this._sessionId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      this.traceLogger = new TraceLogger(this._sessionId, this.projectPath);
      this.traceLogger.logEvent('agent_init', { projectPath: this.projectPath });
    }
  }

  async init() {
    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    await this.gateway.createSession();

    // Record the gateway session log path in the seekcode trace so it's
    // easy to find the rich per-iteration logs when debugging.
    if (this.traceLogger && this.gateway.sessionLogPath) {
      this.traceLogger.logEvent('gateway_session_created', {
        gatewaySessionId  : this.gateway.sessionId,
        gatewaySessionLog : this.gateway.sessionLogPath,
        note: 'Rich per-iteration logs (tool calls, LLM responses) are in gatewaySessionLog'
      });
    }

    // Start session in project memory
    this.projectMemory.startSession(this._sessionId, 'Interactive CLI Session');
    // Generate situation report from prior sessions
    this.situationReport = this._situationReporter.generate();
    if (this.situationReport) {
      logger.warn('📋 Prior session history found — injecting situation report into all prompts.');
    }

    logger.success('Agent ready. Project: ' + this.analyzer.getSummary().project);
    logger.info(`Context window: ${this.contextManager.maxContextTokens / 1000}k tokens`);
    logger.info(`Sandbox: ${this.sandbox.docker._dockerAvailable ? 'Docker enabled' : 'Host mode (unsandboxed)'}`);
  }

  async _callLLMWithTrace(prompt, handlerName) {
    if (!this.traceLogger) return await this.gateway.chat(prompt, 'coder', 'R1');

    const turnId    = `${handlerName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();

    // ── Log the START of the call immediately — before awaiting the gateway.
    // This is critical: if the gateway crashes mid-run, at least the user
    // input is captured in the trace (previously it was only logged AFTER
    // receiving the full response, so crashes silently dropped the entry).
    this.traceLogger.logEvent('llm_turn_start', {
      turnId,
      handler       : handlerName,
      intent        : this._currentIntent,
      promptLength  : prompt.length,
      promptPreview : prompt.substring(0, 500),
    });

    try {
      const response   = await this.gateway.chat(prompt, 'coder', 'R1');
      const durationMs = Date.now() - startTime;
      this.traceLogger.logLLMTurn(
        turnId, prompt, response, durationMs,
        { handler: handlerName, intent: this._currentIntent }
      );
      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.traceLogger.logEvent('llm_turn_error', {
        turnId,
        handler    : handlerName,
        durationMs,
        error      : error.message,
        // Also record if we know the gateway session log for easier debugging
        gatewayLog : this.gateway.sessionLogPath || null,
      });
      throw error;
    }
  }

  async handle(input) {
    const intent = classify(input, this.analyzer.getSummary());
    this._currentIntent = intent;
    let agenticBase = [
      'You are SeekCode, a senior autonomous software engineer.',
      'CORE DIRECTIVES:',
      '- RESEARCH FIRST: Never edit a file without reading it and its dependencies first.',
      '- SURGICAL EDITS: Prefer `replace_in_file` over `write_file`. Be precise.',
      '- VALIDATE ALWAYS: After any change, run a relevant command (test, build, or ls) to verify.',
      '- NO HACKS: Do not suppress warnings or use `any` types. Fix the root cause.',
      '- IDIOMATIC: Match the existing project style, naming, and architecture.'
    ].join('\n');

    if (this.situationReport) {
      agenticBase = this.situationReport + '\n\n' + agenticBase;
    }

    switch (intent) {
      case INTENTS.GREETING: return await this._handleGreeting(input);
      case INTENTS.QUESTION: return await this._handleQuestion(input, agenticBase);
      case INTENTS.SINGLE_EDIT: return await this._handleSingleEdit(input, agenticBase);
      case INTENTS.MULTI_STEP: return await this._handleMultiStep(input, agenticBase);
      default: return await this._handleChat(input, agenticBase);
    }
  }

  async _handleGreeting(input) {
    const greetings = [
      "Hey! I'm SeekCode. What would you like to work on?",
      "Hi there! Ready to help with code. What's the task?",
      "Hello! I can help you code, refactor, debug, or answer questions about this project."
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  async _handleQuestion(input, agenticBase) {
    const summary = this.analyzer.getSummary();
    const context = this.contextManager.buildContextForLLM({ maxRecentTurns: 4 });
    const prompt = [
      agenticBase,
      '',
      'USER QUESTION: ' + input,
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(summary, null, 2),
      context ? '\nRECENT CONVERSATION:\n' + context : '',
    ].join('\n');
    this.contextManager.addMessage('user', input);
    const response = await this._callLLMWithTrace(prompt, '_handleQuestion');
    this.contextManager.addMessage('assistant', response);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleSingleEdit(input, agenticBase) {
    const context = this.contextManager.buildContextForLLM({ maxRecentTurns: 4 });
    const prompt = [
      agenticBase,
      '',
      'TASK: ' + input,
      '',
      'STEPS:',
      '1. Research: Read the file and understand its purpose.',
      '2. Plan: Explain what you will change.',
      '3. Act: Use surgical tools.',
      '4. Verify: Run a check.',
      context ? '\nRECENT CONVERSATION:\n' + context : '',
    ].join('\n');
    this.contextManager.addMessage('user', input);
    const response = await this._callLLMWithTrace(prompt, '_handleSingleEdit');
    this.contextManager.addMessage('assistant', response);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleMultiStep(input, agenticBase) {
    this.contextManager.addMessage('user', input);
    logger.info('Multi-step task detected — routing to full orchestrator pipeline.');

    const { EnhancedOrchestrator } = require('../orchestrator/EnhancedOrchestrator');
    const orchestrator = new EnhancedOrchestrator(this.projectPath);

    try {
      await orchestrator.init();
      const result = await orchestrator.run(input, {});
      this.contextManager.addMessage('assistant', result);
      this._addToHistory('assistant', result);
      await this.analyzer.analyze();
      return result;
    } catch (err) {
      logger.error(`Orchestrator failed: ${err.message}`);
      throw err;
    }
  }

  async _handleChat(input, agenticBase) {
    const context = this.contextManager.buildContextForLLM({ maxRecentTurns: 8 });
    const prompt = [
      agenticBase,
      '',
      'USER: ' + input,
      '',
      'CONVERSATION:',
      ...this.conversationHistory.slice(-8).map(m => m.role + ': ' + m.content),
      context ? '\nRECENT CONTEXT:\n' + context : '',
    ].join('\n');
    this.contextManager.addMessage('user', input);
    const response = await this._callLLMWithTrace(prompt, '_handleChat');
    this.contextManager.addMessage('assistant', response);
    this._addToHistory('assistant', response);
    return response;
  }

  _addToHistory(role, content) {
    this.conversationHistory.push({ role, content: content.substring(0, 500) });
    if (this.conversationHistory.length > 20) this.conversationHistory = this.conversationHistory.slice(-20);
  }

  async _executeToolSafely(toolName, args) {
    if (toolName === 'run_command') {
      const { command, cwd, timeout, env } = args;
      const result = await this.sandbox.execute(command, { cwd, env, timeout });
      let output = result.stdout;
      if (result.stderr) output += '\n\nSTDERR:\n' + result.stderr;
      if (!result.sandboxed) output += '\n\n⚠️ Command ran on host (Docker unavailable). Enable Docker for sandboxing.';
      return output || '(command completed with no output)';
    }
    // For other tools, use the original executeTool
    const { executeTool } = require('./tools');
    return executeTool(toolName, args);
  }

  async shutdown() {
    try { await this.gateway.closeSession(); } catch { }
    await this.sandbox.cleanup();
    if (this.traceLogger) this.traceLogger.close();
    try {
      this.projectMemory.endSession(this._sessionId, 'success');
    } catch (err) {
      // ignore
    }
  }
}

module.exports = { SeekCodeAgent };