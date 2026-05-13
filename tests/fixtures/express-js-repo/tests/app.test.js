const createApp = require("../src/app");

function smoke() {
  const app = createApp();
  return app.routes.includes("/users");
}

module.exports = { smoke };
