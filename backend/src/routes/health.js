const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

router.get("/health", (_req, res) =>
  res.json({ ok: true, mongo: mongoose.connection.readyState === 1 })
);
router.get("/ping", (_req, res) => res.json({ ok: true }));

module.exports = router;
