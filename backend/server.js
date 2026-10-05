const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./database");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());


/* =========================
   ADMIN AUTH
========================= */

function adminAuth(req, res, next) {

  const key = req.headers["x-admin-key"];

  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({
      success: false,
      error: "Admin authentication failed"
    });
  }

  next();
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
   TELEGRAM VERIFY
========================= */

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

  if (calculatedHash !== receivedHash) {
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


/* =========================
   USER AUTH
========================= */

function auth(req, res, next) {

  const initData =
    req.headers["x-telegram-init-data"];

  const user =
    verifyTelegram(initData);

  if (!user) {

    return res.status(401).json({
      success: false,
      error: "Telegram verification failed"
    });

  }

  req.telegramUser = user;

  next();
}


/* =========================
   LOGIN
========================= */

app.post("/api/auth", auth, (req, res) => {

  const user = req.telegramUser;

  db.run(
    `INSERT INTO users
    (telegram_id, username, first_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id)
    DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name`,
    [
      String(user.id),
      user.username || null,
      user.first_name || null
    ],
    function(err) {

      if (err) {

        return res.status(500).json({
          success: false,
          error: err.message
        });

      }

      res.json({
        success: true,
        user: {
          telegram_id: String(user.id),
          username: user.username || null,
          first_name: user.first_name || null
        }
      });

    }
  );

});


/* =========================
   PROFILE
========================= */

app.get("/api/profile", auth, (req, res) => {

  const telegramId =
    String(req.telegramUser.id);

  db.get(
    `SELECT
      telegram_id,
      username,
      first_name,
      coins,
      xp,
      level,
      plays
     FROM users
     WHERE telegram_id = ?`,
    [telegramId],
    (err, row) => {

      if (err) {

        return res.status(500).json({
          success: false,
          error: err.message
        });

      }

      if (!row) {

        return res.status(404).json({
          success: false,
          error: "User not found"
        });

      }

      const currentLevel =
        row.level;

      const xpNeededForNextLevel =
        currentLevel * 10;

      const xpBeforeCurrentLevel =
        10 *
        ((currentLevel - 1) * currentLevel) /
        2;

      const currentLevelXP =
        row.xp - xpBeforeCurrentLevel;

      const xpProgress =
        Math.min(
          Math.max(
            (currentLevelXP /
              xpNeededForNextLevel) * 100,
            0
          ),
          100
        );

      res.json({
        success: true,
        user: {
          ...row,
          xp_to_next_level:
            xpNeededForNextLevel,
          xp_progress:
            xpProgress
        }
      });

    }
  );

});
/* =========================
   PLAY GAME
========================= */

app.post("/api/game/play", auth, (req, res) => {

  const telegramId =
    String(req.telegramUser.id);

  const reward = 10;

  db.get(
    `SELECT xp, level, plays
     FROM users
     WHERE telegram_id = ?`,
    [telegramId],
    (err, user) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          error: "User not found"
        });
      }

      const newXP = user.xp + 1;
      const newPlays = user.plays + 1;

      let newLevel = 1;

      while (
        10 *
        ((newLevel - 1) * newLevel) /
        2 <= newXP
      ) {

        newLevel++;

        if (newLevel > 100) {
          newLevel = 100;
          break;
        }
      }

      newLevel--;

      if (newLevel < 1) {
        newLevel = 1;
      }

      db.run(
        `UPDATE users
         SET coins = coins + ?,
             xp = ?,
             level = ?,
             plays = ?
         WHERE telegram_id = ?`,
        [
          reward,
          newXP,
          newLevel,
          newPlays,
          telegramId
        ],
        function(updateErr) {

          if (updateErr) {
            return res.status(500).json({
              success: false,
              error: updateErr.message
            });
          }

          db.run(
            `INSERT INTO game_events
            (telegram_id, event_type, coins)
            VALUES (?, ?, ?)`,
            [
              telegramId,
              "play",
              reward
            ]
          );

          const xpNeeded =
            newLevel * 10;

          const xpBefore =
            10 *
            ((newLevel - 1) * newLevel) /
            2;

          const currentXP =
            newXP - xpBefore;

          const progress =
            Math.min(
              Math.max(
                (currentXP / xpNeeded) * 100,
                0
              ),
              100
            );

          res.json({
            success: true,
            reward,
            xp: newXP,
            level: newLevel,
            plays: newPlays,
            xp_to_next_level: xpNeeded,
            xp_progress: progress
          });

        }
      );

    }
  );

});


/* =========================
   DAILY REWARD
========================= */

app.post("/api/reward/daily", auth, (req, res) => {

  const telegramId =
    String(req.telegramUser.id);

  const reward = 100;

  db.get(
    `SELECT created_at
     FROM game_events
     WHERE telegram_id = ?
       AND event_type = 'daily_reward'
     ORDER BY created_at DESC
     LIMIT 1`,
    [telegramId],
    (err, lastReward) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (lastReward) {

        const lastDate =
          new Date(lastReward.created_at);

        const now =
          new Date();

        const sameDay =
          lastDate.getFullYear() === now.getFullYear() &&
          lastDate.getMonth() === now.getMonth() &&
          lastDate.getDate() === now.getDate();

        if (sameDay) {

          return res.status(400).json({
            success: false,
            error:
              "Daily reward already claimed today"
          });

        }
      }

      db.run(
        `UPDATE users
         SET coins = coins + ?
         WHERE telegram_id = ?`,
        [reward, telegramId],
        function(updateErr) {

          if (updateErr) {
            return res.status(500).json({
              success: false,
              error: updateErr.message
            });
          }

          db.run(
            `INSERT INTO game_events
            (telegram_id, event_type, coins)
            VALUES (?, ?, ?)`,
            [
              telegramId,
              "daily_reward",
              reward
            ],
            function(insertErr) {

              if (insertErr) {
                return res.status(500).json({
                  success: false,
                  error: insertErr.message
                });
              }

              res.json({
                success: true,
                reward
              });

            }
          );

        }
      );

    }
  );

});


/* =========================
   SPONSORED MISSIONS
   PLAYER - LIST
========================= */

app.get(
  "/api/missions",
  auth,
  (req, res) => {

    const telegramId =
      String(req.telegramUser.id);

    db.all(
      `SELECT
        m.id,
        m.title,
        m.description,
        m.reward,
        m.sponsor,
        m.status,
        CASE
          WHEN c.id IS NULL THEN 'available'
          ELSE c.status
        END AS player_status
       FROM sponsored_missions m
       LEFT JOIN mission_claims c
         ON c.mission_id = m.id
        AND c.telegram_id = ?
       WHERE m.status = 'active'
       ORDER BY m.id DESC`,
      [telegramId],
      (err, rows) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          missions: rows
        });

      }
    );

  }
);


/* =========================
   SPONSORED MISSION
   PLAYER - SUBMIT
========================= */

app.post(
  "/api/missions/:id/claim",
  auth,
  (req, res) => {

    const telegramId =
      String(req.telegramUser.id);

    const missionId =
      Number(req.params.id);

    if (!Number.isInteger(missionId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid mission ID"
      });
    }

    db.get(
      `SELECT
        id,
        title,
        reward,
        status
       FROM sponsored_missions
       WHERE id = ?`,
      [missionId],
      (err, mission) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (
          !mission ||
          mission.status !== "active"
        ) {
          return res.status(404).json({
            success: false,
            error: "Mission unavailable"
          });
        }

        db.get(
          `SELECT id
           FROM mission_claims
           WHERE mission_id = ?
             AND telegram_id = ?`,
          [
            missionId,
            telegramId
          ],
          (checkErr, existing) => {

            if (checkErr) {
              return res.status(500).json({
                success: false,
                error: checkErr.message
              });
            }

            if (existing) {
              return res.status(400).json({
                success: false,
                error:
                  "You already submitted this mission"
              });
            }

            db.run(
              `INSERT INTO mission_claims
              (mission_id, telegram_id, status)
              VALUES (?, ?, 'pending')`,
              [
                missionId,
                telegramId
              ],
              function(insertErr) {

                if (insertErr) {
                  return res.status(500).json({
                    success: false,
                    error: insertErr.message
                  });
                }

                res.json({
                  success: true,
                  message:
                    "Mission submitted for review"
                });

              }
            );

          }
        );

      }
    );

  }
);


/* =========================
   WITHDRAW
========================= */

app.post("/api/withdraw", auth, (req, res) => {

  const telegramId =
    String(req.telegramUser.id);

  const amount =
    Number(req.body.amount);

  const method =
    req.body.method;

  const paymentNumber =
    req.body.payment_number;

  if (
    !Number.isInteger(amount) ||
    amount < 100
  ) {
    return res.status(400).json({
      success: false,
      error: "Minimum withdrawal is 100 coins"
    });
  }

  if (
    !["bkash", "telegram_wallet"].includes(method)
  ) {
    return res.status(400).json({
      success: false,
      error: "Invalid payment method"
    });
  }

  if (!paymentNumber) {
    return res.status(400).json({
      success: false,
      error: "Payment number required"
    });
  }

  db.get(
    `SELECT coins
     FROM users
     WHERE telegram_id = ?`,
    [telegramId],
    (err, user) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      if (
        !user ||
        user.coins < amount
      ) {
        return res.status(400).json({
          success: false,
          error: "Not enough coins"
        });
      }

      db.run(
        `UPDATE users
         SET coins = coins - ?
         WHERE telegram_id = ?`,
        [
          amount,
          telegramId
        ],
        function(updateErr) {

          if (updateErr) {
            return res.status(500).json({
              success: false,
              error: updateErr.message
            });
          }

          db.run(
            `INSERT INTO withdrawals
            (telegram_id, amount, method, payment_number)
            VALUES (?, ?, ?, ?)`,
            [
              telegramId,
              amount,
              method,
              paymentNumber
            ],
            function(insertErr) {

              if (insertErr) {
                return res.status(500).json({
                  success: false,
                  error: insertErr.message
                });
              }

              res.json({
                success: true,
                message:
                  "Withdrawal request submitted",
                withdrawal_id:
                  this.lastID
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
    `SELECT
      username,
      first_name,
      coins,
      level
     FROM users
     ORDER BY coins DESC
     LIMIT 20`,
    [],
    (err, rows) => {

      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message
        });
      }

      res.json({
        success: true,
        leaderboard: rows
      });

    }
  );

});


/* =========================================================
   ADMIN - SPONSORED MISSIONS
========================================================= */


/* =========================
   GET ALL MISSIONS
========================= */

app.get(
  "/api/admin/missions",
  adminAuth,
  (req, res) => {

    db.all(
      `SELECT *
       FROM sponsored_missions
       ORDER BY id DESC`,
      [],
      (err, rows) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          missions: rows
        });

      }
    );

  }
);


/* =========================
   CREATE MISSION
========================= */

app.post(
  "/api/admin/missions",
  adminAuth,
  (req, res) => {

    const title =
      String(req.body.title || "").trim();

    const description =
      String(req.body.description || "").trim();

    const reward =
      Number(req.body.reward);

    const sponsor =
      String(req.body.sponsor || "").trim();

    if (
      !title ||
      !description ||
      !Number.isInteger(reward) ||
      reward <= 0
    ) {

      return res.status(400).json({
        success: false,
        error:
          "Title, description and valid reward required"
      });

    }

    db.run(
      `INSERT INTO sponsored_missions
      (title, description, reward, sponsor, status)
      VALUES (?, ?, ?, ?, 'active')`,
      [
        title,
        description,
        reward,
        sponsor || null
      ],
      function(err) {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          mission_id: this.lastID
        });

      }
    );

  }
);


/* =========================
   ACTIVATE / DEACTIVATE
========================= */

app.post(
  "/api/admin/missions/:id/toggle",
  adminAuth,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid mission ID"
      });
    }

    db.get(
      `SELECT status
       FROM sponsored_missions
       WHERE id = ?`,
      [id],
      (err, mission) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (!mission) {
          return res.status(404).json({
            success: false,
            error: "Mission not found"
          });
        }

        const newStatus =
          mission.status === "active"
            ? "inactive"
            : "active";

        db.run(
          `UPDATE sponsored_missions
           SET status = ?
           WHERE id = ?`,
          [
            newStatus,
            id
          ],
          function(updateErr) {

            if (updateErr) {
              return res.status(500).json({
                success: false,
                error: updateErr.message
              });
            }

            res.json({
              success: true,
              status: newStatus
            });

          }
        );

      }
    );

  }
);


/* =========================================================
   ADMIN - MISSION CLAIMS
========================================================= */


/* =========================
   GET CLAIMS
========================= */

app.get(
  "/api/admin/mission-claims",
  adminAuth,
  (req, res) => {

    db.all(
      `SELECT
        c.id,
        c.mission_id,
        c.telegram_id,
        c.status,
        c.created_at,
        c.processed_at,
        m.title,
        m.reward,
        m.sponsor
       FROM mission_claims c
       JOIN sponsored_missions m
         ON m.id = c.mission_id
       ORDER BY c.created_at DESC`,
      [],
      (err, rows) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          claims: rows
        });

      }
    );

  }
);


/* =========================
   APPROVE MISSION CLAIM
========================= */

app.post(
  "/api/admin/mission-claims/:id/approve",
  adminAuth,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid claim ID"
      });
    }

    db.get(
      `SELECT
        c.id,
        c.telegram_id,
        c.status,
        m.reward
       FROM mission_claims c
       JOIN sponsored_missions m
         ON m.id = c.mission_id
       WHERE c.id = ?
         AND c.status = 'pending'`,
      [id],
      (err, claim) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (!claim) {
          return res.status(404).json({
            success: false,
            error:
              "Claim not found or already processed"
          });
        }

        db.run(
          `UPDATE users
           SET coins = coins + ?
           WHERE telegram_id = ?`,
          [
            claim.reward,
            claim.telegram_id
          ],
          function(updateErr) {

            if (updateErr) {
              return res.status(500).json({
                success: false,
                error: updateErr.message
              });
            }

            db.run(
              `UPDATE mission_claims
               SET status = 'approved',
                   processed_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [id],
              function(statusErr) {

                if (statusErr) {
                  return res.status(500).json({
                    success: false,
                    error: statusErr.message
                  });
                }

                db.run(
                  `INSERT INTO game_events
                  (telegram_id, event_type, coins)
                  VALUES (?, ?, ?)`,
                  [
                    claim.telegram_id,
                    "sponsored_mission",
                    claim.reward
                  ]
                );

                res.json({
                  success: true,
                  reward: claim.reward,
                  message:
                    "Mission approved and coins added"
                });

              }
            );

          }
        );

      }
    );

  }
);


/* =========================
   REJECT MISSION CLAIM
========================= */

app.post(
  "/api/admin/mission-claims/:id/reject",
  adminAuth,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid claim ID"
      });
    }

    db.run(
      `UPDATE mission_claims
       SET status = 'rejected',
           processed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'pending'`,
      [id],
      function(err) {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (this.changes === 0) {
          return res.status(404).json({
            success: false,
            error:
              "Claim not found or already processed"
          });
        }

        res.json({
          success: true,
          message:
            "Mission claim rejected"
        });

      }
    );

  }
);
/* =========================================================
   ADMIN - WITHDRAWALS
========================================================= */


/* =========================
   PENDING WITHDRAWALS
========================= */

app.get(
  "/api/admin/withdrawals",
  adminAuth,
  (req, res) => {

    db.all(
      `SELECT
        id,
        telegram_id,
        amount,
        method,
        payment_number,
        status,
        created_at
       FROM withdrawals
       WHERE status = 'pending'
       ORDER BY created_at DESC`,
      [],
      (err, rows) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          withdrawals: rows
        });

      }
    );

  }
);


/* =========================
   APPROVE WITHDRAWAL
========================= */

app.post(
  "/api/admin/withdrawals/:id/approve",
  adminAuth,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid withdrawal ID"
      });
    }

    db.run(
      `UPDATE withdrawals
       SET status = 'approved',
           processed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status = 'pending'`,
      [id],
      function(err) {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (this.changes === 0) {
          return res.status(404).json({
            success: false,
            error:
              "Withdrawal not found or already processed"
          });
        }

        res.json({
          success: true,
          message:
            "Withdrawal approved"
        });

      }
    );

  }
);


/* =========================
   REJECT WITHDRAWAL + REFUND
========================= */

app.post(
  "/api/admin/withdrawals/:id/reject",
  adminAuth,
  (req, res) => {

    const id =
      Number(req.params.id);

    if (!Number.isInteger(id)) {
      return res.status(400).json({
        success: false,
        error: "Invalid withdrawal ID"
      });
    }

    db.get(
      `SELECT
        telegram_id,
        amount
       FROM withdrawals
       WHERE id = ?
         AND status = 'pending'`,
      [id],
      (err, withdrawal) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        if (!withdrawal) {
          return res.status(404).json({
            success: false,
            error:
              "Withdrawal not found or already processed"
          });
        }

        db.run(
          `UPDATE users
           SET coins = coins + ?
           WHERE telegram_id = ?`,
          [
            withdrawal.amount,
            withdrawal.telegram_id
          ],
          function(refundErr) {

            if (refundErr) {
              return res.status(500).json({
                success: false,
                error: refundErr.message
              });
            }

            db.run(
              `UPDATE withdrawals
               SET status = 'rejected',
                   processed_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [id],
              function(updateErr) {

                if (updateErr) {
                  return res.status(500).json({
                    success: false,
                    error: updateErr.message
                  });
                }

                res.json({
                  success: true,
                  message:
                    "Withdrawal rejected and coins refunded"
                });

              }
            );

          }
        );

      }
    );

  }
);


/* =========================
   WITHDRAWAL HISTORY
========================= */

app.get(
  "/api/admin/withdrawals/all",
  adminAuth,
  (req, res) => {

    db.all(
      `SELECT
        id,
        telegram_id,
        amount,
        method,
        payment_number,
        status,
        created_at,
        processed_at
       FROM withdrawals
       ORDER BY created_at DESC`,
      [],
      (err, rows) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        res.json({
          success: true,
          withdrawals: rows
        });

      }
    );

  }
);


/* =========================================================
   ADMIN - STATS
========================================================= */

app.get(
  "/api/admin/stats",
  adminAuth,
  (req, res) => {

    const stats = {};

    db.get(
      `SELECT COUNT(*) AS total_users
       FROM users`,
      [],
      (err, users) => {

        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message
          });
        }

        stats.total_users =
          users.total_users;

        db.get(
          `SELECT
            COUNT(*) AS total_withdrawals,
            COALESCE(SUM(amount), 0)
            AS total_withdrawal_coins
           FROM withdrawals`,
          [],
          (err, withdrawals) => {

            if (err) {
              return res.status(500).json({
                success: false,
                error: err.message
              });
            }

            stats.total_withdrawals =
              withdrawals.total_withdrawals;

            stats.total_withdrawal_coins =
              withdrawals.total_withdrawal_coins;

            db.get(
              `SELECT COUNT(*) AS pending
               FROM withdrawals
               WHERE status = 'pending'`,
              [],
              (err, pending) => {

                if (err) {
                  return res.status(500).json({
                    success: false,
                    error: err.message
                  });
                }

                stats.pending =
                  pending.pending;

                db.get(
                  `SELECT COUNT(*) AS approved
                   FROM withdrawals
                   WHERE status = 'approved'`,
                  [],
                  (err, approved) => {

                    if (err) {
                      return res.status(500).json({
                        success: false,
                        error: err.message
                      });
                    }

                    stats.approved =
                      approved.approved;

                    db.get(
                      `SELECT COUNT(*) AS rejected
                       FROM withdrawals
                       WHERE status = 'rejected'`,
                      [],
                      (err, rejected) => {

                        if (err) {
                          return res.status(500).json({
                            success: false,
                            error: err.message
                          });
                        }

                        stats.rejected =
                          rejected.rejected;

                        res.json({
                          success: true,
                          stats
                        });

                      }
                    );

                  }
                );

              }
            );

          }
        );

      }
    );

  }
);


/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {

  console.log(
    `Coin Rush backend running on port ${PORT}`
  );

});
