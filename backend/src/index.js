const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const { createWorker } = require("tesseract.js");

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

const app = express();
app.use(cors({ origin: true }));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

/**
 * Fixed exchange rate (BGN per 1 EUR)
 * Officially: 1 EUR = 1.95583 BGN
 */
const RATE = 1.95583;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeNumberToken(token) {
  let t = String(token).trim();
  t = t.replace(/\s/g, "");

  // Keep only digits and separators
  t = t.replace(/[^0-9.,]/g, "");

  if (!t) return "";

  const hasDot = t.includes(".");
  const hasComma = t.includes(",");

  // If both separators appear, assume last one is decimal separator, the other is thousands.
  if (hasDot && hasComma) {
    const lastDot = t.lastIndexOf(".");
    const lastComma = t.lastIndexOf(",");
    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    t = t.split(thouSep).join("");
    // Replace decimal with '.'
    const idx = t.lastIndexOf(decSep);
    if (idx !== -1) t = t.slice(0, idx) + "." + t.slice(idx + 1);
  } else {
    // Single separator type: treat ',' as decimal
    t = t.replace(/,/g, ".");
    // If more than one '.', treat all but last as thousands separators
    const parts = t.split(".");
    if (parts.length > 2) {
      const dec = parts.pop();
      t = parts.join("") + "." + dec;
    }
  }

  // Remove leading zeros (but keep "0.x")
  if (/^0+\d/.test(t) && !/^0\./.test(t)) {
    t = t.replace(/^0+/, "");
  }

  return t;
}

function extractAmounts(text) {
  const raw = String(text || "");
  const tokens = raw.match(/[0-9][0-9.,\s]{0,15}[0-9]/g) || [];
  const seen = new Set();
  const amounts = [];

  for (const tok of tokens) {
    const norm = normalizeNumberToken(tok);
    if (!norm) continue;

    const val = Number.parseFloat(norm);
    if (!Number.isFinite(val)) continue;

    // Filter out obviously wrong values
    if (val <= 0 || val >= 100000) continue;

    // Avoid too many duplicates (e.g., "1" repeated)
    const key = val.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);

    // Score heuristic: prefer values with 2 decimals and typical price ranges
    const hasDecimals = /\.\d{1,2}$/.test(norm) ? 1 : 0;
    const inTypicalRange = val >= 0.2 && val <= 5000 ? 1 : 0;
    const tokenLen = Math.min(norm.length, 10) / 10;

    const score = hasDecimals * 2 + inTypicalRange * 2 + tokenLen;

    amounts.push({ value: val, normalized: norm, score });
  }

  amounts.sort((a, b) => b.score - a.score || b.value - a.value);
  return amounts.slice(0, 8);
}

// --- OCR worker singleton (simple queue) ---
let workerPromise = null;
let queue = Promise.resolve();

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng"); // digits are enough for price tags
      await worker.setParameters({
        tessedit_char_whitelist: "0123456789.,",
        preserve_interword_spaces: "1",
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function runOcr(buffer) {
  const worker = await getWorker();
  // Serialize recognition calls to avoid concurrency issues on low-memory devices
  queue = queue.then(async () => {
    const res = await worker.recognize(buffer);
    return res;
  });
  return queue;
}

// Health + rate endpoints
app.get("/api/health", (req, res) => {
  res.json({ ok: true, rate: RATE });
});

app.get("/api/convert", (req, res) => {
  const amount = Number(req.query.amount);
  const from = String(req.query.from || "BGN").toUpperCase();
  if (!Number.isFinite(amount)) {
    return res.status(400).json({ error: "Invalid amount" });
  }
  if (from !== "BGN" && from !== "EUR") {
    return res.status(400).json({ error: "from must be BGN or EUR" });
  }
  const eur = from === "BGN" ? amount / RATE : amount;
  const bgn = from === "EUR" ? amount * RATE : amount;
  res.json({ rate: RATE, amount, from, bgn: round2(bgn), eur: round2(eur) });
});

/**
 * POST /api/ocr
 * multipart/form-data with field "image"
 * Returns best candidate amount(s) extracted from the picture.
 */
app.post("/api/ocr", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing image file (field name: image)" });

    // Basic preprocessing: rotate using EXIF, resize, grayscale, normalize contrast
    const pre = await sharp(req.file.buffer)
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .toBuffer();

    const result = await runOcr(pre);
    const text = result?.data?.text || "";
    const confidence = result?.data?.confidence ?? null;

    const amounts = extractAmounts(text);
    const best = amounts.length ? amounts[0].value : null;

    res.json({
      ok: true,
      rate: RATE,
      confidence,
      bestAmount: best,
      candidates: amounts.map(a => ({ value: a.value, normalized: a.normalized })),
      rawText: text
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "OCR failed", details: String(e?.message || e) });
  }
});

process.on("SIGINT", async () => {
  try {
    if (workerPromise) {
      const w = await workerPromise;
      await w.terminate();
    }
  } catch {}
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/api/health`);
  console.log(`   OCR:      POST http://localhost:${PORT}/api/ocr (multipart field: image)`);
});
