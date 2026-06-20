function signToken(user) {
  return String(user.id);
}
module.exports = { signToken };
