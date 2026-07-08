module.exports = {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.js"],
  // in-memory Mongo can take a moment to download/boot on first run
  testTimeout: 60000,
};
