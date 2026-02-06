const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
const express = require("express");
const http = require("http");
require("dotenv").config({ path: path.join(__dirname, "admin", "local.env") });
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const sqlite3 = require("sqlite3");
const { Pool } = require("pg");
const rateLimit = require("express-rate-limit");
const twilio = require("twilio");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const ADMIN_SECRET = process.env.ADMIN_SECRET || JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const DEV_OTP = process.env.DEV_OTP !== "false";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.sqlite");
const DATABASE_URL = process.env.DATABASE_URL || "";
const PG_SSL = process.env.PG_SSL === "true";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || "";

const SHOW_START_HOUR = parseInt(process.env.SHOW_START_HOUR || "20", 10);
const SHOW_START_MINUTE = parseInt(process.env.SHOW_START_MINUTE || "0", 10);
const LOBBY_OPEN_MS = 5 * 60 * 1000;
const COUNTDOWN_MS = 30 * 1000;
const PLAYING_MS = 60 * 1000;
const RESULTS_MS = 20 * 1000;
const DISCONNECT_GRACE_MS = 8 * 1000;

const OTP_TTL_MS = 5 * 60 * 1000;
const devOtpStore = new Map(); // phone -> { code, expiresAt }

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin:
      CORS_ORIGIN === "*"
        ? "*"
        : CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST"],
  },
});

const corsOptions = {
  origin:
    CORS_ORIGIN === "*"
      ? "*"
      : CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  methods: ["GET", "POST"],
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use("/admin", express.static(path.join(__dirname, "admin")));

const usePostgres = Boolean(DATABASE_URL);
let db = null;
let pgPool = null;

if (!usePostgres) {
  if (!fs.existsSync(DB_PATH)) {
    fs.closeSync(fs.openSync(DB_PATH, "w"));
  }
  db = new sqlite3.Database(DB_PATH);
}

function buildPgSslConfig() {
  return PG_SSL ? { rejectUnauthorized: false } : undefined;
}

function poolConfigFromUrl(connectionString, hostOverride) {
  const url = new URL(connectionString);
  const config = {
    host: hostOverride || url.hostname,
    port: url.port ? Number(url.port) : 5432,
    ssl: buildPgSslConfig(),
  };
  const database = url.pathname ? url.pathname.slice(1) : "";
  if (database) config.database = database;
  if (url.username) config.user = decodeURIComponent(url.username);
  if (url.password) config.password = decodeURIComponent(url.password);
  return config;
}

async function createPgPoolWithIpv4(connectionString) {
  const url = new URL(connectionString);
  if (!url.hostname) {
    return new Pool({
      connectionString,
      ssl: buildPgSslConfig(),
    });
  }
  const { address } = await dns.promises.lookup(url.hostname, { family: 4 });
  return new Pool(poolConfigFromUrl(connectionString, address));
}

function shouldRetryWithIpv4(err) {
  if (!err) return false;
  if (err.code === "ENETUNREACH") return true;
  const message = String(err.message || "");
  return message.includes("ENETUNREACH");
}

async function initPostgresPool() {
  const primary = new Pool({
    connectionString: DATABASE_URL,
    ssl: buildPgSslConfig(),
  });
  try {
    await primary.query("SELECT 1");
    return primary;
  } catch (err) {
    if (!shouldRetryWithIpv4(err)) throw err;
    console.warn("Postgres IPv6 unreachable; retrying with IPv4.");
    try {
      const ipv4Pool = await createPgPoolWithIpv4(DATABASE_URL);
      await ipv4Pool.query("SELECT 1");
      await primary.end().catch(() => {});
      return ipv4Pool;
    } catch (err2) {
      await primary.end().catch(() => {});
      throw err2;
    }
  }
}

const twilioClient =
  !DEV_OTP && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeSql(sql, params) {
  if (!usePostgres) return { sql, params };
  let index = 0;
  const normalized = sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
  return { sql: normalized, params };
}

function dbRun(sql, params = []) {
  if (usePostgres) {
    const normalized = normalizeSql(sql, params);
    return pgPool.query(normalized.sql, normalized.params);
  }
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  if (usePostgres) {
    const normalized = normalizeSql(sql, params);
    return pgPool.query(normalized.sql, normalized.params).then((res) => res.rows[0]);
  }
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  if (usePostgres) {
    const normalized = normalizeSql(sql, params);
    return pgPool.query(normalized.sql, normalized.params).then((res) => res.rows);
  }
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDb() {
  await dbRun(
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE,
      name TEXT,
      created_at TEXT
    )`
  );
  await dbRun(
    `CREATE TABLE IF NOT EXISTS shows (
      id TEXT PRIMARY KEY,
      start_time TEXT,
      state TEXT,
      created_at TEXT
    )`
  );
  await dbRun(
    `CREATE TABLE IF NOT EXISTS show_players (
      id TEXT PRIMARY KEY,
      show_id TEXT,
      user_id TEXT,
      joined_at TEXT,
      status TEXT,
      score INTEGER,
      eliminated_at TEXT
    )`
  );
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");
}

function normalizePhone(phone) {
  if (!phone) return phone;
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return trimmed;
}

function computeNextShowStart(base = new Date()) {
  const start = new Date(base);
  start.setHours(SHOW_START_HOUR, SHOW_START_MINUTE, 0, 0);
  if (start <= base) {
    start.setDate(start.getDate() + 1);
  }
  return start;
}

let currentShow = null;
let countdownInterval = null;
let showStateTimer = null;
const disconnectTimers = new Map(); // userId -> timeout
const scoreRateLimits = new Map(); // userId -> { count, resetAt }

function checkScoreRateLimit(userId) {
  const now = Date.now();
  const existing = scoreRateLimits.get(userId);
  if (!existing || existing.resetAt < now) {
    scoreRateLimits.set(userId, { count: 1, resetAt: now + 60 * 1000 });
    return true;
  }
  if (existing.count >= 5) return false;
  existing.count += 1;
  return true;
}

async function loadOrCreateShow() {
  const latest = await dbGet(
    "SELECT * FROM shows ORDER BY start_time DESC LIMIT 1"
  );
  if (!latest) {
    const start = computeNextShowStart();
    const show = {
      id: newId(),
      start_time: start.toISOString(),
      state: "scheduled",
      created_at: nowIso(),
    };
    await dbRun(
      "INSERT INTO shows (id, start_time, state, created_at) VALUES (?, ?, ?, ?)",
      [show.id, show.start_time, show.state, show.created_at]
    );
    currentShow = show;
    return show;
  }

  if (latest.state === "ended") {
    const start = computeNextShowStart(new Date(latest.start_time));
    const show = {
      id: newId(),
      start_time: start.toISOString(),
      state: "scheduled",
      created_at: nowIso(),
    };
    await dbRun(
      "INSERT INTO shows (id, start_time, state, created_at) VALUES (?, ?, ?, ?)",
      [show.id, show.start_time, show.state, show.created_at]
    );
    currentShow = show;
    return show;
  }

  currentShow = latest;
  return latest;
}

async function getLeaderboard(showId) {
  const rows = await dbAll(
    `SELECT sp.user_id, sp.status, sp.score, sp.eliminated_at, u.name
     FROM show_players sp
     JOIN users u ON u.id = sp.user_id
     WHERE sp.show_id = ?
     ORDER BY sp.score DESC, sp.joined_at ASC`,
    [showId]
  );
  return rows;
}

async function broadcastPresence(showId) {
  const players = await getLeaderboard(showId);
  io.to(`show:${showId}`).emit("room:presence_update", {
    showId,
    players,
  });
}

async function updateShowState(show, newState) {
  if (!show || show.state === newState) return;
  show.state = newState;
  await dbRun("UPDATE shows SET state = ? WHERE id = ?", [newState, show.id]);
  io.emit("show:state_change", {
    showId: show.id,
    state: newState,
  });

  if (newState === "playing") {
    await dbRun(
      `UPDATE show_players
       SET status = 'playing'
       WHERE show_id = ? AND status IN ('joined', 'ready')`,
      [show.id]
    );
  }

  if (newState === "results") {
    await dbRun(
      `UPDATE show_players
       SET status = 'finished'
       WHERE show_id = ? AND status = 'playing'`,
      [show.id]
    );
    const leaderboard = await getLeaderboard(show.id);
    io.to(`show:${show.id}`).emit("results:final", {
      showId: show.id,
      leaderboard,
      winner: leaderboard[0] || null,
    });
  }

  if (newState === "ended") {
    await loadOrCreateShow();
  }

  await broadcastPresence(show.id);
}

function clearShowTimers() {
  if (showStateTimer) clearInterval(showStateTimer);
  if (countdownInterval) clearInterval(countdownInterval);
  showStateTimer = null;
  countdownInterval = null;
}

function scheduleShowLoop() {
  clearShowTimers();
  showStateTimer = setInterval(async () => {
    if (!currentShow) return;
    const now = Date.now();
    const startTime = new Date(currentShow.start_time).getTime();
    const lobbyOpenAt = startTime - LOBBY_OPEN_MS;
    const countdownAt = startTime - COUNTDOWN_MS;
    const playingEndsAt = startTime + PLAYING_MS;
    const resultsEndsAt = playingEndsAt + RESULTS_MS;

    if (currentShow.state === "scheduled" && now >= lobbyOpenAt) {
      await updateShowState(currentShow, "lobby_open");
    }
    if (currentShow.state === "lobby_open" && now >= countdownAt) {
      await updateShowState(currentShow, "countdown");
    }
    if (currentShow.state === "countdown" && now >= startTime) {
      await updateShowState(currentShow, "playing");
      io.to(`show:${currentShow.id}`).emit("game:start", {
        showId: currentShow.id,
        startTime,
        endTime: playingEndsAt,
      });
    }
    if (currentShow.state === "playing" && now >= playingEndsAt) {
      await updateShowState(currentShow, "results");
    }
    if (currentShow.state === "results" && now >= resultsEndsAt) {
      await updateShowState(currentShow, "ended");
    }
  }, 1000);

  countdownInterval = setInterval(() => {
    if (!currentShow) return;
    const now = Date.now();
    const startTime = new Date(currentShow.start_time).getTime();
    const remainingMs = Math.max(0, startTime - now);
    io.emit("show:tick", {
      showId: currentShow.id,
      state: currentShow.state,
      serverTime: now,
      startTime,
      remainingMs,
    });
  }, 1000);
}

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      name: user.name,
      phone: user.phone,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function issueAdminToken() {
  return jwt.sign({ role: "admin" }, ADMIN_SECRET, { expiresIn: "12h" });
}

function authFromRequest(req) {
  const header = req.headers.authorization || "";
  const token =
    (header.startsWith("Bearer ") && header.slice(7)) || req.cookies?.token;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, ADMIN_SECRET);
    if (payload.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/api/auth/request-otp", otpRequestLimiter, async (req, res) => {
  const { phone, name } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (!phone || !name) {
    return res.status(400).json({ error: "Phone and name required." });
  }
  if (DEV_OTP) {
    const code = "123456";
    devOtpStore.set(normalizedPhone, {
      code,
      expiresAt: Date.now() + OTP_TTL_MS,
    });
    return res.json({ ok: true, devOtp: code });
  }
  if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
    return res
      .status(500)
      .json({ error: "Twilio Verify not configured." });
  }
  try {
    await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: normalizedPhone, channel: "sms" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to send OTP.",
      details: err?.message || "unknown_error",
    });
  }
});

app.post("/api/auth/verify-otp", otpVerifyLimiter, async (req, res) => {
  const { phone, name, otp } = req.body || {};
  const normalizedPhone = normalizePhone(phone);
  if (!phone || !name || !otp) {
    return res.status(400).json({ error: "Phone, name, OTP required." });
  }
  if (DEV_OTP) {
    const stored = devOtpStore.get(normalizedPhone);
    if (!stored || stored.expiresAt < Date.now() || stored.code !== otp) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }
  } else {
    if (!twilioClient || !TWILIO_VERIFY_SERVICE_SID) {
      return res
        .status(500)
        .json({ error: "Twilio Verify not configured." });
    }
    try {
      const check = await twilioClient.verify.v2
        .services(TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: normalizedPhone, code: otp });
      if (check.status !== "approved") {
        return res.status(400).json({ error: "Invalid OTP." });
      }
    } catch (err) {
      return res.status(500).json({
        error: "OTP verification failed.",
        details: err?.message || "unknown_error",
      });
    }
  }

  let user = await dbGet("SELECT * FROM users WHERE phone = ?", [
    normalizedPhone,
  ]);
  if (!user) {
    const id = newId();
    const createdAt = nowIso();
    await dbRun(
      "INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)",
      [id, normalizedPhone, name, createdAt]
    );
    user = { id, phone: normalizedPhone, name, created_at: createdAt };
  } else if (user.name !== name) {
    await dbRun("UPDATE users SET name = ? WHERE id = ?", [name, user.id]);
    user.name = name;
  }

  const token = issueToken(user);
  res.cookie("token", token, {
    httpOnly: false,
    sameSite: "lax",
  });
  return res.json({ ok: true, token, user });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  return res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const payload = authFromRequest(req);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  return res.json({
    id: payload.sub,
    name: payload.name,
    phone: payload.phone,
  });
});

app.get("/api/show/next", async (req, res) => {
  if (!currentShow) await loadOrCreateShow();
  return res.json({
    show: currentShow,
    serverTime: Date.now(),
  });
});

app.get("/api/show/:showId/leaderboard", async (req, res) => {
  const { showId } = req.params;
  if (!showId) return res.status(400).json({ error: "Show id required." });
  const leaderboard = await getLeaderboard(showId);
  return res.json({ leaderboard });
});

app.get("/api/health/db", async (req, res) => {
  try {
    await dbGet("SELECT 1 AS ok");
    return res.json({ ok: true, driver: usePostgres ? "postgres" : "sqlite" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "db_unavailable" });
  }
});

app.post("/api/admin/login", adminLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid password." });
  }
  return res.json({ token: issueAdminToken() });
});

app.post("/api/admin/show/schedule", requireAdmin, async (req, res) => {
  const { startTime } = req.body || {};
  if (!startTime || Number.isNaN(Date.parse(startTime))) {
    return res.status(400).json({ error: "Valid startTime required." });
  }
  const show = {
    id: newId(),
    start_time: new Date(startTime).toISOString(),
    state: "scheduled",
    created_at: nowIso(),
  };
  await dbRun(
    "INSERT INTO shows (id, start_time, state, created_at) VALUES (?, ?, ?, ?)",
    [show.id, show.start_time, show.state, show.created_at]
  );
  currentShow = show;
  scheduleShowLoop();
  return res.json({ ok: true, show });
});

app.post("/api/admin/show/cancel", requireAdmin, async (req, res) => {
  if (!currentShow) {
    return res.status(400).json({ error: "No active show." });
  }
  await updateShowState(currentShow, "ended");
  return res.json({ ok: true });
});

app.post("/api/admin/show/now", requireAdmin, async (req, res) => {
  const start = new Date(Date.now() + COUNTDOWN_MS);
  const show = {
    id: newId(),
    start_time: start.toISOString(),
    state: "countdown",
    created_at: nowIso(),
  };
  await dbRun(
    "INSERT INTO shows (id, start_time, state, created_at) VALUES (?, ?, ?, ?)",
    [show.id, show.start_time, show.state, show.created_at]
  );
  currentShow = show;
  scheduleShowLoop();
  return res.json({ ok: true, show });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Unauthorized"));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = {
      id: payload.sub,
      name: payload.name,
      phone: payload.phone,
    };
    return next();
  } catch (err) {
    return next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.on("room:join", async ({ showId }) => {
    if (!currentShow) return;
    const targetShowId = showId === currentShow.id ? showId : currentShow.id;
    socket.join(`show:${targetShowId}`);
    const userId = socket.user.id;
    const existing = await dbGet(
      "SELECT * FROM show_players WHERE show_id = ? AND user_id = ?",
      [targetShowId, userId]
    );
    if (!existing) {
      const status =
        currentShow.state === "playing" ? "spectating" : "joined";
      await dbRun(
        `INSERT INTO show_players
         (id, show_id, user_id, joined_at, status, score)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), targetShowId, userId, nowIso(), status, 0]
      );
    }
    if (disconnectTimers.has(userId)) {
      clearTimeout(disconnectTimers.get(userId));
      disconnectTimers.delete(userId);
    }
    const players = await getLeaderboard(targetShowId);
    socket.emit("room:presence_update", { showId: targetShowId, players });
    io.to(`show:${targetShowId}`).emit("room:presence_update", {
      showId: targetShowId,
      players,
    });
  });

  socket.on("game:submit_score", async (payload, ack) => {
    if (!currentShow || currentShow.state !== "playing") {
      if (ack) ack({ ok: false, error: "Game not active." });
      return;
    }
    if (!checkScoreRateLimit(socket.user.id)) {
      if (ack) ack({ ok: false, error: "Rate limit exceeded." });
      return;
    }
    const { score, pipesPassed, timeAliveMs } = payload || {};
    if (
      typeof score !== "number" ||
      typeof pipesPassed !== "number" ||
      typeof timeAliveMs !== "number"
    ) {
      if (ack) ack({ ok: false, error: "Invalid payload." });
      return;
    }
    if (score < 0 || pipesPassed < 0 || timeAliveMs < 0) {
      if (ack) ack({ ok: false, error: "Invalid stats." });
      return;
    }
    if (score > pipesPassed) {
      if (ack) ack({ ok: false, error: "Score sanity check failed." });
      return;
    }
    if (timeAliveMs > PLAYING_MS + 2000) {
      if (ack) ack({ ok: false, error: "Time sanity check failed." });
      return;
    }
    const existing = await dbGet(
      "SELECT id FROM show_players WHERE show_id = ? AND user_id = ?",
      [currentShow.id, socket.user.id]
    );
    if (!existing) {
      await dbRun(
        `INSERT INTO show_players
         (id, show_id, user_id, joined_at, status, score, eliminated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          newId(),
          currentShow.id,
          socket.user.id,
          nowIso(),
          "eliminated",
          score,
          nowIso(),
        ]
      );
    }
    await dbRun(
      `UPDATE show_players
       SET score = ?, status = 'eliminated', eliminated_at = ?
       WHERE show_id = ? AND user_id = ?`,
      [score, nowIso(), currentShow.id, socket.user.id]
    );
    await broadcastPresence(currentShow.id);
    const leaderboard = await getLeaderboard(currentShow.id);
    io.to(`show:${currentShow.id}`).emit("leaderboard:update", {
      showId: currentShow.id,
      leaderboard,
    });
    if (ack) ack({ ok: true });
  });

  socket.on("disconnect", async () => {
    if (!currentShow || currentShow.state !== "playing") return;
    const userId = socket.user.id;
    const timer = setTimeout(async () => {
      await dbRun(
        `UPDATE show_players
         SET status = 'eliminated', eliminated_at = ?
         WHERE show_id = ? AND user_id = ? AND status = 'playing'`,
        [nowIso(), currentShow.id, userId]
      );
      await broadcastPresence(currentShow.id);
    }, DISCONNECT_GRACE_MS);
    disconnectTimers.set(userId, timer);
  });
});

app.get("/admin/*", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  if (usePostgres) {
    pgPool = await initPostgresPool();
  }
  await initDb();
  await loadOrCreateShow();
  scheduleShowLoop();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
