// --- CSV parser (semicolon + quotes, double-quote escaping) ---
function parseCSV(text, delimiter = ";") {
  const rows = [];
  let cell = "", row = [], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; } }
      else { cell += ch; }
    } else {
      if (ch === '"') q = true;
      else if (ch === delimiter) { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") { cell += ch; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }

  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1)
    .filter(r => r && r.some(c => String(c).trim() !== ""))
    .map(r => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] ?? "").trim(); });
      return o;
    });
}

// --- State ---
window.priceRows = [];        // non-cylinder rows used by main selectors
window.cylRows   = [];        // only cylinder rows

const mainPriceIndex = new Map();  // "Size¦Series¦Material¦Seat" -> raw Price (non-cylinder)
const cylPriceIndex  = new Map();  // "Size" -> raw Price (cylinder)
const mainNoteIndex = new Map(); // "Size¦Series¦Material¦Seat" -> Notes
const cylNoteIndex  = new Map(); // "CylinderSize" (or "Type¦Size") -> Notes

// --- DOM ---
const sizeSel       = document.getElementById("sizeSel");
const seriesSel     = document.getElementById("seriesSel");
const materialSel   = document.getElementById("materialSel");
const seatSel       = document.getElementById("seatSel");
const csvInput      = document.getElementById("csvFile");
const cylinderSel   = document.getElementById("cylinderSel");
const noteBox = document.getElementById("noteBox");
const noteBox2 = document.getElementById("noteBox2");


// --- Helpers ---
const get = (r, k) => String(r[k] ?? r[k.toLowerCase()] ?? "").trim();

const isCylinderSeries = s => /\bcyl(?:inder)?\.?\b/i.test(String(s || "")); // matches "cyl", "cyl.", "cylinder"

const toNum = s => {
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const numAwareSort = (a, b) => {
  const na = toNum(a), nb = toNum(b);
  return na != null && nb != null
    ? na - nb
    : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
};
const uniq = arr => [...new Set(arr)];

function setOptions(sel, values, ph) {
  sel.innerHTML =
    `<option value="">${ph || "— Select —"}</option>` +
    values.map(v => `<option>${v}</option>`).join("");
}

// Build options for a column with optional filters, using a specific rows array
function optionsFor(rows, key, filter) {
  let src = rows;
  if (filter) {
    src = src.filter(r =>
      Object.entries(filter).every(([k, v]) => !v || get(r, k) === String(v).trim())
    );
  }
  return uniq(src.map(r => get(r, key))).filter(Boolean).sort(numAwareSort);
}

// Money-like string -> number
function parsePriceToNumber(v) {
    let s = String(v || "").trim();
    if (!s) return NaN;
    s = s.replace(/[^\d.,-]/g, "");
    const hasComma = s.includes(","), hasDot = s.includes(".");
    if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
    else if (hasComma)      s = s.replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : NaN;
}

function buildMainIndex() {
    mainPriceIndex.clear();
    mainNoteIndex.clear();
    for (const r of window.priceRows) {
        const key = ["Size", "Series", "Material", "Seat"].map(k => get(r, k)).join("¦");
        mainPriceIndex.set(key, {
            USD: get(r, "Price") || "",
            CAD: get(r, "PriceCAD") || ""
        });
        const note  = get(r, "Note") || r.notes || "";
        mainNoteIndex.set(key, note);
    }
}

function buildCylIndex() {
    cylPriceIndex.clear();
    cylNoteIndex.clear();

    for (const r of window.cylRows) {
        const size = get(r, "Size");
        if (!size) continue;

        const usd = get(r, "Price") || "";
        const cad = get(r, "PriceCAD") || "";
        const rawPrice = { USD: usd, CAD: cad };
        const note     = (get(r, "Note") || r.notes || "").trim();

        // Keep the first seen price for a given size
        if (!cylPriceIndex.has(size)) {
            cylPriceIndex.set(size, rawPrice);
        }

        // Prefer the first non-empty note for a given size
        if (!cylNoteIndex.has(size) || (!cylNoteIndex.get(size) && note)) {
            cylNoteIndex.set(size, note);
        }
    }
}

// --- Price updaters ---
function updateMainPrice() {
    if (!sizeSel.value || !seriesSel.value || !materialSel.value || !seatSel.value) {
        listInput.value = ""; return;
    }
    const k = [sizeSel.value, seriesSel.value, materialSel.value, seatSel.value].join("¦");
    const entry = mainPriceIndex.get(k);
    const raw = entry ? entry[CURRENT_CURRENCY] : "";
    const n = parsePriceToNumber(raw);
    listInput.value = Number.isFinite(n) ? n.toFixed(2) : "";
    // listInput.dispatchEvent(new Event("input", { bubbles: true })); // optional live total
}

function updateCylinderPrice() {
    if (!cylinderSel.value) { cylInput.value = ""; return; }
    const entry = cylPriceIndex.get(cylinderSel.value);
    const raw = entry ? entry[CURRENT_CURRENCY] : "";
    const n = parsePriceToNumber(raw);
    cylInput.value = Number.isFinite(n) ? n.toFixed(2) : "";
}

function updateMainNote() {
    if (!noteBox) return;

    // No full selection = clear
    if (!sizeSel.value || !seriesSel.value || !materialSel.value || !seatSel.value) {
        noteBox.textContent = "";
        noteBox.style.color = ""; // back to CSS default
        return;
    }

    const k = [sizeSel.value, seriesSel.value, materialSel.value, seatSel.value].join("¦");
    const note = (mainNoteIndex.get(k) || "").trim();

    noteBox.textContent = note;
    // Red if there's a note, default color otherwise
    noteBox.style.color = note ? "#c00" : "";
}

function updateCylinderNote() {
    if (!noteBox2 || !cylinderSel) return;

    // No selection or "None" selected => clear
    const sel = (cylinderSel.value || "").trim();
    if (!sel || sel.toLowerCase() === "none") {
        noteBox2.textContent = "";
        noteBox2.style.color = "";
        return;
    }

    // If you have both type + size, build the key from both:
    // const type = (cylTypeSel?.value || "").trim();
    // const size = (cylSizeSel?.value || "").trim();
    // const key  = `${type}¦${size}`;

    const key  = sel; // single size selector
    const note = (cylNoteIndex.get(key) || "").trim();

    noteBox2.textContent = note;
    noteBox2.style.color = note ? "#c00" : ""; // red if present
}


// --- Wiring ---
document.addEventListener("DOMContentLoaded", () => {
    if (!csvInput) return;

    csvInput.addEventListener("change", async e => {
        const f = e.target.files?.[0]; if (!f) return;

        const all = parseCSV(await f.text());
        // Split rows: main vs cylinder
        window.priceRows = all.filter(r => !isCylinderSeries(get(r, "Series")));
        window.cylRows   = all.filter(r =>  isCylinderSeries(get(r, "Series")));

        buildMainIndex();
        buildCylIndex();

        // Main selectors use non-cylinder rows only
        setOptions(sizeSel,     optionsFor(window.priceRows, "Size"), "— Select —");
        setOptions(seriesSel,   [], "— Select —");
        setOptions(materialSel, [], "— Select —");
        setOptions(seatSel,     [], "— Select —");
        listInput.value = "";

        // Cylinder selector uses cylinder rows (by Size)
        if (cylinderSel) {
            setOptions(cylinderSel, optionsFor(window.cylRows, "Size"), "— No Cylinder —");
            cylinderSel.value = "";           // default to None
            cylInput.value = "";              // clear price
        }
    });

    // Main cascade (unchanged logic, but based on priceRows only)
    sizeSel.addEventListener("change", () => {
        setOptions(seriesSel,   optionsFor(window.priceRows, "Series",   { Size: sizeSel.value }), "— Select —");
        setOptions(materialSel, [], "— Select —");
        setOptions(seatSel,     [], "— Select —");
        listInput.value = "";
        updateMainNote(); // clears
    });

    seriesSel.addEventListener("change", () => {
        setOptions(materialSel, optionsFor(window.priceRows, "Material", { Size: sizeSel.value, Series: seriesSel.value }), "— Select —");
        setOptions(seatSel,     [], "— Select —");
        listInput.value = "";
        updateMainNote(); // clears
    });

    materialSel.addEventListener("change", () => {
        setOptions(seatSel,     optionsFor(window.priceRows, "Seat", { Size: sizeSel.value, Series: seriesSel.value, Material: materialSel.value }), "— Select —");
        listInput.value = "";
        updateMainNote(); // clears
    });

    seatSel.addEventListener("change", () => {
        updateMainPrice();
        updateMainNote();
    });

    // Cylinder selector
    if (cylinderSel) {
        cylinderSel.addEventListener("change", () => {
            updateCylinderPrice();
            updateCylinderNote();
        });
    }

    const form = document.getElementById("quote-form");
    if (form) {
        form.addEventListener("reset", () => {
            // let the browser clear inputs first
            setTimeout(resetAllQuoteUI, 0);
        });
    }
});


function resetAllQuoteUI() {
    // Rebuild main selectors from current, already-loaded non-cylinder rows
    setOptions(sizeSel,     optionsFor(window.priceRows, "Size"), "— Select —");
    setOptions(seriesSel,   [],                                   "— Select —");
    setOptions(materialSel, [],                                   "— Select —");
    setOptions(seatSel,     [],                                   "— Select —");

    // Rebuild cylinder selector from cylinder rows
    if (cylinderSel) {
        setOptions(cylinderSel, optionsFor(window.cylRows, "Size"), "— No Cylinder —");
        cylinderSel.value = ""; // default to “No Cylinder”
    }

    // Clear numeric inputs (form reset will clear them too, this is just explicit)
    if (typeof listInput !== "undefined") listInput.value = "";
    if (typeof cylInput  !== "undefined") cylInput.value  = "";

    // Reset discount tier to placeholder
    const tierSel = document.getElementById("discount");
    if (tierSel) {
        tierSel.selectedIndex = 0;               // pick the first option (the placeholder)
        tierSel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (noteBox) {
        noteBox.textContent = "";
        noteBox.style.color = "";
    }

    if (noteBox2) {
        noteBox2.textContent = "";
        noteBox2.style.color = "";
    }
}
