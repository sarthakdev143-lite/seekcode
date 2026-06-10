const { GatewayClient } = require('../gateway-client');
const { classify, INTENTS } = require('../intent/classifier');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const config = require('../config');
const logger = require('../logger');
let TraceLogger = null;
try {
  TraceLogger = require('../trace-logger').TraceLogger;
} catch (e) {}

class SeekCodeAgent {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.gateway = new GatewayClient();
    this.analyzer = null;
    this.conversationHistory = [];  // keep context across turns
    this.traceLogger = null;
    
    // Initialize trace logger if SEEKCODE_TRACE is enabled
    if (process.env.SEEKCODE_TRACE === '1' && TraceLogger) {
      const sessionId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.traceLogger = new TraceLogger(sessionId, this.projectPath);
      this.traceLogger.logEvent('agent_init', { projectPath: this.projectPath });
    }
  }

  async init() {
    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    await this.gateway.createSession();
    logger.success('Agent ready. Project: ' + this.analyzer.getSummary().project);
  }

  async _callLLMWithTrace(prompt, handlerName) {
    if (!this.traceLogger) {
      return await this.gateway.chat(prompt);
    }
    
    const turnId = `${handlerName}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const startTime = Date.now();
    
    try {
      const response = await this.gateway.chat(prompt);
      const duration = Date.now() - startTime;
      
      this.traceLogger.logLLMTurn(turnId, prompt, response, duration, {
        handler: handlerName,
        intent: this._currentIntent
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.traceLogger.logEvent('llm_error', {
        turnId,
        handler: handlerName,
        durationMs: duration,
        error: error.message
      });
      throw error;
    }
  }

  async handle(input) {
    const intent = classify(input, this.analyzer.getSummary());
    this._currentIntent = intent;

    // ENHANCEMENT: System-level constraints for Agentic behavior
    const agenticBase = [
      'You are SeekCode, a senior autonomous software engineer.',
      'CORE DIRECTIVES:',
      '- RESEARCH FIRST: Never edit a file without reading it and its dependencies first.',
      '- SURGICAL EDITS: Prefer `replace_in_file` over `write_file`. Be precise.',
      '- VALIDATE ALWAYS: After any change, run a relevant command (test, build, or ls) to verify.',
      '- NO HACKS: Do not suppress warnings or use `any` types. Fix the root cause.',
      '- IDIOMATIC: Match the existing project style, naming, and architecture.'
    ].join('\n');

    switch (intent) {
      case INTENTS.GREETING:
        return await this._handleGreeting(input);
      case INTENTS.QUESTION:
        return await this._handleQuestion(input, agenticBase);
      case INTENTS.SINGLE_EDIT:
        return await this._handleSingleEdit(input, agenticBase);
      case INTENTS.MULTI_STEP:
        return await this._handleMultiStep(input, agenticBase);
      default:
        return await this._handleChat(input, agenticBase);
    }
  }

  // ---- Handlers ----

  async _handleGreeting(input) {
    const greetings = [
      "Hey! I'm SeekCode. What would you like to work on?",
      "Hi there! Ready to help with code. What's the task?",
      "Hello! I can help you code, refactor, debug, or answer questions about this project."
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  async _handleQuestion(input, agenticBase) {
    const prompt = [
      agenticBase,
      '',
      'USER QUESTION: ' + input,
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(this.analyzer.getSummary(), null, 2)
    ].join('\n');

    const response = await this._callLLMWithTrace(prompt, '_handleQuestion');
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleSingleEdit(input, agenticBase) {
    const prompt = [
      agenticBase,
      '',
      'TASK: ' + input,
      '',
      'STEPS:',
      '1. Research: Read the file and understand its purpose.',
      '2. Plan: Explain what you will change.',
      '3. Act: Use surgical tools.',
      '4. Verify: Run a check.'
    ].join('\n');

    const response = await this._callLLMWithTrace(prompt, '_handleSingleEdit');
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleMultiStep(input, agenticBase) {
    const prompt = [
      agenticBase,
      '',
      'USER TASK: ' + input,
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(this.analyzer.getSummary(), null, 2),
      '',
      'Approach:',
      '1. Research and state your plan.',
      '2. Execute using surgical tools.',
      '3. Validate and summarize.'
    ].join('\n');

    const response = await this._callLLMWithTrace(prompt, '_handleMultiStep');
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleChat(input, agenticBase) {
    const prompt = [
      agenticBase,
      '',
      'USER: ' + input,
      '',
      'CONVERSATION:',
      ...this.conversationHistory.slice(-8).map(m => m.role + ': ' + m.content)
    ].join('\n');

    const response = await this._callLLMWithTrace(prompt, '_handleChat');
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  _buildContext() {
    return {
      project: this.analyzer.getSummary(),
      files: this.analyzer.getDependencyGraph().getAllFiles().slice(0, 50)
    };
  }

  _addToHistory(role, content) {
    this.conversationHistory.push({ role, content: content.substring(0, 500) });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }
  }

  async shutdown() {
    try { await this.gateway.closeSession(); } catch {}
    if (this.traceLogger) {
      this.traceLogger.close();
    }
  }
}

module.exports = { SeekCodeAgent };
