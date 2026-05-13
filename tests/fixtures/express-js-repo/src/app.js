const usersRouter = require("./routes/users");

function createApp() {
  return {
    name: "express-js-repo",
    routes: [usersRouter.route]
  };
}

module.exports = createApp;
