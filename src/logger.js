const chalk = require('chalk');
const { marked } = require('marked');
const TerminalRenderer = require('marked-terminal').default;

// Configure marked to render to the terminal (kept for renderMarkdown)
marked.setOptions({
  renderer: new TerminalRenderer({
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    html: chalk.gray,
    heading: chalk.cyan.bold,
    firstHeading: chalk.magenta.underline.bold,
    hr: chalk.dim,
    listitem: chalk.white,
    table: chalk.gray,
    paragraph: chalk.white,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.bgGray.white,
    del: chalk.strikethrough,
    link: chalk.blue,
    href: chalk.blue.underline
  })
});

const timestamp = () => new Date().toISOString();

function log(level, message, extra = {}) {
  const entry = { timestamp: timestamp(), level, message, ...extra };
  console.log(JSON.stringify(entry));
}

module.exports = {
  info(msg, extra) { log('info', msg, extra); },
  success(msg, extra) { log('success', msg, extra); },
  warn(msg, extra) { log('warn', msg, extra); },
  error(msg, extra) { log('error', msg, extra); },
  header(msg, extra) { log('header', msg, extra); },
  dim(msg, extra) { log('dim', msg, extra); },
  topic(title, intent) { 
    log('topic', title, { intent }); 
  },
  divider() { 
    log('divider', '─'.repeat(50)); 
  },
  renderMarkdown(text) {
    return marked(text);
  }
};
