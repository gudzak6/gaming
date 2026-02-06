# GameSite Live MVP

Single-show live game loop with Flappy Bird, lobby presence, and leaderboard.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Create `.env` if desired. The server also loads `admin/local.env` automatically:

- `PORT` (default 3000)
- `JWT_SECRET` (default dev-secret-change-me)
- `ADMIN_SECRET` (default same as JWT_SECRET)
- `ADMIN_PASSWORD` (default admin123)
- `DEV_OTP` (default true; set to "false" to require Twilio)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `SHOW_START_HOUR` (default 20)
- `SHOW_START_MINUTE` (default 0)
- `DB_PATH` (default ./data.sqlite)
- `DATABASE_URL` (set to use Postgres)
- `PG_SSL` (set to "true" if your Postgres requires SSL)

## Admin helper

Start a show immediately (admin auth required):

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password":"admin123"}'

curl -X POST http://localhost:3000/api/admin/show/now \
  -H "Authorization: Bearer <TOKEN>"
```

## Admin portal

Open `http://localhost:3000/admin`.
