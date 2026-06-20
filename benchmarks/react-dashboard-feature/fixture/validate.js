const fs = require('fs');
const text = fs.readFileSync('src/Dashboard.jsx', 'utf8').toLowerCase();
for (const token of ['revenue', 'active users', 'conversion']) {
  if (!text.includes(token)) throw new Error('missing ' + token);
}
