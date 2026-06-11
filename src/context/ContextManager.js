// seekcode/src/context/ContextManager.js
// Token-aware context compaction & relevance tracking
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger');

function estimateTokens(text) {
  if (!text) return 0;
  // heuristic: English/code ~3.8 chars/token, CJK ~1.5
  const hasCJK = /[\u4e00-\u9fff]/.test(text);
  const avgCharsPerToken = hasCJK ? 1.5 : 3.8;
  return Math.ceil(text.length / avgCharsPerToken);
}

function truncateToTokens(text, maxTokens) {
  const maxChars = Math.floor(maxTokens * 3.8);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n... [truncated]';
}

class ConversationSummarizer {
  constructor(options = {}) {
    this.maxSummaryTokens = options.maxSummaryTokens || 400;
    this.summaries = new Map();
  }

  summarizeTurn(turnIndex, role, content) {
    let summary;
    if (role === 'tool') {
      const status = content.includes('ERROR') ? 'FAILED' : 'SUCCESS';
      const preview = content.slice(0, 200).replace(/\n/g, ' ');
      summary = `[Tool ${status}] ${preview}${content.length > 200 ? '...' : ''}`;
    } else if (role === 'assistant') {
      const lines = content.split('\n').filter(l => l.trim());
      const firstSentence = lines[0]?.slice(0, 200) || '';
      const hasToolCall = content.includes('```tool_call');
      summary = firstSentence + (hasToolCall ? ' [used tools]' : '') +
                (content.length > 300 ? ' ...' : '');
    } else {
      summary = content.slice(0, 300) + (content.length > 300 ? '...' : '');
    }
    this.summaries.set(turnIndex, { role, summary, originalTokens: estimateTokens(content) });
    return summary;
  }

  getSummaryChain() {
    const entries = Array.from(this.summaries.entries()).sort(([a],[b]) => a-b);
    return entries.map(([i,{role,summary}]) => `[${i}] ${role}: ${summary}`).join('\n');
  }

  getSavedTokens() {
    let saved = 0;
    for (const {originalTokens, summary} of this.summaries.values()) {
      saved += originalTokens - estimateTokens(summary);
    }
    return saved;
  }
}

class RelevantFileTracker {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.fileScores = new Map();
    this.fileContents = new Map();
    this.maxCacheSize = 50;
  }

  scoreRelevance(taskDescription, filePaths) {
    const taskWords = new Set(
      taskDescription.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2)
    );
    const scores = [];
    for (const fp of filePaths) {
      const basename = path.basename(fp).toLowerCase();
      const relPath = path.relative(this.projectPath, fp).toLowerCase();
      let score = 0;
      for (const word of taskWords) {
        if (basename.includes(word)) score += 10;
        if (relPath.includes(word)) score += 5;
      }
      if (this.fileContents.has(fp)) {
        const content = this.fileContents.get(fp).toLowerCase();
        for (const word of taskWords) {
          const count = (content.match(new RegExp(word, 'g')) || []).length;
          score += count * 2;
        }
      }
      this.fileScores.set(fp, score);
      if (score > 0) scores.push({ path: fp, score });
    }
    return scores.sort((a,b) => b.score - a.score);
  }

  cacheFileContent(filePath, content) {
    if (this.fileContents.size >= this.maxCacheSize) {
      const firstKey = this.fileContents.keys().next().value;
      this.fileContents.delete(firstKey);
    }
    this.fileContents.set(filePath, content);
  }

  getTopRelevantFiles(maxFiles = 10, minScore = 1) {
    return Array.from(this.fileScores.entries())
      .filter(([,score]) => score >= minScore)
      .sort(([,a],[,b]) => b - a)
      .slice(0, maxFiles)
      .map(([fp]) => fp);
  }

  clear() {
    this.fileScores.clear();
    this.fileContents.clear();
  }
}

class ContextManager {
  constructor(options = {}) {
    this.maxContextTokens = options.maxContextTokens || 120_000;
    this.systemPromptTokens = options.systemPromptTokens || 2000;
    this.toolDescriptionsTokens = options.toolDescriptionsTokens || 3000;
    this.reserveTokens = options.reserveTokens || 4000;
    this.summarizer = new ConversationSummarizer(options);
    this.fileTracker = options.projectPath ? new RelevantFileTracker(options.projectPath) : null;
    this.conversation = [];
    this.turnCounter = 0;
    this.currentTask = '';
    this.metrics = {
      totalTurns: 0,
      summarizedTurns: 0,
      tokensSaved: 0,
      compactionEvents: 0,
    };
  }

  setTask(taskDescription) {
    this.currentTask = taskDescription;
  }

  addMessage(role, content, options = {}) {
    const tokens = estimateTokens(content);
    const turnIndex = this.turnCounter++;
    const entry = {
      role, content, tokens, turnIndex,
      isSummarized: false,
      timestamp: Date.now(),
    };
    this.conversation.push(entry);
    this.metrics.totalTurns++;

    const availableTokens = this.maxContextTokens -
      this.systemPromptTokens -
      this.toolDescriptionsTokens -
      this.reserveTokens;
    const currentTokens = this.getCurrentTokenCount();
    if (currentTokens > availableTokens) {
      this._compact(availableTokens);
    }
    return entry;
  }

  getCurrentTokenCount() {
    return this.conversation.reduce((sum, e) =>
      sum + (e.isSummarized ? estimateTokens(e.content) : e.tokens), 0);
  }

  buildContextForLLM(options = {}) {
    const { maxRecentTurns = 6 } = options;
    const parts = [];
    let usedTokens = 0;

    const recentTurns = this.conversation.slice(-maxRecentTurns);
    const recentContent = recentTurns.map(e => this._formatEntry(e)).join('\n\n');
    const recentTokens = estimateTokens(recentContent);
    parts.push({ type: 'recent', content: recentContent, tokens: recentTokens });
    usedTokens += recentTokens;

    const olderTurns = this.conversation.slice(0, -maxRecentTurns).filter(e => e.isSummarized);
    if (olderTurns.length > 0) {
      const summaryContent = olderTurns.map(e => this._formatEntry(e)).join('\n\n');
      const summaryTokens = estimateTokens(summaryContent);
      const remaining = this.maxContextTokens - usedTokens - this.reserveTokens;
      if (summaryTokens < remaining) {
        parts.unshift({ type: 'summary', content: `\n[Earlier conversation summary]\n${summaryContent}`, tokens: summaryTokens });
      } else {
        const compressed = this._compressSummaries(olderTurns, remaining);
        if (compressed) {
          parts.unshift({ type: 'summary', content: `\n[Earlier conversation summary]\n${compressed}`, tokens: estimateTokens(compressed) });
        }
      }
    }

    if (this.fileTracker) {
      const relevantFiles = this.fileTracker.getTopRelevantFiles(5);
      if (relevantFiles.length > 0) {
        const fileContext = this._buildFileContext(relevantFiles);
        const fileTokens = estimateTokens(fileContext);
        const remaining = this.maxContextTokens - usedTokens - this.reserveTokens;
        if (fileTokens < remaining * 0.3) {
          parts.push({ type: 'files', content: fileContext, tokens: fileTokens });
        }
      }
    }

    const ordered = [
      parts.find(p => p.type === 'summary'),
      parts.find(p => p.type === 'recent'),
      parts.find(p => p.type === 'files'),
    ].filter(Boolean);
    return ordered.map(p => p.content).join('\n\n');
  }

  _compact(targetTokens) {
    logger.warn(`Context window approaching limit. Compacting older turns...`);
    this.metrics.compactionEvents++;
    const toSummarize = [];
    let currentTokens = this.getCurrentTokenCount();
    for (let i = 0; i < this.conversation.length - 3; i++) {
      const entry = this.conversation[i];
      if (!entry.isSummarized) {
        toSummarize.push(entry);
        currentTokens -= entry.tokens;
        if (currentTokens <= targetTokens * 0.85) break;
      }
    }
    for (const entry of toSummarize) {
      const summary = this.summarizer.summarizeTurn(entry.turnIndex, entry.role, entry.content);
      entry.content = summary;
      entry.isSummarized = true;
      entry.tokens = estimateTokens(summary);
      this.metrics.summarizedTurns++;
    }
    const saved = this.summarizer.getSavedTokens();
    this.metrics.tokensSaved = saved;
    logger.success(`Compacted ${toSummarize.length} turns. Tokens saved: ~${saved}`);
  }

  _formatEntry(entry) {
    const prefix = entry.role === 'user' ? 'USER' :
                   entry.role === 'assistant' ? 'ASSISTANT' : 'TOOL';
    return `[${prefix}]\n${entry.content}`;
  }

  _compressSummaries(turns, maxTokens) {
    const actions = turns.filter(e => e.role === 'assistant').map(e =>
      e.content.includes('tool_call') ? '[used tools]' : '[responded]');
    const toolResults = turns.filter(e => e.role === 'tool').map(e =>
      e.content.includes('ERROR') ? '[tool failed]' : '[tool success]');
    const compressed = [
      `Actions: ${actions.join(' → ')}`,
      `Tool results: ${toolResults.join(', ')}`,
    ].join('\n');
    return truncateToTokens(compressed, maxTokens);
  }

  _buildFileContext(filePaths) {
    const lines = ['\n[Relevant project files]'];
    for (const fp of filePaths) {
      const content = this.fileTracker.fileContents.get(fp);
      if (content) {
        const preview = content.split('\n').slice(0, 30).join('\n');
        lines.push(`\n--- ${path.basename(fp)} ---\n${preview}`);
      }
    }
    return lines.join('\n');
  }

  getMetrics() {
    return {
      ...this.metrics,
      currentTokens: this.getCurrentTokenCount(),
      maxTokens: this.maxContextTokens,
      utilization: (this.getCurrentTokenCount() / this.maxContextTokens * 100).toFixed(1) + '%',
      conversationLength: this.conversation.length,
    };
  }

  reset() {
    this.conversation = [];
    this.turnCounter = 0;
    this.currentTask = '';
    this.summarizer = new ConversationSummarizer();
    if (this.fileTracker) this.fileTracker.clear();
    this.metrics = {
      totalTurns: 0,
      summarizedTurns: 0,
      tokensSaved: 0,
      compactionEvents: 0,
    };
  }
}

module.exports = {
  ContextManager,
  ConversationSummarizer,
  RelevantFileTracker,
  estimateTokens,
  truncateToTokens,
};