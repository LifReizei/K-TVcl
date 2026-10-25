// Teles Chile para Kino — v1.1.0
const JSON_URL = "https://cdn.jsdelivr.net/gh/Alplox/json-teles@refs/heads/main/channels.json";
const JSON_FALLBACK = "https://raw.githubusercontent.com/Alplox/json-teles/refs/heads/main/channels.json";
const PAGE_SIZE = 200;
const DEBUG = true;

function log(...args) {
  if (!DEBUG) return;
  try { kino.log("[teles]", ...args); } catch (_) {}
}

let cache = null;
async function fetchChannels() {
  if (cache && Date.now() - cache.time < 3600_000) return cache.data;
  const urls = [JSON_URL, JSON_FALLBACK];
  let lastErr;
  for (const url of urls) {
    try {
      const r = await kino.fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || !Array.isArray(data.channels)) throw new Error("respuesta sin array channels");
      cache = { time: Date.now(), data };
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw kino.error("unavailable", `teles: no se pudo cargar el directorio (${lastErr && lastErr.message})`);
}

function norm(s) { return String(s || "").toLowerCase().trim(); }
function hasM3u8(ch) { return (ch.signals || []).some((s) => s && s.type === "m3u8" && s.url); }
function bestM3u8(ch) {
  const sig = (ch.signals || []).find((s) => s && s.type === "m3u8" && s.url);
  return sig ? sig.url : null;
}

function toLiveItem(ch) {
  const id = String(ch.id);
  const item = { id, title: ch.name || id, kind: "live", ref: id };
  if (ch.logo) item.poster = ch.logo;
  const m3u8 = bestM3u8(ch);
  if (m3u8) item.stream = { url: m3u8, mime: "application/vnd.apple.mpegurl" };
  
  const badges = [];
  if (ch.country) badges.push(ch.country.toUpperCase());
  if (ch.category) badges.push(ch.category.toUpperCase());
  if (badges.length) item.badges = badges;
  return item;
}

function channelsWithM3u8(data) { return (data.channels || []).filter(hasM3u8); }
function liveItemsFor(data, filterFn) { return channelsWithM3u8(data).filter(filterFn).map(toLiveItem); }

export async function liveCategories() {
  const data = await fetchChannels();
  const chs = channelsWithM3u8(data);
  const countryCount = new Map();
  for (const ch of chs) {
    const c = norm(ch.country);
    if (c) countryCount.set(c, (countryCount.get(c) || 0) + 1);
  }
  const cats = [{ id: "all", name: "Todos los canales", genre: "general" }];
  for (const [code, count] of countryCount) {
    if (count >= 3) cats.push({ id: "country:" + code, name: code.toUpperCase(), genre: "general" });
  }
  return cats;
}

export async function liveChannels({ categoryId, cursor }) {
  const data = await fetchChannels();
  let filter = () => true;
  if (categoryId && categoryId !== "all" && categoryId.startsWith("country:")) {
    const code = categoryId.slice(8);
    filter = (ch) => norm(ch.country) === code;
  }
  const items = liveItemsFor(data, filter);
  const offset = parseInt(cursor, 10) || 0;
  const page = items.slice(offset, offset + PAGE_SIZE);
  const next = offset + PAGE_SIZE < items.length ? String(offset + PAGE_SIZE) : undefined;
  return { items: page, next };
}

export async function liveSearch({ query }) {
  const q = norm(query);
  if (!q) return { items: [] };
  const data = await fetchChannels();
  return { items: liveItemsFor(data, (ch) => norm(ch.name).includes(q)).slice(0, 100) };
}

export async function resolve(ref) {
  const id = String(ref);
  const data = await fetchChannels();
  const ch = (data.channels || []).find((c) => String(c.id) === id);
  if (!ch) throw kino.error("not_found", "teles: canal no encontrado " + id);
  const m3u8 = bestM3u8(ch);
  if (!m3u8) throw kino.error("unavailable", "teles: el canal no tiene señal m3u8");
  return { url: m3u8, mime: "application/vnd.apple.mpegurl", expiresInSeconds: 3600 };
}

export async function home() {
  const data = await fetchChannels();
  return [
    { id: "all", title: "Todos los canales", items: liveItemsFor(data, () => true).slice(0, 20) },
    { id: "cl", title: "Chile", items: liveItemsFor(data, (ch) => norm(ch.country) === "cl").slice(0, 20) }
  ];
}