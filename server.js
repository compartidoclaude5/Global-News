const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";

const ALLOWED_DOMAINS = [
  "bbc.com","bbc.co.uk","cnn.com","forbes.com","infobae.com","nytimes.com",
  "reuters.com","apnews.com","aljazeera.com","dw.com","france24.com",
  "theguardian.com","washingtonpost.com","elpais.com","eltiempo.com",
  "elespectador.com","caracol.com.co","semana.com","bloomberg.com"
];

const CATEGORY_QUERIES = {
  Todos: "",
  Ambientales: "climate OR environment OR biodiversity OR pollution OR deforestation",
  Políticas: "politics OR government OR election OR diplomacy OR geopolitics",
  Económicas: "economy OR markets OR inflation OR trade OR business",
  Sociales: "society OR education OR health OR migration OR human rights"
};

app.use(express.static(path.join(__dirname, "public")));

function domainsParam() {
  return ALLOWED_DOMAINS.join(",");
}

function cleanText(s = "") {
  return String(s).replace(/[<>]/g, "").trim();
}

app.get("/api/config", (req,res) => {
  res.json({
    configured: Boolean(NEWS_API_KEY),
    provider: "News API",
    domains: ALLOWED_DOMAINS
  });
});

app.get("/api/news", async (req,res) => {
  try {
    if (!NEWS_API_KEY) {
      return res.status(503).json({
        error: "NEWS_API_KEY no configurada",
        message: "Configura NEWS_API_KEY en el archivo .env para activar noticias en tiempo real."
      });
    }

    const country = cleanText(req.query.country || "");
    const category = cleanText(req.query.category || "Todos");
    const q = cleanText(req.query.q || "");
    const language = ["es","en"].includes(req.query.language) ? req.query.language : undefined;
    const pageSize = Math.min(Math.max(Number(req.query.pageSize || 30), 1), 100);

    const queryParts = [];
    if (country) queryParts.push(`"${country}"`);
    if (CATEGORY_QUERIES[category]) queryParts.push(`(${CATEGORY_QUERIES[category]})`);
    if (q) queryParts.push(`(${q})`);

    const query = queryParts.length
      ? queryParts.join(" AND ")
      : "world OR international";

    const params = new URLSearchParams({
      q: query,
      domains: domainsParam(),
      sortBy: "publishedAt",
      pageSize: String(pageSize),
      page: "1",
      apiKey: NEWS_API_KEY
    });
    if (language) params.set("language", language);

    const response = await fetch(`https://newsapi.org/v2/everything?${params}`);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.code || "news_api_error",
        message: data.message || "News API devolvió un error."
      });
    }

    const articles = (data.articles || [])
      .filter(a => a.title && a.url)
      .map(a => ({
        id: `${a.source?.id || a.source?.name}-${a.publishedAt}-${a.url}`,
        source: a.source?.name || "Fuente desconocida",
        author: a.author || "",
        title: a.title,
        description: a.description || "Consulta la noticia completa en el medio original.",
        url: a.url,
        image: a.urlToImage || null,
        publishedAt: a.publishedAt,
        category: inferCategory(a.title + " " + (a.description || "")),
        country: country || "Mundo"
      }));

    res.json({ totalResults: data.totalResults || articles.length, articles });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "server_error",
      message: "No fue posible consultar las noticias en este momento."
    });
  }
});

function inferCategory(text) {
  const t = text.toLowerCase();
  if (/(climate|environment|biodiversity|pollution|deforestation|clima|ambient|bosque|contamin)/.test(t)) return "Ambientales";
  if (/(politic|election|government|diplomacy|geopolit|polít|elección|gobierno|diplom)/.test(t)) return "Políticas";
  if (/(econom|market|inflation|trade|business|economía|mercado|inflación|comercio|empresa)/.test(t)) return "Económicas";
  return "Sociales";
}

app.get("/{*splat}", (req,res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Global News V2 funcionando en http://localhost:${PORT}`);
});
