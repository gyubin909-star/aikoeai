"use strict";
/* AIKOE — frontend (gambar + video).
   Daftar model diambil LIVE dari API lewat backend (GET /api/models),
   digabung dari type=image + type=video, dan di-DEDUPE ketat berdasarkan
   model_id — baik di server maupun di sini — jadi tidak ada model kembar.
   Nama tampil yang sama (mis. "Nano Banana 2.1") BUKAN duplikat: itu varian
   mode berbeda (t2i/i2i/is2i) dengan model_id berbeda, dan UI selalu
   menampilkan label modenya agar bisa dibedakan.
   Panel kontrol dibangun dari skema `params` resmi tiap model. */

const $ = (s) => document.querySelector(s);
const els = {
  pill: $("#connPill"), banner: $("#configBanner"), search: $("#modelSearch"),
  select: $("#modelSelect"), meta: $("#modelMeta"), prompt: $("#prompt"),
  promptCount: $("#promptCount"), drop: $("#dropZone"), file: $("#fileInput"),
  refGrid: $("#refGrid"), refCount: $("#refCount"), refWarn: $("#refWarn"),
  params: $("#dynamicParams"), noParams: $("#noParams"),
  btnGen: $("#btnGenerate"),
  status: $("#statusOut"), running: $("#runningCard"), runModel: $("#runModel"),
  runElapsed: $("#runElapsed"), runStatus: $("#runStatus"),
  empty: $("#emptyState"), gallery: $("#gallery"),
  lb: $("#lightbox"), lbImg: $("#lbImg"), lbVideo: $("#lbVideo"), lbCap: $("#lbCaption"),
  lbDl: $("#lbDownload"), toast: $("#toast"),
  capFilters: $("#capFilters"), dedupeNote: $("#dedupeNote"),
  countImage: $("#countImage"), countVideo: $("#countVideo"), countText: $("#countText"),
  loginCard: $("#loginCard"), loginForm: $("#loginForm"), loginUser: $("#loginUser"),
  loginPass: $("#loginPass"), loginError: $("#loginError"),
  chatPanel: $("#chatPanel"), chatLog: $("#chatLog"), chatInput: $("#chatInput"),
  btnSendChat: $("#btnSendChat"), chatModelName: $("#chatModelName"),
  promptField: $("#promptField"), refField: $("#refField"),
};

/* Batas referensi mengikuti MODEL, bukan angka tetap:
   - model tanpa parameter gambar -> 0 referensi
   - model dengan image_url tunggal -> tepat 1 referensi
   - model dengan image_urls (array) -> batas asli tiap model TIDAK dipublikasikan
     API di skema, jadi website mempelajarinya dari pesan validasi resmi API
     ("must have N items or fewer") lalu menyimpannya per model_id.
     Plafon awal 14 = batas terbesar yang terverifikasi (keluarga Nano Banana). */
const HARD_CAP = 14;
const learnedLimits = JSON.parse(localStorage.getItem("flora-ref-limits") || "{}");
function limitKey(modelId, kind) { return kind === "video" ? modelId + "#video" : modelId; }
function learnLimit(modelId, n, kind = "image") {
  if (!modelId || !n) return;
  learnedLimits[limitKey(modelId, kind)] = n;
  localStorage.setItem("flora-ref-limits", JSON.stringify(learnedLimits));
}
function parseLimitFromError(msg) {
  const m = String(msg).match(/must have (\d+) items or fewer/i) || String(msg).match(/at most (\d+) distinct files/i) || String(msg).match(/maximum of (\d+)/i);
  return m ? Number(m[1]) : null;
}
function isVideoMediaParam(p) { const n = (p.name || "").toLowerCase(); return isMediaParam(p) && (n.includes("video")); }
function mediaLimit(model, kind = "image") {
  if (!model) return HARD_CAP;
  const media = (Array.isArray(model.params) ? model.params : []).filter((p) => isMediaParam(p) && (kind === "video" ? isVideoMediaParam(p) : isImageMediaParam(p)));
  if (!media.length) return 0;
  if (media.some(isArrayParam)) return learnedLimits[limitKey(model.model_id, kind)] ?? HARD_CAP;
  return 1;
}
function refLimit(model) { return mediaLimit(model, "image"); }
const state = {
  configured: false,
  mediaType: "image",       // "image" | "video"
  models: [], featured: new Set(),
  capFilter: "all",
  model: null,
  values: {},
  mediaParams: [],          // semua params media model terpilih
  requiredParams: [],       // params non-media yang wajib
  refs: [],
  history: JSON.parse(localStorage.getItem("flora-history") || "[]"),
  chats: {},
  lbItem: null,
};
try { state.chats = JSON.parse(localStorage.getItem("aikoe-chats") || "{}"); } catch { state.chats = {}; }

/* ---------- Mode label dari capabilities ---------- */
const CAP_LABEL = {
  "text-to-image": "Teks → Gambar", "image-to-image": "Gambar → Gambar", "images-to-image": "Multi-Gambar → Gambar",
  "inpainting": "Inpainting", "outpainting": "Outpainting", "image-upscaler": "Upscaler Gambar",
  "text-to-video": "Teks → Video", "image-to-video": "Gambar → Video", "images-to-video": "Multi-Gambar → Video",
  "video-to-video": "Video → Video", "frames-to-video": "Frame → Video", "first-last-frame-to-video": "Frame Awal-Akhir → Video",
  "mixed-to-video": "Gabungan / Motion → Video", "audio-to-video": "Audio → Video", "audio-image-to-video": "Audio+Gambar → Video",
  "audio-video-to-video": "Audio+Video → Video", "video-upscaler": "Upscaler Video", "reference-to-video": "Referensi → Video",
  "text-to-text": "Chat (Teks → Teks)", "image-to-text": "Gambar → Teks", "video-to-text": "Video → Teks", "audio-to-text": "Audio → Teks (Transkrip)",
};
const capLabel = (c) => CAP_LABEL[c] || c.replace(/-/g, " ").replace(/\b\w/g, (x) => x.toUpperCase());
const primaryCap = (m) => (m.capabilities || [])[0] || (m.type === "video" ? "text-to-video" : m.type === "text" ? "text-to-text" : "text-to-image");

/* ---------- Model contoh untuk Mode Pratinjau ---------- */
const GEN_IMG = [
  { name: "aspect_ratio", type: "string", label: "Aspect Ratio", default: "1:1", options: ["auto","21:9","16:9","4:3","3:2","1:1","2:3","3:4","4:5","9:16"].map(v => ({ label: v, value: v })) },
  { name: "resolution", type: "string", label: "Resolution", default: "1K", options: ["1K","2K","4K"].map(v => ({ label: v, value: v })) },
  { name: "seed", type: "seed", min: 0, max: 1000000000 },
];
const GEN_VID = [
  { name: "duration", type: "string", label: "Duration", default: "5", options: ["5","10","15"].map(v => ({ label: v + " seconds", value: v })) },
  { name: "aspect_ratio", type: "string", label: "Aspect Ratio", default: "16:9", options: ["16:9","9:16","1:1"].map(v => ({ label: v, value: v })) },
  { name: "resolution", type: "string", label: "Resolution", default: "1080P", options: ["480P","768P","1080P"].map(v => ({ label: v, value: v })) },
  { name: "seed", type: "seed", min: 0, max: 1000000000 },
];
const FALLBACK_MODELS = [
  { model_id: "t2i-elote-gateway", name: "Nano Banana 2.1 (pratinjau)", type: "image", capabilities: ["text-to-image"], estimated_cost_usd: 0.02, estimated_seconds: 20, params: GEN_IMG },
  { model_id: "t2i-gemini-3-pro", name: "Nano Banana Pro (pratinjau)", type: "image", capabilities: ["text-to-image"], estimated_cost_usd: 0.18, estimated_seconds: 29, params: GEN_IMG },
  { model_id: "i2i-elote-gateway", name: "Nano Banana 2.1 (pratinjau)", type: "image", capabilities: ["image-to-image"], estimated_cost_usd: 0.03, estimated_seconds: 25, params: [...GEN_IMG, { name: "image_url", type: "string", required: true }] },
  { model_id: "t2v-kling-v4-gateway", name: "Kling v4 (pratinjau)", type: "video", capabilities: ["text-to-video"], estimated_cost_usd: 0.3, estimated_seconds: 120, params: GEN_VID },
  { model_id: "i2v-kling-v4-gateway", name: "Kling v4 (pratinjau)", type: "video", capabilities: ["image-to-video"], estimated_cost_usd: 0.35, estimated_seconds: 150, params: [...GEN_VID, { name: "image_url", type: "string", required: true }] },
  { model_id: "t2t-openai-gpt4o-mini", name: "GPT 4o Mini (pratinjau)", type: "text", capabilities: ["text-to-text"], estimated_seconds: 15, params: [] },
];

/* ---------- Util ---------- */
function toast(msg, ms = 4200) {
  els.toast.textContent = msg; els.toast.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => els.toast.classList.add("hidden"), ms);
}
function setStatus(msg, isErr = false) { els.status.textContent = msg; els.status.classList.toggle("err", isErr); }
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(data?.error?.message || `Request gagal (${res.status})`); e.status = res.status; throw e; }
  return data;
}
function dedupeModels(list) {
  const byId = new Map();
  for (const m of list || []) if (m.model_id && !byId.has(m.model_id)) byId.set(m.model_id, m);
  return [...byId.values()];
}
function isMediaParam(p) {
  const n = (p.name || "").toLowerCase(), t = (p.type || "").toLowerCase();
  if (t === "image" || t === "images") return true;
  if (/(_url|_urls)$/.test(n)) return true;
  return ["image", "images", "first_frame", "last_frame", "start_frame", "end_frame"].includes(n);
}
function isImageMediaParam(p) {
  const n = (p.name || "").toLowerCase();
  return n.includes("image") || n.includes("frame") || (p.type || "").toLowerCase().startsWith("image");
}
function isArrayParam(p) {
  const n = (p.name || "").toLowerCase(), t = (p.type || "").toLowerCase();
  return t.includes("[]") || t.includes("array") || n.endsWith("_urls");
}
function prettyName(p) {
  if (p.label) return p.label;
  const map = { aspect_ratio: "Aspek Rasio", quality: "Kualitas", resolution: "Resolusi", seed: "Seed", negative_prompt: "Prompt Negatif", duration: "Durasi", guidance_scale: "Guidance Scale", cfg_scale: "CFG Scale", num_inference_steps: "Steps", steps: "Steps", width: "Lebar (px)", height: "Tinggi (px)", output_format: "Format Output" };
  return map[p.name] || p.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function parseRatio(value) {
  const m = String(value).match(/(\d+)\s*[:x_\/-]\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  const s = String(value).toLowerCase();
  if (s.includes("landscape")) return [16, 10];
  if (s.includes("portrait")) return [10, 16];
  if (s.includes("square")) return [1, 1];
  return null;
}

/* ---------- Filter capability (dinamis per jenis) ---------- */
function buildCapChips() {
  const caps = new Set();
  for (const m of state.models) if (m.type === state.mediaType) (m.capabilities || []).forEach((c) => caps.add(c));
  els.capFilters.innerHTML = "";
  const mk = (val, label) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip" + (state.capFilter === val ? " active" : "");
    b.textContent = label; b.dataset.cap = val;
    b.onclick = () => { state.capFilter = val; buildCapChips(); renderModelList(); };
    els.capFilters.appendChild(b);
  };
  mk("all", "Semua");
  for (const c of caps) mk(c, capLabel(c));
  if (state.capFilter !== "all" && !caps.has(state.capFilter)) state.capFilter = "all";
}

/* ---------- Daftar model ---------- */
function renderModelList() {
  const q = els.search.value.trim().toLowerCase();
  const list = state.models.filter((m) =>
    m.type === state.mediaType &&
    (state.capFilter === "all" || (m.capabilities || []).includes(state.capFilter)) &&
    (!q || (m.name || "").toLowerCase().includes(q) || (m.model_id || "").toLowerCase().includes(q)));
  els.select.innerHTML = "";
  if (!list.length) {
    const o = document.createElement("option"); o.textContent = "— tidak ada model cocok —"; els.select.appendChild(o);
    state.model = null; return;
  }
  for (const m of list) {
    const o = document.createElement("option");
    o.value = m.model_id;
    o.textContent = `${state.featured.has(m.model_id) ? "⭐ " : ""}${m.name || m.model_id} — ${capLabel(primaryCap(m))}`;
    els.select.appendChild(o);
  }
  const keep = list.find((m) => state.model && m.model_id === state.model.model_id) || list[0];
  els.select.value = keep.model_id;
  selectModel(keep.model_id, true);
}

function selectModel(modelId, fromList = false) {
  const m = state.models.find((x) => x.model_id === modelId);
  if (!m) return;
  state.model = m;
  if (!fromList) els.select.value = modelId;
  els.meta.innerHTML = "";
  const badges = [capLabel(primaryCap(m)), ...(m.capabilities || []).slice(1).map(capLabel)];
  if (m.provider) badges.push(m.provider);
  if (state.featured.has(m.model_id)) badges.push("⭐ Unggulan");
  for (const b of [...new Set(badges)]) { const s = document.createElement("span"); s.className = "badge"; s.textContent = b; els.meta.appendChild(s); }
  if (m.estimated_seconds) { const s = document.createElement("span"); s.className = "badge"; s.textContent = `≈ ${m.estimated_seconds} dtk`; els.meta.appendChild(s); }
  const idb = document.createElement("span"); idb.className = "badge"; idb.textContent = m.model_id; els.meta.appendChild(idb);
  buildParams(m);
  renderRefs();
  applyMode();
}

/* ---------- Panel kontrol dinamis dari skema params model ---------- */
function buildParams(model) {
  const params = Array.isArray(model.params) ? model.params : [];
  state.mediaParams = params.filter(isMediaParam);
  const controls = params.filter((p) => !isMediaParam(p));
  state.requiredParams = controls.filter((p) => p.required);
  state.values = {};
  els.params.innerHTML = "";
  els.noParams.classList.toggle("hidden", controls.length > 0);
  const prio = (n) => n === "aspect_ratio" ? 0 : /duration|quality|resolution/.test(n) ? 1 : 2;
  controls.sort((a, b) => prio(a.name) - prio(b.name));
  for (const p of controls) {
    if (p.default !== undefined && p.default !== null && p.default !== "") state.values[p.name] = coerce(p, p.default);
    els.params.appendChild(renderParam(p));
  }
}

function renderParam(p) {
  const wrap = document.createElement("div"); wrap.className = "param";
  const head = document.createElement("div"); head.className = "p-head";
  const lab = document.createElement("label"); lab.textContent = prettyName(p);
  if (p.required) { const r = document.createElement("span"); r.className = "req"; r.textContent = "WAJIB"; lab.appendChild(r); }
  const val = document.createElement("span"); val.className = "p-val";
  head.append(lab, val); wrap.appendChild(head);
  const setVal = (v) => { state.values[p.name] = v; val.textContent = displayVal(p, v); };
  const options = Array.isArray(p.options) ? p.options : null;
  const type = (p.type || "string").toLowerCase();

  if (/aspect/.test(p.name) && options) {
    const grid = document.createElement("div"); grid.className = "ratio-grid";
    for (const opt of options) {
      const b = document.createElement("button"); b.type = "button"; b.className = "ratio-btn";
      const r = parseRatio(opt.value) || parseRatio(opt.label) || [1, 1];
      const scale = 30 / Math.max(r[0], r[1]);
      const box = document.createElement("span"); box.className = "box";
      box.style.width = Math.max(8, r[0] * scale) + "px"; box.style.height = Math.max(8, r[1] * scale) + "px";
      const t = document.createElement("span"); t.textContent = opt.label || opt.value;
      b.append(box, t);
      if (String(state.values[p.name]) === String(opt.value)) b.classList.add("active");
      b.onclick = () => { grid.querySelectorAll(".ratio-btn").forEach((x) => x.classList.remove("active")); b.classList.add("active"); setVal(opt.value); };
      grid.appendChild(b);
    }
    if (state.values[p.name] !== undefined) val.textContent = displayVal(p, state.values[p.name]);
    wrap.appendChild(grid);
  } else if (options && options.length <= 8) {
    const seg = document.createElement("div"); seg.className = "seg";
    for (const opt of options) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = opt.label || opt.value;
      if (String(state.values[p.name]) === String(opt.value)) b.classList.add("active");
      b.onclick = () => { seg.querySelectorAll("button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); setVal(coerce(p, opt.value)); };
      seg.appendChild(b);
    }
    if (state.values[p.name] !== undefined) val.textContent = displayVal(p, state.values[p.name]);
    wrap.appendChild(seg);
  } else if (options) {
    const sel = document.createElement("select");
    for (const opt of options) { const o = document.createElement("option"); o.value = opt.value; o.textContent = opt.label || opt.value; sel.appendChild(o); }
    if (state.values[p.name] !== undefined) sel.value = state.values[p.name];
    sel.onchange = () => setVal(coerce(p, sel.value));
    setVal(coerce(p, sel.value)); wrap.appendChild(sel);
  } else if (type === "boolean" || type === "bool") {
    const sw = document.createElement("label"); sw.className = "switch";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = Boolean(state.values[p.name]);
    const track = document.createElement("span"); track.className = "track";
    sw.append(cb, track); cb.onchange = () => setVal(cb.checked); setVal(cb.checked);
    wrap.appendChild(sw);
  } else if (type === "seed") {
    const row = document.createElement("div"); row.className = "seed-row";
    const inp = document.createElement("input"); inp.type = "number"; inp.placeholder = "Kosong = acak";
    inp.min = p.min ?? 0; inp.max = p.max ?? 1000000000;
    if (state.values[p.name] != null) inp.value = state.values[p.name];
    const dice = document.createElement("button"); dice.type = "button"; dice.className = "btn btn-ghost"; dice.textContent = "🎲"; dice.title = "Seed acak";
    const apply = () => { const v = inp.value === "" ? undefined : Number(inp.value); if (v === undefined) { delete state.values[p.name]; val.textContent = ""; } else setVal(v); };
    inp.oninput = apply;
    dice.onclick = () => { inp.value = Math.floor(Math.random() * ((p.max ?? 1000000000) + 1)); apply(); };
    row.append(inp, dice); wrap.appendChild(row);
  } else if (["number", "integer", "int", "float"].includes(type)) {
    const min = p.min ?? p.minimum, max = p.max ?? p.maximum;
    if (min !== undefined && max !== undefined && Number(max) - Number(min) <= 1000) {
      const rng = document.createElement("input"); rng.type = "range"; rng.min = min; rng.max = max;
      rng.step = type === "float" ? 0.05 : 1;
      rng.value = state.values[p.name] ?? min;
      rng.oninput = () => setVal(Number(rng.value)); setVal(Number(rng.value));
      wrap.appendChild(rng);
    } else {
      const inp = document.createElement("input"); inp.type = "number";
      if (min !== undefined) inp.min = min; if (max !== undefined) inp.max = max;
      if (type === "float") inp.step = "0.05";
      if (state.values[p.name] != null) inp.value = state.values[p.name];
      inp.oninput = () => { inp.value === "" ? delete state.values[p.name] : setVal(Number(inp.value)); };
      if (state.values[p.name] != null) val.textContent = String(state.values[p.name]);
      wrap.appendChild(inp);
    }
  } else {
    const inp = document.createElement(p.name.includes("prompt") ? "textarea" : "input");
    if (inp.tagName === "INPUT") inp.type = "text"; else inp.rows = 2;
    inp.placeholder = p.default || "";
    if (state.values[p.name] != null) inp.value = state.values[p.name];
    inp.oninput = () => { inp.value === "" ? delete state.values[p.name] : setVal(inp.value); };
    wrap.appendChild(inp);
  }
  if (p.description) { const d = document.createElement("p"); d.className = "hint"; d.textContent = p.description; wrap.appendChild(d); }
  return wrap;
}
function coerce(p, v) {
  const t = (p.type || "").toLowerCase();
  if (["number", "integer", "int", "seed"].includes(t)) return Number(v);
  if (t === "float") return parseFloat(v);
  if (t === "boolean" || t === "bool") return v === true || v === "true";
  return v;
}
function displayVal(p, v) {
  const opt = (p.options || []).find((o) => String(o.value) === String(v));
  return opt ? (opt.label || opt.value) : String(v);
}

/* ---------- Referensi (jumlah mengikuti model) ---------- */
function updateRefWarning() {
  const imgRefs = state.refs.filter((r) => r.kind !== "video");
  const vidRefs = state.refs.filter((r) => r.kind === "video");
  const il = mediaLimit(state.model, "image"), vl = mediaLimit(state.model, "video");
  const iu = Math.min(imgRefs.length, il), vu = Math.min(vidRefs.length, vl);
  els.refCount.textContent = state.model && state.mediaParams.some(isVideoMediaParam)
    ? `Gambar ${iu}/${il} · Video ${vu}/${vl}`
    : `${iu} terpakai / batas ${il}` + (imgRefs.length > iu ? ` (${imgRefs.length - iu} cadangan)` : "");
  const info = $("#refLimitInfo");
  if (info && state.model) {
    const parts = [];
    if (state.mediaParams.some(isImageMediaParam)) parts.push(`maks ${il} gambar`);
    if (state.mediaParams.some(isVideoMediaParam)) parts.push(`maks ${vl} video`);
    info.textContent = parts.length
      ? `Model "${state.model.name || state.model.model_id}" menerima ${parts.join(" + ")} referensi${learnedLimits[state.model.model_id] || learnedLimits[limitKey(state.model.model_id, "video")] ? " (batas asli model, dari validasi server)" : ""}.`
      : `Model "${state.model.name || state.model.model_id}" tidak menerima referensi.`;
  }
  if (!state.model) { els.refWarn.classList.add("hidden"); return; }
  const imgMedia = state.mediaParams.filter(isImageMediaParam);
  const vidMedia = state.mediaParams.filter(isVideoMediaParam);
  const otherMedia = state.mediaParams.filter((p) => !isImageMediaParam(p) && !isVideoMediaParam(p));
  const reqOther = otherMedia.filter((p) => p.required);
  const msgs = [];
  if (imgRefs.length && imgMedia.length) msgs.push(`Referensi gambar akan dikirim lewat: ${imgMedia.map((p) => p.name).join(", ")}.`);
  if (vidRefs.length && vidMedia.length) msgs.push(`Referensi video akan dikirim lewat: ${vidMedia.map((p) => p.name).join(", ")}.`);
  if (imgRefs.length && !imgMedia.length) msgs.push(`Model ini tidak menerima referensi gambar — gambar yang diupload tidak akan dipakai.`);
  if (vidRefs.length && !vidMedia.length) msgs.push(`Model ini tidak menerima referensi video — video yang diupload tidak akan dipakai.`);
  if (reqOther.length) msgs.push(`Model ini juga mewajibkan input lain (${reqOther.map((p) => p.name).join(", ")}) yang tidak bisa diisi dari upload di sini.`);
  if (msgs.length) { els.refWarn.textContent = msgs.join(" "); els.refWarn.classList.remove("hidden"); }
  else els.refWarn.classList.add("hidden");
}
function renderRefs() {
  els.refGrid.innerHTML = "";
  const counters = { image: 0, video: 0 };
  state.refs.forEach((r) => {
    const kind = r.kind === "video" ? "video" : "image";
    const inactive = counters[kind] >= mediaLimit(state.model, kind);
    counters[kind]++;
    const d = document.createElement("div"); d.className = "ref-item" + (inactive ? " inactive" : "");
    const media = document.createElement(kind === "video" ? "video" : "img");
    media.src = r.preview; if (kind === "video") { media.muted = true; media.loop = true; media.autoplay = true; media.playsInline = true; } else media.alt = r.name;
    const x = document.createElement("button"); x.className = "ref-x"; x.textContent = "✕"; x.title = "Hapus";
    x.onclick = () => { state.refs = state.refs.filter((y) => y.id !== r.id); renderRefs(); updateRefWarning(); };
    const st = document.createElement("div"); st.className = "ref-state " + (inactive ? "" : r.status === "ready" ? "ok" : r.status === "error" ? "err" : "");
    st.textContent = inactive ? "cadangan (di luar batas model)" : r.status === "ready" ? (kind === "video" ? "🎬 ✔ siap" : "✔ siap") : r.status === "error" ? "✘ gagal" : "mengupload…";
    d.append(media, x, st); els.refGrid.appendChild(d);
  });
  updateRefWarning();
}
async function addFiles(files) {
  const medias = [...files].filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
  for (const f of medias) {
    if (state.refs.length >= HARD_CAP) { toast(`Plafon upload ${HARD_CAP} file (batas terbesar yang didukung). Batas model yang lebih kecil diterapkan otomatis saat generate.`); break; }
    if (f.size > 50 * 1024 * 1024) { toast(`"${f.name}" melebihi 50MB, dilewati.`); continue; }
    const ref = { id: crypto.randomUUID(), name: f.name, kind: f.type.startsWith("video/") ? "video" : "image", preview: URL.createObjectURL(f), assetUrl: null, status: "uploading" };
    state.refs.push(ref); renderRefs();
    try {
      if (!state.configured) { ref.status = "error"; renderRefs(); continue; }
      // Jalur utama: upload LANGSUNG dari browser ke storage (file tidak melewati
      // server/Vercel, jadi tidak kena batas body 4,5MB dan tidak mengembang base64).
      try {
        const init = await api("/api/upload-init", { method: "POST", body: JSON.stringify({ name: f.name, content_type: f.type || "image/png" }) });
        const fd = new FormData();
        for (const [k, v] of Object.entries(init.upload.form_fields || {})) fd.append(k, v);
        fd.append(init.upload.file_field || "file", f);
        const up = await fetch(init.upload.url, { method: init.upload.method || "POST", body: fd });
        if (!up.ok) throw new Error(`storage menolak (${up.status})`);
        const done = await api("/api/upload-complete", { method: "POST", body: JSON.stringify({ asset_id: init.asset_id }) });
        ref.assetUrl = done.url || init.url;
        if (!ref.assetUrl) throw new Error("Server tidak mengembalikan URL asset");
      } catch (directErr) {
        // Fallback jalur lama (base64 lewat server) — hanya efektif untuk file kecil.
        const b64 = await new Promise((resolve, reject) => {
          const rd = new FileReader();
          rd.onload = () => resolve(String(rd.result).split(",")[1]);
          rd.onerror = reject; rd.readAsDataURL(f);
        });
        const out = await api("/api/upload", { method: "POST", body: JSON.stringify({ name: f.name, content_type: f.type || "image/png", data_base64: b64 }) });
        if (!out.url) throw new Error("Server tidak mengembalikan URL asset");
        ref.assetUrl = out.url;
      }
      ref.status = "ready";
    } catch (e) { ref.status = "error"; toast(`Upload "${f.name}" gagal: ${e.message}`); }
    renderRefs();
  }
}

/* ---------- Kumpulkan params final ---------- */
function collectParams() {
  const params = {};
  for (const [k, v] of Object.entries(state.values)) if (v !== undefined && v !== "") params[k] = v;
  let refsUsed = 0;
  for (const kind of ["image", "video"]) {
    const media = state.mediaParams.filter((p) => (kind === "video" ? isVideoMediaParam(p) : isImageMediaParam(p)));
    if (!media.length) continue;
    const ready = state.refs.filter((r) => r.status === "ready" && r.assetUrl && (kind === "video" ? r.kind === "video" : r.kind !== "video")).slice(0, mediaLimit(state.model, kind));
    if (!ready.length) continue;
    const arrP = media.find(isArrayParam);
    const singleP = media.find((p) => !isArrayParam(p));
    if (arrP) params[arrP.name] = ready.map((r) => r.assetUrl);
    else if (singleP) params[singleP.name] = ready[0].assetUrl;
    if (arrP && singleP && !params[singleP.name]) params[singleP.name] = ready[0].assetUrl;
    refsUsed += ready.length;
  }
  return { params, refsUsed };
}
function validateRequired() {
  if (!state.model) return "Pilih model dulu.";
  const { params } = collectParams();
  for (const p of state.mediaParams) {
    if (p.required && params[p.name] === undefined) {
      if (isImageMediaParam(p)) return `Model ini mewajibkan gambar referensi (${p.name}) — upload minimal 1 gambar dulu.`;
      if (isVideoMediaParam(p)) return `Model ini mewajibkan video referensi (${p.name}) — upload minimal 1 video dulu (mis. video gerakan untuk Motion Control).`;
      return `Model ini mewajibkan input ${p.name} yang tidak bisa diisi dari website ini. Pilih model lain.`;
    }
  }
  for (const p of state.requiredParams) {
    if (params[p.name] === undefined || params[p.name] === "") return `Parameter wajib "${prettyName(p)}" belum diisi.`;
  }
  return null;
}

/* ---------- Generate ---------- */
function payload() {
  const { params } = collectParams();
  return { type: state.model?.type || "image", prompt: els.prompt.value.trim(), model: state.model?.model_id, params };
}

els.btnGen.onclick = async () => {
  if (!state.configured) return toast("Mode pratinjau: isi API key di file .env server, lalu restart server.");
  if (!state.model) return toast("Pilih model dulu.");
  if (!els.prompt.value.trim()) return toast("Isi prompt dulu ya.");
  if (state.refs.some((r) => r.status === "uploading")) return toast("Tunggu upload referensi selesai dulu.");
  const err = validateRequired(); if (err) return toast(err, 5600);
  const { refsUsed } = collectParams();
  if (state.refs.length && !refsUsed) toast("Model ini tidak menerima referensi: referensi TIDAK akan dipakai.", 5200);
  // Pra-cek validasi: kalau jumlah referensi melebihi batas asli model,
  // server menolak di sini (tanpa proses generate) dan website mempelajari batasnya.
  const arrKind = state.mediaParams.some((p) => isImageMediaParam(p) && isArrayParam(p)) ? "image" : state.mediaParams.some((p) => isVideoMediaParam(p) && isArrayParam(p)) ? "video" : null;
  if (refsUsed > 1 && arrKind && !learnedLimits[limitKey(state.model.model_id, arrKind)]) {
    try { await api("/api/quote", { method: "POST", body: JSON.stringify(payload()) }); }
    catch (e) {
      const n = parseLimitFromError(e.message);
      if (n) {
        learnLimit(state.model.model_id, n, arrKind); renderRefs();
        return toast(`Model ini ternyata menerima maks ${n} referensi — jumlah terpakai sudah disesuaikan. Tekan Generate lagi.`, 6000);
      }
      // Error validasi lain diabaikan: generate akan menampilkan error aslinya.
    }
  }
  const kind = state.model.type || "image";
  els.btnGen.disabled = true; setStatus("Mengirim request…");
  els.running.classList.remove("hidden"); els.empty.classList.add("hidden");
  els.runModel.textContent = state.model.name || state.model.model_id;
  const t0 = Date.now();
  const timer = setInterval(() => { els.runElapsed.textContent = `${Math.floor((Date.now() - t0) / 1000)} dtk`; }, 500);
  try {
    const run = await api("/api/generate", { method: "POST", body: JSON.stringify(payload()) });
    const runId = run.run_id || run.id;
    if (!runId) throw new Error("Server tidak mengembalikan run_id");
    setStatus(`Proses dimulai · referensi terpakai: ${refsUsed}`);
    let result = null;
    const deadline = Date.now() + (kind === "video" ? 25 : 10) * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      result = await api(`/api/runs/${encodeURIComponent(runId)}`);
      els.runStatus.textContent = result.status || "running";
      if (result.status === "completed" || result.status === "failed") break;
    }
    if (!result || result.status === "failed") throw new Error(result?.error_message || "Generate gagal / timeout.");
    const outs = (result.outputs || []).filter((o) => o && (o.url || o.text));
    if (!outs.length) throw new Error("Run selesai tapi tidak ada output.");
    let made = 0;
    for (const o of outs) {
      const isText = o.type === "text" || !/^https?:\/\//i.test(o.url || "");
      if (isText) addToGallery({ kind: "text", text: o.url || o.text || "", prompt: els.prompt.value.trim(), model: state.model.name || state.model.model_id, at: Date.now() }, true);
      else addToGallery({ url: o.url, kind, prompt: els.prompt.value.trim(), model: state.model.name || state.model.model_id, at: Date.now() }, true);
      made++;
    }
    setStatus(`Selesai ✔ ${made} ${kind === "video" ? "video" : kind === "text" ? "jawaban teks" : "gambar"} dibuat dalam ${Math.floor((Date.now() - t0) / 1000)} detik.`);
  } catch (e) {
    const n = parseLimitFromError(e.message);
    if (n && state.model) { learnLimit(state.model.model_id, n, /video/i.test(e.message) ? "video" : "image"); renderRefs(); setStatus(`Batas referensi model ini ${n} — sudah dipelajari & diterapkan. Tekan Generate lagi.`, true); }
    else { setStatus("Gagal: " + e.message, true); toast("Generate gagal: " + e.message, 6000); }
  }
  clearInterval(timer);
  els.running.classList.add("hidden");
  els.btnGen.disabled = false;
  if (!state.history.length) els.empty.classList.remove("hidden");
};

/* ---------- Galeri & riwayat ---------- */
function saveHistory() { localStorage.setItem("flora-history", JSON.stringify(state.history.slice(0, 60))); }
function addToGallery(item, save) {
  if (save) { state.history.unshift(item); saveHistory(); }
  els.empty.classList.add("hidden");
  const card = document.createElement("article"); card.className = "card glass";
  let media;
  if (item.kind === "video") {
    media = document.createElement("video"); media.src = item.url; media.controls = true; media.preload = "metadata"; media.playsInline = true;
  } else if (item.kind === "text") {
    media = document.createElement("div"); media.className = "text-result"; media.textContent = item.text || "";
  } else {
    media = document.createElement("img"); media.src = item.url; media.alt = item.prompt; media.loading = "lazy";
    media.onclick = () => openLightbox(item);
  }
  const body = document.createElement("div"); body.className = "c-body";
  const pr = document.createElement("p"); pr.className = "c-prompt"; pr.textContent = item.prompt;
  const meta = document.createElement("div"); meta.className = "c-meta";
  const mb = document.createElement("span"); mb.className = "badge"; mb.textContent = (item.kind === "video" ? "🎬 " : item.kind === "text" ? "💬 " : "🖼️ ") + item.model;
  const tm = document.createElement("span"); tm.className = "hint"; tm.textContent = new Date(item.at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  meta.append(mb, tm);
  const acts = document.createElement("div"); acts.className = "c-actions";
  if (item.kind === "text") {
    const cp = document.createElement("button"); cp.className = "btn btn-primary"; cp.textContent = "📋 Salin teks";
    cp.onclick = async () => { try { await navigator.clipboard.writeText(item.text || ""); toast("Teks tersalin ✔"); } catch { toast("Gagal menyalin teks."); } };
    const dl = document.createElement("a"); dl.className = "btn btn-ghost"; dl.textContent = "⬇ Download .txt";
    dl.href = URL.createObjectURL(new Blob([item.text || ""], { type: "text/plain;charset=utf-8" })); dl.download = `jawaban-${item.at}.txt`;
    acts.append(cp, dl);
    body.append(pr, meta, acts); card.append(media, body);
    els.gallery.prepend(card);
    return;
  }
  const dl = document.createElement("a"); dl.className = "btn btn-primary"; dl.textContent = "⬇ Download"; dl.href = `/api/download?url=${encodeURIComponent(item.url)}`;
  acts.append(dl);
  if (item.kind !== "video") {
    const rf = document.createElement("button"); rf.className = "btn btn-ghost"; rf.textContent = "Jadikan referensi";
    rf.onclick = () => useAsRef(item);
    acts.append(rf);
    const lb = document.createElement("button"); lb.className = "btn btn-ghost"; lb.textContent = "Perbesar";
    lb.onclick = () => openLightbox(item);
    acts.append(lb);
  }
  body.append(pr, meta, acts); card.append(media, body);
  els.gallery.prepend(card);
}
function useAsRef(item) {
  if (state.refs.length >= HARD_CAP) return toast(`Referensi sudah penuh (${HARD_CAP}).`);
  state.refs.push({ id: crypto.randomUUID(), name: "hasil-generate", kind: item.kind === "video" ? "video" : "image", preview: item.url, assetUrl: item.url, status: "ready" });
  renderRefs(); toast("Hasil ditambahkan sebagai referensi ✔"); window.scrollTo({ top: 0, behavior: "smooth" });
}
function openLightbox(item) {
  state.lbItem = item;
  const isVid = item.kind === "video";
  els.lbVideo.classList.toggle("hidden", !isVid);
  els.lbImg.classList.toggle("hidden", isVid);
  if (isVid) { els.lbVideo.src = item.url; } else { els.lbImg.src = item.url; }
  els.lbCap.textContent = `${item.model} — ${item.prompt}`;
  els.lbDl.href = `/api/download?url=${encodeURIComponent(item.url)}`;
  $("#lbUseRef").style.display = isVid ? "none" : "";
  els.lb.classList.remove("hidden");
}
function closeLightbox() { els.lb.classList.add("hidden"); els.lbVideo.pause(); }
$("#lbClose").onclick = closeLightbox;
els.lb.onclick = (e) => { if (e.target === els.lb) closeLightbox(); };
$("#lbUseRef").onclick = () => { if (state.lbItem) { const it = state.lbItem; closeLightbox(); useAsRef(it); } };
$("#btnHistory").onclick = () => { els.gallery.scrollIntoView({ behavior: "smooth" }); toast(state.history.length ? `${state.history.length} hasil tersimpan di galeri (browser ini).` : "Belum ada riwayat di browser ini."); };

/* ---------- Login (form di halaman, v10) ---------- */
els.loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginError.classList.add("hidden");
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ username: els.loginUser.value.trim(), password: els.loginPass.value }) });
    location.reload(); // cookie sesi kini tersimpan; init ulang memuat model asli
  } catch (err) {
    els.loginError.textContent = "Password salah. Cek SITE_PASSWORD di Vercel — kalau baru diubah, Redeploy dulu di tab Deployments, lalu coba lagi.";
    els.loginError.classList.remove("hidden");
  }
});

/* ---------- Mode CHAT (untuk model teks->teks / asisten) ---------- */
function isChatModel(m) { return Boolean(m) && m.type === "text" && primaryCap(m) === "text-to-text"; }
function loadChats() { try { return JSON.parse(localStorage.getItem("aikoe-chats") || "{}"); } catch { return {}; } }
function saveChats() { localStorage.setItem("aikoe-chats", JSON.stringify(state.chats)); }
function chatTurns() { return state.model ? (state.chats[state.model.model_id] || []) : []; }
function applyMode() {
  const chat = isChatModel(state.model);
  document.body.classList.toggle("chat-mode", chat);
  els.chatPanel.classList.toggle("hidden", !chat);
  if (els.promptField) els.promptField.style.display = chat ? "none" : "";
  if (els.refField) els.refField.style.display = chat ? "none" : "";
  const actions = document.querySelector(".actions");
  if (actions) actions.style.display = chat ? "none" : "";
  els.status.style.display = chat ? "none" : "";
  if (chat) {
    els.empty.classList.add("hidden"); els.running.classList.add("hidden");
    els.gallery.style.display = "none";
    els.chatModelName.textContent = `💬 ${state.model.name || state.model.model_id}`;
    renderChat();
    setTimeout(() => els.chatInput.focus(), 50);
  } else {
    els.gallery.style.display = "";
    if (!state.history.length) els.empty.classList.remove("hidden");
  }
}
function renderChat() {
  const turns = chatTurns();
  els.chatLog.innerHTML = "";
  if (!turns.length) {
    const d = document.createElement("div"); d.className = "chat-empty";
    d.textContent = `Mulai percakapan dengan ${state.model?.name || "asisten"} — tanya apa saja, Enter untuk kirim.`;
    els.chatLog.appendChild(d);
    return;
  }
  for (const t of turns) {
    const b = document.createElement("div");
    b.className = "bubble " + (t.r === "u" ? "user" : "ai") + (t.err ? " err" : "");
    b.textContent = t.t;
    els.chatLog.appendChild(b);
  }
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}
function buildChatPrompt(newText) {
  const turns = chatTurns().filter((t) => !t.err);
  if (!turns.length) return newText;
  const lines = turns.slice(-16).map((t) => `${t.r === "u" ? "Pengguna" : "Asisten"}: ${t.t}`);
  return `Berikut riwayat percakapan antara Pengguna dan Asisten. Lanjutkan percakapan ini: jawab HANYA pesan Pengguna yang paling terakhir, dengan mengingat konteks sebelumnya.\n\n${lines.join("\n")}\nPengguna: ${newText}\nAsisten:`;
}
let chatBusy = false;
async function sendChat() {
  if (chatBusy) return;
  if (!state.configured) return toast("Mode pratinjau: hubungkan server dulu untuk chat.");
  if (!isChatModel(state.model)) return;
  const text = els.chatInput.value.trim();
  if (!text) return;
  const modelId = state.model.model_id;
  if (!state.chats[modelId]) state.chats[modelId] = [];
  state.chats[modelId].push({ r: "u", t: text });
  saveChats(); els.chatInput.value = ""; renderChat();
  chatBusy = true; els.btnSendChat.disabled = true;
  const typing = document.createElement("div");
  typing.className = "bubble ai typing"; typing.innerHTML = "<span></span><span></span><span></span>";
  els.chatLog.appendChild(typing); els.chatLog.scrollTop = els.chatLog.scrollHeight;
  try {
    const { params } = collectParams();
    const run = await api("/api/generate", { method: "POST", body: JSON.stringify({ type: "text", prompt: buildChatPrompt(text), model: modelId, params }) });
    const runId = run.run_id || run.id;
    if (!runId) throw new Error("Server tidak mengembalikan run_id");
    let result = null;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      result = await api(`/api/runs/${encodeURIComponent(runId)}`);
      if (result.status === "completed" || result.status === "failed") break;
    }
    if (!result || result.status === "failed") throw new Error(result?.error_message || "Generate gagal / timeout.");
    const out = (result.outputs || []).find((o) => o && (o.type === "text" || (o.url && !/^https?:\/\//i.test(o.url))));
    const answer = out ? (out.url || out.text || "") : "";
    if (!answer) throw new Error("Model tidak mengembalikan teks jawaban.");
    state.chats[modelId].push({ r: "a", t: answer });
  } catch (e) {
    state.chats[modelId].push({ r: "a", t: `⚠ Gagal: ${e.message}`, err: true });
  }
  saveChats(); typing.remove(); renderChat();
  chatBusy = false; els.btnSendChat.disabled = false; els.chatInput.focus();
}
els.btnSendChat.onclick = sendChat;
els.chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$("#btnClearChat").onclick = () => {
  if (!state.model) return;
  state.chats[state.model.model_id] = []; saveChats(); renderChat();
  toast("Percakapan baru dimulai ✔");
};

/* ---------- Event panel ---------- */
document.querySelectorAll("#mediaTabs button").forEach((b) => b.onclick = () => {
  document.querySelectorAll("#mediaTabs button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  state.mediaType = b.dataset.media; state.capFilter = "all";
  buildCapChips(); renderModelList();
});
els.search.addEventListener("input", renderModelList);
els.select.addEventListener("change", () => selectModel(els.select.value));
els.prompt.addEventListener("input", () => { els.promptCount.textContent = els.prompt.value.length; });
$("#btnResetParams").onclick = () => { if (state.model) { buildParams(state.model); toast("Pengaturan model direset ke default."); } };
els.drop.onclick = () => els.file.click();
els.file.onchange = () => { addFiles(els.file.files); els.file.value = ""; };
["dragover", "dragenter"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove("drag"); }));
els.drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
document.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) addFiles(f); });

/* ---------- Init ---------- */
(async function init() {
  for (const h of [...state.history].reverse()) addToGallery(h, false);
  if (!state.history.length) els.empty.classList.remove("hidden");
  let cfg = null;
  try {
    cfg = await api("/api/config");
    state.configured = Boolean(cfg.configured);
  } catch (e) { state.configured = false; }
  if (cfg && cfg.locked && !cfg.authenticated) {
    // Terkunci password: tampilkan FORM LOGIN di halaman (bukan popup browser),
    // supaya password salah langsung ketahuan dan bisa dicoba ulang.
    els.pill.textContent = "🔒 Terkunci — perlu login"; els.pill.className = "pill pill-warn";
    els.banner.classList.add("hidden");
    els.loginCard.classList.remove("hidden");
    state.models = dedupeModels(FALLBACK_MODELS);
    finishInit(null); return;
  }
  if (!state.configured) {
    els.pill.textContent = "⚠ Belum terhubung (mode pratinjau)"; els.pill.className = "pill pill-warn";
    els.banner.innerHTML = `<strong>Mode Pratinjau.</strong> Server belum terhubung (API key belum diisi). Isi key dulu untuk memuat <em>semua model asli</em> dari akunmu dan mengaktifkan tombol Generate.`;
    els.banner.classList.remove("hidden");
    state.models = dedupeModels(FALLBACK_MODELS);
    finishInit(null); return;
  }
  els.pill.textContent = "Menghubungkan…";
  try {
    const data = await api("/api/models");
    state.models = dedupeModels(data.models || []);
    state.featured = new Set((data.featured || []).map((f) => f.model_id));
    if (!state.models.length) throw new Error("Daftar model kosong dari server");
    finishInit(data.counts || null);
    els.pill.textContent = `● Terhubung · ${state.models.length} model unik`; els.pill.className = "pill pill-ok";
  } catch (e) {
    els.pill.textContent = "✘ Gagal memuat model"; els.pill.className = "pill pill-warn";
    els.banner.innerHTML = `<strong>Gagal memuat model:</strong> ${e.message}. Periksa API key & workspace ID di .env, lalu refresh. Untuk diagnosa pasti, buka <a href="/api/health" target="_blank">/api/health</a>.`;
    els.banner.classList.remove("hidden");
    state.models = dedupeModels(FALLBACK_MODELS);
    finishInit(null);
  }
})();
function finishInit(counts) {
  const ci = state.models.filter((m) => m.type === "image").length;
  const cv = state.models.filter((m) => m.type === "video").length;
  const ct = state.models.filter((m) => m.type === "text").length;
  els.countImage.textContent = ci; els.countVideo.textContent = cv; if (els.countText) els.countText.textContent = ct;
  els.dedupeNote.textContent = `(${ci + cv + ct} model unik, dedupe by model_id)`;
  buildCapChips(); renderModelList();
}
