# Mafia City Telegram Mini App

Mobile-first Next.js App Router application intended to run inside Telegram. Telegram `initData` is verified server-side, and authenticated player sessions are stored in signed, HttpOnly cookies. There are no guest accounts, seeded/sample players, or local authentication bypasses.

## Requirements

- Node.js `>=20.9 <23` and npm.
- A Telegram bot token from BotFather.
- A strong session signing secret.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set `TELEGRAM_BOT_TOKEN` and a long random `SESSION_SECRET`.
3. Start the development server:

   ```sh
   npm ci
   npm run dev
   ```

4. To authenticate from Telegram, expose the local server over HTTPS using a secure tunnel, configure the bot's Mini App URL to that HTTPS address, then open the Mini App from Telegram. A normal browser or `localhost` does not provide trusted Telegram `initData` and will show the Telegram-only entry page.

## Deploy from GitHub

### Render

The included `render.yaml` configures a Node web service, build/start commands, Node version, and health check. Connect the repository in Render and provide `TELEGRAM_BOT_TOKEN` when prompted. The blueprint generates `SESSION_SECRET`. After Render provides the service's HTTPS URL, configure the bot's Mini App URL to that address.

### Vercel

Import the repository into Vercel; it detects Next.js. Use Node.js 22 in Project Settings and configure:

- `TELEGRAM_BOT_TOKEN` (server-side secret)
- `TELEGRAM_BOT_USERNAME` (server-side; `mafiauz_robot`)
- `SESSION_SECRET` (server-side random secret)
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (`mafiauz_robot`)

After the deployment has an HTTPS domain, configure that URL as the bot's Mini App URL. Do not add bot/session secrets with a `NEXT_PUBLIC_` prefix.

## Important production limitation

The current lobby and match engine stores game state in the Node.js process. It is useful for development on one persistent process, but it is **not durable or reliable across restarts, multiple Render instances, or Vercel serverless functions**. Do not advertise or use this build for real multiplayer production until a shared transactional database and cross-instance realtime/state synchronization are implemented. Supabase variables were removed from `.env.example` because there is no Supabase integration in the current code; adding empty variables would imply a feature that is not connected.

Friends, chat, Telegram bot `/start`/notifications, timers, match history, and automated game tests are also not implemented. The included health endpoint reports process health only; it does not indicate persistent game readiness.

## Verification

```sh
npm run lint
npm run build
```

Use the lockfile with `npm ci` for reproducible dependency installation. Never commit `.env.local` or production secrets. `.env.example` contains placeholders and is intentionally included in Git.
