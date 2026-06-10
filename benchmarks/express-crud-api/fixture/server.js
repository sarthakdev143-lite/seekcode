const express = require('express');
const app = express();
app.use(express.json());
let todos = [];
app.get('/todos', (req, res) => res.json(todos));
module.exports = app;
