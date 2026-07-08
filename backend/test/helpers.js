const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;

async function setup() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

async function teardown() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

async function clear() {
  for (const c of Object.values(mongoose.connection.collections)) {
    await c.deleteMany({});
  }
}

module.exports = { setup, teardown, clear };
