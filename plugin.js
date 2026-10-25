// Teles Chile para Kino — v1.2.0
// Repositorio: LifReizei/K-TVcl

const JSON_URL = "https://cdn.jsdelivr.net/gh/Alplox/json-teles@refs/heads/main/channels.json";
const JSON_FALLBACK = "https://raw.githubusercontent.com/Alplox/json-teles/refs/heads/main/channels.json";
const PAGE_SIZE = 200;
const DEBUG = true;

function log(...args) {
  if (!DEBUG) return;
  try { kino.log("[teles]", ...args); } catch (_) {}
}

// ---------------------------------------------------------------------------------------------
// Carga y caché de datos

let cache = null;

async function fetchChannels() {
  if (cache && Date.now() - cache.time < 3600_000) return cache.data;
  
  const urls = [JSON_URL, JSON_FALLBACK];
  let lastErr;
  
  for (const url of urls) {
    try {
      log("Descargando canales desde:", url);
      const r = await kino.fetch(url, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (!data || !Array.isArray(data.channels)) {
        throw new Error("La respuesta no contiene un array válido de canales");
      }
      cache = { time: Date.now(), data };
      return data;
    } catch (e) {
      lastErr = e;
      log("Error al descargar de", url, "-", e.message);
    }
  }
  throw kino.error("unavailable", `No se pudo cargar el directorio (${lastErr && lastErr.message})`);
}

// ---------------------------------------------------------------------------------------------
// Utilidades

function norm(s) { return String(s || "").toLowerCase().trim(); }

function hasM3u8(ch) {
  return (ch.signals || []).some((s) => s && s.type === "m3u8" && s.url);
}

function bestM3u8(ch) {
  const sig = (ch.signals || []).find((s) => s && s.type === "m3u8" && s.url);
  return sig ? sig.url : null;
}

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
    item.stream = { url: m3u8, mime: "application/vnd.apple.mpegurl" };
  }
  
  const badges = [];
  if (ch.country) badges.push(ch.country.toUpperCase());
  if (ch.category) badges.push(ch.category.toUpperCase());
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
// Pestaña personalizada (Soluciona el error de "falta section")

export async function section(arg) {
  const currentTab = arg && arg.tab ? arg.tab : "cl";
  
  const tabs = [
    { id: "cl", label: "Chile" },
    { id: "ar", label: "Argentina" },
    { id: "mx", label: "México" },
    { id: "pe", label: "Perú" },
    { id: "all", label: "Todos" }
  ];

  const data = await fetchChannels();
  
  let filter = () => true;
  if (currentTab !== "all") {
    filter = (ch) => norm(ch.country) === currentTab;
  }

  const items = liveItemsFor(data, filter);

  return {
    tabs,
    tab: currentTab,
    rows: [
      {
        id: "live-" + currentTab,
        title: currentTab === "all" ? "Todos los canales" : "Canales en vivo",
        items: items.slice(0, 100), // Limitamos a 100 para no sobrecargar la memoria
      }
    ]
  };
}

// ---------------------------------------------------------------------------------------------
// Canales en Vivo (Native Live TV Tab)

export async function liveCategories() {
  const data = await fetchChannels();
  const chs = channelsWithM3u8(data);
  const countryCount = new Map();
  
  for (const ch of chs) {
    const c = norm(ch.country);
    if (c) countryCount.set(c, (countryCount.get(c) || 0) + 1);
  }
  
  const cats = [{ id: "all", name: "Todos los canales" }];
  
  for (const [code, count] of countryCount) {
    if (count >= 3) {
      cats.push({ id: "country:" + code, name: code.toUpperCase() });
    }
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
  
  return {
    items: page,
    next: offset + PAGE_SIZE < items.length ? String(offset + PAGE_SIZE) : undefined
  };
}

export async function liveSearch({ query }) {
  const q = norm(query);
  if (!q) return { items: [] };
  
  const data = await fetchChannels();
  const items = liveItemsFor(data, (ch) => norm(ch.name).includes(q));
  
  return { items: items.slice(0, 100) };
}

// ---------------------------------------------------------------------------------------------
// Home y Resolve

export async function home() {
  const data = await fetchChannels();
  
  return [
    {
      id: "cl",
      title: "Chile",
      items: liveItemsFor(data, (ch) => norm(ch.country) === "cl").slice(0, 20)
    },
    {
      id: "ar",
      title: "Argentina",
      items: liveItemsFor(data, (ch) => norm(ch.country) === "ar").slice(0, 20)
    },
    {
      id: "mx",
      title: "México",
      items: liveItemsFor(data, (ch) => norm(ch.country) === "mx").slice(0, 20)
    }
  ];
}

export async function resolve(ref) {
  const id = String(ref);
  const data = await fetchChannels();
  
  const ch = (data.channels || []).find((c) => String(c.id) === id);
  if (!ch) throw kino.error("not_found", "Canal no encontrado: " + id);
  
  const m3u8 = bestM3u8(ch);
  if (!m3u8) throw kino.error("unavailable", "El canal no tiene una señal m3u8 válida");
  
  return {
    url: m3u8,
    mime: "application/vnd.apple.mpegurl",
    expiresInSeconds: 3600
  };
}