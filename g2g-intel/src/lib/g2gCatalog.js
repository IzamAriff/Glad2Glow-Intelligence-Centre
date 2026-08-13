/** Street / Guardian MY list prices observed Aug 2026 (promo vs RRP). */
export const G2G_SKUS = {
  serum: {
    title: "Glad2Glow 377 Dark Spot Yuja Symwhite Serum 17ml",
    g2gPrice: 15.0,
    rrp: 25.0,
    product: {
      brand: "Glad2Glow",
      name: "377 Dark Spot Yuja Symwhite Serum 17ml",
      price: 15.0,
      platform: "Guardian MY (promo)",
      notes: "RRP RM25.00 · Caring also lists Centella SA Power Acne Serum 17ml at RM25.00",
      quality: 8.4,
    },
  },
  moisturizer: {
    title: "Glad2Glow 5% Niacinamide Pomegranate Brightening Moisturizer 30g",
    g2gPrice: 15.0,
    rrp: 25.0,
    product: {
      brand: "Glad2Glow",
      name: "5% Niacinamide Pomegranate Brightening Moisturizer 30g",
      price: 15.0,
      platform: "Guardian MY (promo)",
      notes: "RRP RM25.00 · Centella Allantoin Gel 30g is RM11.40 (RRP RM19) · Blueberry Ceramide 30g RM15",
      quality: 8.2,
    },
  },
  sunscreen: {
    title: "Glad2Glow Blueberry / Lychee Light Sunscreen SPF50 30g",
    g2gPrice: 15.3,
    rrp: 25.0,
    product: {
      brand: "Glad2Glow",
      name: "Blueberry Light Sunscreen SPF50 PA+++ 30g",
      price: 15.3,
      platform: "Shopee / TikTok Shop MY",
      notes: "Hero UV SKU; typical live extra RM12–16 vs RRP ~RM25",
      quality: 8.1,
    },
  },
  cleanser: {
    title: "Glad2Glow Ceramide Low pH Blueberry Gel Cleanser 70ml",
    g2gPrice: 11.4,
    rrp: 19.0,
    product: {
      brand: "Glad2Glow",
      name: "Ceramide Low pH Blueberry Gel Cleanser 70ml",
      price: 11.4,
      platform: "Guardian MY (promo)",
      notes: "RRP RM19.00 · Yuzu AHA Blackhead Cleanser also RM11.40 · Shopee brightening cleanser ~RM13.95",
      quality: 7.8,
    },
  },
  toner: {
    title: "Glad2Glow Pomegranate Niacinamide Brightening Toner 80ml",
    g2gPrice: 13.95,
    rrp: 23.0,
    product: {
      brand: "Glad2Glow",
      name: "Pomegranate Niacinamide Brightening Toner 80ml",
      price: 13.95,
      platform: "Shopee MY / Guardian range",
      notes: "Matches brightening-line street price (~RM14). Centella Ceramide Soothing Toner is the acne/barrier twin.",
      quality: 7.9,
    },
  },
};

export function isG2G(row) {
  const s = `${row?.brand || ""} ${row?.name || ""}`;
  return /glad\s*2\s*glow/i.test(s) || /g2g/i.test(row?.brand || "");
}

export function ensureG2G(payload) {
  const out = { ...payload, skus: { ...(payload.skus || {}) } };
  for (const key of Object.keys(G2G_SKUS)) {
    const canon = G2G_SKUS[key];
    const sku = out.skus[key] || { title: canon.title, competitors: [], recommendations: [] };
    const others = (sku.competitors || []).filter((c) => !isG2G(c));
    out.skus[key] = {
      ...sku,
      title: sku.title || canon.title,
      g2gPrice: canon.g2gPrice,
      g2gRrp: canon.rrp,
      g2gProduct: canon.product.name,
      competitors: [canon.product, ...others],
    };
  }
  return out;
}
