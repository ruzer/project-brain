const route = "/users";

function listUsers() {
  return [{ id: "user-1", name: "Ada" }];
}

module.exports = {
  route,
  listUsers
};
