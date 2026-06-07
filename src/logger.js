const A = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m' };
function c(code, text) { return A[code] + text + A.reset; }
function cb(code, text) { return A.bold + A[code] + text + A.reset; }
module.exports = {
  info(msg)    { console.log(c('blue', 'i') + ' ' + msg); },
  success(msg) { console.log(c('green', '√') + ' ' + msg); },
  warn(msg)    { console.log(c('yellow', '⚠') + ' ' + msg); },
  error(msg)   { console.log(c('magenta', 'X') + ' ' + msg); },
  header(msg)  { console.log('\n' + cb('cyan', msg)); },
  dim(msg)     { console.log(A.dim + msg + A.reset); },
};
