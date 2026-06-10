const users = require('./users');
const user = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };
if (typeof users.formatUser !== 'function') throw new Error('formatUser missing');
if (users.renderAdmin(user) !== 'Ada Lovelace <ada@example.com>') throw new Error('admin behavior changed');
if (users.renderCustomer(user) !== 'Ada Lovelace <ada@example.com>') throw new Error('customer behavior changed');
