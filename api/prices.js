const GROUPS = {
  1: ["ENGROH", "FFC", "GCIL", "HUBC", "LUCK", "MARI"],
  2: ["MEBL", "OGDC", "SLM", "SPSL", "SYS", "THCCL"]
};

function normalizeQuote(symbol, raw) {
  if (!raw || raw.status === "error" || raw.code) {
    return {
      symbol,
      error: raw?.message || "Quote unavailable"
    };
  }

  const price = Number(raw.close ?? raw.price);
  const previousClose = Number(raw.previous_close);
  const suppliedChange = Number(raw.change);

  const dayChange = Number.isFinite(suppliedChange)
    ? suppliedChange
    : Number.isFinite(previousClose)
      ? price - previousClose
      : NaN;

  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(dayChange)
  ) {
    return {
      symbol,
      error: "Provider returned an invalid price or change"
    };
  }

  return {
    symbol,
    price,
    previousClose: Number.isFinite(previousClose)
      ? previousClose
      : null,
    dayChange,
    changePercent: Number(raw.percent_change),
    timestamp: raw.datetime || raw.timestamp || null
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return response.status(500).json({
      error: "TWELVE_DATA_API_KEY is not configured in Vercel"
    });
  }

  const groupNumber = Number(request.query.group || 1);
  const symbols = GROUPS[groupNumber];

  if (!symbols) {
    return response.status(400).json({
      error: "group must be 1 or 2"
    });
  }

  try {
    const url = new URL("https://api.twelvedata.com/quote");

    url.searchParams.set("symbol", symbols.join(","));
    url.searchParams.set("exchange", "XKAR");
    url.searchParams.set("apikey", apiKey);

    const providerResponse = await fetch(url, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(20000)
    });

    const payload = await providerResponse.json();

    if (
      !providerResponse.ok ||
      payload.status === "error" ||
      payload.code
    ) {
      return response.status(502).json({
        error:
          payload.message ||
          `Twelve Data returned HTTP ${providerResponse.status}`
      });
    }

    const results = symbols.map((symbol) => {
      const rawQuote =
        payload[symbol] ||
        payload[`${symbol}:XKAR`] ||
        (payload.symbol === symbol ? payload : null);

      return normalizeQuote(symbol, rawQuote);
    });

    const quotes = results.filter((item) => !item.error);
    const unavailable = results.filter((item) => item.error);

    if (!quotes.length) {
      return response.status(502).json({
        error:
          `No group ${groupNumber} symbols are available ` +
          "on the current Twelve Data plan",
        unavailable
      });
    }

    return response.status(200).json({
      asOf: new Date().toISOString(),
      source: "Twelve Data",
      group: groupNumber,
      quotes,
      unavailable
    });
  } catch (error) {
    return response.status(500).json({
      error: error.message || "Unable to download prices"
    });
  }
}