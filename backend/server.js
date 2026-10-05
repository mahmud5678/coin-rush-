const express = require("express");
const crypto = require("crypto");

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

// Telegram Mini App verification
function verifyTelegramInitData(initData) {

  if (!initData) return null;

  const params = new URLSearchParams(initData);

  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const botToken = process.env.BOT_TOKEN;

  if (!botToken) {
    return null;
  }

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) {
    return null;
  }

  const userData = params.get("user");

  if (!userData) return null;

  try {
    return JSON.parse(userData);
  } catch {
    return null;
  }
}


// Telegram login test
app.post("/api/auth", (req, res) => {

  const { initData } = req.body;

  const user = verifyTelegramInitData(initData);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "Telegram verification failed"
    });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username || "",
      first_name: user.first_name || ""
    }
  });

});


app.listen(PORT, () => {
  console.log(`Coin Rush backend running on port ${PORT}`);
});
