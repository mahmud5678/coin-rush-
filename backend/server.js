const express = require("express");
const crypto = require("crypto");
const db = require("./database");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "Coin Rush Backend",
    status: "online"
  });
});

function verifyTelegram(initData) {
  if (!initData) return null;

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== receivedHash) return null;

  const userData = params.get("user");

  if (!userData) return null;

  try {
    return JSON.parse(userData);
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];

  const user = verifyTelegram(initData);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Telegram verification failed"
    });
  }

  req.telegramUser = user;
  next();
}

app.post("/api/auth", auth, (req, res) => {
  const user =
