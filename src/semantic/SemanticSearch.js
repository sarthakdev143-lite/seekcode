'use strict';

const { tokenize } = require('./tokenize');

class SemanticSearch {
  constructor(repositoryMap) {
    this.repositoryMap = repositoryMap;
    this.documents = [];
    this.idf = new Map();
    this.vectors = new Map();
    this._buildIndex(repositoryMap.map);
  }

  refresh() {
    this._buildIndex(this.repositoryMap.map);
  }

  search(query, limit = 8) {
    const queryVector = this._vectorize(tokenize(query));
    return this.documents
      .map(doc => ({ ...doc, score: this._cosine(queryVector, this.vectors.get(doc.path)) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  _buildIndex(map) {
    this.documents = Object.values(map.files || {}).map(file => ({
      path: file.path,
      symbols: file.symbols || [],
      exports: file.exports || [],
      imports: file.imports || [],
      tokens: file.tokens || []
    }));

    const docFreq = new Map();
    for (const doc of this.documents) {
      for (const token of new Set(doc.tokens)) docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }

    this.idf = new Map();
    const total = Math.max(this.documents.length, 1);
    for (const [token, count] of docFreq) {
      this.idf.set(token, Math.log((1 + total) / (1 + count)) + 1);
    }

    this.vectors = new Map();
    for (const doc of this.documents) this.vectors.set(doc.path, this._vectorize(doc.tokens));
  }

  _vectorize(tokens) {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    const vector = new Map();
    for (const [token, count] of counts) vector.set(token, count * (this.idf.get(token) || 1));
    return vector;
  }

  _cosine(a, b) {
    if (!a || !b) return 0;
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    for (const value of a.values()) aNorm += value * value;
    for (const value of b.values()) bNorm += value * value;
    for (const [token, value] of a) dot += value * (b.get(token) || 0);
    return dot && aNorm && bNorm ? dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)) : 0;
  }
}

module.exports = { SemanticSearch };
