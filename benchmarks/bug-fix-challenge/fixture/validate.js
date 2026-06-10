const { average } = require('./math');
if (average([2, 4, 6]) !== 4) throw new Error('wrong average');
if (average([]) !== 0) throw new Error('empty average must be 0');
