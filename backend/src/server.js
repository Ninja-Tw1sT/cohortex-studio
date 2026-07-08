require("dotenv").config();
const createApp = require("./app");
const { connectDb } = require("./config/db");

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/cohortex_studio";

(async () => {
  await connectDb(MONGODB_URI);
  createApp().listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log(`[cohortex-studio] API listening on :${PORT}`)
  );
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("startup failed:", e);
  process.exit(1);
});
