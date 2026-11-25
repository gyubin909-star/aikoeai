// AIKOE — backend tipis.
// API key HANYA tinggal di server ini (file .env), tidak pernah dikirim ke browser.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const FLORA_BASE = "https://app.flora.ai/api/v1";

// ---------- .env loader (tanpa dependensi) ----------
async function loadEnv() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return;
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
await loadEnv();

const API_KEY = process.env.FLORA_API_KEY || "";
const ENV_WORKSPACE = process.env.FLORA_WORKSPACE_ID || "";
const ENV_PROJECT = process.env.FLORA_PROJECT_ID || "";
const PORT = Number(process.env.PORT || 3000);
const configured = Boolean(API_KEY);

// ---------- Util ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}
async function readBody(req, limitBytes = 60 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw Object.assign(new Error("Body terlalu besar"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); }
  catch { throw Object.assign(new Error("JSON tidak valid"), { status: 400 }); }
}

// ---------- API client ----------
async function flora(path, { method = "GET", body, headers = {} } = {}) {
  if (!configured) throw Object.assign(new Error("API key belum diisi di file .env server."), { status: 503, code: "not_configured" });
  const res = await fetch(`${FLORA_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    // Ambil pesan paling informatif: pesan JSON dari API, atau cuplikan body mentah
    // (mis. halaman HTML 403 dari firewall/WAF — biasanya karena koneksi lewat VPN/proxy).
    const snippet = !data?.error?.message && !data?.message && text
      ? text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)
      : "";
    const msg = data?.error?.message || data?.message || (snippet ? `Server API membalas ${res.status} (bukan JSON): ${snippet}` : `API error ${res.status}`);
    console.error(`[API] ${method} ${path} -> ${res.status}: ${msg}`);
    throw Object.assign(new Error(msg), { status: res.status, code: data?.error?.code || data?.code || "flora_error", flora: data });
  }
  return data;
}

// Workspace: dari .env, atau workspace pertama yang dijangkau key.
let cachedWorkspaceId = ENV_WORKSPACE || null;
async function getWorkspaceId() {
  if (cachedWorkspaceId) return cachedWorkspaceId;
  const data = await flora("/workspaces");
  const list = data?.workspaces || data?.data || [];
  if (!list.length) throw Object.assign(new Error("API key tidak menjangkau workspace mana pun."), { status: 502 });
  cachedWorkspaceId = list[0].workspace_id || list[0].id;
  return cachedWorkspaceId;
}

// Project: dari .env, cache file data/project.json, cari by nama, atau buat baru.
let cachedProjectId = ENV_PROJECT || null;
async function getProjectId() {
  if (cachedProjectId) return cachedProjectId;
  const ws = await getWorkspaceId();
  const cacheFile = join(DATA_DIR, "project.json");
  if (existsSync(cacheFile)) {
    try {
      const saved = JSON.parse(await readFile(cacheFile, "utf8"));
      if (saved.workspace_id === ws && saved.project_id) { cachedProjectId = saved.project_id; return cachedProjectId; }
    } catch { /* abaikan cache rusak */ }
  }
  const NAME = "AIKOE";
  const found = await flora(`/projects?workspace_id=${encodeURIComponent(ws)}&query=${encodeURIComponent(NAME)}&limit=10`);
  const hit = (found?.projects || []).find((p) => p.name === NAME);
  if (hit) cachedProjectId = hit.project_id;
  else {
    const created = await flora("/projects", { method: "POST", body: { workspace_id: ws, name: NAME } });
    cachedProjectId = created.project_id || created.project?.project_id;
  }
  if (!cachedProjectId) throw Object.assign(new Error("Gagal menyiapkan project."), { status: 502 });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ workspace_id: ws, project_id: cachedProjectId }, null, 2));
  return cachedProjectId;
}

// ---------- Cache daftar model (5 menit) ----------
// Menggabungkan model gambar + video, lalu DEDUPE ketat berdasarkan model_id:
// ID yang sama tidak akan pernah muncul dua kali di daftar yang dikirim ke UI.
let modelCache = { at: 0, data: null };
async function getModels() {
  if (modelCache.data && Date.now() - modelCache.at < 5 * 60 * 1000) return modelCache.data;
  const [img, vid] = await Promise.all([flora("/models?type=image"), flora("/models?type=video")]);
  const byId = new Map();
  for (const [type, data] of [["image", img], ["video", vid]]) {
    for (const m of data?.models || []) {
      if (!m.model_id || byId.has(m.model_id)) continue; // anti-kembar
      byId.set(m.model_id, { ...m, type });
    }
  }
  const featById = new Map();
  for (const data of [img, vid]) for (const f of data?.featured || []) if (f.model_id && !featById.has(f.model_id)) featById.set(f.model_id, f);
  const models = [...byId.values()];
  const out = {
    models,
    featured: [...featById.values()],
    counts: {
      image: models.filter((m) => m.type === "image").length,
      video: models.filter((m) => m.type === "video").length,
      total: models.length,
    },
  };
  modelCache = { at: Date.now(), data: out };
  return out;
}

// ---------- Upload asset ----------
// File <= 4MB: direct multipart. Lebih besar: signed upload (reserve -> upload -> complete).
async function uploadAsset({ name, contentType, buffer }) {
  const ws = await getWorkspaceId();
  if (buffer.length <= 4 * 1024 * 1024) {
    const form = new FormData();
    form.append("workspace_id", ws);
    form.append("file", new Blob([buffer], { type: contentType }), name);
    const res = await fetch(`${FLORA_BASE}/assets`, { method: "POST", headers: { Authorization: `Bearer ${API_KEY}` }, body: form });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `Upload gagal (${res.status})`), { status: res.status, code: data?.error?.code || "flora_error", flora: data });
    return data;
  }
  const reserve = await flora("/assets", { method: "POST", body: { source: "signed-url", workspace_id: ws, file_name: name, content_type: contentType } });
  const up = reserve.upload;
  if (!up?.url) throw Object.assign(new Error("Server tidak mengembalikan instruksi signed upload."), { status: 502 });
  if ((up.method || "POST").toUpperCase() === "PUT") {
    const r = await fetch(up.url, { method: "PUT", headers: up.headers || { "Content-Type": contentType }, body: buffer });
    if (!r.ok) throw Object.assign(new Error(`Signed upload gagal (${r.status})`), { status: 502 });
  } else {
    const form = new FormData();
    for (const [k, v] of Object.entries(up.form_fields || {})) form.append(k, v);
    form.append(up.file_field || "file", new Blob([buffer], { type: contentType }), name);
    const r = await fetch(up.url, { method: up.method || "POST", body: form });
    if (!r.ok) throw Object.assign(new Error(`Signed upload gagal (${r.status})`), { status: 502 });
  }
  const done = await flora(`/assets/${reserve.asset_id}/complete`, { method: "POST" });
  return done;
}

// ---------- HTTP server ----------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === "/api/config") {
      return sendJson(res, 200, { configured, workspace_configured: Boolean(ENV_WORKSPACE), base: FLORA_BASE });
    }
    if (p === "/api/health") {
      // Diagnosa bertahap: langkah mana persisnya yang gagal (auth / workspace / models / project).
      const steps = [];
      const step = async (name, fn) => {
        try { const out = await fn(); steps.push({ name, ok: true, ...out }); return true; }
        catch (e) { steps.push({ name, ok: false, status: e.status || 500, error: e.message }); return false; }
      };
      steps.push({ name: "env", ok: configured, key_loaded: configured, key_prefix: configured ? API_KEY.slice(0, 3) + "…" : null, workspace_from_env: ENV_WORKSPACE || null });
      if (configured) {
        let wsId = null;
        await step("workspaces", async () => {
          const d = await flora("/workspaces");
          const list = d?.workspaces || [];
          wsId = ENV_WORKSPACE || list[0]?.workspace_id || null;
          return { count: list.length, active_workspace: wsId, env_workspace_match: ENV_WORKSPACE ? list.some((w) => w.workspace_id === ENV_WORKSPACE) : null };
        });
        await step("models", async () => { const d = await getModels(); return { counts: d.counts }; });
        if (wsId) await step("project", async () => ({ project_id: await getProjectId() }));
      }
      return sendJson(res, 200, { ok: steps.every((s) => s.ok), steps });
    }
    if (p === "/api/models") {
      const data = await getModels();
      return sendJson(res, 200, data);
    }
    if (p === "/api/workspaces") {
      const data = await flora("/workspaces");
      return sendJson(res, 200, data);
    }
    if (p === "/api/upload" && req.method === "POST") {
      const { name, content_type, data_base64 } = await readJson(req);
      if (!name || !data_base64) throw Object.assign(new Error("name dan data_base64 wajib ada"), { status: 400 });
      const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "video/mp4", "video/webm", "video/quicktime"];
      const ct = content_type || "image/png";
      if (!allowed.includes(ct)) throw Object.assign(new Error(`Tipe file tidak didukung: ${ct}`), { status: 400 });
      const buffer = Buffer.from(data_base64, "base64");
      if (buffer.length > 50 * 1024 * 1024) throw Object.assign(new Error("File melebihi batas 50MB"), { status: 413 });
      const asset = await uploadAsset({ name, contentType: ct, buffer });
      return sendJson(res, 200, { asset_id: asset.asset_id, url: asset.url, status: asset.status });
    }
    if ((p === "/api/quote" || p === "/api/generate") && req.method === "POST") {
      const input = await readJson(req);
      if (!input.prompt || typeof input.prompt !== "string") throw Object.assign(new Error("Prompt wajib diisi"), { status: 400 });
      if (!input.model) throw Object.assign(new Error("Model wajib dipilih"), { status: 400 });
      const workspace_id = await getWorkspaceId();
      const project_id = await getProjectId();
      const payload = {
        type: input.type === "video" ? "video" : "image",
        prompt: input.prompt,
        workspace_id,
        project_id,
        model: input.model,
        params: input.params && typeof input.params === "object" ? input.params : {},
      };
      if (p === "/api/quote") payload.quote = true;
      const data = await flora("/generate", { method: "POST", body: payload, headers: { "Idempotency-Key": randomUUID() } });
      return sendJson(res, p === "/api/quote" ? 200 : 201, data);
    }
    const runMatch = p.match(/^\/api\/runs\/([\w-]+)$/);
    if (runMatch && req.method === "GET") {
      const data = await flora(`/runs/${encodeURIComponent(runMatch[1])}`);
      return sendJson(res, 200, data);
    }
    if (p === "/api/generations" && req.method === "GET") {
      const ws = await getWorkspaceId();
      const data = await flora(`/generations?workspace_id=${encodeURIComponent(ws)}&limit=20`);
      return sendJson(res, 200, data);
    }
    if (p === "/api/download" && req.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target || !/^https:\/\//i.test(target)) throw Object.assign(new Error("URL tidak valid"), { status: 400 });
      const upstream = await fetch(target);
      if (!upstream.ok) throw Object.assign(new Error(`Unduhan gagal (${upstream.status})`), { status: 502 });
      const ct = upstream.headers.get("content-type") || "application/octet-stream";
      const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : ct.includes("mp4") ? "mp4" : ct.includes("webm") ? "webm" : ct.includes("quicktime") ? "mov" : "bin";
      res.writeHead(200, { "Content-Type": ct, "Content-Disposition": `attachment; filename="hasil-${Date.now()}.${ext}"` });
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    }
    // Static files
    if (req.method === "GET") {
      const rel = p === "/" ? "/index.html" : p;
      const filePath = normalize(join(PUBLIC_DIR, rel));
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
      try {
        const content = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        return res.end(content);
      } catch { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    }
    res.writeHead(405); res.end("Method not allowed");
  } catch (err) {
    sendJson(res, err.status || 500, { error: { message: err.message, code: err.code || "server_error", flora: err.flora || undefined } });
  }
});

server.listen(PORT, () => {
  console.log(`AIKOE jalan di http://localhost:${PORT}`);
  console.log(configured ? "API key: terbaca ✔" : "API key: BELUM diisi — salin .env.example menjadi .env lalu isi key-nya.");
});
