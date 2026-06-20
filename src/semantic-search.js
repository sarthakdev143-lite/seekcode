#!/usr/bin/env node
'use strict';

const path = require('path');
const { ProjectAnalyzer } = require('./analyzer/ProjectAnalyzer');
const { RepositoryMap, SemanticSearch } = require('./semantic');

async function main() {
  const project = path.resolve(process.argv[2] || '.');
  const query = process.argv.slice(3).join(' ');
  if (!query) {
    console.error('Usage: node src/semantic-search.js <project> <query>');
    process.exit(1);
  }

  const analyzer = new ProjectAnalyzer(project);
  await analyzer.analyze();
  const repositoryMap = new RepositoryMap(project, analyzer);
  repositoryMap.build();
  const search = new SemanticSearch(repositoryMap);
  const results = search.search(query, 10);

  for (const result of results) {
    const symbols = result.symbols.slice(0, 5).map(s => s.name).filter(Boolean).join(', ');
    console.log(`${result.score.toFixed(3)} ${result.path}${symbols ? ` [${symbols}]` : ''}`);
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
