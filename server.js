/*
 * Global News v3 — servidor
 * Junta noticias de varias APIs, las filtra por país, categoría, idioma y fechas,
 * y entrega datos de contexto de cada país (Wikipedia, Banco Mundial, UN Comtrade).
 *
 * Las claves NUNCA van en este archivo: se ponen en Render → Environment
 * con los nombres que aparecen abajo en KEYS.
 */
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;
const UA = "GlobalNews/3.0 (proyecto universitario, Universidad Libre Bogota)";

/* ------------------------------------------------------------------ */
/* 1. Claves (variables de entorno en Render)                          */
/* ------------------------------------------------------------------ */
const KEYS = {
  newsapi:   process.env.NEWS_API_KEY || "",
  newsapiai: process.env.NEWSAPI_AI_KEY || "",
  nyt:       process.env.NYT_API_KEY || "",
  guardian:  process.env.GUARDIAN_API_KEY || "",
  gnews:     process.env.GNEWS_API_KEY || "",
  currents:  process.env.CURRENTS_API_KEY || "",
  newsdata:  process.env.NEWSDATA_API_KEY || "",
  comtrade:  process.env.COMTRADE_API_KEY || ""
};

/* Todas las fuentes que usa la app (las que no piden clave están siempre activas) */
const SOURCES = [
  { id: "newsapi",   name: "NewsAPI.org",        env: "NEWS_API_KEY",     type: "Noticias del último mes" },
  { id: "gnews",     name: "GNews",              env: "GNEWS_API_KEY",    type: "Noticias del último mes" },
  { id: "currents",  name: "Currents",           env: "CURRENTS_API_KEY", type: "Noticias del último mes" },
  { id: "newsdata",  name: "NewsData.io",        env: "NEWSDATA_API_KEY", type: "Noticias recientes por país" },
  { id: "newsapiai", name: "NewsAPI.ai",         env: "NEWSAPI_AI_KEY",   type: "Noticias del último mes" },
  { id: "guardian",  name: "The Guardian",       env: "GUARDIAN_API_KEY", type: "Actuales e históricas (desde 1999)" },
  { id: "nyt",       name: "The New York Times", env: "NYT_API_KEY",      type: "Actuales e históricas (desde 1851)" },
  { id: "gdelt",     name: "GDELT",              env: null,               type: "Prensa mundial, 65 idiomas (últimos 3 meses)" },
  { id: "loc",       name: "Chronicling America", env: null,              type: "Periódicos históricos (1756–1963)" },
  { id: "wayback",   name: "Wayback Machine",    env: null,               type: "Portadas archivadas de periódicos" },
  { id: "wikipedia", name: "Wikipedia",          env: null,               type: "Resumen de cada país" },
  { id: "worldbank", name: "Banco Mundial",      env: null,               type: "Población, PIB e inflación" },
  { id: "comtrade",  name: "UN Comtrade",        env: "COMTRADE_API_KEY", type: "Exportaciones e importaciones" }
];
const isOn = id => {
  const s = SOURCES.find(x => x.id === id);
  return Boolean(s && (!s.env || KEYS[id] || id === "comtrade")); // Comtrade funciona sin clave en modo "preview"
};
const lastStatus = {}; // última respuesta de cada fuente (se ve en Configuración)

/* Medios de referencia para la vista mundial de NewsAPI.org */
const WORLD_DOMAINS = [
  "bbc.com","bbc.co.uk","cnn.com","reuters.com","apnews.com","aljazeera.com","dw.com","france24.com",
  "theguardian.com","nytimes.com","washingtonpost.com","bloomberg.com","forbes.com","ft.com","economist.com",
  "politico.com","npr.org","cbsnews.com","nbcnews.com","abcnews.go.com","time.com","foreignpolicy.com",
  "elpais.com","elmundo.es","abc.es","lavanguardia.com","infobae.com","clarin.com","lanacion.com.ar",
  "eltiempo.com","elespectador.com","semana.com","caracol.com.co","eluniversal.com.mx","milenio.com",
  "latercera.com","emol.com","elcomercio.pe","larepublica.pe","eluniverso.com","elnacional.com",
  "lemonde.fr","lefigaro.fr","spiegel.de","zeit.de","corriere.it","repubblica.it","folha.uol.com.br",
  "oglobo.globo.com","scmp.com","japantimes.co.jp","thehindu.com","timesofindia.indiatimes.com",
  "haaretz.com","arabnews.com","news24.com","abc.net.au","smh.com.au","theglobeandmail.com","cbc.ca"
];

/* Periódicos para la hemeroteca (portadas en Wayback Machine) */
const OUTLETS = {
  CO: [["El Tiempo","eltiempo.com"],["El Espectador","elespectador.com"]],
  MX: [["El Universal","eluniversal.com.mx"],["La Jornada","jornada.com.mx"]],
  AR: [["Clarín","clarin.com"],["La Nación","lanacion.com.ar"]],
  BR: [["Folha de S.Paulo","folha.uol.com.br"],["O Globo","oglobo.globo.com"]],
  CL: [["El Mercurio","emol.com"],["La Tercera","latercera.com"]],
  PE: [["El Comercio","elcomercio.pe"],["La República","larepublica.pe"]],
  VE: [["El Nacional","elnacional.com"],["Últimas Noticias","ultimasnoticias.com.ve"]],
  EC: [["El Universo","eluniverso.com"],["El Comercio","elcomercio.com"]],
  BO: [["La Razón","la-razon.com"]], UY: [["El País","elpais.com.uy"]], PY: [["ABC Color","abc.com.py"]],
  CU: [["Granma","granma.cu"]], PA: [["La Prensa","prensa.com"]], CR: [["La Nación","nacion.com"]],
  ES: [["El País","elpais.com"],["El Mundo","elmundo.es"]],
  US: [["The New York Times","nytimes.com"],["The Washington Post","washingtonpost.com"]],
  CA: [["The Globe and Mail","theglobeandmail.com"]],
  GB: [["BBC","bbc.co.uk"],["The Guardian","theguardian.com"]],
  FR: [["Le Monde","lemonde.fr"],["Le Figaro","lefigaro.fr"]],
  DE: [["Der Spiegel","spiegel.de"],["FAZ","faz.net"]],
  IT: [["Corriere della Sera","corriere.it"],["La Repubblica","repubblica.it"]],
  PT: [["Público","publico.pt"]], RU: [["TASS","tass.com"],["Kommersant","kommersant.ru"]],
  UA: [["Kyiv Post","kyivpost.com"]], TR: [["Hürriyet","hurriyet.com.tr"]], IL: [["Haaretz","haaretz.com"]],
  SA: [["Arab News","arabnews.com"]], QA: [["Al Jazeera","aljazeera.com"]], EG: [["Al-Ahram","ahram.org.eg"]],
  CN: [["China Daily","chinadaily.com.cn"],["Xinhua","xinhuanet.com"]], JP: [["The Japan Times","japantimes.co.jp"]],
  KR: [["The Korea Herald","koreaherald.com"]], IN: [["The Times of India","timesofindia.indiatimes.com"],["The Hindu","thehindu.com"]],
  AU: [["The Sydney Morning Herald","smh.com.au"]], ZA: [["News24","news24.com"],["Mail & Guardian","mg.co.za"]],
  NG: [["The Punch","punchng.com"]], KE: [["Daily Nation","nation.africa"]]
};
const WORLD_OUTLETS = [["BBC","bbc.co.uk"],["CNN","cnn.com"]];

/* Palabras de cada categoría (para las búsquedas y para filtrar) */
const CATEGORIES = {
  Ambientales: { en: ["climate","environment","biodiversity","pollution","deforestation"], es: ["clima","ambiente","biodiversidad","contaminación"],
                 re: /(climat|environment|biodivers|pollut|deforest|emission|wildfire|drought|flood|clima|ambient|contamina|emisi|incendio|sequ|inundac|energ)/i,
                 newsdata: "environment" },
  "Políticas": { en: ["politics","government","election","diplomacy","president"], es: ["política","gobierno","elecciones","diplomacia"],
                 re: /(politic|government|election|diplomac|president|minister|parliament|congress|senate|vote|sanction|treaty|pol[ií]tic|gobierno|elecci|diplomac|presiden|ministr|congreso|senado|canciller|tratado)/i,
                 newsdata: "politics" },
  "Económicas": { en: ["economy","markets","inflation","trade","business"], es: ["economía","mercados","inflación","comercio"],
                 re: /(econom|market|inflation|trade|business|export|import|tariff|gdp|bank|stock|invest|econom[ií]a|mercado|inflaci|comercio|empresa|exporta|importa|arancel|banco|inversi|d[oó]lar|peso)/i,
                 newsdata: "business" },
  Sociales:    { en: ["society","education","health","migration","human rights"], es: ["sociedad","educación","salud","migración"],
                 re: /(societ|social|education|health|migra|refugee|human rights|protest|crime|violence|culture|sociedad|educaci|salud|migra|refugiad|derechos humanos|protesta|violencia|cultura)/i,
                 newsdata: "health,education" }
};

/* ------------------------------------------------------------------ */
/* 2. Utilidades                                                       */
/* ------------------------------------------------------------------ */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 864e5;

const cache = new Map();
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { cache.delete(k); return null; }
  return e.val;
}
function cacheSet(k, val, ttl) {
  cache.set(k, { val, exp: Date.now() + ttl });
  if (cache.size > 400) cache.delete(cache.keys().next().value);
}

function hideKeys(msg) {
  let s = String(msg || "");
  for (const k of Object.values(KEYS)) if (k && k.length > 4) s = s.split(k).join("***");
  return s.slice(0, 220);
}

async function getJSON(url, { headers = {}, method = "GET", body, timeout = 12000 } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, body,
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(timeout)
    });
  } catch (e) {
    throw networkError(e);
  }
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* no era JSON */ }
  if (!res.ok) {
    const m = data && (data.message || data.error?.message || data.results?.message || data.response?.message ||
                       data.fault?.faultstring || data.error || data.errors);
    throw new Error(`${res.status} ${typeof m === "string" ? m : (m ? JSON.stringify(m) : text.slice(0, 120) || res.statusText)}`);
  }
  if (data === null) throw new Error(text.trim().slice(0, 160) || "Respuesta vacía");
  return data;
}

/* Explica por qué no hubo conexión (DNS, certificado, conexión cortada, tiempo agotado...) */
function networkError(e) {
  const c = e.cause || {};
  const code = c.code || c.name || (e.name === "TimeoutError" ? "TIMEOUT" : "");
  const detail = c.message && !String(c.message).includes(code) ? `: ${c.message}` : "";
  const err = new Error(`${e.name === "TimeoutError" ? "Tiempo agotado" : "Sin conexión"}${code ? ` (${code}${detail})` : ""}`);
  err.network = true;
  return err;
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("La fuente tardó demasiado")), ms))]);
}

const cleanText = (s = "") => String(s).replace(/[<>"]/g, "").trim().slice(0, 120);
function stripHtml(s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
}
function clip(s, n = 260) { s = stripHtml(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }

function toISO(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (/^\d{8}T\d{6}Z$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15)}Z`;
  else if (/^\d{14}$/.test(s)) s = `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`;
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(" ", "T") + "Z";
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/.test(s)) s = s.replace(" ", "T").replace(/ ([+-]\d{2})(\d{2})$/, "$1:$2");
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += "T12:00:00Z";
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}
const ymd = d => d.toISOString().slice(0, 10);
const ymdCompact = d => ymd(d).replace(/-/g, "");
const isoNoMs = d => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const gdeltStamp = d => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);

function langCode(v) {
  v = String(v || "").toLowerCase();
  if (["es", "spa", "spanish", "español"].includes(v)) return "es";
  if (["en", "eng", "english", "inglés"].includes(v)) return "en";
  return v.slice(0, 2);
}
const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

/* Normaliza una noticia de cualquier fuente al mismo formato */
function art(provider, a) {
  const title = stripHtml(a.title);
  const url = String(a.url || "").trim();
  if (!title || !/^https?:\/\//.test(url)) return null;
  let image = a.image && /^https?:\/\//.test(a.image) ? a.image : null;
  return {
    title,
    description: clip(a.description || "") || "Consulta la noticia completa en el medio original.",
    url,
    image,
    publishedAt: toISO(a.publishedAt),
    source: stripHtml(a.source) || provider.name,
    author: clip(Array.isArray(a.author) ? a.author.join(", ") : a.author || "", 60),
    lang: langCode(a.lang),
    provider: provider.id,
    providerName: provider.name,
    category: a.category || null
  };
}

/* ------------------------------------------------------------------ */
/* 3. Países                                                           */
/* ------------------------------------------------------------------ */
const dnEs = new Intl.DisplayNames(["es"], { type: "region", fallback: "none" });
const dnEn = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const safeDN = (dn, code) => { try { return dn.of(code) || ""; } catch { return ""; } };

/* Nombres como los escribe la prensa (el nombre "oficial" a veces no aparece en las noticias) */
const EN_NAMES = {
  US: "United States", GB: "United Kingdom", CD: "Democratic Republic of Congo", CG: "Republic of Congo",
  MM: "Myanmar", HK: "Hong Kong", MO: "Macau", BA: "Bosnia", CI: "Ivory Coast", TR: "Turkey",
  KP: "North Korea", KR: "South Korea", PS: "Palestine", VA: "Vatican", CZ: "Czech Republic",
  MK: "North Macedonia", CV: "Cape Verde", TL: "East Timor", LA: "Laos", SY: "Syria", RU: "Russia",
  IR: "Iran", VN: "Vietnam", TZ: "Tanzania", BO: "Bolivia", VE: "Venezuela", FM: "Micronesia",
  KN: "Saint Kitts and Nevis", LC: "Saint Lucia", VC: "Saint Vincent", ST: "Sao Tome", SZ: "Eswatini",
  EH: "Western Sahara", FK: "Falkland Islands", TW: "Taiwan", XK: "Kosovo"
};
const ES_NAMES = { HK: "Hong Kong", MO: "Macao", MM: "Myanmar", CD: "República Democrática del Congo", CG: "República del Congo" };

function tidyName(n) {
  return String(n || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+RAE de China/i, "").replace(/\s+SAR China/i, "")
    .replace(/&/g, "and").replace(/\bSt\.\s/g, "Saint ").replace(/\s+/g, " ").trim();
}

function countryFrom(query) {
  const code = String(query.code || "").toUpperCase();
  const valid = /^[A-Z]{2}$/.test(code) && safeDN(dnEn, code);
  const fallback = cleanText(query.name || "");
  const es = tidyName((valid && (ES_NAMES[code] || safeDN(dnEs, code))) || fallback);
  const en = tidyName((valid && (EN_NAMES[code] || safeDN(dnEn, code))) || fallback || es);
  if (!es && !en) return null;
  const iso3 = String(query.iso3 || "").toUpperCase();
  return { code: valid ? code : "", iso3: /^[A-Z]{3}$/.test(iso3) ? iso3 : "", es: es || en, en: en || es };
}
const countryNames = c => [...new Set([c.en, c.es].filter(Boolean))];
const quote = s => /\s/.test(s) ? `"${s}"` : s;

/* Arma una búsqueda booleana: ("Germany" OR "Alemania") AND (politics OR ...) AND (tema) */
function boolQuery(ctx, { short = false } = {}) {
  const parts = [];
  if (ctx.country) parts.push(`(${countryNames(ctx.country).map(n => `"${n}"`).join(" OR ")})`);
  const cat = CATEGORIES[ctx.category];
  if (cat) {
    const words = short ? [...cat.en.slice(0, 3), ...cat.es.slice(0, 2)] : [...cat.en, ...cat.es];
    parts.push(`(${words.map(quote).join(" OR ")})`);
  }
  if (ctx.q) parts.push(`(${ctx.q})`);
  return parts.length ? parts.join(" AND ") : "(world OR international OR internacional)";
}

/* Recorta el rango de fechas a lo que una fuente permite (null = la fuente no cubre ese rango) */
function windowFor(ctx, maxDays) {
  const min = new Date(Date.now() - maxDays * DAY);
  if (ctx.to && ctx.to < min) return null;
  return { from: ctx.from ? (ctx.from < min ? min : ctx.from) : null, to: ctx.to };
}
const isRecentOnly = ctx => !ctx.from && !ctx.to;

/* ------------------------------------------------------------------ */
/* 4. Fuentes de noticias                                              */
/* ------------------------------------------------------------------ */
const P = Object.fromEntries(SOURCES.map(s => [s.id, s]));

async function pNewsApi(ctx) {
  const w = windowFor(ctx, 29);
  if (!w) return null;
  const params = new URLSearchParams({ q: boolQuery(ctx), sortBy: "publishedAt", pageSize: "60", apiKey: KEYS.newsapi });
  if (ctx.country) params.set("searchIn", "title,description");
  else params.set("domains", WORLD_DOMAINS.join(","));
  if (ctx.lang !== "all") params.set("language", ctx.lang);
  if (w.from) params.set("from", isoNoMs(w.from));
  if (w.to) params.set("to", isoNoMs(w.to));
  const d = await getJSON(`https://newsapi.org/v2/everything?${params}`);
  return (d.articles || []).filter(a => a.title !== "[Removed]").map(a => art(P.newsapi, {
    title: a.title, description: a.description, url: a.url, image: a.urlToImage, publishedAt: a.publishedAt,
    source: a.source?.name, author: a.author, lang: ctx.lang !== "all" ? ctx.lang : ""
  }));
}

async function pGNews(ctx) {
  const w = windowFor(ctx, 29);
  if (!w) return null;
  const params = new URLSearchParams({ q: boolQuery(ctx, { short: true }), max: "10", sortby: "publishedAt", apikey: KEYS.gnews });
  if (ctx.lang !== "all") params.set("lang", ctx.lang);
  if (w.from) params.set("from", isoNoMs(w.from));
  if (w.to) params.set("to", isoNoMs(w.to));
  const d = await getJSON(`https://gnews.io/api/v4/search?${params}`);
  if (d.errors) throw new Error(JSON.stringify(d.errors));
  return (d.articles || []).map(a => art(P.gnews, {
    title: a.title, description: a.description, url: a.url, image: a.image, publishedAt: a.publishedAt,
    source: a.source?.name, lang: a.lang || (ctx.lang !== "all" ? ctx.lang : "")
  }));
}

async function pCurrents(ctx) {
  const w = windowFor(ctx, 29);
  if (!w) return null;
  const params = new URLSearchParams({ apiKey: KEYS.currents });
  if (ctx.lang !== "all") params.set("language", ctx.lang);
  let endpoint = "latest-news";
  const kw = ctx.country ? (ctx.lang === "es" ? ctx.country.es : ctx.country.en) : "";
  if (kw || ctx.q || w.from || w.to) {
    endpoint = "search";
    const words = [kw, ctx.q].filter(Boolean).join(" ");
    if (words) params.set("keywords", words);
    if (w.from) params.set("start_date", isoNoMs(w.from));
    if (w.to) params.set("end_date", isoNoMs(w.to));
  }
  const d = await getJSON(`https://api.currentsapi.services/v1/${endpoint}?${params}`);
  if (d.status && d.status !== "ok") throw new Error(d.message || d.status);
  return (d.news || []).map(a => art(P.currents, {
    title: a.title, description: a.description, url: a.url, image: a.image === "None" ? null : a.image,
    publishedAt: a.published, source: hostName(a.url), author: a.author === "None" ? "" : a.author, lang: a.language
  }));
}

async function pNewsData(ctx) {
  // El plan gratis solo trae noticias recientes (sin archivo histórico)
  if (ctx.to && ctx.to < new Date(Date.now() - 2 * DAY)) return null;
  const params = new URLSearchParams({ apikey: KEYS.newsdata, size: "10" });
  if (ctx.country?.code) params.set("country", ctx.country.code.toLowerCase());
  else if (ctx.country) params.set("q", `"${ctx.country.en}"`);
  if (ctx.q) params.set("q", [params.get("q"), ctx.q].filter(Boolean).join(" AND "));
  if (ctx.lang !== "all") params.set("language", ctx.lang);
  const cat = CATEGORIES[ctx.category];
  if (cat) params.set("category", cat.newsdata);
  const d = await getJSON(`https://newsdata.io/api/1/latest?${params}`);
  if (d.status && d.status !== "success") throw new Error(d.results?.message || d.status);
  return (d.results || []).map(a => art(P.newsdata, {
    title: a.title, description: a.description, url: a.link, image: a.image_url, publishedAt: a.pubDate,
    source: a.source_name || a.source_id, author: a.creator, lang: a.language
  }));
}

async function pNewsApiAi(ctx) {
  const w = windowFor(ctx, 29);
  if (!w) return null;
  if (!ctx.country && !ctx.q) return null; // en la vista mundial ya hay suficientes fuentes
  const body = {
    action: "getArticles", resultType: "articles", articlesSortBy: "date", articlesCount: 40, articlesPage: 1,
    dataType: ["news"], apiKey: KEYS.newsapiai
  };
  if (ctx.country && ctx.q) { body.keyword = [ctx.country.en, ctx.q]; body.keywordOper = "and"; }
  else if (ctx.country) { body.keyword = countryNames(ctx.country); body.keywordOper = "or"; body.keywordLoc = "title"; }
  else body.keyword = ctx.q;
  body.lang = ctx.lang === "es" ? "spa" : ctx.lang === "en" ? "eng" : ["spa", "eng"];
  if (w.from) body.dateStart = ymd(w.from);
  if (w.to) body.dateEnd = ymd(w.to);
  const d = await getJSON("https://eventregistry.org/api/v1/article/getArticles", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (d.error) throw new Error(d.error);
  return (d.articles?.results || []).map(a => art(P.newsapiai, {
    title: a.title, description: a.body, url: a.url, image: a.image, publishedAt: a.dateTimePub || a.dateTime,
    source: a.source?.title, author: (a.authors || []).map(x => x.name), lang: a.lang
  }));
}

async function pGuardian(ctx) {
  if (ctx.lang === "es") return null; // The Guardian publica en inglés
  const params = new URLSearchParams({
    "order-by": "newest", "page-size": "40", "show-fields": "thumbnail,trailText,byline", "api-key": KEYS.guardian
  });
  if (ctx.country || ctx.q || ctx.category !== "Todos") params.set("q", boolQuery(ctx));
  else params.set("section", "world");
  if (ctx.from) params.set("from-date", ymd(ctx.from));
  if (ctx.to) params.set("to-date", ymd(ctx.to));
  const d = await getJSON(`https://content.guardianapis.com/search?${params}`);
  if (d.response?.status === "error") throw new Error(d.response.message);
  return (d.response?.results || []).map(a => art(P.guardian, {
    title: a.webTitle, description: a.fields?.trailText, url: a.webUrl, image: a.fields?.thumbnail,
    publishedAt: a.webPublicationDate, source: "The Guardian", author: a.fields?.byline, lang: "en"
  }));
}

function nytImage(m) {
  if (!m) return null;
  if (Array.isArray(m)) {
    const x = m.find(i => i.url);
    return x ? (/^https?:/.test(x.url) ? x.url : `https://static01.nyt.com/${x.url}`) : null;
  }
  return m.default?.url || m.thumbnail?.url || null;
}
async function pNyt(ctx) {
  if (ctx.lang === "es") return null; // The New York Times publica en inglés
  if (!ctx.country && !ctx.q && isRecentOnly(ctx)) return null; // ahorra cuota (5 consultas por minuto)
  const q = [ctx.country?.en, ctx.q].filter(Boolean).join(" ") || "international";
  const params = new URLSearchParams({ q, sort: "newest", "api-key": KEYS.nyt });
  if (ctx.from) params.set("begin_date", ymdCompact(ctx.from));
  if (ctx.to) params.set("end_date", ymdCompact(ctx.to));
  const d = await getJSON(`https://api.nytimes.com/svc/search/v2/articlesearch.json?${params}`);
  return (d.response?.docs || []).map(a => art(P.nyt, {
    title: a.headline?.main, description: a.abstract || a.snippet || a.lead_paragraph, url: a.web_url,
    image: nytImage(a.multimedia), publishedAt: a.pub_date, source: "The New York Times",
    author: a.byline?.original?.replace(/^By\s+/i, ""), lang: "en"
  }));
}

/* GDELT pide máximo una consulta cada 5 segundos: todas pasan por esta fila */
const gdeltQueue = { high: [], low: [] };
let gdeltBusy = false, gdeltLast = 0, gdeltGap = 5500, gdeltScheme = "https";
function gdeltFetch(url, priority = "high") {
  return new Promise((resolve, reject) => {
    gdeltQueue[priority].push({ url, resolve, reject, t: Date.now() });
    runGdelt();
  });
}
async function runGdelt() {
  if (gdeltBusy) return;
  gdeltBusy = true;
  try {
    while (gdeltQueue.high.length || gdeltQueue.low.length) {
      const wait = gdeltLast + gdeltGap - Date.now();
      if (wait > 0) await sleep(wait);
      const job = gdeltQueue.high.shift() || gdeltQueue.low.shift();
      if (Date.now() - job.t > 60000 && job.url.includes("maxrecords=75")) { job.reject(new Error("Consulta vencida")); continue; }
      gdeltLast = Date.now();
      try {
        let d;
        const url = gdeltScheme === "http" ? job.url.replace("https://", "http://") : job.url;
        try {
          d = await getJSON(url, { timeout: 9000 });
        } catch (e) {
          if (!e.network) throw e;
          const other = url.startsWith("https://") ? url.replace("https://", "http://") : url.replace("http://", "https://");
          d = await getJSON(other, { timeout: 9000 });
          gdeltScheme = other.startsWith("https://") ? "https" : "http";
        }
        gdeltGap = 5500;
        job.resolve(d);
      } catch (e) {
        if (/limit|429|too many/i.test(e.message)) gdeltGap = 12000;
        if (e.network) gdeltDownUntil = Date.now() + 10 * 60 * 1000;
        job.reject(e);
      }
    }
  } finally { gdeltBusy = false; }
}
function gdeltTerm(name) {
  const n = fold(name).replace(/[^A-Za-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return /\s/.test(n) ? `"${n}"` : n;
}
let gdeltDownUntil = 0;
async function pGdelt(ctx) {
  const w = windowFor(ctx, 89);
  if (!w) return null;
  if (Date.now() < gdeltDownUntil) return null; // no respondió hace poco: no hacemos esperar al usuario
  const parts = [];
  if (ctx.country) parts.push(gdeltTerm(ctx.country.en));
  const cat = CATEGORIES[ctx.category];
  if (cat) parts.push(`(${cat.en.map(quote).join(" OR ")})`);
  if (ctx.q) parts.push(/\s/.test(ctx.q) ? `"${fold(ctx.q)}"` : fold(ctx.q));
  if (!parts.length) parts.push("(diplomacy OR geopolitics OR international)");
  if (ctx.lang === "es") parts.push("sourcelang:spanish");
  if (ctx.lang === "en") parts.push("sourcelang:english");
  const params = new URLSearchParams({ query: parts.join(" "), mode: "ArtList", format: "json", maxrecords: "75", sort: "DateDesc" });
  if (w.from || w.to) {
    params.set("startdatetime", gdeltStamp(w.from || new Date(Date.now() - 89 * DAY)));
    params.set("enddatetime", gdeltStamp(w.to || new Date()));
  } else params.set("timespan", "3d");
  const d = await gdeltFetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, "high");
  return (d.articles || []).map(a => art(P.gdelt, {
    title: a.title, url: a.url, image: a.socialimage, publishedAt: a.seendate, source: a.domain, lang: a.language,
    description: `Nota publicada por ${a.domain}${a.sourcecountry ? ` (${a.sourcecountry})` : ""}. Encontrada por GDELT, que vigila la prensa de todo el mundo.`
  }));
}

async function pLoc(ctx) {
  // Chronicling America: periódicos de EE. UU. digitalizados entre 1756 y 1963
  if (!ctx.from || ctx.from.getUTCFullYear() > 1963) return null;
  const end = ctx.to && ctx.to < new Date("1963-12-31") ? ctx.to : new Date("1963-12-31");
  const words = ctx.q || ctx.country?.en || "world";
  const params = new URLSearchParams({
    qs: fold(words), ops: /\s/.test(words) ? "PHRASE" : "AND", dl: "page", start_date: ymd(ctx.from), end_date: ymd(end),
    fo: "json", c: "20", sb: "date_desc"
  });
  const d = await getJSON(`https://www.loc.gov/collections/chronicling-america/?${params}`, { timeout: 15000 });
  return (d.results || []).map(it => {
    const paper = String(it.partof_title?.[0] || it.title || "Periódico histórico").split(/\.\s|\s\[|\s\(/)[0].trim();
    const ocr = Array.isArray(it.description) ? it.description.join(" ") : (it.description || it.full_text || "");
    const idx = fold(ocr).toLowerCase().indexOf(fold(words).toLowerCase());
    const snippet = ocr ? clip((idx > 80 ? "…" : "") + ocr.slice(Math.max(0, idx - 80), Math.max(0, idx - 80) + 240), 240) : "";
    const url = String(it.url || it.id || "").replace(/^http:/, "https:");
    return art(P.loc, {
      title: `${paper}: página que menciona “${words}”`, url, image: Array.isArray(it.image_url) ? it.image_url[0] : it.image_url,
      publishedAt: it.date, source: paper, lang: "",
      description: snippet ? `Texto de la página: ${snippet}` : "Página digitalizada de un periódico histórico."
    });
  });
}

async function pWayback(ctx) {
  // Hemeroteca: cómo se veía la portada de los periódicos del país en la fecha elegida
  if (!ctx.from || ctx.from > new Date(Date.now() - 2 * DAY) || ctx.from.getUTCFullYear() < 1996) return null;
  const outlets = (ctx.country?.code && OUTLETS[ctx.country.code]) || (ctx.country ? [] : WORLD_OUTLETS);
  const dates = [ctx.from];
  if (ctx.to && ctx.to - ctx.from > 60 * DAY && ctx.to < new Date(Date.now() - 2 * DAY)) dates.push(ctx.to);
  const jobs = [];
  for (const [name, domain] of outlets.slice(0, 2)) for (const date of dates) jobs.push({ name, domain, date });
  const results = await Promise.allSettled(jobs.map(async j => {
    const d = await getJSON(`https://archive.org/wayback/available?url=${encodeURIComponent(j.domain)}&timestamp=${ymdCompact(j.date)}`);
    const snap = d.archived_snapshots?.closest;
    if (!snap?.available) return null;
    const when = toISO(snap.timestamp);
    if (!when || Math.abs(new Date(when) - j.date) > 120 * DAY) return null;
    return {
      title: `Portada de ${j.name}`, url: String(snap.url).replace(/^http:/, "https:"), image: null, publishedAt: when,
      source: j.name, description: `Así se veía ${j.domain} en esa fecha, guardada por Internet Archive.`,
      provider: "wayback", providerName: "Wayback Machine", kind: "archive", lang: ""
    };
  }));
  return results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value);
}

const NEWS_PROVIDERS = [
  { id: "newsapi", fn: pNewsApi },
  { id: "gnews", fn: pGNews },
  { id: "currents", fn: pCurrents, catFilter: true },
  { id: "newsdata", fn: pNewsData },
  { id: "newsapiai", fn: pNewsApiAi, catFilter: true },
  { id: "guardian", fn: pGuardian },
  { id: "nyt", fn: pNyt, catFilter: true },
  { id: "gdelt", fn: pGdelt },
  { id: "loc", fn: pLoc, catFilter: true }
];

function inferCategory(text) {
  for (const name of ["Ambientales", "Económicas", "Políticas", "Sociales"]) if (CATEGORIES[name].re.test(text)) return name;
  return "Internacional";
}
function hostName(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }
function normUrl(u) { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "").toLowerCase(); } catch { return u; } }
function normTitle(t) { return fold(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90); }

async function aggregate(ctx) {
  const active = NEWS_PROVIDERS.filter(p => isOn(p.id));
  const [settled, archive] = await Promise.all([
    Promise.allSettled(active.map(p => withTimeout(p.fn(ctx), p.id === "gdelt" ? 20000 : 15000))),
    ctx.from ? withTimeout(pWayback(ctx), 15000).catch(() => []) : Promise.resolve([])
  ]);

  const providers = [];
  let all = [];
  settled.forEach((r, i) => {
    const p = active[i];
    const info = { id: p.id, name: P[p.id].name };
    if (r.status === "rejected") { info.status = "error"; info.error = hideKeys(r.reason?.message); }
    else if (r.value === null) info.status = "skipped";
    else {
      let list = r.value.filter(Boolean);
      if (p.catFilter && CATEGORIES[ctx.category]) list = list.filter(a => CATEGORIES[ctx.category].re.test(`${a.title} ${a.description}`));
      info.status = "ok"; info.count = list.length;
      all = all.concat(list);
    }
    if (info.status !== "skipped") lastStatus[p.id] = { ...info, at: new Date().toISOString() };
    providers.push(info);
  });
  if (archive?.length) lastStatus.wayback = { id: "wayback", status: "ok", count: archive.length, at: new Date().toISOString() };

  const toEnd = ctx.to ? new Date(ctx.to.getTime()) : null;
  const seenUrl = new Set(), seenTitle = new Set();
  const articles = [];
  for (const a of all) {
    if (ctx.lang !== "all" && a.lang && a.lang !== ctx.lang) continue;
    const t = a.publishedAt ? new Date(a.publishedAt) : null;
    if ((ctx.from || ctx.to) && !t) continue;
    if (ctx.from && t < ctx.from) continue;
    if (toEnd && t > toEnd) continue;
    const u = normUrl(a.url), ti = normTitle(a.title);
    if (seenUrl.has(u) || (ti.length > 20 && seenTitle.has(ti))) continue;
    seenUrl.add(u); seenTitle.add(ti);
    a.category = a.category || (ctx.category !== "Todos" ? ctx.category : inferCategory(`${a.title} ${a.description}`));
    articles.push(a);
  }
  articles.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  return { articles: articles.slice(0, 200), archive: archive || [], providers };
}

/* ------------------------------------------------------------------ */
/* 5. Cobertura: qué países tienen noticias (para pintarlos en el mapa) */
/* ------------------------------------------------------------------ */
const COVERAGE_FILE = path.join(os.tmpdir(), "globalnews-coverage.json");
const COVERAGE_TTL = 12 * 3600 * 1000;
let coverage = {};
try { coverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, "utf8")); } catch { coverage = {}; }
let saveTimer = null;
function setCoverage(code, n, src) {
  if (!code) return;
  coverage[code] = { s: n > 0 ? "yes" : "no", n, at: Date.now(), src };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(COVERAGE_FILE, JSON.stringify(coverage), () => {}), 3000);
}

/* ------------------------------------------------------------------ */
/* 5b. Eventos GDELT: tensiones entre países                           */
/* ------------------------------------------------------------------ */
/*
 * GDELT publica cada 15 minutos un archivo con los eventos del mundo que
 * aparecieron en la prensa: quién hizo qué a quién. Cada evento trae:
 *   - el país de cada actor (código de 3 letras, p. ej. COL, VEN, USA)
 *   - QuadClass: 1 cooperación verbal, 2 cooperación material,
 *                3 conflicto verbal, 4 conflicto material
 *   - escala Goldstein: de -10 (conflicto) a +10 (cooperación)
 *   - cuántos artículos lo mencionaron
 * Para el historial se toma una muestra (1 archivo cada 2 horas) y desde que
 * el servidor arranca se suman todos los archivos nuevos.
 */
const zlib = require("zlib");
const EV_DAYS = Math.min(Math.max(Number(process.env.EVENT_DAYS || 30), 3), 60);
const SAMPLE_EVERY_H = 2;
const SAMPLE_WEIGHT = SAMPLE_EVERY_H * 4; // 1 de cada 8 archivos de 15 minutos
const EV_START = Date.now();
const evDays = new Map();       // "AAAAMMDD" -> { pairs: Map("COL|VEN" -> registro), countries: Map("COL" -> eventos) }
const evProcessed = new Set();
const evStatus = { loading: true, filesOk: 0, filesMissing: 0, filesFailed: 0, filesTotal: 0, lastFile: null, lastError: null };

function evDay(key) {
  let d = evDays.get(key);
  if (!d) { d = { pairs: new Map(), countries: new Map() }; evDays.set(key, d); }
  return d;
}

/* Abre un .zip de un solo archivo usando solo herramientas de Node */
function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP inválido");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error("ZIP inválido");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

function ingestEvents(text, weight, dayKey) {
  const day = evDay(dayKey);
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    if (line.length < 50) continue;
    const f = line.split("\t");
    if (f.length < 35) continue;
    const a = f[7], b = f[17];
    const validA = a && a.length === 3, validB = b && b.length === 3;
    if (validA) day.countries.set(a, (day.countries.get(a) || 0) + weight);
    if (validB && b !== a) day.countries.set(b, (day.countries.get(b) || 0) + weight);
    if (!validA || !validB || a === b) continue;
    const quad = f[29], g = parseFloat(f[30]);
    if (!Number.isFinite(g)) continue;
    const arts = Math.max(1, parseInt(f[33], 10) || 1);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let r = day.pairs.get(key);
    if (!r) { r = { n: 0, w: 0, wg: 0, wc: 0, wm: 0, u: [] }; day.pairs.set(key, r); }
    const w = arts * weight;
    r.n += weight; r.w += w; r.wg += w * g;
    if (quad === "3" || quad === "4") r.wc += w;
    if (quad === "4") r.wm += w;
    const url = f[f.length - 1];
    if (/^https?:\/\//.test(url)) {
      const score = arts * (quad === "3" || quad === "4" ? 2 : 1);
      if (r.u.length < 3 || score > r.u[r.u.length - 1][0]) {
        if (!r.u.some(x => x[1] === url)) {
          r.u.push([score, url.slice(0, 300), quad]);
          r.u.sort((x, y) => y[0] - x[0]);
          if (r.u.length > 3) r.u.length = 3;
        }
      }
    }
  }
}

function stampOf(t) { return new Date(t).toISOString().replace(/[-:T]/g, "").slice(0, 14); }
function stampTime(s) { return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)); }

async function loadEventFile(stamp, weight) {
  if (evProcessed.has(stamp)) return;
  evProcessed.add(stamp);
  try {
    let r;
    try {
      r = await fetch(`http://data.gdeltproject.org/gdeltv2/${stamp}.export.CSV.zip`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    } catch (e) { throw networkError(e); }
    if (r.status === 404) { evStatus.filesMissing++; return; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = unzipFirst(Buffer.from(await r.arrayBuffer())).toString("utf8");
    ingestEvents(text, weight, stamp.slice(0, 8));
    evStatus.filesOk++;
    if (!evStatus.lastFile || stamp > evStatus.lastFile) evStatus.lastFile = stamp;
  } catch (e) {
    evStatus.filesFailed++;
    evStatus.lastError = hideKeys(e.message);
    evProcessed.delete(stamp); // se puede reintentar después
  }
}

function pruneOldDays() {
  const keep = new Set(lastDayKeys(EV_DAYS + 1));
  for (const k of evDays.keys()) if (!keep.has(k)) evDays.delete(k);
}

async function backfillEvents() {
  const stamps = [];
  const cutoff = EV_START - 20 * 60 * 1000;
  for (let d = 0; d < EV_DAYS; d++) {
    const day = new Date(EV_START - d * DAY);
    for (let h = 24 - SAMPLE_EVERY_H; h >= 0; h -= SAMPLE_EVERY_H) {
      const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, 0);
      if (t <= cutoff) stamps.push(stampOf(t));
    }
  }
  stamps.sort().reverse(); // primero lo más reciente
  evStatus.filesTotal = stamps.length;
  let i = 0;
  const worker = async () => { while (i < stamps.length) await loadEventFile(stamps[i++], SAMPLE_WEIGHT); };
  await Promise.all([worker(), worker()]);
  // segundo intento para los que fallaron
  const failed = stamps.filter(s => !evProcessed.has(s));
  for (const s of failed) await loadEventFile(s, SAMPLE_WEIGHT);
  evStatus.loading = false;
  pruneOldDays();
}

async function pollLatestEvents() {
  try {
    let r;
    try { r = await fetch("http://data.gdeltproject.org/gdeltv2/lastupdate.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) }); }
    catch (e) { throw networkError(e); }
    const txt = await r.text();
    const m = txt.match(/(\d{14})\.export\.CSV\.zip/);
    if (m && stampTime(m[1]) >= EV_START - 20 * 60 * 1000) await loadEventFile(m[1], 1);
    pruneOldDays();
  } catch (e) { evStatus.lastError = hideKeys(e.message); }
}

function lastDayKeys(n, offset = 0) {
  const out = [];
  for (let d = offset; d < offset + n; d++) out.push(ymdCompact(new Date(Date.now() - d * DAY)));
  return out;
}
const daysWithData = () => [...evDays.values()].filter(d => d.pairs.size > 0).length;

function sumPairs(keys, filter) {
  const out = new Map();
  for (const k of keys) {
    const day = evDays.get(k);
    if (!day) continue;
    for (const [pair, r] of day.pairs) {
      if (filter && !filter(pair)) continue;
      let s = out.get(pair);
      if (!s) { s = { n: 0, w: 0, wg: 0, wc: 0, wm: 0 }; out.set(pair, s); }
      s.n += r.n; s.w += r.w; s.wg += r.wg; s.wc += r.wc; s.wm += r.wm;
    }
  }
  return out;
}

/* Índice de tensión 0-100 (se explica en la app, botón "¿Cómo se calcula?") */
function tensionOf(r) {
  if (!r || !r.w) return null;
  const conflict = r.wc / r.w, material = r.wm / r.w, goldstein = r.wg / r.w;
  const gScore = Math.min(1, Math.max(0, (3 - goldstein) / 10));
  const index = Math.round(100 * (0.4 * conflict + 0.3 * Math.min(1, material * 2) + 0.3 * gScore));
  return { index, level: levelOf(index), goldstein: +goldstein.toFixed(2), conflict: +conflict.toFixed(3), material: +material.toFixed(3), events: Math.round(r.n) };
}
function levelOf(i) { return i >= 65 ? "critica" : i >= 45 ? "tension" : i >= 25 ? "roces" : "estable"; }
const minEvents = days => Math.max(15, days * 4);

function eventsStatus() {
  return {
    loading: evStatus.loading, days: daysWithData(), daysTarget: EV_DAYS,
    filesOk: evStatus.filesOk, filesTotal: evStatus.filesTotal, lastFile: evStatus.lastFile && toISO(evStatus.lastFile),
    lastError: evStatus.lastError
  };
}

/* Arranca la descarga apenas inicia el servidor */
setTimeout(() => { pollLatestEvents(); backfillEvents(); }, 3000);
setInterval(pollLatestEvents, 15 * 60 * 1000);

/* ------------------------------------------------------------------ */
/* 6. Datos de contexto del país                                       */
/* ------------------------------------------------------------------ */
async function wikiSummary(c) {
  for (const [lang, title] of [["es", c.es], ["en", c.en]]) {
    try {
      const d = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
      if (d.extract && d.type !== "disambiguation") {
        return { title: d.title, extract: clip(d.extract, 520), image: d.thumbnail?.source || null, url: d.content_urls?.desktop?.page || null, lang };
      }
    } catch { /* se intenta con el otro idioma */ }
  }
  return null;
}

const WB_INDICATORS = { population: "SP.POP.TOTL", gdp: "NY.GDP.MKTP.CD", gdpPerCapita: "NY.GDP.PCAP.CD", inflation: "FP.CPI.TOTL.ZG" };
async function worldBank(c) {
  const id = c.iso3 || c.code;
  if (!id) return null;
  const out = {};
  await Promise.all(Object.entries(WB_INDICATORS).map(async ([k, ind]) => {
    try {
      const d = await getJSON(`https://api.worldbank.org/v2/country/${id}/indicator/${ind}?format=json&mrnev=1`);
      const row = Array.isArray(d) && Array.isArray(d[1]) ? d[1].find(r => r.value !== null) : null;
      if (row) out[k] = { value: row.value, year: row.date };
    } catch { /* indicador no disponible */ }
  }));
  return Object.keys(out).length ? out : null;
}

async function comtradeReporters() {
  const hit = cacheGet("comtrade-reporters");
  if (hit) return hit;
  const d = await getJSON("https://comtradeapi.un.org/files/v1/app/reference/Reporters.json");
  const list = (d.results || []).filter(r => !r.isGroup);
  cacheSet("comtrade-reporters", list, 7 * DAY);
  return list;
}
/* ---------- UN Comtrade: comercio por socio, historia y productos ---------- */
const ctBase = () => KEYS.comtrade ? "https://comtradeapi.un.org/data/v1/get/C/A/HS" : "https://comtradeapi.un.org/public/v1/preview/C/A/HS";
const ctHeaders = () => KEYS.comtrade ? { "Ocp-Apim-Subscription-Key": KEYS.comtrade } : {};
let ctChain = Promise.resolve();
/* Nombres en español de los capítulos del Sistema Armonizado (HS) */
const HS_ES = {"1": "Animales vivos", "2": "Carne", "3": "Pescados y mariscos", "4": "Lácteos, huevos y miel", "5": "Otros productos de origen animal", "6": "Flores y plantas vivas", "7": "Hortalizas", "8": "Frutas y frutos secos", "9": "Café, té y especias", "10": "Cereales", "11": "Harinas y almidones", "12": "Semillas oleaginosas", "13": "Gomas y resinas vegetales", "14": "Otros productos vegetales", "15": "Grasas y aceites", "16": "Preparaciones de carne y pescado", "17": "Azúcar y confitería", "18": "Cacao y sus preparaciones", "19": "Productos de panadería y cereales", "20": "Conservas de frutas y hortalizas", "21": "Preparaciones alimenticias diversas", "22": "Bebidas y alcohol", "23": "Alimentos para animales", "24": "Tabaco", "25": "Sal, piedra y cemento", "26": "Minerales metálicos", "27": "Petróleo, carbón y combustibles", "28": "Químicos inorgánicos", "29": "Químicos orgánicos", "30": "Productos farmacéuticos", "31": "Abonos", "32": "Tintas y pinturas", "33": "Perfumes y cosméticos", "34": "Jabones y detergentes", "35": "Proteínas y colas", "36": "Explosivos", "37": "Productos fotográficos", "38": "Productos químicos diversos", "39": "Plásticos", "40": "Caucho", "41": "Cueros", "42": "Artículos de cuero", "43": "Peletería", "44": "Madera", "45": "Corcho", "46": "Cestería", "47": "Pasta de papel", "48": "Papel y cartón", "49": "Libros e impresos", "50": "Seda", "51": "Lana", "52": "Algodón", "53": "Otras fibras vegetales", "54": "Filamentos sintéticos", "55": "Fibras sintéticas", "56": "Guata y cordelería", "57": "Alfombras", "58": "Tejidos especiales", "59": "Telas técnicas", "60": "Tejidos de punto", "61": "Ropa de punto", "62": "Ropa (excepto de punto)", "63": "Otros textiles", "64": "Calzado", "65": "Sombreros", "66": "Paraguas", "67": "Plumas y flores artificiales", "68": "Manufacturas de piedra", "69": "Cerámica", "70": "Vidrio", "71": "Oro, piedras y metales preciosos", "72": "Hierro y acero", "73": "Manufacturas de hierro y acero", "74": "Cobre", "75": "Níquel", "76": "Aluminio", "78": "Plomo", "79": "Zinc", "80": "Estaño", "81": "Otros metales", "82": "Herramientas", "83": "Manufacturas de metal", "84": "Maquinaria", "85": "Aparatos eléctricos y electrónicos", "86": "Trenes", "87": "Vehículos y autopartes", "88": "Aeronaves", "89": "Barcos", "90": "Instrumentos ópticos y médicos", "91": "Relojes", "92": "Instrumentos musicales", "93": "Armas y municiones", "94": "Muebles", "95": "Juguetes y deportes", "96": "Manufacturas diversas", "97": "Obras de arte", "99": "Otros"};
/* Comtrade limita las consultas por segundo: se hacen de una en una */
function ctGet(params) {
  const run = async () => {
    await sleep(1100);
    const q = new URLSearchParams({ partner2Code: "0", customsCode: "C00", motCode: "0", includeDesc: "true", ...params });
    const d = await getJSON(`${ctBase()}?${q}`, { headers: ctHeaders(), timeout: 25000 });
    if (d.error) throw new Error(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
    return d.data || [];
  };
  const p = ctChain.then(run, run);
  ctChain = p.catch(() => {});
  return p;
}
async function comtradePartners() {
  const hit = cacheGet("comtrade-partners");
  if (hit) return hit;
  const d = await getJSON("https://comtradeapi.un.org/files/v1/app/reference/partnerAreas.json");
  const map = new Map();
  for (const r of d.results || []) {
    map.set(Number(r.id ?? r.PartnerCode), {
      name: r.text || r.PartnerDesc, isGroup: Boolean(r.isGroup),
      iso3: r.PartnerCodeIsoAlpha3 || r.partnerCodeIsoAlpha3 || ""
    });
  }
  cacheSet("comtrade-partners", map, 7 * DAY);
  return map;
}
async function reporterCodeFor(c) {
  if (!c || (!c.code && !c.iso3)) return null;
  const reporters = await comtradeReporters();
  const rep = reporters.find(r => (c.iso3 && r.reporterCodeIsoAlpha3 === c.iso3) || (c.code && r.reporterCodeIsoAlpha2 === c.code));
  return rep ? (rep.reporterCode ?? rep.id) : null;
}
const NOT_COUNTRY = /\bnes\b|n\.e\.s|bunkers|free zones|special categories|not specified|areas,/i;

/* Todo el comercio de un país: totales de 10 años, socios y productos del último año */
async function tradeData(c) {
  const key = "trade:" + (c.iso3 || c.code);
  const hit = cacheGet(key);
  if (hit) return hit;
  const code = await reporterCodeFor(c);
  if (!code) return null;
  const y = new Date().getFullYear();
  const years = Array.from({ length: 10 }, (_, i) => y - 1 - i);
  const hist = await ctGet({ reporterCode: String(code), period: years.join(","), partnerCode: "0", flowCode: "X,M", cmdCode: "TOTAL" });
  const byYear = new Map();
  for (const r of hist) {
    const yr = Number(r.period);
    const e = byYear.get(yr) || { year: yr, exports: null, imports: null };
    if (r.flowCode === "X") e.exports = r.primaryValue;
    if (r.flowCode === "M") e.imports = r.primaryValue;
    byYear.set(yr, e);
  }
  const history = [...byYear.values()].sort((a, b) => a.year - b.year);
  const latest = [...history].reverse().find(h => h.exports != null);
  if (!latest) return null;
  const out = { year: latest.year, exports: latest.exports, imports: latest.imports, history, partnersX: [], partnersM: [], products: [] };

  try {
    const [rows, areas] = await Promise.all([
      ctGet({ reporterCode: String(code), period: String(latest.year), flowCode: "X,M", cmdCode: "TOTAL" }),
      comtradePartners().catch(() => new Map())
    ]);
    for (const r of rows) {
      const pc = Number(r.partnerCode);
      if (!pc) continue; // 0 = Mundo
      const info = areas.get(pc) || {};
      let name = r.partnerDesc || info.name || String(pc), iso3 = r.partnerISO || info.iso3 || "";
      if (pc === 490) { name = "Taiwan"; iso3 = "TWN"; } // Comtrade lo llama "Other Asia, nes"
      else if (info.isGroup || NOT_COUNTRY.test(name)) continue;
      if (!/^[A-Z]{3}$/.test(iso3)) continue;
      const item = { iso3, name, value: r.primaryValue };
      if (r.flowCode === "X") out.partnersX.push(item);
      if (r.flowCode === "M") out.partnersM.push(item);
    }
    const finish = (list, total) => list.sort((a, b) => b.value - a.value).map(p => ({ ...p, share: total ? p.value / total : null }));
    out.partnersX = finish(out.partnersX, out.exports);
    out.partnersM = finish(out.partnersM, out.imports);
  } catch (e) { out.partnersError = hideKeys(e.message); }

  try {
    const t = await ctGet({ reporterCode: String(code), period: String(latest.year), partnerCode: "0", flowCode: "X", cmdCode: "AG2" });
    out.products = t.filter(r => r.cmdCode !== "TOTAL").sort((a, b) => b.primaryValue - a.primaryValue).slice(0, 10)
      .map(r => ({ code: r.cmdCode, name: HS_ES[Number(r.cmdCode)] || String(r.cmdDesc || r.cmdCode).split(";")[0], value: r.primaryValue, share: out.exports ? r.primaryValue / out.exports : null }));
  } catch (e) { out.productsError = hideKeys(e.message); }

  cacheSet(key, out, DAY);
  return out;
}
/* Resumen corto para la ficha del país */
async function comtrade(c) {
  const t = await tradeData(c);
  return t ? { year: t.year, exports: t.exports, imports: t.imports, topExports: t.products.slice(0, 3) } : null;
}

/* ---------- Banco Mundial: series históricas ---------- */
const WB_SERIES = {
  gdp:        { id: "NY.GDP.MKTP.CD",    label: "PIB",                    unit: "usd" },
  growth:     { id: "NY.GDP.MKTP.KD.ZG", label: "Crecimiento del PIB",    unit: "pct" },
  gdppc:      { id: "NY.GDP.PCAP.CD",    label: "PIB por persona",        unit: "usd" },
  inflation:  { id: "FP.CPI.TOTL.ZG",    label: "Inflación",              unit: "pct" },
  military:   { id: "MS.MIL.XPND.GD.P",  label: "Gasto militar (% del PIB)", unit: "pct" },
  unemployment: { id: "SL.UEM.TOTL.ZS",  label: "Desempleo",              unit: "pct" }
};
async function wbSeries(iso3s, ind) {
  const def = WB_SERIES[ind];
  const key = `wb:${ind}:${iso3s.join(";")}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const y = new Date().getFullYear();
  const d = await getJSON(`https://api.worldbank.org/v2/country/${iso3s.join(";")}/indicator/${def.id}?format=json&date=1995:${y}&per_page=1000`);
  if (!Array.isArray(d) || !Array.isArray(d[1])) throw new Error(d?.[0]?.message?.[0]?.value || "Sin datos del Banco Mundial");
  const series = {};
  for (const r of d[1]) {
    if (r.value === null) continue;
    const c = r.countryiso3code || r.country?.id;
    (series[c] = series[c] || []).push({ year: Number(r.date), value: r.value });
  }
  for (const c in series) series[c].sort((a, b) => a.year - b.year);
  const out = { ind, label: def.label, unit: def.unit, series };
  cacheSet(key, out, DAY);
  return out;
}

/* ------------------------------------------------------------------ */
/* 7. Rutas                                                            */
/* ------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname, "public")));

/* Para cron-job.org: lo visita cada 10 minutos y así Render no apaga la app */
app.get("/api/ping", (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));

/* Página de diagnóstico: prueba la conexión con cada servicio y muestra la causa de los errores */
let diagRunning = false;
app.get("/api/diagnostico", async (req, res) => {
  if (diagRunning) return res.send("<p>Ya hay un diagnóstico en curso. Espera 30 segundos y recarga.</p>");
  diagRunning = true;
  const rows = [];
  async function test(name, fn) {
    const t = Date.now();
    try { rows.push([name, "OK", await fn(), Date.now() - t]); }
    catch (e) { rows.push([name, "ERROR", hideKeys(e.message), Date.now() - t]); }
  }
  async function getText(url) {
    let r;
    try { r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw networkError(e); }
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 100)}`);
    return text;
  }
  const doc = "api.gdeltproject.org/api/v2/doc/doc?query=Colombia&mode=ArtList&format=json&maxrecords=5&timespan=1d";
  try {
    await test("GDELT noticias (https)", async () => `${(JSON.parse(await getText("https://" + doc)).articles || []).length} noticias`);
    await sleep(6000);
    await test("GDELT noticias (http)", async () => `${(JSON.parse(await getText("http://" + doc)).articles || []).length} noticias`);
    await test("GDELT eventos (http)", async () => (await getText("http://data.gdeltproject.org/gdeltv2/lastupdate.txt")).split("\n")[0].slice(0, 90));
    await test("GDELT eventos (https)", async () => (await getText("https://data.gdeltproject.org/gdeltv2/lastupdate.txt")).split("\n")[0].slice(0, 90));
    if (KEYS.currents) {
      await test("Currents: búsqueda Colombia", async () => `${(await getJSON(`https://api.currentsapi.services/v1/search?keywords=Colombia&apiKey=${KEYS.currents}`)).news?.length ?? "?"} noticias`);
      await test("Currents: últimas en español", async () => `${(await getJSON(`https://api.currentsapi.services/v1/latest-news?language=es&apiKey=${KEYS.currents}`)).news?.length ?? "?"} noticias`);
    }
    if (KEYS.newsapiai) {
      const er = body => getJSON("https://eventregistry.org/api/v1/article/getArticles", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getArticles", resultType: "articles", articlesCount: 10, apiKey: KEYS.newsapiai, ...body }) });
      await test("NewsAPI.ai: Colombia simple", async () => { const d = await er({ keyword: "Colombia" }); if (d.error) throw new Error(d.error); return `${d.articles?.results?.length ?? "?"} noticias`; });
      await test("NewsAPI.ai: Colombia en títulos", async () => { const d = await er({ keyword: ["Colombia"], keywordOper: "or", keywordLoc: "title", lang: ["spa", "eng"] }); if (d.error) throw new Error(d.error); return `${d.articles?.results?.length ?? "?"} noticias`; });
    }
  } finally { diagRunning = false; }
  const esc = s => String(s).replace(/[&<>]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagnóstico</title>
<body style="background:#06131f;color:#edf3f7;font-family:system-ui,sans-serif;padding:20px"><h2>Diagnóstico de conexiones</h2>
<p style="color:#9eb0be">Node ${process.version} · ${new Date().toISOString()} · GDELT usa: ${gdeltScheme}</p>
<table style="border-collapse:collapse;font-size:13px">${rows.map(r => `<tr><td style="padding:8px;border-bottom:1px solid #284154">${esc(r[0])}</td><td style="padding:8px;border-bottom:1px solid #284154;color:${r[1] === "OK" ? "#6fd39b" : "#d98b83"}">${r[1]}</td><td style="padding:8px;border-bottom:1px solid #284154">${esc(r[2])}</td><td style="padding:8px;border-bottom:1px solid #284154;color:#9eb0be">${r[3]} ms</td></tr>`).join("")}</table></body>`);
});

app.get("/api/config", (req, res) => {
  res.json({
    sources: SOURCES.map(s => ({
      id: s.id, name: s.name, type: s.type, env: s.env,
      needsKey: Boolean(s.env), configured: isOn(s.id) && (!s.env || Boolean(KEYS[s.id])),
      last: lastStatus[s.id] || null
    })),
    active: SOURCES.filter(s => !s.env || KEYS[s.id]).length
  });
});

function parseDate(s, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
  const d = new Date(`${s}T${endOfDay ? "23:59:59" : "00:00:00"}Z`);
  return isNaN(d) ? null : d;
}

app.get("/api/news", async (req, res) => {
  try {
    const country = req.query.code || req.query.name ? countryFrom(req.query) : null;
    let from = parseDate(req.query.from, false), to = parseDate(req.query.to, true);
    if (from && to && from > to) [from, to] = [parseDate(req.query.to, false), parseDate(req.query.from, true)];
    if (to && to > new Date()) to = null;
    const ctx = {
      country,
      category: CATEGORIES[req.query.category] ? req.query.category : "Todos",
      q: cleanText(req.query.q || "").slice(0, 80),
      lang: ["es", "en"].includes(req.query.language) ? req.query.language : "all",
      from, to
    };
    const key = JSON.stringify([country?.code || country?.en, ctx.category, ctx.q, ctx.lang, from && ymd(from), to && ymd(to)]);
    let result = cacheGet(key);
    if (!result) {
      result = await aggregate(ctx);
      const ok = result.providers.some(p => p.status === "ok");
      if (ok) cacheSet(key, result, isRecentOnly(ctx) ? 15 * 60 * 1000 : 6 * 3600 * 1000);
      if (ok && country?.code && isRecentOnly(ctx) && !ctx.q && ctx.category === "Todos" && ctx.lang === "all") {
        setCoverage(country.code, result.articles.length, "busqueda");
      } else if (country?.code && result.articles.length) {
        setCoverage(country.code, result.articles.length, "busqueda");
      }
    }
    res.json({
      country, range: { from: from && ymd(from), to: to && ymd(to) },
      total: result.articles.length, articles: result.articles, archive: result.archive, providers: result.providers,
      coverage: country?.code ? coverage[country.code] || null : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", message: "No fue posible consultar las noticias en este momento." });
  }
});

const validCode3 = s => /^[A-Z]{3}$/.test(String(s || "").toUpperCase());

app.get("/api/coverage", (req, res) => {
  const counts = {};
  for (const k of lastDayKeys(7)) {
    const d = evDays.get(k);
    if (d) for (const [c, n] of d.countries) counts[c] = (counts[c] || 0) + n;
  }
  for (const c in counts) counts[c] = Math.round(counts[c]);
  res.json({ coverage, events: counts, eventsReady: daysWithData() > 0, status: eventsStatus() });
});

/* Termómetro de un país: con quién tiene relación y qué tan tensa */
app.get("/api/tensiones", (req, res) => {
  const code = String(req.query.code || "").toUpperCase();
  if (!validCode3(code)) return res.status(400).json({ error: "Código de país no válido" });
  const days = req.query.days === "30" ? 30 : 7;
  const has = p => p.startsWith(code + "|") || p.endsWith("|" + code);
  const now = sumPairs(lastDayKeys(days), has);
  const before = sumPairs(lastDayKeys(days, days), has);
  const total = { n: 0, w: 0, wg: 0, wc: 0, wm: 0 };
  const partners = [];
  for (const [pair, r] of now) {
    for (const k of ["n", "w", "wg", "wc", "wm"]) total[k] += r[k];
    if (r.n < minEvents(days)) continue;
    const other = pair.split("|").find(x => x !== code);
    const t = tensionOf(r);
    const prev = before.get(pair);
    const p = prev && prev.n >= minEvents(days) / 2 ? tensionOf(prev) : null;
    partners.push({ code: other, ...t, change: p ? t.index - p.index : null });
  }
  partners.sort((a, b) => b.events - a.events);
  res.json({ code, days, overall: total.n ? tensionOf(total) : null, partners: partners.slice(0, 18), status: eventsStatus() });
});

/* Ranking mundial de relaciones más tensas y más cooperativas */
app.get("/api/calientes", (req, res) => {
  const days = req.query.days === "30" ? 30 : 7;
  const now = sumPairs(lastDayKeys(days));
  const before = sumPairs(lastDayKeys(days, days));
  const min = days * 25;
  const list = [];
  for (const [pair, r] of now) {
    if (r.n < min) continue;
    const t = tensionOf(r);
    const prev = before.get(pair);
    const p = prev && prev.n >= min / 2 ? tensionOf(prev) : null;
    const [a, b] = pair.split("|");
    list.push({ a, b, ...t, change: p ? t.index - p.index : null });
  }
  const hot = list.filter(x => x.index >= 25).sort((x, y) => y.index - x.index || y.events - x.events).slice(0, 40);
  const calm = list.filter(x => x.index < 25).sort((x, y) => x.index - y.index || y.events - x.events).slice(0, 25);
  res.json({ days, hot, calm, status: eventsStatus() });
});

/* Historia de una relación: día por día */
app.get("/api/relacion", (req, res) => {
  const a = String(req.query.a || "").toUpperCase(), b = String(req.query.b || "").toUpperCase();
  if (!validCode3(a) || !validCode3(b) || a === b) return res.status(400).json({ error: "Elige dos países distintos" });
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  const keys = lastDayKeys(EV_DAYS).reverse();
  const series = [];
  const total = { n: 0, w: 0, wg: 0, wc: 0, wm: 0 };
  for (const k of keys) {
    const day = evDays.get(k);
    if (!day || !day.pairs.size) continue;
    const r = day.pairs.get(key);
    const date = `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
    if (!r) { series.push({ date, events: 0, index: null }); continue; }
    for (const f of ["n", "w", "wg", "wc", "wm"]) total[f] += r[f];
    const t = tensionOf(r);
    series.push({ date, events: t.events, index: r.n >= 3 ? t.index : null, level: t.level, goldstein: t.goldstein,
      sources: r.u.map(x => ({ url: x[1], conflict: x[2] === "3" || x[2] === "4" })) });
  }
  const last7 = tensionOf(sumPairs(lastDayKeys(7), p => p === key).get(key));
  const peaks = series.filter(s => s.index !== null && s.events >= 5).sort((x, y) => y.index - x.index).slice(0, 3)
    .map(s => ({ date: s.date, index: s.index, level: s.level, events: s.events, sources: s.sources }));
  res.json({ a, b, days: series.length, summary: total.n ? tensionOf(total) : null, last7, series: series.map(({ sources, ...s }) => s), peaks, status: eventsStatus() });
});


/* ---------- Datos para gráficas ---------- */
app.get("/api/serie", async (req, res) => {
  const ind = WB_SERIES[req.query.ind] ? req.query.ind : "gdp";
  const iso3s = String(req.query.iso3 || "").toUpperCase().split(",").filter(validCode3).slice(0, 4);
  if (!iso3s.length) return res.status(400).json({ error: "Falta el país" });
  try { res.json(await wbSeries(iso3s, ind)); }
  catch (e) { res.status(502).json({ error: hideKeys(e.message) }); }
});

app.get("/api/comercio", async (req, res) => {
  const c = countryFrom(req.query);
  if (!c) return res.status(400).json({ error: "País no válido" });
  try {
    const t = await tradeData(c);
    if (!t) return res.json({ country: c, trade: null });
    lastStatus.comtrade = { id: "comtrade", status: "ok", count: t.partnersX.length, at: new Date().toISOString() };
    res.json({ country: c, trade: { ...t, partnersX: t.partnersX.slice(0, 15), partnersM: t.partnersM.slice(0, 15) } });
  } catch (e) {
    lastStatus.comtrade = { id: "comtrade", status: "error", error: hideKeys(e.message), at: new Date().toISOString() };
    res.status(502).json({ error: hideKeys(e.message) });
  }
});

/* "Si se pelean, ¿quién pierde más?": qué parte de sus exportaciones manda cada uno al otro */
app.get("/api/dependencia", async (req, res) => {
  const A = countryFrom({ code: req.query.acode, iso3: req.query.a }), B = countryFrom({ code: req.query.bcode, iso3: req.query.b });
  if (!A || !B || !A.iso3 || !B.iso3) return res.status(400).json({ error: "Faltan los países" });
  try {
    const ta = await tradeData(A);
    if (!ta || !ta.partnersX.length) return res.json({ available: false });
    const xAB = ta.partnersX.find(p => p.iso3 === B.iso3)?.value || 0;
    const mAB = ta.partnersM.find(p => p.iso3 === B.iso3)?.value || 0; // lo que A le compra a B = lo que B le vende a A
    let tb = null;
    try { tb = await tradeData(B); } catch { tb = null; }
    const shareA = ta.exports ? xAB / ta.exports : null;
    const shareB = tb?.exports ? mAB / tb.exports : null;
    res.json({
      available: true, year: ta.year,
      a: { iso3: A.iso3, exportsTo: xAB, totalExports: ta.exports, share: shareA, importsFrom: mAB, importShare: ta.imports ? mAB / ta.imports : null },
      b: { iso3: B.iso3, exportsTo: mAB, totalExports: tb?.exports ?? null, share: shareB, year: tb?.year ?? null },
      balance: xAB - mAB
    });
  } catch (e) { res.status(502).json({ error: hideKeys(e.message) }); }
});

/* Clima internacional de un país día por día (índice de tensión con todos sus socios) */
app.get("/api/clima", (req, res) => {
  const code = String(req.query.code || "").toUpperCase();
  if (!validCode3(code)) return res.status(400).json({ error: "Código no válido" });
  const has = p => p.startsWith(code + "|") || p.endsWith("|" + code);
  const series = [];
  for (const k of lastDayKeys(EV_DAYS).reverse()) {
    const day = evDays.get(k);
    if (!day || !day.pairs.size) continue;
    const tot = { n: 0, w: 0, wg: 0, wc: 0, wm: 0 };
    for (const [pair, r] of day.pairs) if (has(pair)) for (const f of ["n", "w", "wg", "wc", "wm"]) tot[f] += r[f];
    const t = tot.n >= 5 ? tensionOf(tot) : null;
    series.push({ date: `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`, events: Math.round(tot.n), index: t ? t.index : null, level: t ? t.level : null });
  }
  res.json({ code, series, status: eventsStatus() });
});

app.get("/api/country", async (req, res) => {
  const c = countryFrom(req.query);
  if (!c) return res.status(400).json({ error: "País no válido" });
  const key = "country:" + (c.code || c.en);
  const hit = cacheGet(key);
  if (hit) return res.json(hit);
  const [wiki, indicators, trade] = await Promise.allSettled([wikiSummary(c), worldBank(c), comtrade(c)]);
  const out = {
    country: c,
    wiki: wiki.value || null,
    indicators: indicators.value || null,
    trade: trade.value || null
  };
  if (trade.status === "rejected") lastStatus.comtrade = { id: "comtrade", status: "error", error: hideKeys(trade.reason?.message), at: new Date().toISOString() };
  else if (trade.value) lastStatus.comtrade = { id: "comtrade", status: "ok", count: 1, at: new Date().toISOString() };
  if (wiki.value) lastStatus.wikipedia = { id: "wikipedia", status: "ok", count: 1, at: new Date().toISOString() };
  if (indicators.value) lastStatus.worldbank = { id: "worldbank", status: "ok", count: Object.keys(indicators.value).length, at: new Date().toISOString() };
  if (wiki.value || indicators.value || trade.value) cacheSet(key, out, DAY);
  res.json(out);
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  const n = SOURCES.filter(s => !s.env || KEYS[s.id]).length;
  console.log(`Global News v3 funcionando en http://localhost:${PORT} con ${n} de ${SOURCES.length} fuentes activas`);
});
