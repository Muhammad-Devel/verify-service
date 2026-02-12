# Verify Service

Centralized Telegram verification service with multi‑project support. Each project receives a unique `project_key` for API access and a `project_code` for Telegram onboarding.

## Features
- Multi‑tenant projects with isolated users and codes
- Telegram bot onboarding via `/start <project_code>`
- Admin project creation via API, admin UI, or Telegram command
- Code delivery and verification endpoints
- Direct notify endpoint for external backends

## Architecture
- Node.js + Express
- MongoDB (Mongoose)
- Telegram Bot API (polling)

## Quickstart
1. Create a Telegram bot with BotFather and obtain `BOT_TOKEN`.
2. Start MongoDB.
3. Configure `.env`.
4. Install and run:
```bash
npm install
npm run dev
```

## Environment Variables
- `PORT` (default `3000`)
- `MONGODB_URI` (example `mongodb://localhost:27017/verify_service`)
- `BOT_TOKEN` (Telegram bot token)
- `CODE_TTL_SECONDS` (default `300`)
- `MAX_ATTEMPTS` (default `5`)
- `START_SESSION_TTL_SECONDS` (default `600`)
- `ADMIN_API_KEY` (required for admin API + admin UI)
- `ADMIN_TELEGRAM_ID` (numeric Telegram user ID for `/add_project`)

## Admin Project Creation
You can create projects in three ways.

### 1) Admin API
`POST /projects`
- header: `x-admin-key: <ADMIN_API_KEY>`
- body:
```json
{"name":"My Project"}
```
- response:
```json
{"id":"...","name":"My Project","key":"<project_key>","code":"<project_code>"}
```

### 2) Admin UI
- Open `http://localhost:3000/admin`
- Enter `ADMIN_API_KEY`
- Create project
- Toggle or copy the `project_key`

### 3) Telegram Admin
1. Set `ADMIN_TELEGRAM_ID` in `.env` (numeric ID).
2. In Telegram, send `/add_project` to the bot.
3. Send project name.
4. Confirm with inline buttons.

## User Onboarding (Telegram)
Users must link their phone numbers to the correct project:
1. User opens the bot with project code:
   - `/start <project_code>`
2. Bot requests contact.
3. User shares contact.

Deep link example:
```
https://t.me/<bot_username>?start=<project_code>
```

## API Reference

### Health
`GET /`
```json
{"status":"ok"}
```

### Request Verification Code
`POST /auth/request`
- header: `x-project-key: <project_key>`
- body:
```json
{"phone":"+998901234567"}
```

### Check Phone Exists
`POST /auth/check`
- header: `x-project-key: <project_key>`
- body:
```json
{"phone":"+998901234567"}
```
- response:
```json
{"check":true}
```

### Verify Code
`POST /auth/verify`
- header: `x-project-key: <project_key>`
- body:
```json
{"phone":"+998901234567","code":"123456"}
```

### Direct Notify (External Backends)
`POST /notify`
- header: `x-project-key: <project_key>`
- body:
```json
{"user_id":"12345","code":"5566"}
```

## Auth Rule
- All auth flows require `x-project-key`.
- External backends should use only:
  - `POST /auth/request`
  - `POST /auth/verify`

## Notes
- Telegram polling requires outbound access to `api.telegram.org`.
- If MongoDB has legacy indexes, start once and allow the server to clean them up.

## Troubleshooting
Common issues:
- `ENOTFOUND api.telegram.org` → DNS/internet/firewall issue.
- `SyntaxError: Expected ':' after property name` → invalid JSON body or missing `Content-Type: application/json`.

## License
Private/internal use.
