// Teles Chile para Kino — v1.0.0
//
// Fuente: https://cdn.jsdelivr.net/gh/Alplox/json-teles@refs/heads/main/channels.json
// Solo se usan las señales de tipo "m3u8" (Kino no reproduce YouTube/Twitch de forma nativa).
// Se exponen canales como ítems "live" en la pestaña En vivo, además de filas en Home.

const JSON_URL =
  "https://cdn.jsdelivr.net/gh/Alplox/json-teles@refs/heads/main/channels.json";
const JSON_FALLBACK =
  "https://raw.githubusercontent.com/Alplox/json-teles/refs/heads/main/channels.json";
const PAGE_SIZE = 200;
const DEBUG = true;

function log(...args) {
  if (!DEBUG) return;
  try { kino.log("[teles]", ...args); } catch (_) {}
}

// ---------------------------------------------------------------------------------------------
// Cache en memoria (se renueva cada hora)

let cache = null;
async function fetchChannels() {
  if (cache && Date.now() - cache.time < 3600_000) return cache.data;

  const urls = [JSON_URL, JSON_FALLBACK];
  let lastErr;

  for (const url of urls) {
    try {
      log("fetchChannels: intentando", url);
      const r = await kino.fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || !Array.isArray(data.channels)) {
        throw new Error("respuesta sin array channels");
      }
      cache = { time: Date.now(), data };
      log("fetchChannels: OK,", data.channels.length, "canales");
      return data;
    } catch (e) {
      lastErr = e;
      log("fetchChannels: fallo", url, "-", e && e.message);
    }
  }
  throw kino.error(
    "unavailable",
    `teles: no se pudo cargar el directorio (${lastErr && lastErr.message})`
  );
}

// ---------------------------------------------------------------------------------------------
// Utilidades

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function hasM3u8(ch) {
  return (ch.signals || []).some((s) => s && s.type === "m3u8" && s.url);
}

function bestM3u8(ch) {
  const sig = (ch.signals || []).find((s) => s && s.type === "m3u8" && s.url);
  return sig ? sig.url : null;
}

const COUNTRY_NAMES = {
  cl: "Chile",
  ar: "Argentina",
  mx: "México",
  pe: "Perú",
  co: "Colombia",
  es: "España",
  us: "Estados Unidos",
  ve: "Venezuela",
  ec: "Ecuador",
  bo: "Bolivia",
  py: "Paraguay",
  uy: "Uruguay",
  br: "Brasil",
  do: "República Dominicana",
  gt: "Guatemala",
  cr: "Costa Rica",
  pa: "Panamá",
  hn: "Honduras",
  sv: "El Salvador",
  ni: "Nicaragua",
  cu: "Cuba",
  pr: "Puerto Rico",
};

const CATEGORY_NAMES = {
  news: "Noticias",
  sports: "Deportes",
  music: "Música",
  kids: "Infantil",
  general: "General",
  movies: "Películas",
  entertainment: "Entretenimiento",
  education: "Educación",
  religion: "Religión",
  shopping: "Compras",
  travel: "Viajes",
  outdoor: "Aire libre",
  lifestyle: "Estilo de vida",
  cooking: "Cocina",
  science: "Ciencia",
  technology: "Tecnología",
  gaming: "Gaming",
  automotive: "Automotriz",
  business: "Negocios",
  weather: "Clima",
  government: "Gobierno",
  local: "Local",
  regional: "Regional",
  international: "Internacional",
};

function countryLabel(code) {
  return COUNTRY_NAMES[norm(code)] || String(code || "").toUpperCase();
}

function categoryLabel(cat) {
  return CATEGORY_NAMES[norm(cat)] || String(cat || "");
}

// ---------------------------------------------------------------------------------------------
// Canales

function toLiveItem(ch) {
  const id = String(ch.id);
  const item = {
    id,
    title: ch.name || id,
    kind: "live",
    ref: id,
  };
  if (ch.logo) item.poster = ch.logo;

  const m3u8 = bestM3u8(ch);
  if (m3u8) {
    item.stream = {
      url: m3u8,
      mime: "application/vnd.apple.mpegurl",
    };
  }

  const badges = [];
  if (ch.country) badges.push(countryLabel(ch.country));
  if (ch.category) badges.push(categoryLabel(ch.category));
  if (badges.length) item.badges = badges;

  return item;
}

function channelsWithM3u8(data) {
  return (data.channels || []).filter(hasM3u8);
}

function liveItemsFor(data, filterFn) {
  return channelsWithM3u8(data).filter(filterFn).map(toLiveItem);
}

// ---------------------------------------------------------------------------------------------
// Categorías (países + categorías principales)

async function buildCategories() {
  const data = await fetchChannels();
  const chs = channelsWithM3u8(data);

  const countryCount = new Map();
  const catCount = new Map();

  for (const ch of chs) {
    const c = norm(ch.country);
    if (c) countryCount.set(c, (countryCount.get(c) || 0) + 1);

    const k = norm(ch.category);
    if (k) catCount.set(k, (catCount.get(k) || 0) + 1);
  }

  const cats = [{ id: "all", name: "Todos los canales", genre: "general" }];

  // Países con al menos 3 canales
  for (const [code, count] of countryCount) {
    if (count >= 3) {
      cats.push({
        id: "country:" + code,
        name: countryLabel(code),
        genre: "general",
      });
    }
  }

  // Categorías con al menos 5 canales
  for (const [cat, count] of catCount) {
    if (count >= 5) {
      cats.push({
        id: "category:" + cat,
        name: categoryLabel(cat),
        genre: cat,
      });
    }
  }

  return cats;
}

// ---------------------------------------------------------------------------------------------
// API de canales en vivo

export async function liveCategories() {
  return await buildCategories();
}

export async function liveChannels({ categoryId, cursor }) {
  const data = await fetchChannels();
  let filter = () => true;

  if (categoryId && categoryId !== "all") {
    if (categoryId.startsWith("country:")) {
      const code = categoryId.slice(8);
      filter = (ch) => norm(ch.country) === code;
    } else if (categoryId.startsWith("category:")) {
      const cat = categoryId.slice(9);
      filter = (ch) => norm(ch.category) === cat;
    }
  }

  const items = liveItemsFor(data, filter);
  const offset = parseInt(cursor, 10) || 0;
  const page = items.slice(offset, offset + PAGE_SIZE);
  const next =
    offset + PAGE_SIZE < items.length ? String(offset + PAGE_SIZE) : undefined;

  return { items: page, next };
}

export async function liveSearch({ query }) {
  const q = norm(query);
  if (!q) return { items: [] };

  const data = await fetchChannels();
  const items = liveItemsFor(data, (ch) => norm(ch.name).includes(q));
  return { items: items.slice(0, 100) };
}

// ---------------------------------------------------------------------------------------------
// Resolver

export async function resolve(ref) {
  const id = String(ref);
  const data = await fetchChannels();
  const ch = (data.channels || []).find((c) => String(c.id) === id);

  if (!ch) throw kino.error("not_found", "teles: canal no encontrado " + id);

  const m3u8 = bestM3u8(ch);
  if (!m3u8) {
    throw kino.error(
      "unavailable",
      "teles: el canal no tiene señal m3u8 (" + id + ")"
    );
  }

  return {
    url: m3u8,
    mime: "application/vnd.apple.mpegurl",
    expiresInSeconds: 3600,
  };
}

// ---------------------------------------------------------------------------------------------
// Home (filas de canales)

export async function home() {
  const data = await fetchChannels();

  const defs = [
    ["all", "Todos los canales", () => true],
    ["cl", "Chile", (ch) => norm(ch.country) === "cl"],
    ["ar", "Argentina", (ch) => norm(ch.country) === "ar"],
    ["mx", "México", (ch) => norm(ch.country) === "mx"],
    ["news", "Noticias", (ch) => norm(ch.category) === "news"],
    ["sports", "Deportes", (ch) => norm(ch.category) === "sports"],
    ["music", "Música", (ch) => norm(ch.category) === "music"],
    ["kids", "Infantil", (ch) => norm(ch.category) === "kids"],
    ["general", "General", (ch) => norm(ch.category) === "general"],
  ];

  const rows = [];

  for (const [id, title, filter] of defs) {
    const items = liveItemsFor(data, filter).slice(0, 20);
    if (items.length > 0) {
      rows.push({ id, title, items });
    }
  }

  if (rows.length === 0) {
    throw kino.error("unavailable", "teles: no hay canales m3u8 disponibles");
  }

  return rows;
}

// ---------------------------------------------------------------------------------------------
// Browse (para la pestaña de exploración)

export async function browse(ref, cursor) {
  // ref es el id de categoría (all, country:cl, category:news, etc.)
  return await liveChannels({ categoryId: ref, cursor });
}

// ---------------------------------------------------------------------------------------------
// Search (búsqueda general)

export async function search(query) {
  const q = norm(query.q || query.title || query);
  if (!q) return [];

  const data = await fetchChannels();
  const items = liveItemsFor(data, (ch) => norm(ch.name).includes(q));
  return items.slice(0, 100);
}