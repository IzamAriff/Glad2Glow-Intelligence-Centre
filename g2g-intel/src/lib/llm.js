function extractJson(text) {
  if (!text) throw new Error("Empty model response");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(raw.slice(start, end + 1));
}

export async function webSearch(query, searchKey) {
  const snippets = [];
  if (searchKey) {
    try {
      const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(
        query
      )}&gl=my&hl=en&api_key=${searchKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        for (const r of data.organic_results || []) {
          snippets.push(`${r.title}: ${r.snippet || ""}`);
        }
      }
    } catch {
      /* continue */
    }
  }
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`
    );
    if (res.ok) {
      const data = await res.json();
      if (data.AbstractText) snippets.push(data.AbstractText);
      for (const t of data.RelatedTopics || []) {
        if (t.Text) snippets.push(t.Text);
      }
    }
  } catch {
    /* ignore */
  }
  return snippets.slice(0, 8);
}

function cleanKey(v) {
  return String(v || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

export async function callLlm({ system, user, keys }) {
  const openai = cleanKey(keys.openai || process.env.OPENAI_API_KEY);
  const gemini = cleanKey(keys.gemini || process.env.GEMINI_API_KEY);

  if (openai) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return extractJson(data.choices?.[0]?.message?.content || "");
  }

  if (gemini) {
    const models = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "gemini-flash-latest",
      "gemini-2.5-flash-lite",
      "gemini-pro-latest",
    ];
    let lastErr = "";
    for (const model of models) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
          }),
        }
      );
      if (!res.ok) {
        lastErr = await res.text();
        if (res.status === 404) continue;
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          const invalid = /API key not valid|INVALID_ARGUMENT|PERMISSION_DENIED|invalid/i.test(lastErr);
          if (invalid) {
            const err = new Error(
              "Gemini API key is not valid. Create a new key at https://aistudio.google.com/apikey (Google AI Studio, not a Cloud service-account key). Refresh still loaded with the Malaysia synthesis engine."
            );
            err.code = "INVALID_KEY";
            throw err;
          }
        }
        throw new Error(`Gemini error ${res.status}: ${lastErr.slice(0, 220)}`);
      }
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      return extractJson(text);
    }
    throw new Error(`Gemini error 404: no available model. Last: ${lastErr.slice(0, 180)}`);
  }

  return null;
}

export function keysFromRequest(req) {
  return {
    openai: req.headers.get("x-openai-key") || "",
    gemini: req.headers.get("x-gemini-key") || "",
    search: req.headers.get("x-search-key") || process.env.SERPAPI_KEY || "",
  };
}
