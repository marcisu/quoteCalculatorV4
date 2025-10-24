"use strict";

// ===== Config =====
var CURRENCY_SYMBOL = "USD$"; // Can change to "USD $", "€"...
var currencySel = document.getElementById("currencySel");
var CURRENT_CURRENCY = "USD";

if (currencySel) {
    currencySel.addEventListener("change", function () {
        CURRENT_CURRENCY = currencySel.value;
        CURRENCY_SYMBOL = (CURRENT_CURRENCY === "CAD") ? "CAD$" : "USD$";
        // // Re-run calculation to refresh UI with new currency
        // var res = calculate();
        // if (res.ok) updateTotalUI(res);

        // Reset everything when currency changes
        resetAllQuoteUI();

        // Also reset the total display
        if (totalEl) {
            totalEl.textContent = fmtMoney(0);
        }

        // Ensure additions label updates to the new currency symbol
        if (typeof updateAdjustmentsDisplay === "function") {
            updateAdjustmentsDisplay();
        }
    });
}

// Discount tiers as NET multipliers after discount, in basis points (1 bp = 0.0001)
// e.g. 0.71 => 7100 (71.00%)
var DISCOUNT_BPS = {
    "TierA": 7100,  // 29% off
    "TierB": 7800,  // 22% off
    "TierC": 8500,  // 15% off
    "TierD": 9200,  // 8% off
    "TierE": 6500,  // 35% off
    "None":  10000  // No discount
};

// ===== DOM =====
var form      = document.getElementById("quote-form");
var listInput = document.getElementById("list-price");
var cylInput  = document.getElementById("cylinder");
var tierSel   = document.getElementById("discount");
var totalEl   = document.getElementById("total");

// ===== Utility functions =====
function isFiniteNumber(n) {
    return typeof n === "number" && isFinite(n);
}

function addCommas(x) {
    var parts = (x + "").split(".");
    var integer = parts[0];
    var fraction = "";
    if (parts.length > 1) {
        fraction = parts[1];
    }
    var sign = "";

    if (integer.charAt(0) === "-") { 
        sign = "-"; integer = integer.slice(1); 
    }
    var out = "";
    var count = 0;
    for (var i = integer.length - 1; i >= 0; i--) {
        out = integer.charAt(i) + out;
        count++;
        if (count % 3 === 0 && i !== 0) {
            out = "," + out;
        }
    }
    if (fraction !== "") { 
        out = out + "." + fraction; 
    }
    return sign + out;
}

// Format number as money string with 2 decimal places and currency symbol
function fmtMoney(n) {
    var v;
    if (isFiniteNumber(n)) { 
        v = n; 
    } else { 
        v = 0; 
    }
    var s = v.toFixed(2);
    return CURRENCY_SYMBOL + addCommas(s);
}

// Convert to cents safely
function toCents(n) {
    return Math.round(n * 100);
}

// Convert from cents to dollars float
function fromCents(c) {
    return c / 100;
}

// Get discount basis points from key
function getDiscountBps(key) {
    if (DISCOUNT_BPS.hasOwnProperty(key)) { 
        return DISCOUNT_BPS[key]; 
    }
    return NaN;
}


// --- Manual adjustments UI & logic ---
function parseAdjAmountRaw(v) {
    const n = parseFloat(String(v).trim());
    return Number.isFinite(n) ? n : 0;
}

function getAdjustmentsCents() {
    const nodes = document.querySelectorAll(".adj-amount");
    let sumC = 0;
    nodes.forEach(n => {
        const val = parseAdjAmountRaw(n.value);
        sumC += Math.round(val * 100);
    });
    return sumC;
}

function updateAdjustmentsDisplay() {
    const totalC = getAdjustmentsCents();
    const total = fromCents(totalC);
    const el = document.getElementById("adjustmentsTotal");
    if (el) el.textContent = "Additions: " + fmtMoney(total);
}

// Can I remove style inline here??****
// function createAdjustmentRow(amount, desc) {
//     const list = document.getElementById("adjustmentsList");
//     if (!list) return;
//     const row = document.createElement("div");
//     row.style.display = "flex";
//     row.style.gap = "6px";
//     row.style.alignItems = "center";
//     row.innerHTML = `
//       <input class="adj-amount" type="number" step="0.01" placeholder="0.00" value="${(isFinite(amount)?Number(amount).toFixed(2):"")}" style="width:110px;height:34px;padding:6px"/>
//       <button type="button" class="adj-remove" title="Remove">✕</button>
//     `;
//     list.appendChild(row);

//     const amt = row.querySelector(".adj-amount");
//     const rm  = row.querySelector(".adj-remove");
//     amt.addEventListener("input", updateAdjustmentsDisplay);
//     rm.addEventListener("click", () => { row.remove(); updateAdjustmentsDisplay(); });
//     updateAdjustmentsDisplay();
// }

function createAdjustmentRow(amount, desc) {
    const list = document.getElementById("adjustmentsList");
    if (!list) return;
    const row = document.createElement("div");
    row.className = "adj-row";
    row.innerHTML = `
      <input class="adj-amount" type="number" step="0.01" placeholder="0.00" value="${(isFinite(amount)?Number(amount).toFixed(2):"")}" />
      <button type="button" class="adj-remove" title="Remove">✕</button>
    `;
    list.appendChild(row);

    const amt = row.querySelector(".adj-amount");
    const rm  = row.querySelector(".adj-remove");
    amt.addEventListener("input", updateAdjustmentsDisplay);
    // rm.addEventListener("click", () => { row.remove(); updateAdjustmentsDisplay(); });
    // remove row, update display and recalc
    rm.addEventListener("click", () => {
        row.remove();
        updateAdjustmentsDisplay();
        if (form && typeof form.checkValidity === "function" && form.checkValidity()) {
            const res = calculate();
            if (res.ok) updateTotalUI(res);
        }
    });
    updateAdjustmentsDisplay();
}

// remove all manual-addition rows
function clearAdjustments() {
    const list = document.getElementById("adjustmentsList");
    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    updateAdjustmentsDisplay();
}

// Wire add button in init()
function initAdjustments() {
    const addBtn = document.getElementById("addAdjustment");
    if (addBtn) {
        addBtn.addEventListener("click", () => createAdjustmentRow("", ""));
    }
    updateAdjustmentsDisplay();
}

// ===== Core calculations =====
function calculate() {
    var list = parseFloat(listInput.value);
    if (isNaN(list)) {
        return { ok: false, message: "Enter a valid list price." };
    }

    var rawCyl = parseFloat(cylInput.value);
    var cyl = isNaN(rawCyl) ? 0 : rawCyl;

    var rateKey = "";
    if (tierSel && typeof tierSel.value === "string") {
        rateKey = tierSel.value;
    }
    var bps = getDiscountBps(rateKey);
    if (!isFiniteNumber(bps)) {
        return { ok: false, message: "Choose a discount tier." };
    }

    // Work in cents
    var listC = toCents(list);
    var cylC  = toCents(cyl);
    var subtotalC = listC + cylC;

    // Apply discount in basis points, then ceil to whole dollars
    // X = subtotalC * bps
    // We want ceil( X / 1,000,000 ) where denom = 10000 (bps) * 100 (cents per dollar)
    var X = subtotalC * bps;
    var denom = 1000000;
    var totalDollars = Math.floor((X + denom - 1) / denom);

    // Convert rounded base dollars back to cents
    var baseCents = totalDollars * 100;

    // Add manual adjustments (in cents) AFTER base rounding
    var adjCents = (typeof getAdjustmentsCents === "function") ? getAdjustmentsCents() : 0;

    // Final amount in cents (preserve cents from adjustments)
    var finalCents = baseCents + adjCents;

    return {
        ok: true,
        subtotal: fromCents(subtotalC),
        rate: bps / 10000,
        // return final as dollars (may include cents from adjustments)
        total: fromCents(finalCents)
    };


    // return { 
    //     ok: true, 
    //     subtotal: fromCents(subtotalC), 
    //     rate: bps / 10000, 
    //     total: totalDollars 
    // };
}

// Update total in the UI
function updateTotalUI(result) {
    if (!result || !result.ok) {
        if (result && result.message && window && window.console) {
            console.warn(result.message);
        }
        return;
    }
    if (totalEl) {
        totalEl.textContent = fmtMoney(result.total);
    }
}

// ===== Events =====
// // Attach live updates to inputs (uncomment to enable live updates)
// function attachLiveUpdates() {
//     var inputs = [listInput, cylInput, tierSel];
//     for (var i = 0; i < inputs.length; i++) {
//         var el = inputs[i];
//         if (!el) { continue; }
//         var evt;
//         if (el.tagName && el.tagName.toUpperCase() === 'SELECT') {
//             evt = 'change';
//         } else {
//             evt = 'input';
//         }
//         el.addEventListener(evt, function () {
//         if (!form) { return; }
//         // Only compute when constraints pass (required fields present)
//         if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
//             return;
//         }
//         var res = calculate();
//         if (res.ok) { updateTotalUI(res); }
//         });
//     }
// }

function onSubmit(e) {
    if (e && e.preventDefault) { 
        e.preventDefault(); 
    }
    if (!form) { 
        return; 
    }

    // Native constraint validation
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
        if (typeof form.reportValidity === 'function') {
            form.reportValidity();
        } else {
            var firstInvalid = null;
            if (form.querySelector) { firstInvalid = form.querySelector(':invalid'); }
            if (firstInvalid && typeof firstInvalid.focus === 'function') {
                firstInvalid.focus();
            }
            alert('Please fill in the required fields.');
        }
        return;
    }

    var res = calculate();
    if (!res.ok) {
        alert(res.message);
        return;
    }
    updateTotalUI(res);
}

// Clear total on form reset
function onReset() {
    setTimeout(function () {
        // clear manual-addition rows too
        clearAdjustments();
        if (totalEl) { totalEl.textContent = fmtMoney(0); }
    }, 0);
}

// ===== Init =====
function init() {
    if (totalEl) { 
        totalEl.textContent = fmtMoney(0); 
    }
    if (form) {
        form.addEventListener('submit', onSubmit);
        form.addEventListener('reset', onReset);
    }
    initAdjustments();
    // Uncomment to enable live updates
    // attachLiveUpdates();
}

// Initialise on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
