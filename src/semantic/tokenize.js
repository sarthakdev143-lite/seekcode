'use strict';

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','in','is','it','of','on','or','that','the','to','with',
  'this','const','let','var','function','class','return','require','import','export','module','async','await'
]);

function tokenize(text) {
  return String(text)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

module.exports = { tokenize };
