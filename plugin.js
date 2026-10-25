// Teles Chile para Kino — v1.3.0
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
// Utilidades de extracción de video (Súper robusta)

function norm(s) { return String(s || "").toLowerCase().trim(); }

// Busca enlaces .m3u8 sin importar cómo estén estructurados en el JSON
function getM3u8Url(ch) {
  // 1. Propiedad directa "url"
  if (typeof ch.url === "string" && ch.url.includes(".m3u8")) return ch.url;
  
  // 2. Array "streams"
  if (Array.isArray(ch.streams)) {
    const stream = ch.streams.find(s => (s.type && s.type.includes("m3u8")) || (s.url && s.url.includes(".m3u8")));
    if (stream && stream.url) return stream.url;
  }
  
  // 3. Array "sources" o "signals"
  for (const key of ["sources", "signals"]) {
    if (Array.isArray(ch[key])) {
      const src = ch[key].find(s => (s.type && s.type.includes("m3u8")) || (s.url && s.url.includes(".m3u8")));
      if (src && src.url) return src.url;
    }
  }
  
  return null;
}

function toLiveItem(ch) {
  const id = String(ch.id || ch.name);
  const m3u8 = getM3u8Url(ch);
  
  const item = {
    id,
    title: ch.name || id,
    kind: "live",
    ref: id,
  };
  
  if (ch.logo) item.poster = ch.logo;
  
  // Si encontramos el m3u8, se lo pasamos directamente a Kino
  if (m3u8) {
    item.stream = { url: m3u8, mime: "application/vnd.apple.mpegurl" };
  }
  
  const badges = [];
  if (ch.country) badges.push(String(ch.country).toUpperCase());
  if (ch.category) badges.push(String(ch.category).toUpperCase());
  if (badges.length) item.badges = badges;
  
  return item;
}

function getValidChannels(data) {
  // Filtramos solo los canales que tengan un enlace m3u8 válido
  return (data.channels || []).filter(ch => getM3u8Url(ch) !== null).map(toLiveItem);
}

// ---------------------------------------------------------------------------------------------
// Pestaña personalizada (Sección)
// En lugar de usar tabs (que a veces no se renderizan), devolvemos filas para cada país.

export async function section(arg) {
  const data = await fetchChannels();
  const allItems = getValidChannels(data);

  const rows = [];
  
  // Fila 1: Chile
  const clItems = allItems.filter(it => it.badges && it.badges.includes("CL"));
  if (clItems.length) rows.push({ id: "cl", title: "🇨🇱 Canales de Chile", items: clItems });

  // Fila 2: Argentina
  const arItems = allItems.filter(it => it.badges && it.badges.includes("AR"));
  if (arItems.length) rows.push({ id: "ar", title: "🇦🇷 Canales de Argentina", items: arItems });

  // Fila 3: México
  const mxItems = allItems.filter(it => it.badges && it.badges.includes("MX"));
  if (mxItems.length) rows.push({ id: "mx", title: "🇲🇽 Canales de México", items: mxItems });

  // Fila 4: Todos los demás
  if (allItems.length) rows.push({ id: "all", title: "🌎 Todos los canales", items: allItems });

  return {
    rows: rows
  };
}

// ---------------------------------------------------------------------------------------------
// Canales en Vivo (Native Live TV Tab)

export async function liveCategories() {
  const data = await fetchChannels();
  return [
    { id: "all", name: "Todos los canales" },
    { id: "country:cl", name: "Chile" },
    { id: "country:ar", name: "Argentina" },
    { id: "country:mx", name: "México" }
  ];
}

export async function liveChannels({ categoryId, cursor }) {
  const data = await fetchChannels();
  let items = getValidChannels(data);
  
  if (categoryId && categoryId !== "all" && categoryId.startsWith("country:")) {
    const code = categoryId.split(":")[1];
    items = items.filter(it => it.badges && it.badges.includes(code.toUpperCase()));
  }
  
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
  const items = getValidChannels(data).filter(it => norm(it.title).includes(q));
  
  return { items: items.slice(0, 100) };
}

// ---------------------------------------------------------------------------------------------
// Home y Resolve

export async function home() {
  const data = await fetchChannels();
  const items = getValidChannels(data);
  
  return [
    { id: "cl", title: "Chile", items: items.filter(it => it.badges && it.badges.includes("CL")).slice(0, 20) },
    { id: "ar", title: "Argentina", items: items.filter(it => it.badges && it.badges.includes("AR")).slice(0, 20) }
  ];
}

export async function resolve(ref) {
  const id = String(ref);
  const data = await fetchChannels();
  
  const ch = (data.channels || []).find((c) => String(c.id || c.name) === id);
  if (!ch) throw kino.error("not_found", "Canal no encontrado: " + id);
  
  const m3u8 = getM3u8Url(ch);
  if (!m3u8) throw kino.error("unavailable", "El canal no tiene una señal m3u8 válida");
  
  return {
    url: m3u8,
    mime: "application/vnd.apple.mpegurl",
    expiresInSeconds: 3600
  };
}