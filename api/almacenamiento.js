// Cambia esto:
// const axios = require("axios");
// ...
// module.exports = async (req, res) => { ... }

// Por esto:
import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import tough from "tough-cookie";
import cheerio from "cheerio";

export default async function handler(req, res) {
  try {
    // --- CONFIG / desde ENV (configurar en Vercel) ---
    const PROVIDER_LOGIN_URL = process.env.PROVIDER_LOGIN_URL || "http://jotakp.dyndns.org/loginext.aspx";
    const USER = process.env.PROVIDER_USER;          // tu usuario (setear en Vercel)
    const PASS = process.env.PROVIDER_PASS;          // tu pass (setear en Vercel)
    const CLOUDINARY_BASE = process.env.CLOUDINARY_BASE; // e.g. https://res.cloudinary.com/tuusuario/image/upload/almacenamiento/
    const CATEGORIES = [
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=14",
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=69",
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=157",
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=156",
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=12",
      "http://jotakp.dyndns.org/buscar.aspx?idsubrubro1=5"
    ];

    if (!USER || !PASS) {
      return res.status(500).json({ error: "Falta PROVIDER_USER o PROVIDER_PASS en las env vars." });
    }
    if (!CLOUDINARY_BASE) {
      return res.status(500).json({ error: "Falta CLOUDINARY_BASE en las env vars." });
    }

    // --- axios con cookie jar ---
    const jar = new tough.CookieJar();
    const client = wrapper(axios.create({
      withCredentials: true,
      jar,
      headers: { "User-Agent": "TopGamingScraper/1.0 (+https://topgaming.example)" },
      timeout: 20000
    }));

    // --- login y scraping ---
    const getLoginPage = await client.get(PROVIDER_LOGIN_URL);
    const $login = cheerio.load(getLoginPage.data);

    const viewstate = $login("input[name=__VIEWSTATE]").attr("value") || "";
    const viewstateGenerator = $login("input[name=__VIEWSTATEGENERATOR]").attr("value") || "";
    const eventValidation = $login("input[name=__EVENTVALIDATION]").attr("value") || "";

    const qs = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k])).join("&");

    const payload = {
      "__VIEWSTATE": viewstate,
      "__VIEWSTATEGENERATOR": viewstateGenerator,
      "__EVENTVALIDATION": eventValidation,
      "TxtEmail": USER,
      "TxtPass1": PASS,
      "BtnIngresar": "Ingresar"
    };

    await client.post(PROVIDER_LOGIN_URL, qs(payload), {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": PROVIDER_LOGIN_URL },
      maxRedirects: 5
    });

    const productos = [];
    for (const catUrl of CATEGORIES) {
      try {
        const page = await client.get(catUrl, { headers: { Referer: PROVIDER_LOGIN_URL } });
        const $ = cheerio.load(page.data);

        $("article").each((i, el) => {
          const art = $(el);
          const aHref = art.find("a").first().attr("href") || "";
          const idMatch = aHref.match(/id=(\d+)/);
          if (!idMatch) return;
          const id = idMatch[1];
          const nombre = art.find(".tg-article-txt").first().text().trim() || null;
          let arsText = art.find(".tg-body-f10").first().text() || "";
          const arsMatch = arsText.match(/\$\s*([\d\.\,]+)/);
          let precioARS = null;
          if (arsMatch) precioARS = parseFloat(arsMatch[1].replace(/\./g, "").replace(",", "."));
          if (!nombre || !precioARS) return;

          const conIVA = precioARS * 1.21;
          const precioFinal = Math.round(conIVA * 1.35);
          const imagen = `${CLOUDINARY_BASE}almacenamiento-${id}.jpg`;

          productos.push({ id, nombre, precioARSProveedor: precioARS, precioFinal, imagen, categoriaFuente: catUrl });
        });
      } catch (errCat) {
        console.error("Error leyendo categoría:", catUrl, errCat.message || errCat);
      }
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=120");
    return res.json(productos);

  } catch (err) {
    console.error("ERROR API:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "Error interno", detail: err.message || String(err) });
  }
      }
