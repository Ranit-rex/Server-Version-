# CastDoo Server Version

Firebase Cloud Functions HTTP API for CastDoo version policies. MongoDB Atlas remains the source of truth. This service does not depend on Cloudflare or Render.

## Endpoints

After deployment, Firebase provides the function URL:
- `GET /health`
- `GET /v1/version` (Stable)
- `GET /v1/version?track=beta` (Beta)

The API is read-only. It does not accept policy writes or expose database credentials.

## MongoDB policy documents

Database: `castdoo`  
Collection: `version_policies`

Stable document example:

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

Create a corresponding document with `_id: "beta"` for the Beta track. Compare integer version codes, not version-name strings.

## Configure and deploy

1. Install Firebase CLI and sign in with an account that has access to Firebase project `castdoo`.
2. From this repository directory, run `cd functions && npm install && cd ..`.
3. Create a dedicated MongoDB database user with read-only access to the policy collection.
4. Set the secret (the value is your Atlas connection string):
   `firebase functions:secrets:set MONGODB_URI --project castdoo`
5. Deploy:
   `firebase deploy --only functions:versionApi --project castdoo`
6. Test the deployed `/health`, `/v1/version`, and `/v1/version?track=beta` URLs.

Optional function environment values:
- `MONGODB_DB` (default `castdoo`)
- `VERSION_COLLECTION` (default `version_policies`)

Firebase Functions deployment may require the Firebase project to be on the Blaze billing plan. The function is configured in `asia-south1`, with no minimum instances and a maximum of five instances.

## Client behavior contract

- Load cached policy immediately when the app opens.
- Make at most one successful version check per local day.
- A failed check must not count as the daily successful check.
- Save only a valid successful policy response.
- Keep using cached policy while offline or when the API is unavailable.
- Enforce a cached mandatory update immediately.
- Compare installed and remote versions using integer version codes.
- Keep Stable and Beta policies separate.
- Major updates are mandatory; Mini updates are optional, with Update and Continue choices.

This repository contains the server API only. It does not modify the CastDoo Android app or any existing Render services.
