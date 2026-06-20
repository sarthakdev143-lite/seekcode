function renderAdmin(user) {
  return user.firstName + ' ' + user.lastName + ' <' + user.email + '>';
}
function renderCustomer(user) {
  return user.firstName + ' ' + user.lastName + ' <' + user.email + '>';
}
module.exports = { renderAdmin, renderCustomer };
