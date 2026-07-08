const mongoose = require("mongoose");

async function connectDb(uri) {
  await mongoose.connect(uri);
  return mongoose.connection;
}

async function disconnectDb() {
  await mongoose.disconnect();
}

module.exports = { connectDb, disconnectDb };
