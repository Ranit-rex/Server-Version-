const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { MongoClient } = require("mongodb");

const MONGODB_URI = defineSecret("MONGODB_URI");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function send(res, status, body, extraHeaders = {}) {
  res.set({ ...JSON_HEADERS, ...extraHeaders });
  return res.status(status).json(body);
}

function normalizePolicy(doc, track) {
  if (!doc) return null;

  const latestVersionCode = Number(doc.latestVersionCode);
  const minimumSupportedVersionCode = Number(doc.minimumSupportedVersionCode);

  if (!Number.isSafeInteger(latestVersionCode) || latestVersionCode < 1) {
    throw new Error("Invalid latestVersionCode");
  }
  if (
    !Number.isSafeInteger(minimumSupportedVersionCode) ||
    minimumSupportedVersionCode < 1 ||
    minimumSupportedVersionCode > latestVersionCode
  ) {
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
    releaseNotes: String(doc.releaseNotes || ""),
    updateUrl: String(doc.updateUrl || ""),
    track,
    updatedAt: doc.updatedAt || null
  };
}

exports.versionApi = onRequest(
  {
    region: "asia-south1",
    secrets: [MONGODB_URI],
    timeoutSeconds: 15,
    memory: "256MiB",
    maxInstances: 5
  },
  async (req, res) => {
    if (req.method === "OPTIONS") {
      res.set(JSON_HEADERS);
      return res.status(204).send("");
    }

    if (req.method !== "GET") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    const path = req.path.replace(/\\/+$/, "") || "/";
    if (path === "/health") {
      return send(res, 200, { ok: true, service: "castdoo-version-api" });
    }

    if (path !== "/v1/version") {
      return send(res, 404, { ok: false, error: "Not found" });
    }

    const track = String(req.query.track || "stable").toLowerCase();
    if (!["stable", "beta"].includes(track)) {
      return send(res, 400, { ok: false, error: "track must be stable or beta" });
    }

    let client;
    try {
      client = new MongoClient(MONGODB_URI.value(), {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        maxPoolSize: 1
      });
      await client.connect();

      const db = client.db(process.env.MONGODB_DB || "castdoo");
      const collection = db.collection(
        process.env.VERSION_COLLECTION || "version_policies"
      );

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
          }
        }
      );

      if (!doc) {
        return send(res, 404, {
          ok: false,
          error: "No version policy configured for this track"
        });
      }

      return send(res, 200, {
        ok: true,
        policy: normalizePolicy(doc, track)
      });
    } catch (error) {
      console.error("Version policy lookup failed:", error.message);
      return send(
        res,
        503,
        { ok: false, error: "Unable to read version policy" },
        { "Cache-Control": "no-store" }
      );
    } finally {
      if (client) {
        await client.close().catch(() => {});
      }
    }
  }
);
