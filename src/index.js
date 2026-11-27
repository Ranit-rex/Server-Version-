import { MongoClient } from "mongodb";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
  if (!["major", "mini"].includes(releaseType)) throw new Error("Invalid releaseType");
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

function validAdminKey(request, env) {
  const expected = env.ADMIN_API_KEY || "";
  const supplied = request.headers.get("Authorization") || "";
  const actual = supplied.startsWith("Bearer ") ? supplied.slice(7) : "";
  if (!expected || actual.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return mismatch === 0;
}

async function withCollection(env, callback) {
  if (!env.MONGODB_URI) throw new Error("Database is not configured");
  const client = new MongoClient(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    maxPoolSize: 1,
    minPoolSize: 0,
    maxIdleTimeMS: 10000
  });
  try {
    await client.connect();
    const collection = client.db(env.MONGODB_DB || "castdoo_versions")
      .collection(env.VERSION_COLLECTION || "version_policies");
    return await callback(collection);
  } finally {
    try { await client.close(); } catch {}
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
    if (path === "/health" && request.method === "GET") {
      return json({ ok: true, service: "castdoo-version-api" });
    }

    if (path === "/v1/admin/version") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      if (!validAdminKey(request, env)) return json({ ok: false, error: "Unauthorized" }, 401, { "Cache-Control": "no-store" });

      let input;
      try { input = await request.json(); }
      catch { return json({ ok: false, error: "Invalid JSON body" }, 400); }

      const track = String(input.track || "stable").toLowerCase();
      const latestVersionCode = Number(input.latestVersionCode);
      const minimumSupportedVersionCode = Number(input.minimumSupportedVersionCode);
      const releaseType = String(input.releaseType || "mini").toLowerCase();
      if (!["stable", "beta"].includes(track)) return json({ ok: false, error: "Invalid track" }, 400);
      if (!Number.isSafeInteger(latestVersionCode) || latestVersionCode < 1 ||
          !Number.isSafeInteger(minimumSupportedVersionCode) || minimumSupportedVersionCode < 1 ||
          minimumSupportedVersionCode > latestVersionCode) {
        return json({ ok: false, error: "Invalid version codes" }, 400);
      }
      if (!["major", "mini"].includes(releaseType)) return json({ ok: false, error: "releaseType must be major or mini" }, 400);
      const policy = {
        latestVersionCode,
        minimumSupportedVersionCode,
        versionName: String(input.versionName || "").slice(0, 40),
        releaseType,
        releaseNotes: String(input.releaseNotes || "").slice(0, 4000),
        updateUrl: String(input.updateUrl || "").slice(0, 2048),
        updatedAt: new Date()
      };
      if (policy.updateUrl && !/^https:\\/\\//i.test(policy.updateUrl)) {
        return json({ ok: false, error: "updateUrl must be an HTTPS URL" }, 400);
      }

      try {
        await withCollection(env, collection => collection.updateOne(
          { _id: track },
          { $set: policy, $setOnInsert: { createdAt: new Date() } },
          { upsert: true }
        ));
        return json({ ok: true, track, policy: normalizePolicy(policy, track) }, 200, { "Cache-Control": "no-store" });
      } catch (error) {
        console.error("Admin policy save failed:", error?.message || "unknown error");
        return json({ ok: false, error: "Unable to save version policy; check database write access" }, 503, { "Cache-Control": "no-store" });
      }
    }

    if (path !== "/v1/version" || request.method !== "GET") {
      return json({ ok: false, error: "Not found" }, 404);
    }
    const track = String(url.searchParams.get("track") || "stable").toLowerCase();
    if (!["stable", "beta"].includes(track)) return json({ ok: false, error: "track must be stable or beta" }, 400);

    try {
      const doc = await withCollection(env, collection => collection.findOne(
        { _id: track },
        { projection: { _id: 0, latestVersionCode: 1, minimumSupportedVersionCode: 1, versionName: 1, releaseType: 1, releaseNotes: 1, updateUrl: 1, updatedAt: 1 }, maxTimeMS: 4000 }
      ));
      if (!doc) return json({ ok: false, error: "No version policy configured for this track", track }, 404, { "Cache-Control": "no-store" });
      return json({ ok: true, policy: normalizePolicy(doc, track) });
    } catch (error) {
      console.error("Version policy lookup failed:", error?.message || "unknown error");
      return json({ ok: false, error: "Unable to read version policy" }, 503, { "Cache-Control": "no-store" });
    }
  }
};
