const CHART_INDICATORS = [
  { id: "ind-hr",   label: "HR",      max: 140, min_ok: 60, max_ok: 100 },
  { id: "ind-spo2", label: "SpO₂",    max: 100, min_ok: 95, max_ok: 100 },
  { id: "ind-glu",  label: "Glucose", max: 160, min_ok: 70, max_ok: 100 },
  { id: "ind-bp",   label: "BP",      max: 160, min_ok: 90, max_ok: 120 },
];

// Llamar otra vez cada vez que cambien los valores de la lista
function renderIndicatorsChart() {
  const box = document.getElementById("barras");
  if (!box) return;
  box.innerHTML = CHART_INDICATORS.map((c) => {
    const el = document.getElementById(c.id);
    const value = el ? parseFloat(el.textContent) : NaN;
    if (isNaN(value)) {
      return `<div class="barra-g"><span class="v">--</span><div class="col"></div><span class="l">${c.label}</span></div>`;
    }
    const pct = Math.min(100, (value / c.max) * 100);
    const ok = value >= c.min_ok && value <= c.max_ok;
    return `
      <div class="barra-g">
        <span class="v">${value}</span>
        <div class="col"><div class="fill ${ok ? "ok" : "warn"}" style="height:${pct}%"></div></div>
        <span class="l">${c.label}</span>
      </div>`;
  }).join("");
}

renderIndicatorsChart();