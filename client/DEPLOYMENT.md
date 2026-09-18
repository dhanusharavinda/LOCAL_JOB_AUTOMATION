# Deploying the GO CANDID8 dashboard (Vercel)

## How the frontend reaches the API

The dashboard calls the API with relative `/api/*` paths, so the rewrites in
`vercel.json` are the only thing connecting the frontend to the backend. They
point at the production API server on Railway:

```
https://localjobautomation-production.up.railway.app
```

If you fork this and deploy your own copy, replace that hostname in
`client/vercel.json` with the hostname of YOUR API server. Leaving someone
else's host there would send your users' data to their server.

Local development does not use `vercel.json` at all: `client/vite.config.ts`
proxies `/api` to `http://127.0.0.1:3001` instead.

**Do not add comments to `vercel.json`.** Vercel validates it against a strict
schema and rejects unknown keys, including `_comment`. A build that fails this
check never runs, so the site silently keeps serving the previous deployment.
Notes about deployment belong in this file.

## Environment variables (Vercel project settings)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Supabase project URL for auth |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase anon key (safe to ship in the bundle) |
| `VITE_LAUNCH_POST_URL` | no | Links the "Open the LinkedIn post" button on the invite-only page |
| `VITE_SUPPORT_EMAIL` | no | Shows a mailto fallback in the Contact dialog |

## After deploying

Open the site in a private window and confirm:

1. Signed out, you see the invite-only page ("Invite-only early access").
2. `/<site>/api/invites/check/probeToken123` returns
   `{"valid":false,"reason":"not_found"}`, which proves the API rewrite works.
