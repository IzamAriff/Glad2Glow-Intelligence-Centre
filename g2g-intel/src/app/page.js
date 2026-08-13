"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
} from "chart.js";
import annotationPlugin from "chartjs-plugin-annotation";
import { Bar, Scatter } from "react-chartjs-2";
import { jsPDF } from "jspdf";
import { ensureG2G, isG2G } from "@/lib/g2gCatalog";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  Tooltip,
  Legend,
  Title,
  annotationPlugin
);

const CACHE_KEY = "g2g-intel-cache-v3";
const KEYS_KEY = "g2g-api-keys";
const THEME_KEY = "g2g-theme";
const SKUS = [
  { id: "serum", label: "Serum" },
  { id: "moisturizer", label: "Moisturizer" },
  { id: "sunscreen", label: "Sunscreen" },
  { id: "cleanser", label: "Cleanser" },
  { id: "toner", label: "Toner" },
];

function loadKeys() {
  if (typeof window === "undefined") return { openai: "", gemini: "", search: "" };
  try {
    return { openai: "", gemini: "", search: "", ...JSON.parse(localStorage.getItem(KEYS_KEY) || "{}") };
  } catch {
    return { openai: "", gemini: "", search: "" };
  }
}

function statsFor(sku) {
  if (!sku) return null;
  const prices = sku.competitors.map((c) => Number(c.price)).filter((n) => !Number.isNaN(n));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const g2g = Number(sku.g2gPrice);
  const below = ((avg - g2g) / avg) * 100;
  const belowCount = prices.filter((p) => p < g2g).length;
  const percentile = Math.round((belowCount / prices.length) * 100);
  return { min, max, avg, median, g2g, below, percentile };
}

export default function Home() {
  const [tab, setTab] = useState("trend");
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usedCache, setUsedCache] = useState(false);
  const [trend, setTrend] = useState(null);
  const [price, setPrice] = useState(null);
  const [skuId, setSkuId] = useState("serum");
  const [calc, setCalc] = useState({ cogs: 5.2, fee: 8, ads: 12, margin: 62, testPrice: 15 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keys, setKeys] = useState({ openai: "", gemini: "", search: "" });
  const loaded = useRef(false);

  useEffect(() => {
    setKeys(loadKeys());
    const t = localStorage.getItem(THEME_KEY);
    if (t === "dark") setDark(true);
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached?.trend && cached?.price) {
        setTrend(cached.trend);
        setPrice(ensureG2G(cached.price));
        setUsedCache(true);
      }
    } catch {
      /* ignore */
    }
    loaded.current = true;
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  const headers = useCallback(() => {
    const h = { "Content-Type": "application/json" };
    if (keys.openai) h["x-openai-key"] = keys.openai;
    if (keys.gemini) h["x-gemini-key"] = keys.gemini;
    if (keys.search) h["x-search-key"] = keys.search;
    return h;
  }, [keys]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    setUsedCache(false);
    try {
      const [tRes, pRes] = await Promise.all([
        fetch("/api/trend-scan", { method: "POST", headers: headers() }),
        fetch("/api/price-review", { method: "POST", headers: headers() }),
      ]);
      const tJson = await tRes.json();
      const pJson = await pRes.json();
      if (!tRes.ok && !tJson.trends) throw new Error(tJson.error || "Trend agent failed");
      if (!pRes.ok && !pJson.skus) throw new Error(pJson.error || "Price agent failed");
      const warn = tJson.warning || pJson.warning;
      if (warn) setError(warn);
      setTrend(tJson);
      const priced = ensureG2G(pJson);
      setPrice(priced);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ trend: tJson, price: priced, at: Date.now() }));
    } catch (e) {
      setError(e.message || "Failed to refresh live data");
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
        if (cached?.trend) {
          setTrend(cached.trend);
          setPrice(ensureG2G(cached.price));
          setUsedCache(true);
        }
      } catch {
        /* ignore */
      }
    } finally {
      setLoading(false);
    }
  };

  const saveKeys = () => {
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    setSettingsOpen(false);
  };

  const sku = price?.skus?.[skuId];
  const stats = useMemo(() => statsFor(sku), [sku]);

  useEffect(() => {
    if (!sku) return;
    const p = Number(sku.g2gPrice) || 15;
    setCalc((c) => ({ ...c, cogs: +(p * 0.38).toFixed(2), testPrice: p }));
  }, [skuId, sku?.g2gPrice]);

  const calcOut = useMemo(() => {
    const sell = Number(calc.testPrice) || 0;
    const cogs = Number(calc.cogs) || 0;
    const fee = sell * (Number(calc.fee) || 0) / 100;
    const ads = sell * (Number(calc.ads) || 0) / 100;
    const net = sell - cogs - fee - ads;
    const netPct = sell ? (net / sell) * 100 : 0;
    const target = Number(calc.margin) || 0;
    const denom = 1 - (Number(calc.fee) + Number(calc.ads) + target) / 100;
    const suggested = denom > 0.05 ? cogs / denom : sell;
    return { sell, cogs, fee, ads, net, netPct, suggested };
  }, [calc]);

  const barData = useMemo(() => {
    if (!sku) return null;
    const sorted = [...sku.competitors].sort((a, b) => a.price - b.price);
    return {
      labels: sorted.map((c) => c.brand),
      datasets: [
        {
          label: "Price (RM)",
          data: sorted.map((c) => c.price),
          backgroundColor: sorted.map((c) =>
            isG2G(c) ? "#9560E8" : /glowmy/i.test(c.brand) ? "#FFB6C1" : "#B0C965"
          ),
          borderRadius: 6,
          barThickness: 16,
        },
      ],
      _sorted: sorted,
      _avg: stats?.avg,
    };
  }, [sku, stats]);

  const scatterData = useMemo(() => {
    if (!sku) return null;
    return {
      datasets: [
        {
          label: "Position",
          data: sku.competitors.map((c) => ({
            x: Number(c.price),
            y: Number(c.quality || 7),
            brand: c.brand,
          })),
          backgroundColor: sku.competitors.map((c) => (isG2G(c) ? "#9560E8" : "#B0C965")),
          pointRadius: sku.competitors.map((c) => (isG2G(c) ? 11 : 7)),
        },
      ],
    };
  }, [sku]);

  const exportPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("Glad2Glow Intelligence Report", 40, 40);
    doc.setFontSize(10);
    doc.text(new Date().toLocaleString(), 40, 58);
    let y = 80;
    if (trend?.trends) {
      doc.setFontSize(12);
      doc.text("Trend Scan", 40, y);
      y += 16;
      doc.setFontSize(9);
      trend.trends.forEach((t) => {
        doc.text(`${t.rank}. ${t.format} — ${t.viralSound || ""}`, 40, y);
        y += 14;
      });
    }
    if (sku) {
      y += 10;
      doc.setFontSize(12);
      doc.text(`Price Optimiser — ${sku.title}`, 40, y);
      y += 16;
      doc.setFontSize(9);
      sku.competitors.forEach((c) => {
        if (y > 760) {
          doc.addPage();
          y = 40;
        }
        doc.text(`${c.brand}  RM${Number(c.price).toFixed(2)}  ${c.platform}`, 40, y);
        y += 13;
      });
    }
    doc.save("glad2glow-intelligence.pdf");
  };

  const hasData = Boolean(trend && price);
  const today = new Date().toLocaleDateString("en-MY", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen pb-12 bg-[#FFF0E5] text-slate-800 dark:bg-[#2a1838] dark:text-slate-100">
      <header className="bg-white/90 dark:bg-[#3a2050] border-b border-pink-200/70 sticky top-0 z-50 shadow-sm backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-[#9560E8] flex items-center justify-center text-white font-heading font-bold text-xl shadow-md">
                G2G
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-bold font-heading text-slate-900 dark:text-white">
                    Glad2Glow Intelligence Command Center
                  </h1>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFC0CB] text-[#7A45D4]">
                    <span className="w-2 h-2 rounded-full bg-[#9560E8] mr-1.5 animate-pulse" />
                    LIVE
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Malaysian D2C · TikTok / Shopee intelligence · Task 2
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-right hidden sm:block mr-1">
                <span className="text-[10px] font-medium text-slate-400 block">TODAY</span>
                <span className="text-xs font-semibold">{today}</span>
              </div>
              <button
                onClick={() => setDark((d) => !d)}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium"
              >
                {dark ? "Light" : "Dark"}
              </button>
              <button
                onClick={exportPdf}
                disabled={!hasData}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium disabled:opacity-40"
              >
                Export Report
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium"
                aria-label="Settings"
              >
                ⚙ Settings
              </button>
              <button
                onClick={refresh}
                disabled={loading}
                className="inline-flex items-center px-3.5 py-2 rounded-lg bg-[#9560E8] hover:bg-[#7A45D4] text-white text-xs font-semibold disabled:opacity-60"
              >
                {loading ? (
                  <span className="inline-block w-3.5 h-3.5 mr-1.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <span className="mr-1.5">🔍</span>
                )}
                Refresh Live Data
              </button>
            </div>
          </div>
          <div className="flex space-x-2 mt-5 border-t border-slate-100 dark:border-slate-800 pt-3">
            <button
              onClick={() => setTab("trend")}
              className={`tab-btn px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === "trend" ? "active" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Trend Scan
            </button>
            <button
              onClick={() => setTab("price")}
              className={`tab-btn px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === "price" ? "active" : "text-slate-600 dark:text-slate-300"
              }`}
            >
              Price Optimiser
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {error && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 text-red-800 dark:text-red-200 text-sm px-4 py-3">
            {error}
            {usedCache && " Showing last cached intelligence."}
          </div>
        )}
        {usedCache && !error && hasData && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs px-4 py-2">
            Showing cached intelligence. Click Refresh Live Data for a new agent pull.
          </div>
        )}

        {!hasData && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center shadow-sm">
            <p className="font-heading text-lg font-semibold">
              Click Refresh Live Data to pull the latest market intelligence.
            </p>
            <p className="text-sm text-slate-500 mt-2">
              Agents hit /api/trend-scan and /api/price-review in parallel. Add an OpenAI or Gemini key in Settings for LLM-grounded scans.
            </p>
          </div>
        )}

        {hasData && tab === "trend" && (
          <div className="space-y-8">
            <div className="bg-gradient-to-r from-[#9560E8] via-[#b07af0] to-[#FFB6C1] rounded-2xl p-6 text-white shadow-lg">
              <span className="px-2.5 py-1 rounded-md bg-white/10 text-xs uppercase tracking-wider">
                Agent source: {trend.source}
              </span>
              <h2 className="text-2xl font-bold font-heading mt-2">Closing the GMV Gap vs GlowMY</h2>
              <p className="text-white/90 text-sm mt-1 max-w-2xl">
                Glad2Glow Current GMV: <strong className="text-white">RM45,000/mo</strong> vs GlowMY:{" "}
                <strong className="text-white">RM180,000/mo</strong>. Pulled {trend.generatedAt}.
              </p>
            </div>

            <section>
              <h3 className="text-lg font-bold font-heading mb-4">Top 5 Trending TikTok Formats</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {(trend.trends || []).map((t) => (
                  <div
                    key={t.rank}
                    className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#FFC0CB] text-[#7A45D4]">
                          VIRAL #{t.rank}
                        </span>
                        <span className="text-[11px] text-slate-400">{t.avgViews}</span>
                      </div>
                      <h4 className="font-bold text-sm font-heading">{t.format}</h4>
                      <p className="text-xs text-slate-500 mt-1">{t.description}</p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-[11px]">
                      <div className="text-[#9560E8] font-mono truncate">♪ {t.viralSound}</div>
                      <div className="text-slate-500">{t.hashtags}</div>
                      <div className="bg-slate-50 dark:bg-slate-800 p-2 rounded italic text-slate-600 dark:text-slate-300">
                        <strong>Tip:</strong> {t.tip}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-4">Top Shopee Keywords</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b bg-slate-50 dark:bg-slate-800 text-slate-600 uppercase">
                        <th className="py-2.5 px-3">Rank</th>
                        <th className="py-2.5 px-3">Keyword</th>
                        <th className="py-2.5 px-3">Vol</th>
                        <th className="py-2.5 px-3">Trend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(trend.keywords || []).map((k) => (
                        <tr key={k.rank}>
                          <td className="py-2.5 px-3 font-bold text-[#9560E8]">#{k.rank}</td>
                          <td className="py-2.5 px-3 font-medium">{k.keyword}</td>
                          <td className="py-2.5 px-3">
                            {k.volume}
                            {k.searches ? ` · ${k.searches.toLocaleString()}` : ""}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-bold ${
                              String(k.trend).startsWith("-") ? "text-amber-600" : "text-emerald-600"
                            }`}
                          >
                            {String(k.trend).startsWith("-") ? "▼" : "▲"} {k.trend}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-4">Competitor Campaigns</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(trend.campaigns || []).map((c) => (
                    <div key={c.name} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm font-heading">{c.brand}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700">
                          {c.platform}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-coral-600 mt-1">{c.name}</div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">{c.description}</p>
                      <div className="mt-3 pt-2 border-t text-[11px]">
                        <div className="text-slate-500">
                          <strong>Why it works:</strong> {c.whyItWorks}
                        </div>
                        <div className="font-mono font-bold text-[#9560E8] mt-1">{c.metric}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="text-lg font-bold font-heading mb-4">5 Content Hooks for Glad2Glow</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 border-b uppercase text-slate-600">
                      <th className="py-3 px-4">Hook</th>
                      <th className="py-3 px-4">Format</th>
                      <th className="py-3 px-4">Sound</th>
                      <th className="py-3 px-4">Caption</th>
                      <th className="py-3 px-4">Best time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(trend.hooks || []).map((h, i) => (
                      <tr key={i}>
                        <td className="py-3.5 px-4 font-semibold max-w-xs">{h.hook}</td>
                        <td className="py-3.5 px-4">{h.format}</td>
                        <td className="py-3.5 px-4 font-mono text-[11px]">{h.sound}</td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 max-w-xs">{h.caption}</td>
                        <td className="py-3.5 px-4 whitespace-nowrap">{h.postingTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {hasData && tab === "price" && sku && stats && (
          <div className="space-y-8">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold font-heading">Interactive Category Price Intelligence</h2>
                <p className="text-xs text-slate-500">Source: {price.source} · {price.generatedAt}</p>
              </div>
              <select
                value={skuId}
                onChange={(e) => setSkuId(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-sm rounded-lg p-2.5 font-semibold"
              >
                {SKUS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-1">{sku.title}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  Purple = Glad2Glow · sage = competitors · pink = GlowMY · dashed = market average
                </p>
                <div className="relative h-72 w-full">
                  {barData && (
                    <Bar
                      data={barData}
                      options={{
                        indexAxis: "y",
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                          legend: { display: false },
                          annotation: {
                            annotations: {
                              avg: {
                                type: "line",
                                xMin: stats.avg,
                                xMax: stats.avg,
                                borderColor: "#EF4444",
                                borderWidth: 2,
                                borderDash: [6, 4],
                                label: {
                                  display: true,
                                  content: `Avg RM${stats.avg.toFixed(2)}`,
                                  position: "start",
                                  color: "#EF4444",
                                  font: { size: 10 },
                                },
                              },
                            },
                          },
                        },
                        scales: {
                          x: {
                            beginAtZero: true,
                            title: { display: true, text: "Price (RM)" },
                            grid: { color: dark ? "#1e293b" : "#F1F5F9" },
                          },
                          y: { grid: { display: false } },
                        },
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="lg:col-span-4 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-3">Price Distribution</h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    ["Market Min", `RM${stats.min.toFixed(2)}`],
                    ["Market Max", `RM${stats.max.toFixed(2)}`],
                    ["Average", `RM${stats.avg.toFixed(2)}`],
                    ["Median", `RM${stats.median.toFixed(2)}`],
                  ].map(([l, v]) => (
                    <div key={l} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                      <span className="text-[10px] text-slate-400 font-semibold uppercase block">{l}</span>
                      <span className="text-lg font-bold font-mono">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="p-4 rounded-xl bg-[#FFC0CB]/40 border border-[#FFB6C1]">
                  <div className="flex justify-between text-xs font-bold text-[#7A45D4]">
                    <span>{sku.g2gProduct || "Glad2Glow"}</span>
                    <span className="font-mono">RM{stats.g2g.toFixed(2)}</span>
                  </div>
                  {sku.g2gRrp && (
                    <p className="text-[11px] text-slate-500 mt-1">RRP RM{Number(sku.g2gRrp).toFixed(2)}</p>
                  )}
                  <p className="text-xs mt-2 text-[#5b2fb0]">
                    {stats.below >= 0
                      ? `${stats.below.toFixed(1)}% below market average`
                      : `${Math.abs(stats.below).toFixed(1)}% above market average`}
                    . Percentile rank: {stats.percentile}th (cheaper than {100 - stats.percentile}% of set).
                  </p>
                </div>
              </div>
            </div>

            <section className="bg-white dark:bg-[#3a2050] rounded-2xl p-6 border border-[#FFC0CB] shadow-sm">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2 mb-4">
                <div>
                  <h3 className="text-lg font-bold font-heading text-[#9560E8]">Price Optimiser Calculator</h3>
                  <p className="text-xs text-slate-500">
                    Model net after COGS, Shopee/TikTok fees and ads. Suggested price hits your target margin floor.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#B0C965] text-slate-900"
                  onClick={() =>
                    setCalc((c) => ({ ...c, testPrice: +calcOut.suggested.toFixed(2) }))
                  }
                >
                  Apply suggested price
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                {[
                  ["cogs", "COGS (RM)", 0.1],
                  ["fee", "Platform fee %", 0.1],
                  ["ads", "Ads / affiliate %", 0.1],
                  ["margin", "Target net margin %", 1],
                  ["testPrice", "Test sell price (RM)", 0.1],
                ].map(([k, label, step]) => (
                  <label key={k} className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {label}
                    <input
                      type="number"
                      step={step}
                      value={calc[k]}
                      onChange={(e) => setCalc((prev) => ({ ...prev, [k]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-[#FFB6C1] bg-[#FFF0E5] dark:bg-[#2a1838] px-2 py-2 text-sm font-mono"
                    />
                  </label>
                ))}
              </div>
              <input
                type="range"
                min={Math.max(1, (stats.min * 0.6).toFixed(1))}
                max={Math.max(stats.max * 1.1, 80)}
                step="0.1"
                value={calc.testPrice}
                onChange={(e) => setCalc((prev) => ({ ...prev, testPrice: e.target.value }))}
                className="w-full accent-[#9560E8] mb-4"
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-[#FFF0E5] border border-[#FFC0CB]">
                  <div className="text-slate-500">Fees + ads</div>
                  <div className="font-mono font-bold text-lg">RM{(calcOut.fee + calcOut.ads).toFixed(2)}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#FFF0E5] border border-[#FFC0CB]">
                  <div className="text-slate-500">Net / unit</div>
                  <div className={`font-mono font-bold text-lg ${calcOut.net < 0 ? "text-red-600" : "text-[#7A45D4]"}`}>
                    RM{calcOut.net.toFixed(2)} ({calcOut.netPct.toFixed(1)}%)
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#FFC0CB]/50 border border-[#9560E8]/30">
                  <div className="text-slate-500">Suggested sell (target margin)</div>
                  <div className="font-mono font-bold text-lg text-[#9560E8]">RM{calcOut.suggested.toFixed(2)}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#B0C965]/30 border border-[#B0C965]">
                  <div className="text-slate-500">vs market avg / G2G street</div>
                  <div className="font-mono font-bold">
                    {(((calcOut.testPrice || calcOut.sell) - stats.avg) / stats.avg * 100).toFixed(1)}% vs avg
                  </div>
                  <div className="text-[11px] mt-1">
                    Street RM{stats.g2g.toFixed(2)} · Flash −15% = RM{(stats.g2g * 0.85).toFixed(2)} · Live extra −25% = RM
                    {(stats.g2g * 0.75).toFixed(2)}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-3">
                {calcOut.suggested < stats.min
                  ? "Suggested sits at the floor of the set — protect perceived quality with bundles, not deeper cuts."
                  : calcOut.suggested > stats.avg
                  ? "Suggested is above average — only hold if you lead with PDRN / 377 / barrier claims."
                  : "Suggested is in the value-leader band vs Shopee/TikTok MY peers."}
                {" "}
                11.11 / 12.12: keep net ≥ 0 after 8% platform + 15% ads by not going below RM{Math.max(calcOut.cogs / 0.55, 1).toFixed(2)}.
              </p>
            </section>

            <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="text-lg font-bold font-heading mb-4">
                Full Competitor Price Table ({sku.competitors.length} tracked)
              </h3>
              <div className="overflow-x-auto max-h-80 custom-scrollbar border border-slate-100 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800">
                    <tr>
                      <th className="py-3 px-4">Brand</th>
                      <th className="py-3 px-4">Product</th>
                      <th className="py-3 px-4 text-right">Price (RM)</th>
                      <th className="py-3 px-4">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {sku.competitors.map((c, i) => (
                      <tr
                        key={i}
                        className={isG2G(c) ? "bg-[#FFC0CB]/50 font-semibold" : ""}
                      >
                        <td className="py-2.5 px-4 font-bold">{c.brand}</td>
                        <td className="py-2.5 px-4">{c.name}</td>
                        <td className="py-2.5 px-4 text-right font-mono">RM{Number(c.price).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-slate-500">{c.platform}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-5 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-3">Pricing Recommendations</h3>
                <ul className="space-y-3">
                  {(sku.recommendations || []).map((r, i) => (
                    <li
                      key={i}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs leading-relaxed"
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lg:col-span-7 bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm">
                <h3 className="text-base font-bold font-heading mb-3">Seasonal Pricing Playbook</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800 border-b uppercase text-slate-600">
                        <th className="py-2.5 px-3">Event</th>
                        <th className="py-2.5 px-3">Bundle</th>
                        <th className="py-2.5 px-3">Discount</th>
                        <th className="py-2.5 px-3">Timing</th>
                        <th className="py-2.5 px-3">Rationale</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(price.seasonalPlaybook || []).map((row) => (
                        <tr key={row.event}>
                          <td className="py-2.5 px-3 font-bold">{row.event}</td>
                          <td className="py-2.5 px-3 text-g2g-600 font-medium">{row.bundle}</td>
                          <td className="py-2.5 px-3 font-mono text-coral-600">{row.discount}</td>
                          <td className="py-2.5 px-3">{row.timing}</td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">{row.rationale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="text-lg font-bold font-heading mb-1">Market Position Scatter</h3>
              <p className="text-xs text-slate-500 mb-4">X = price (RM) · Y = perceived quality (1–10)</p>
              <div className="relative h-80 w-full">
                {scatterData && (
                  <Scatter
                    data={scatterData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          callbacks: {
                            label: (ctx) => {
                              const d = ctx.raw;
                              return `${d.brand}: RM${d.x} · quality ${d.y}`;
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          title: { display: true, text: "Price (RM)" },
                          grid: { color: dark ? "#1e293b" : "#F1F5F9" },
                        },
                        y: {
                          min: 1,
                          max: 10,
                          title: { display: true, text: "Perceived quality" },
                          grid: { color: dark ? "#1e293b" : "#F1F5F9" },
                        },
                      },
                    }}
                  />
                )}
              </div>
            </section>
          </div>
        )}
      </main>

      {settingsOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-700">
            <h3 className="font-heading font-bold text-lg mb-2">API keys</h3>
            <p className="text-xs text-slate-500 mb-4">
              Stored only in this browser (localStorage) and sent as request headers. You can also set
              OPENAI_API_KEY, GEMINI_API_KEY, SERPAPI_KEY in <code>.env.local</code>.
            </p>
            {[
              ["openai", "OpenAI API key (gpt-4o)"],
              ["gemini", "Gemini API key"],
              ["search", "SerpAPI key (optional web grounding)"],
            ].map(([k, label]) => (
              <label key={k} className="block text-xs font-medium mb-3">
                {label}
                <input
                  type="password"
                  value={keys[k]}
                  onChange={(e) => setKeys((prev) => ({ ...prev, [k]: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm"
                />
              </label>
            ))}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setSettingsOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800">
                Cancel
              </button>
              <button onClick={saveKeys} className="px-4 py-2 text-sm rounded-lg bg-[#9560E8] text-white font-semibold">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
