const chalk = require('chalk');
const { marked } = require('marked');
const TerminalRenderer = require('marked-terminal').default;

// Configure marked to render to the terminal
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

module.exports = {
  info(msg)    { console.log(chalk.blue('i') + ' ' + msg); },
  success(msg) { console.log(chalk.green('√') + ' ' + msg); },
  warn(msg)    { console.log(chalk.yellow('⚠') + ' ' + msg); },
  error(msg)   { console.log(chalk.red('X') + ' ' + msg); },
  header(msg)  { console.log('\n' + chalk.cyan.bold(msg)); },
  dim(msg)     { console.log(chalk.dim(msg)); },
  
  // New Topic Bar style
  topic(title, intent) {
    console.log('\n' + chalk.bgBlue.white.bold(` TOPIC `) + ' ' + chalk.blue.bold(title));
    if (intent) {
      console.log(chalk.dim('↳ ' + intent));
    }
  },
  
  divider() {
    console.log(chalk.dim('─'.repeat(process.stdout.columns || 50)));
  },

  renderMarkdown(text) {
    return marked(text);
  }
};
