// src/intent/classifier.js
// Determines what kind of user input this is, so we route appropriately.

const INTENTS = {
  GREETING: 'greeting',       // "hi", "hello", "yo"
  QUESTION: 'question',       // "what is X", "how does Y work"
  SINGLE_EDIT: 'single_edit', // "rename this function", "fix this line"
  MULTI_STEP: 'multi_step',   // "refactor the auth module", "add TypeScript"
  UNKNOWN: 'unknown'
};

function classify(task, projectContext) {
  const lower = task.toLowerCase().trim();

  // Greetings
  if (/^(hi|hello|hey|yo|sup|good (morning|afternoon|evening)|howdy)\b/.test(lower)) {
    return INTENTS.GREETING;
  }

  // Pure questions (no action verbs)
  const questionWords = /^(what|who|where|when|why|how|is there|are there|can you (see|find|show|tell|list|explain))\b/i;
  const actionVerbs = /\b(create|make|build|write|add|remove|delete|update|change|refactor|fix|implement|run|execute|install|setup|configure)\b/i;
  
  if (questionWords.test(lower) && !actionVerbs.test(lower)) {
    return INTENTS.QUESTION;
  }

  // Single edit patterns
  const singleEditPatterns = [
    /^(rename|fix|change|update|remove|delete|add a comment to|format|prettify)/i,
    /^(in|for|on) (this|that|the) (file|function|line)/i,
    /^(make this|convert this|switch this)/i
  ];
  if (singleEditPatterns.some(p => p.test(lower))) {
    return INTENTS.SINGLE_EDIT;
  }

  // Multi-step if it has action verbs and seems complex
  if (actionVerbs.test(lower) && lower.split(' ').length > 4) {
    return INTENTS.MULTI_STEP;
  }

  return INTENTS.UNKNOWN;
}

module.exports = { classify, INTENTS };
