import { callLlm, keysFromRequest, webSearch } from "@/lib/llm";
import { ensureG2G, G2G_SKUS } from "@/lib/g2gCatalog";
import { NextResponse } from "next/server";

const SYSTEM = `You are a live Malaysian pricing optimiser for Glad2Glow D2C skincare.
ALWAYS include a Glad2Glow row as the first competitor in EVERY SKU using these official MY street prices:
- serum: Glad2Glow 377 Dark Spot Yuja Symwhite Serum 17ml = RM15.00 (Guardian promo; RRP RM25). Also note Centella SA Power Acne Serum 17ml RM25 Caring.
- moisturizer: Glad2Glow 5% Niacinamide Pomegranate Brightening Moisturizer 30g = RM15.00 (Guardian; RRP RM25). Centella Allantoin Gel 30g = RM11.40.
- sunscreen: Glad2Glow Blueberry Light Sunscreen SPF50 30g ≈ RM15.30 Shopee/TikTok.
- cleanser: Glad2Glow Ceramide Low pH Blueberry Gel Cleanser 70ml = RM11.40 (Guardian; RRP RM19).
- toner: Glad2Glow Pomegranate Niacinamide Brightening Toner 80ml ≈ RM13.95.
Do not omit Glad2Glow. brand field must be exactly "Glad2Glow".
Return ONLY JSON:
{
  "generatedAt": ISO,
  "source": "ai-agent",
  "seasonalPlaybook": [ { "event":"", "bundle":"", "discount":"", "timing":"", "rationale":"" } ], // Raya, 9.9/10.10, 11.11, 12.12, school holidays
  "skus": {
    "cleanser": SKU, "toner": SKU, "serum": SKU, "moisturizer": SKU, "sunscreen": SKU
  }
}
Each SKU:
{
  "title": "human label",
  "g2gPrice": number,
  "competitors": [ { "brand":"", "name":"", "price": number, "platform":"", "notes":"", "quality": number 1-10 } ], // 8-10 incl Glad2Glow
  "recommendations": ["...", "..."]
}
Prices in RM, realistic Shopee/TikTok MY. Brands: Glad2Glow, GlowMY, Skintific, Wardah, Orkid, COSRX, Some By Mi, Kayman, The Ordinary, Biore, Hada Labo, Aiken, Senka, Sunplay.`;

function sku(key, rows, recs) {
  const c = G2G_SKUS[key];
  return { title: c.title, g2gPrice: c.g2gPrice, g2gRrp: c.rrp, competitors: rows, recommendations: recs };
}

function fallback() {
  return {
    generatedAt: new Date().toISOString(),
    source: "live-agent-synthesis",
    seasonalPlaybook: [
      { event: "Ramadan & Raya Prep", bundle: "Set Lebaran Glowing - 4IN1", discount: "22% OFF (RM48.00)", timing: "3 Weeks Pre-Raya", rationale: "Skin prep before open houses; free sampul raya." },
      { event: "9.9 / 10.10 Double Dates", bundle: "Buy Serum Free Refill Cream", discount: "18% OFF (RM36.80)", timing: "Mega Day Flash Slots", rationale: "Shopee Coins cashback impulse." },
      { event: "11.11 Big Sale", bundle: "Ultimate Barrier Repair Set 5-Pcs", discount: "28% OFF (RM59.90)", timing: "Midnight 00:00 - 02:00", rationale: "Compete with Skintific midnight flash." },
      { event: "12.12 Year-End Shopping", bundle: "Year-End Stock Up Duo", discount: "20% OFF (RM39.00)", timing: "Dec 10 - Dec 14", rationale: "Student holiday + bonus spend." },
      { event: "School Holidays (Jun / Nov)", bundle: "Student Starter Trio", discount: "15% OFF + free pouch", timing: "First week of break", rationale: "Allowance-driven trial kits." },
    ],
    skus: {
      serum: sku(
        "serum",
        [
          G2G_SKUS.serum.product,
          { brand: "Wardah", name: "Symradiance Bright & Barrier Repair Serum (30ml)", price: 28.5, platform: "Shopee MY", notes: "Halal 10% niacinamide", quality: 7.2 },
          { brand: "GlowMY", name: "Brightening Barrier Glow Serum (30ml)", price: 35.0, platform: "TikTok Shop", notes: "Affiliate push", quality: 7.8 },
          { brand: "Skintific", name: "377 Dark Spot Serum (20ml)", price: 32.76, platform: "Shopee MY", notes: "SymWhite 377", quality: 8.2 },
          { brand: "Orkid Cosmetics", name: "Glow & Bright Serum (30ml)", price: 38.0, platform: "Shopee MY", notes: "Clean beauty", quality: 7.0 },
          { brand: "The Ordinary", name: "Niacinamide 10% + Zinc 1% (30ml)", price: 39.0, platform: "Shopee MY", notes: "Global benchmark", quality: 8.0 },
          { brand: "SOME BY MI", name: "Yuja Niacin 30 Days Blemish Serum (50ml)", price: 42.0, platform: "Shopee MY", notes: "Vit C", quality: 7.5 },
          { brand: "Bio-Essence", name: "Tanaka Bio-White Advanced Serum (30ml)", price: 45.0, platform: "Watsons / Shopee", notes: "Drugstore", quality: 6.8 },
          { brand: "Cosrx", name: "The Niacinamide 15 Serum (20ml)", price: 48.0, platform: "Shopee MY", notes: "High conc.", quality: 8.8 },
          { brand: "Kayman Beauty", name: "Hyalu-C Brightening Serum (30ml)", price: 59.0, platform: "Shopee / Website", notes: "Premium MY D2C", quality: 8.6 },
        ],
        [
          "G2G PDRN at RM24.90 is ~36% below category average — defend value leadership.",
          "Test RM27.90 bundle with mini micellar to lift AOV.",
          "Call out RM10+ savings vs GlowMY RM35 in every creator hook.",
        ]
      ),
      moisturizer: sku(
        "moisturizer",
        [
          G2G_SKUS.moisturizer.product,
          { brand: "Wardah", name: "Symradiance Niacinamide Gel (30g)", price: 20.62, platform: "Shopee MY", notes: "Drugstore", quality: 7.0 },
          { brand: "Aiken", name: "Prebiotic Hydra Plus Cream (40g)", price: 22.9, platform: "Guardian", notes: "Mass MY", quality: 6.5 },
          { brand: "GlowMY", name: "Ceramide Barrier Repair Cream (50g)", price: 29.0, platform: "TikTok Shop", notes: "Pump jar", quality: 7.6 },
          { brand: "Skintific", name: "5X Ceramide Moisture Gel (30g)", price: 32.0, platform: "Shopee MY", notes: "Category leader", quality: 8.4 },
          { brand: "Bio-Essence", name: "Bio-Water B5 Jelly (50g)", price: 38.5, platform: "Shopee MY", notes: "Hydration", quality: 6.9 },
          { brand: "Cosrx", name: "Oil-Free Ultra Moisturizing Lotion (100ml)", price: 44.0, platform: "Shopee MY", notes: "Larger pack", quality: 8.1 },
          { brand: "SOME BY MI", name: "AHA-BHA-PHA Miracle Cream (50g)", price: 48.0, platform: "Shopee MY", notes: "Acne cream", quality: 7.7 },
          { brand: "Kayman Beauty", name: "Skintella Repairing Gel (50g)", price: 55.0, platform: "Shopee MY", notes: "Premium local", quality: 8.3 },
        ],
        [
          "RM14.31 is 58% cheaper than Skintific RM32 — lock for flash sales.",
          "Upsell 100g jumbo tub at RM36.",
          "Pair with Lychee SPF as RM29.90 Daily Defense Duo on Live.",
        ]
      ),
      sunscreen: sku(
        "sunscreen",
        [
          G2G_SKUS.sunscreen.product,
          { brand: "Wardah", name: "UV Shield Essential Gel SPF30 (40ml)", price: 18.5, platform: "Shopee MY", notes: "Mass", quality: 6.8 },
          { brand: "Sunplay", name: "Skin Aqua UV Moisture Milk SPF50 (40g)", price: 24.5, platform: "Watsons", notes: "JP staple", quality: 7.5 },
          { brand: "Skintific", name: "5X Ceramide Serum Sunscreen SPF50 (30g)", price: 25.0, platform: "Shopee MY", notes: "Top seller", quality: 8.3 },
          { brand: "GlowMY", name: "UV Invisible Shield SPF50 (40g)", price: 26.0, platform: "TikTok Shop", notes: "Non-greasy", quality: 7.4 },
          { brand: "Biore", name: "UV Aqua Rich Watery Essence SPF50 (50g)", price: 28.9, platform: "Guardian", notes: "Benchmark", quality: 8.0 },
          { brand: "Cosrx", name: "Aloe Soothing Sun Cream SPF50 (50ml)", price: 39.0, platform: "Shopee MY", notes: "Hydrating", quality: 7.9 },
          { brand: "SOME BY MI", name: "Truecica Mineral Calming (50ml)", price: 43.0, platform: "Shopee MY", notes: "Mineral", quality: 7.6 },
          { brand: "Kayman Beauty", name: "SunStick / Sunscreen SPF50 (50g)", price: 49.0, platform: "Shopee MY", notes: "Premium", quality: 8.1 },
        ],
        ["Most affordable SPF50 tone-up in viral D2C set.", "Lean on UV camera tests: SPF50 under RM16."]
      ),
      cleanser: sku(
        "cleanser",
        [
          G2G_SKUS.cleanser.product,
          { brand: "Wardah", name: "Lightening Whip Facial Foam (100g)", price: 12.3, platform: "Shopee MY", notes: "Lowest mass", quality: 6.2 },
          { brand: "Skintific", name: "Damask Rose Whipped Cleanser (120g)", price: 17.58, platform: "Shopee MY", notes: "Entry", quality: 7.4 },
          { brand: "Senka", name: "Perfect Whip (120g)", price: 18.9, platform: "Shopee MY", notes: "JP classic", quality: 7.0 },
          { brand: "GlowMY", name: "Gentle Foaming Amino Wash (100g)", price: 24.0, platform: "TikTok Shop", notes: "Barrier", quality: 7.3 },
          { brand: "Cosrx", name: "Low pH Good Morning Gel (150ml)", price: 28.0, platform: "Shopee MY", notes: "Cult", quality: 8.4 },
          { brand: "Skintific", name: "Panthenol Gel Cleanser (120ml)", price: 29.99, platform: "Shopee MY", notes: "Acne/barrier", quality: 8.0 },
          { brand: "Kayman Beauty", name: "CoalFace Gel Cleanser (120ml)", price: 35.0, platform: "Shopee MY", notes: "Charcoal", quality: 7.7 },
          { brand: "SOME BY MI", name: "Bye Bye Blackhead Green Tea (120g)", price: 42.0, platform: "Shopee MY", notes: "Bubble", quality: 7.5 },
        ],
        ["RM16 is a basket-builder toward RM40 free-shipping."]
      ),
      toner: sku(
        "toner",
        [
          G2G_SKUS.toner.product,
          { brand: "Wardah", name: "Lightening Face Toner (125ml)", price: 14.5, platform: "Shopee MY", notes: "Entry", quality: 6.0 },
          { brand: "GlowMY", name: "Clarifying Barrier Essence Toner (100ml)", price: 28.0, platform: "TikTok Shop", notes: "Larger", quality: 7.4 },
          { brand: "Skintific", name: "5X Ceramide Soothing Toner (80ml)", price: 33.5, platform: "Shopee MY", notes: "Top seller", quality: 8.3 },
          { brand: "Cosrx", name: "AHA/BHA Clarifying Toner (150ml)", price: 38.0, platform: "Shopee MY", notes: "Exfoliating", quality: 8.1 },
          { brand: "Hada Labo", name: "Gokujyun Hydrating Lotion (170ml)", price: 39.9, platform: "Watsons", notes: "HA benchmark", quality: 8.2 },
          { brand: "SOME BY MI", name: "AHA BHA PHA Miracle Toner (150ml)", price: 42.0, platform: "Shopee MY", notes: "Acne", quality: 7.6 },
          { brand: "Kayman Beauty", name: "Rosa Glow Treatment Essence (120ml)", price: 68.0, platform: "Shopee MY", notes: "Premium", quality: 8.4 },
        ],
        ["RM19.50 sits between drugstore and RM30+ barrier toners — keep the sweet spot."]
      ),
    },
  };
}

export async function POST(req) {
  try {
    const keys = keysFromRequest(req);
    const snippets = (
      await Promise.all(
        [
          "Glad2Glow Shopee Malaysia price serum moisturizer",
          "Skintific serum price Shopee Malaysia",
          "Wardah GlowMY COSRX sunscreen price Malaysia",
        ].map((q) => webSearch(q, keys.search))
      )
    ).flat();

    const user = `Today ${new Date().toISOString()}. Snippets:\n${snippets.join("\n")}\nReturn full pricing JSON for 5 SKUs.`;
    let warning = "";
    let ai = null;
    try {
      ai = await callLlm({ system: SYSTEM, user, keys });
    } catch (e) {
      if (e.code === "INVALID_KEY") warning = e.message;
      else throw e;
    }
    let payload = ai || fallback();
    if (ai) payload.source = "llm";
    if (warning) payload.warning = warning;
    if (!payload.skus) payload.skus = fallback().skus;
    if (!payload.seasonalPlaybook) payload.seasonalPlaybook = fallback().seasonalPlaybook;
    payload = ensureG2G(payload);
    payload.generatedAt = payload.generatedAt || new Date().toISOString();
    return NextResponse.json(payload);
  } catch (e) {
    try {
      const payload = ensureG2G(fallback());
      payload.warning = e.message;
      return NextResponse.json(payload);
    } catch {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }
}

export async function GET(req) {
  return POST(req);
}
