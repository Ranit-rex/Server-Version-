# CastDoo Server Version

Cloudflare Workers HTTP API with MongoDB Atlas as the source of truth. No Firebase Functions or Render service is used for version checks.

## API routes

- `GET /health`
- `GET /v1/version` (Stable)
- `GET /v1/version?track=beta` (Beta)

The API is read-only and uses a dedicated MongoDB read-only account. MongoDB connection details are stored as a Cloudflare Worker secret, never in this repository.

## MongoDB Atlas

- Project: `CastDoo Version System`
- Cluster: `CastDooVersion` (AWS Mumbai / `AP_SOUTH_1`, Free tier)
- Database: `castdoo_versions`
- Collection: `version_policies`
- Document IDs: `stable` and `beta`

Example Stable document:

```json
{
  "_id": "stable",
  "latestVersionCode": 12,
  "minimumSupportedVersionCode": 10,
  "versionName": "1.2.0",
  "releaseType": "mini",
  "releaseNotes": "Performance and stability improvements",
  "updateUrl": "https://example.com/castdoo.apk",
  "updatedAt": "2026-11-27T00:00:00.000Z"
}
```

Create the equivalent Beta document with `_id: "beta"`. Use integer version codes. `releaseType` must be `major` or `mini`.

## Cloudflare deployment

Worker name: `castdoo-version-api`

Secret required:
- `MONGODB_URI`: Atlas connection string for the dedicated read-only user.

The database and collection are configured in `wrangler.jsonc`. The Worker supports GET and OPTIONS only. It validates policy data and never exposes MongoDB errors or credentials.

## Client behavior contract

- Load cached policy immediately when the app opens.
- Make at most one successful version check per local day.
- A failed check does not count as the daily successful check.
- Save only a valid successful policy response.
- Keep using cached policy while offline or when the API is unavailable.
- Compare installed and remote versions using integer version codes.
- Keep Stable and Beta policies separate.
- Major updates are mandatory; Mini updates are optional, with Update and Continue choices.

This repository contains the server API only. It does not modify the CastDoo Android app or existing Render services.
