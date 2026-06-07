const { GatewayClient } = require('../gateway-client');
const { classify, INTENTS } = require('../intent/classifier');
const { ProjectAnalyzer } = require('../analyzer/ProjectAnalyzer');
const config = require('../config');
const logger = require('../logger');

class SeekCodeAgent {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.gateway = new GatewayClient();
    this.analyzer = null;
    this.conversationHistory = [];  // keep context across turns
  }

  async init() {
    this.analyzer = new ProjectAnalyzer(this.projectPath);
    await this.analyzer.analyze();
    await this.gateway.createSession();
    logger.success('Agent ready. Project: ' + this.analyzer.getSummary().project);
  }

  async handle(input) {
    const intent = classify(input, this.analyzer.getSummary());

    switch (intent) {
      case INTENTS.GREETING:
        return await this._handleGreeting(input);
      case INTENTS.QUESTION:
        return await this._handleQuestion(input);
      case INTENTS.SINGLE_EDIT:
        return await this._handleSingleEdit(input);
      case INTENTS.MULTI_STEP:
        return await this._handleMultiStep(input);
      default:
        return await this._handleChat(input);  // freeform chat
    }
  }

  // ---- Handlers ----

  async _handleGreeting(input) {
    // Don't even call the LLM for greetings
    const greetings = [
      "Hey! I'm SeekCode. What would you like to work on?",
      "Hi there! Ready to help with code. What's the task?",
      "Hello! I can help you code, refactor, debug, or answer questions about this project."
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }

  async _handleQuestion(input) {
    const context = this._buildContext();
    const prompt = [
      'You are SeekCode, an expert coding assistant. Answer the user question concisely.',
      'You have access to the project context. Keep your answer brief and direct.',
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(this.analyzer.getSummary(), null, 2),
      '',
      'CONVERSATION HISTORY:',
      ...this.conversationHistory.slice(-5).map(m => m.role + ': ' + m.content),
      '',
      'USER QUESTION: ' + input,
      '',
      'Answer in 1-3 short paragraphs. No tool calls unless needed to read a file.'
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleSingleEdit(input) {
    const context = this._buildContext();
    const prompt = [
      'You are SeekCode, an expert coding assistant. Perform the requested edit.',
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(this.analyzer.getSummary(), null, 2),
      '',
      'RECENT CONVERSATION:',
      ...this.conversationHistory.slice(-3).map(m => m.role + ': ' + m.content),
      '',
      'USER REQUEST: ' + input,
      '',
      'Use tools (read_file, write_file, replace_in_file, run_command) as needed.',
      'Do one thing at a time. After completing the edit, provide a brief summary.'
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleMultiStep(input) {
    // For complex tasks, generate a light plan but let the LLM drive execution
    const context = this._buildContext();
    const prompt = [
      'You are SeekCode, an expert AI software engineer. Complete the following task.',
      '',
      'PROJECT CONTEXT:',
      JSON.stringify(this.analyzer.getSummary(), null, 2),
      '',
      'USER TASK: ' + input,
      '',
      'Approach:',
      '1. Briefly state your plan (2-3 bullet points)',
      '2. Execute using tools (read_file, write_file, run_command, etc.)',
      '3. After completing, provide a summary of what was done',
      '',
      'You have full access to the filesystem. Be thorough but efficient.'
    ].join('\n');

    const response = await this.gateway.chat(prompt);
    this._addToHistory('user', input);
    this._addToHistory('assistant', response);
    return response;
  }

  async _handleChat(input) {
    // Freeform chat – let the LLM decide what to do
    const context = this._buildContext();
    const prompt = [
      'You are SeekCode, an expert coding assistant. Respond to the user naturally.',
      'You have access to project tools (read_file, write_file, run_command).',
      '',
      'PROJECT: ' + JSON.stringify(this.analyzer.getSummary()),
      '',
      'CONVERSATION:',
      ...this.conversationHistory.slice(-8).map(m => m.role + ': ' + m.content),
      '',
      'USER: ' + input,
      '',
      'Respond helpfully. If you need to read or edit files, use the tools. If it is a simple conversation, just reply.'
    ].join('\n');

    const response = await this.gateway.chat(prompt);
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
  }
}

module.exports = { SeekCodeAgent };
