'use strict';

class PlannerAgent {
  constructor(planner, semanticSearch = null) {
    this.planner = planner;
    this.semanticSearch = semanticSearch;
  }

  async plan(task) {
    const plan = await this.planner.plan(task);
    if (!plan.quickAnswer && this.semanticSearch) {
      plan.relatedFiles = this.semanticSearch.search(task, 10).map(r => ({
        path: r.path,
        score: Number(r.score.toFixed(3)),
        symbols: r.symbols.slice(0, 8)
      }));
    }
    return plan;
  }
}

module.exports = { PlannerAgent };
