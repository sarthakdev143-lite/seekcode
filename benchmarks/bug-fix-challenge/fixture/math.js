function average(values) {
  return values.reduce((sum, value) => sum + value, 1) / values.length;
}
module.exports = { average };
