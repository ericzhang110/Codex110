import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = loadEnv();
const DATA_DIR = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const PORT = Number(env.PORT || 8000);
const APP_SECRET = env.APP_SECRET || "dev-secret-change-me";
const UPSTREAM_BASE_URL = env.UPSTREAM_BASE_URL || "https://api.openai.com";
const OPENAI_API_KEY = env.OPENAI_API_KEY || "";
const PROMPT_TOKEN_PRICE = Number(env.PROMPT_TOKEN_PRICE || "0.000001");
const COMPLETION_TOKEN_PRICE = Number(env.COMPLETION_TOKEN_PRICE || "0.000003");
const PUBLIC_SITE_ONLY = process.argv.includes("--public-site") || env.PUBLIC_SITE_ONLY === "true" || env.PUBLIC_SITE_ONLY === "1";

const rateBuckets = new Map();
let db = await loadDb();
await bootstrapAdmin();

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "internal_error", message: "服务器开小差了，请稍后再试" });
  }
});

server.listen(PORT, () => {
  console.log(`API Token Relay running at http://localhost:${PORT}`);
  if (PUBLIC_SITE_ONLY) console.log("Public site only mode is enabled.");
});

async function route(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, publicSiteOnly: PUBLIC_SITE_ONLY, checkedAt: now() });
    return;
  }

  if (url.pathname === "/public-config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    res.end(`window.PUBLIC_SITE_ONLY=${JSON.stringify(PUBLIC_SITE_ONLY)};`);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (PUBLIC_SITE_ONLY) {
      sendJson(res, 404, { error: "public_site_only" });
      return;
    }
    await routeApi(req, res, url);
    return;
  }

  if ((url.pathname === "/v1/chat/completions" || url.pathname === "/v1/responses") && req.method === "GET") {
    res.writeHead(302, { Location: "/#docs" });
    res.end();
    return;
  }

  if (url.pathname === "/v1/chat/completions" || url.pathname === "/v1/responses") {
    if (PUBLIC_SITE_ONLY) {
      sendJson(res, 404, { error: "public_site_only" });
      return;
    }
    await proxyUpstream(req, res, url.pathname);
    return;
  }

  await serveStatic(req, res, url);
}

async function routeApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!user || user.passwordHash !== hashPassword(body.password || "", user.passwordSalt)) {
      sendJson(res, 401, { error: "invalid_credentials" });
      return;
    }
    if (user.status !== "active") {
      sendJson(res, 403, { error: "account_disabled" });
      return;
    }
    sendJson(res, 200, { session: signSession(user.id), user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email.includes("@") || password.length < 8) {
      sendJson(res, 400, { error: "bad_request", message: "邮箱或密码格式不正确" });
      return;
    }
    if (db.users.some((item) => item.email === email)) {
      sendJson(res, 409, { error: "email_exists" });
      return;
    }
    const user = createUser(email, password, "user");
    db.users.push(user);
    addLedger(user.id, "signup_credit", 5, "新用户试用额度");
    await saveDb();
    sendJson(res, 201, { session: signSession(user.id), user: publicUser(user) });
    return;
  }

  const user = requireSession(req, res);
  if (!user) return;

  if (req.method === "GET" && url.pathname === "/api/me") {
    sendJson(res, 200, {
      user: publicUser(user),
      tokens: db.apiTokens.filter((item) => item.userId === user.id).map(publicToken),
      logs: db.requests.filter((item) => item.userId === user.id).slice(-50).reverse(),
      ledger: db.ledger.filter((item) => item.userId === user.id).slice(-50).reverse(),
      upstreamConfigured: Boolean(OPENAI_API_KEY),
      pricing: { prompt: PROMPT_TOKEN_PRICE, completion: COMPLETION_TOKEN_PRICE }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tokens") {
    const body = await readJson(req);
    const raw = `atr_${crypto.randomBytes(30).toString("base64url")}`;
    const token = {
      id: id("tok"),
      userId: user.id,
      name: String(body.name || "Default token").slice(0, 80),
      tokenHash: sha256(raw),
      prefix: raw.slice(0, 12),
      status: "active",
      rpm: clamp(Number(body.rpm || 60), 1, 3000),
      dailyCredits: clamp(Number(body.dailyCredits || 20), 1, 10000),
      createdAt: now(),
      lastUsedAt: null
    };
    db.apiTokens.push(token);
    await saveDb();
    sendJson(res, 201, { token: publicToken(token), secret: raw });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/tokens/")) {
    const tokenId = url.pathname.split("/").pop();
    const token = db.apiTokens.find((item) => item.id === tokenId && item.userId === user.id);
    if (!token) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    token.status = "revoked";
    token.revokedAt = now();
    await saveDb();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (user.role === "admin" && req.method === "GET" && url.pathname === "/api/admin") {
    sendJson(res, 200, {
      users: db.users.map(publicUser),
      tokens: db.apiTokens.map(publicToken),
      requests: db.requests.slice(-200).reverse(),
      ledger: db.ledger.slice(-200).reverse()
    });
    return;
  }

  if (user.role === "admin" && req.method === "POST" && url.pathname === "/api/admin/topup") {
    const body = await readJson(req);
    const target = db.users.find((item) => item.id === body.userId);
    const amount = Number(body.amount || 0);
    if (!target || !Number.isFinite(amount) || amount <= 0) {
      sendJson(res, 400, { error: "bad_request" });
      return;
    }
    addLedger(target.id, "admin_topup", amount, `管理员充值：${user.email}`);
    await saveDb();
    sendJson(res, 200, { user: publicUser(target) });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
}

async function proxyUpstream(req, res, upstreamPath) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, { error: "upstream_not_configured", message: "请先在 .env 配置 OPENAI_API_KEY" });
    return;
  }

  const auth = String(req.headers.authorization || "");
  const rawToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const token = db.apiTokens.find((item) => item.tokenHash === sha256(rawToken) && item.status === "active");
  if (!token) {
    sendJson(res, 401, { error: "invalid_api_token" });
    return;
  }
  const user = db.users.find((item) => item.id === token.userId && item.status === "active");
  if (!user) {
    sendJson(res, 403, { error: "account_disabled" });
    return;
  }

  const ip = clientIp(req);
  const rpmCheck = rateLimit(`rpm:${token.id}`, token.rpm, 60_000);
  const ipCheck = rateLimit(`ip:${ip}`, 240, 60_000);
  if (!rpmCheck.ok || !ipCheck.ok) {
    sendJson(res, 429, { error: "rate_limited", retryAfterSeconds: Math.ceil(Math.max(rpmCheck.resetIn, ipCheck.resetIn) / 1000) });
    return;
  }

  const spentToday = db.requests
    .filter((item) => item.tokenId === token.id && item.createdAt.slice(0, 10) === now().slice(0, 10))
    .reduce((sum, item) => sum + Number(item.cost || 0), 0);
  if (spentToday >= token.dailyCredits) {
    sendJson(res, 429, { error: "daily_quota_exceeded" });
    return;
  }

  if (user.balance <= 0) {
    sendJson(res, 402, { error: "insufficient_balance" });
    return;
  }

  const started = Date.now();
  const requestId = id("req");
  const bodyText = await readBody(req, 2 * 1024 * 1024);
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    sendJson(res, 400, { error: "invalid_json" });
    return;
  }

  const model = String(body.model || "unknown");
  const preauth = Math.min(Math.max(0.05, Number(body.max_tokens || 1024) * COMPLETION_TOKEN_PRICE), user.balance);
  addLedger(user.id, "preauth", -preauth, `请求预扣 ${requestId}`, requestId);

  const upstreamUrl = `${UPSTREAM_BASE_URL.replace(/\/$/, "")}${upstreamPath}`;
  let usage = null;
  let statusCode = 502;
  let responseText = "";

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": req.headers.accept || "application/json"
      },
      body: JSON.stringify(body)
    });

    statusCode = upstream.status;
    res.writeHead(upstream.status, Object.fromEntries(filterHeaders(upstream.headers)));

    if (body.stream && upstream.body) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        responseText += chunk;
        res.write(chunk);
      }
      res.end();
    } else {
      responseText = await upstream.text();
      try {
        const parsed = JSON.parse(responseText);
        usage = parsed.usage || null;
      } catch {
        usage = null;
      }
      res.end(responseText);
    }
  } catch (error) {
    statusCode = 502;
    responseText = JSON.stringify({ error: "upstream_error", message: error.message });
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(responseText);
  }

  const cost = statusCode < 400 ? calculateCost(usage, body, responseText) : 0;
  const refund = preauth - cost;
  if (refund !== 0) {
    addLedger(user.id, refund > 0 ? "refund" : "capture", refund, `请求结算 ${requestId}`, requestId);
  }
  token.lastUsedAt = now();
  db.requests.push({
    id: requestId,
    userId: user.id,
    tokenId: token.id,
    model,
    path: upstreamPath,
    statusCode,
    promptTokens: Number(usage?.prompt_tokens || usage?.input_tokens || 0),
    completionTokens: Number(usage?.completion_tokens || usage?.output_tokens || 0),
    cost,
    latencyMs: Date.now() - started,
    ip,
    createdAt: now()
  });
  await saveDb();
}

function calculateCost(usage, body, responseText) {
  if (usage) {
    const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
    const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
    return roundCredits(prompt * PROMPT_TOKEN_PRICE + completion * COMPLETION_TOKEN_PRICE);
  }
  const roughPrompt = JSON.stringify(body).length / 4;
  const roughOutput = responseText.length / 4;
  return roundCredits(roughPrompt * PROMPT_TOKEN_PRICE + roughOutput * COMPLETION_TOKEN_PRICE);
}

function addLedger(userId, type, amount, note, requestId = null) {
  const user = db.users.find((item) => item.id === userId);
  user.balance = roundCredits(user.balance + amount);
  db.ledger.push({ id: id("led"), userId, type, amount: roundCredits(amount), balanceAfter: user.balance, note, requestId, createdAt: now() });
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/login" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

function requireSession(req, res) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const session = verifySession(token);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  const user = db.users.find((item) => item.id === session.sub);
  if (!user || user.status !== "active") {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  return user;
}

function signSession(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifySession(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", APP_SECRET).update(payload).digest("base64url");
  if (Buffer.byteLength(sig) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function rateLimit(key, limit, windowMs) {
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: Date.now() + windowMs };
  if (Date.now() > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = Date.now() + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return { ok: bucket.count <= limit, resetIn: Math.max(0, bucket.resetAt - Date.now()) };
}

async function readJson(req) {
  const text = await readBody(req, 512 * 1024);
  return text ? JSON.parse(text) : {};
}

async function readBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, data) {
  res.writeHead(status, { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
  };
}

function filterHeaders(headers) {
  const blocked = new Set(["connection", "content-encoding", "transfer-encoding", "keep-alive", "set-cookie"]);
  const result = [];
  headers.forEach((value, key) => {
    if (!blocked.has(key.toLowerCase())) result.push([key, value]);
  });
  return result;
}

async function loadDb() {
  await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) {
    return { users: [], apiTokens: [], requests: [], ledger: [] };
  }
  return JSON.parse(await readFile(DB_FILE, "utf8"));
}

async function saveDb() {
  await writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

async function bootstrapAdmin() {
  const email = String(env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
  if (!db.users.some((item) => item.email === email)) {
    const admin = createUser(email, env.ADMIN_PASSWORD || "change-me-now", "admin");
    admin.balance = 1000;
    db.users.push(admin);
    await saveDb();
  }
}

function createUser(email, password, role) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    id: id("usr"),
    email,
    role,
    status: "active",
    balance: 0,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    createdAt: now()
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, status: user.status, balance: user.balance, createdAt: user.createdAt };
}

function publicToken(token) {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    status: token.status,
    rpm: token.rpm,
    dailyCredits: token.dailyCredits,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt
  };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("base64url")}`;
}

function now() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCredits(value) {
  return Math.round(Number(value) * 1_000_000) / 1_000_000;
}

function clientIp(req) {
  return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function loadEnv() {
  const file = path.join(__dirname, ".env");
  const values = { ...process.env };
  if (!existsSync(file)) return values;
  const content = readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const raw = trimmed.slice(index + 1).trim();
    values[key] = raw.replace(/^["']|["']$/g, "");
  }
  return values;
}
