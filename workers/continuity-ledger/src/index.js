const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    headers: JSON_HEADERS,
    status,
  });
}

export class ContinuityLedger {
  fetch() {
    return json({ error: "ledger_mutations_not_enabled" }, 503);
  }
}

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ mutationsEnabled: false, status: "ready" }, 200);
    }
    return json({ error: "not_found" }, 404);
  },
};
