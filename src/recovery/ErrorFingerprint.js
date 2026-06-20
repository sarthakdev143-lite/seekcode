'use strict';

const crypto = require('crypto');

class ErrorFingerprint {
  static normalize(errorMessage = '') {
    return String(errorMessage)
      .replace(/[A-Z]:\\[^\s)]+/gi, '<path>')
      .replace(/\/[^\s)]+/g, '<path>')
      .replace(/\b\d+:\d+\b/g, '<line>')
      .replace(/\b\d+\b/g, '<num>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
  }

  static hash(errorMessage = '') {
    return crypto
      .createHash('sha256')
      .update(this.normalize(errorMessage))
      .digest('hex')
      .slice(0, 16);
  }
}

module.exports = { ErrorFingerprint };
