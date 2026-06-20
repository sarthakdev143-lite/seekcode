'use strict';

/**
 * redact.js — Scrub secrets from strings before they reach log output.
 *
 * Patterns covered:
 *   - Generic API key / secret / token env-var assignments
 *   - Bearer / Authorization header values
 *   - Private key PEM blocks
 *   - Connection strings (postgres://, mongodb://, redis://)
 *   - AWS-style access keys
 *   - Common .env variable patterns  (SECRET=, PASSWORD=, TOKEN=, KEY=)
 */

// Each entry: [regex, replacement]
const PATTERNS = [
  // ── Bearer / Auth headers ─────────────────────────────────────────────────
  [/(Authorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]'],
  [/(Authorization\s*[:=]\s*Basic\s+)[A-Za-z0-9+/=]+/gi,        '$1[REDACTED]'],

  // ── .env / config assignments  (KEY=value or "key": "value") ──────────────
  [/((?:secret|password|passwd|token|api[_-]?key|private[_-]?key|access[_-]?key|auth[_-]?key|client[_-]?secret)\s*[=:]\s*)["']?[^\s"',;\n]{8,}["']?/gi, '$1[REDACTED]'],

  // ── AWS-style access key IDs (AKIA...) ────────────────────────────────────
  [/\bAKIA[0-9A-Z]{16}\b/g, '[AWS_KEY_REDACTED]'],

  // ── Private key PEM blocks ─────────────────────────────────────────────────
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[PRIVATE_KEY_REDACTED]'],

  // ── Connection strings (strip credentials from URL) ────────────────────────
  [/((?:postgres|postgresql|mongodb|mysql|redis|amqp|amqps):\/\/)[^:@\s]+:[^@\s]+@/gi, '$1[REDACTED]@'],

  // ── GitHub / npm / generic tokens (long alphanumeric strings after "token") ─
  [/(token\s*[:=]\s*)["']?[A-Za-z0-9_\-]{20,}["']?/gi, '$1[REDACTED]'],

  // ── OpenAI / Anthropic / Hugging Face style keys ─────────────────────────
  [/\bsk-[A-Za-z0-9]{20,}/g,  '[API_KEY_REDACTED]'],
  [/\bhf_[A-Za-z0-9]{10,}/g,  '[HF_TOKEN_REDACTED]'],
  [/\bxoxb-[A-Za-z0-9\-]{10,}/g, '[SLACK_TOKEN_REDACTED]'],
];

/**
 * Redact secrets from a string.
 * @param {string} text
 * @returns {string}
 */
function redact(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redact secrets from all string values in an object (shallow).
 * Safe to call on logger metadata payloads.
 * @param {object} obj
 * @returns {object}
 */
function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      result[k] = redact(v);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = redactObject(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

module.exports = { redact, redactObject, PATTERNS };
