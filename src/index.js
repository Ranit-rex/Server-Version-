import { MongoClient } from "mongodb";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  });
}

function normalizePolicy(doc, track) {
  if (!doc) return null;

  const latestVersionCode = Number(doc.latestVersionCode);
  const minimumSupportedVersionCode = Number(doc.minimumSupportedVersionCode);
  if (!Number.isSafeInteger(latestVersionCode) || latestVersionCode < 1) {
    throw new Error("Invalid latestVersionCode");
  }
  if (!Number.isSafeInteger(minimumSupportedVersionCode) ||
      minimumSupportedVersionCode < 1 ||
      minimumSupportedVersionCode > latestVersionCode) {
    throw new Error("Invalid minimumSupportedVersionCode");
  }

  const releaseType = String(doc.releaseType || "mini").toLowerCase();
  if (!["major", "mini"].includes(releaseType)) {
    throw new Error("Invalid releaseType");
  }

  return {
    latestVersionCode,
    minimumSupportedVersionCode,
    versionName: String(doc.versionName || ""),
    releaseType,
    isMandatory: releaseType === "major",
    releaseNotes: String(doc.releaseNotes || ""),
    updateUrl: String(doc.updateUrl || ""),
    track,
    updatedAt: doc.updatedAt || null
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }
    if (path === "/health") {
      return json({ ok: true, service: "castdoo-version-api" });
    }
    if (path !== "/v1/version") {
      return json({ ok: false, error: "Not found" }, 404);
    }

    const track = String(url.searchParams.get("track") || "stable").toLowerCase();
    if (!["stable", "beta"].includes(track)) {
      return json({ ok: false, error: "track must be stable or beta" }, 400);
    }
    if (!env.MONGODB_URI) {
      return json({ ok: false, error: "Version service is not configured" }, 503, {
        "Cache-Control": "no-store"
      });
    }

    let client;
    try {
      client = new MongoClient(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: 1,
        minPoolSize: 0,
        maxIdleTimeMS: 10000
      });
      await client.connect();

      const collection = client
        .db(env.MONGODB_DB || "castdoo_versions")
        .collection(env.VERSION_COLLECTION || "version_policies");

      const doc = await collection.findOne(
        { _id: track },
        {
          projection: {
            _id: 0,
            latestVersionCode: 1,
            minimumSupportedVersionCode: 1,
            versionName: 1,
            releaseType: 1,
            releaseNotes: 1,
            updateUrl: 1,
            updatedAt: 1
          },
          maxTimeMS: 4000
        }
      );

      if (!doc) {
        return json({
          ok: false,
          error: "No version policy configured for this track",
          track
        }, 404, { "Cache-Control": "no-store" });
      }

      return json({ ok: true, policy: normalizePolicy(doc, track) });
    } catch (error) {
      console.error("Version policy lookup failed:", error?.message || "unknown error");
      return json({ ok: false, error: "Unable to read version policy" }, 503, {
        "Cache-Control": "no-store"
      });
    } finally {
      if (client) {
        try { await client.close(); } catch {}
      }
    }
  }
};
