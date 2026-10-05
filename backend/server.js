const express = require("express");
const crypto = require("crypto");
const db = require("./database");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;


/* =========================
   TELEGRAM VERIFICATION
========================= */

function verifyTelegram(initData) {

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

  if (!botToken) return null;

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash !== hash) return null;

  const userData = params.get("user");

  if (!userData) return null;

  try {
    return JSON.parse(userData);
  } catch {
    return null;
  }
}


/* =========================
   CREATE / GET USER
========================= */

function getUser(telegramUser, callback) {

  db.get(
    "SELECT * FROM users WHERE telegram_id = ?",
    [String(telegramUser.id)],
    (err, user) => {

      if (err) {
        return callback(err);
      }

      if (user) {
        return callback(null, user);
      }

      db.run(
        `INSERT INTO users
        (telegram_id, username, first_name, coins, xp, level)
        VALUES (?, ?, ?, 0, 0, 1)`,

        [
          String(telegramUser.id),
          telegramUser.username || "",
          telegramUser.first_name || ""
        ],

        function(err) {

          if (err) {
            return callback(err);
          }

          db.get(
            "SELECT * FROM users WHERE id = ?",
            [this.lastID],
            callback
          );

        }
      );

    }
  );

}


/* =========================
   HOME
========================= */

app.get("/", (req, res) => {

  res.json({
    success: true,
    app: "Coin Rush Backend",
    status: "online"
  });

});


/* =========================
   AUTH
========================= */

app.post("/api/auth", (req, res) => {

  const user = verifyTelegram(
    req.body.initData
  );

  if (!user) {

    return res.status(401).json({
      success: false,
      message: "Telegram verification failed"
    });

  }

  getUser(user, (err, dbUser) => {

    if (err) {

      return res.status(500).json({
        success: false,
        message: "Database error"
      });

    }

    res.json({
      success: true,
      user: dbUser
    });

  });

});


/* =========================
   PROFILE
========================= */

app.get("/api/profile", (req, res) => {

  const telegramId =
    req.query.telegram_id;

  if (!telegramId) {

    return res.status(400).json({
      success: false,
      message: "Telegram ID required"
    });

  }

  db.get(
    "SELECT * FROM users WHERE telegram_id = ?",
    [String(telegramId)],
    (err, user) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Database error"
        });

      }

      if (!user) {

        return res.status(404).json({
          success: false,
          message: "User not found"
        });

      }

      res.json({
        success: true,
        user: user
      });

    }
  );

});


/* =========================
   PLAY
========================= */

app.post("/api/game/play", (req, res) => {

  const telegramUser =
    verifyTelegram(req.body.initData);

  if (!telegramUser) {

    return res.status(401).json({
      success: false,
      message: "Telegram verification failed"
    });

  }

  getUser(
    telegramUser,
    (err, user) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Database error"
        });

      }

      const earned =
        Math.floor(Math.random() * 21) + 10;

      const newCoins =
        user.coins + earned;

      const newXP =
        user.xp + 10;

      const newLevel =
        Math.floor(newXP / 100) + 1;

      db.run(
        `UPDATE users
         SET coins = ?, xp = ?, level = ?
         WHERE telegram_id = ?`,

        [
          newCoins,
          newXP,
          newLevel,
          String(telegramUser.id)
        ],

        (updateErr) => {

          if (updateErr) {

            return res.status(500).json({
              success: false,
              message: "Could not update coins"
            });

          }

          db.run(
            `INSERT INTO game_events
             (telegram_id, event_type, coins)
             VALUES (?, ?, ?)`,

            [
              String(telegramUser.id),
              "play",
              earned
            ]
          );

          db.get(
            "SELECT * FROM users WHERE telegram_id = ?",
            [String(telegramUser.id)],
            (getErr, updatedUser) => {

              if (getErr) {

                return res.status(500).json({
                  success: false,
                  message: "Database error"
                });

              }

              res.json({
                success: true,
                earned: earned,
                user: updatedUser
              });

            }
          );

        }
      );

    }
  );

});


/* =========================
   DAILY REWARD
========================= */

app.post("/api/reward/daily", (req, res) => {

  const telegramUser =
    verifyTelegram(req.body.initData);

  if (!telegramUser) {

    return res.status(401).json({
      success: false,
      message: "Telegram verification failed"
    });

  }

  getUser(
    telegramUser,
    (err, user) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Database error"
        });

      }

      const today =
        new Date().toISOString().slice(0,10);

      db.get(
        `SELECT * FROM game_events
         WHERE telegram_id = ?
         AND event_type = ?
         AND DATE(created_at) = DATE(?)`,

        [
          String(telegramUser.id),
          "daily_reward",
          today
        ],

        (checkErr, existing) => {

          if (checkErr) {

            return res.status(500).json({
              success: false,
              message: "Database error"
            });

          }

          if (existing) {

            return res.json({
              success: false,
              message: "Daily reward already claimed"
            });

          }

          const newCoins =
            user.coins + 100;

          db.run(
            `UPDATE users
             SET coins = ?
             WHERE telegram_id = ?`,

            [
              newCoins,
              String(telegramUser.id)
            ],

            (updateErr) => {

              if (updateErr) {

                return res.status(500).json({
                  success: false,
                  message: "Could not update reward"
                });

              }

              db.run(
                `INSERT INTO game_events
                (telegram_id, event_type, coins)
                VALUES (?, ?, ?)`,

                [
                  String(telegramUser.id),
                  "daily_reward",
                  100
                ]
              );

              db.get(
                "SELECT * FROM users WHERE telegram_id = ?",
                [String(telegramUser.id)],
                (getErr, updatedUser) => {

                  res.json({
                    success: true,
                    user: updatedUser
                  });

                }
              );

            }
          );

        }
      );

    }
  );

});


/* =========================
   WITHDRAW
========================= */

app.post("/api/withdraw", (req, res) => {

  const telegramUser =
    verifyTelegram(req.body.initData);

  if (!telegramUser) {

    return res.status(401).json({
      success: false,
      message: "Telegram verification failed"
    });

  }

  const amount =
    Number(req.body.amount);

  const method =
    req.body.method;

  const paymentNumber =
    String(req.body.payment_number || "").trim();


  if (
    !Number.isInteger(amount) ||
    amount < 100
  ) {

    return res.json({
      success: false,
      message: "Minimum withdrawal is 100 coins"
    });

  }


  if (
    method !== "bKash" &&
    method !== "Nagad"
  ) {

    return res.json({
      success: false,
      message: "Invalid payment method"
    });

  }


  if (
    paymentNumber.length < 10
  ) {

    return res.json({
      success: false,
      message: "Invalid payment number"
    });

  }


  db.get(
    "SELECT * FROM users WHERE telegram_id = ?",
    [String(telegramUser.id)],
    (err, user) => {

      if (err || !user) {

        return res.status(500).json({
          success: false,
          message: "User not found"
        });

      }


      if (user.coins < amount) {

        return res.json({
          success: false,
          message: "Not enough coins"
        });

      }


      db.run(
        `UPDATE users
         SET coins = coins - ?
         WHERE telegram_id = ?`,

        [
          amount,
          String(telegramUser.id)
        ],

        (updateErr) => {

          if (updateErr) {

            return res.status(500).json({
              success: false,
              message: "Could not reserve coins"
            });

          }


          db.run(
            `INSERT INTO withdrawals
            (telegram_id, amount, method, payment_number, status)
            VALUES (?, ?, ?, ?, 'pending')`,

            [
              String(telegramUser.id),
              amount,
              method,
              paymentNumber
            ],

            (withdrawErr) => {

              if (withdrawErr) {

                return res.status(500).json({
                  success: false,
                  message: "Could not create withdrawal"
                });

              }


              res.json({
                success: true,
                message:
                  "Withdrawal request submitted"
              });

            }
          );

        }
      );

    }
  );

});


/* =========================
   LEADERBOARD
========================= */

app.get("/api/leaderboard", (req, res) => {

  db.all(
    `SELECT first_name, username, coins
     FROM users
     ORDER BY coins DESC
     LIMIT 10`,

    [],
    (err, players) => {

      if (err) {

        return res.status(500).json({
          success: false,
          message: "Database error"
        });

      }

      res.json({
        success: true,
        players: players
      });

    }
  );

});


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

  console.log(
    `Coin Rush backend running on port ${PORT}`
  );

});
