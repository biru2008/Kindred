# Kindred

A calm, responsive real-time chat application for **First Commit**. Built with React, TypeScript, Vite, and Supabase. Deploy the frontend to Vercel.

## What is included

- Phone-number sign-in with SMS verification. Email/password sign-in is also available; every live account must verify a phone before using the workspace.
- One-click random text conversations, with anonymous or regular identity chosen before matching.
- Separate anonymous and regular names, bios/interests/vibes, colors, and uploaded profile songs.
- Private conversation ratings that influence future matching, plus blocking and a 24-hour repeat-match exclusion.
- Persistent sessions, email confirmation, password reset, and sign-out.
- Private one-to-one conversations and small group conversations (“circles”, up to 20 people).
- Persistent messages with Supabase Postgres and WebSocket updates.
- Membership-based access controls enforced in the database.
- Typing indicators and presence within the current conversation.
- Unread counts and read receipts; opening a conversation does not mark unseen messages below the viewport as read.
- Safe message retries, message editing, soft deletion, and paginated history.
- Conversation search, full-history message search, editable profiles, and an emoji picker.
- Per-conversation drafts and failed sends retained in the current browser tab/session.
- Responsive phone/desktop layouts, keyboard controls, reduced-motion support, and accessible modal dialogs.
- Optional browser WebMCP tools for listing conversations and staging a draft. They do not send messages.

Without environment variables, the application opens a **clearly labeled preview**. Its sample people are fictional; nothing is delivered to another person. Preview data is stored only in this browser. Preview accounts are not real authentication and are separate from the live service.

## 1. Run the local preview

Install Node.js 22.13+ (24 LTS is also suitable) and pnpm 11.25.0. Then, from this folder:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. No account or external service is needed for this preview.

To activate pnpm using Corepack, if available:

```sh
corepack enable
corepack prepare pnpm@11.25.0 --activate
```

If Corepack is unavailable, install pnpm with `npm install -g pnpm@11.25.0`.

## 2. Create a fresh Supabase backend

1. Create a project at [Supabase](https://supabase.com/dashboard). Choose your region and save the database password privately. The application does **not** need that password.
2. Open the project’s **SQL Editor**. Run the complete `supabase/migrations/001_kindred.sql` **once**, then run the complete `supabase/migrations/002_discover.sql` **once**. Run them in this order. The second migration adds phone verification requirements, private anonymous identities, random matching, ratings, blocks, and the profile music bucket. Each file is transactional; if one fails, resolve the reported error before rerunning that entire file.
3. Under **Authentication → Sign In / Providers**, enable **Phone** and configure a supported SMS provider such as Twilio using its own credentials and sender configuration. Keep SMS confirmation enabled. Provider credentials belong only in Supabase’s dashboard, never in Vercel frontend variables. SMS delivery needs your provider account, supported destination countries, and any required sender registration; check its charges before enabling public traffic. For development, Supabase’s configured test phone numbers/codes can exercise verification without delivering SMS; remove test entries before public launch. See [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login).
   Leave email/password sign-in enabled if you want that alternative. Keep email confirmation enabled and configure SMTP for confirmation/reset mail. An email account still needs a unique verified phone. A phone-only account needs no email. Set Auth SMS rate limits for your expected usage; the UI also spaces resend requests by 60 seconds.
4. Under **Authentication → URL Configuration**, set the local Site URL to `http://127.0.0.1:5173` during development. Add it as an allowed redirect URL too. Add `http://localhost:5173` if you use that address instead.
5. In Realtime settings, disable **Allow public access** (private channels only). Account updates, random-match notifications, and conversation typing/presence channels are private. Postgres message access is also checked by table RLS.
6. Copy the project URL and **publishable key** from the project’s Connect dialog/API settings. The older `anon` key also works, but never use a `service_role`, `sb_secret_...`, database password, or JWT signing secret in this frontend.
7. Copy `.env.example` to `.env` and fill in:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

8. Restart the development server. Sign in with a phone number in international format and the SMS code. Repeat with a different phone in a separate browser profile or device. Choose **My profiles** to personalize both identities. Use **Meet someone** on both devices to match; the live queue waits for another eligible person. For direct chats, use **+** to find the other person by display name or username.
9. The music bucket is created automatically by migration 002. Upload MP3, OGG, WAV, or M4A audio (10 MB maximum) from each profile editor. No music streaming API, extra key, or external player account is needed.

The `VITE_*` values are deliberately browser-visible. Security comes from authenticated user tokens plus the included RLS/RPC checks. `.env` and local credentials are excluded from Git.

These migrations target a **new project** and are not designed to be run twice. Future schema changes should be added as new migrations. If the migration fails, its transaction rolls back; resolve the reported error before rerunning the entire file.

## 3. Deploy on Vercel

1. Put the contents of this folder in a new repository. Keep it private while the hackathon is in progress if required by your organizers.
2. Import the repository at [Vercel](https://vercel.com/new).
3. Use the **Vite** framework preset. If the repository contains this folder within another folder, set Vercel’s **Root Directory** to the folder containing `package.json`.
4. Select Node.js **22.x** or **24.x**. The committed `packageManager` specifies pnpm. The build command is `pnpm build`, and the output directory is `dist`. `vercel.json` includes SPA rewrites and basic security headers.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Vercel’s environment variables. Apply them to Production, and to Preview if you want preview deployments to use this backend.
6. Deploy. Add the exact HTTPS deployment origin to Supabase’s allowed redirect URLs and set it as the Auth Site URL. Add a custom domain too if you use one. Use exact origins for production; do not authorize arbitrary domains.
7. Rebuild after changing `VITE_*` variables because Vite injects them at build time.
8. Test phone sign-in/SMS, email confirmation/reset if enabled, direct chat, anonymous matching, private ratings, blocking, and profile songs from two devices on the deployed URL.

Vercel serves the frontend. Supabase provides Auth, Postgres storage, and the live WebSocket service. There is no separate application server to provision. Choose hosting/database service plans according to actual usage and provider limits; production SMS has separate provider requirements and may incur charges.

## 4. Verification

```sh
pnpm test
pnpm test:database
pnpm build
```

The database suite uses an isolated in-memory PostgreSQL runtime (PGlite) with minimal Auth/Realtime schema stubs. It runs **both actual migrations** and tests data isolation, phone gates, separate anonymous identities, queue/match lifecycle, score-based eligibility, blocks, rating privacy, upload ownership, duplicate retries, private-channel policy, read receipts, and atomic conversation creation. It does **not** emulate Supabase Auth, SMS/email delivery, hosted Storage/Realtime, or network failures.

### Live backend smoke test

After setup, create and email-confirm **three disposable test accounts**, then verify a distinct phone for each using the app. Account C must be different from A and B. Add the following non-Vite variables to your ignored `.env`:

```dotenv
SUPABASE_TEST_EMAIL_A=first-test-account@example.com
SUPABASE_TEST_PASSWORD_A=YOUR_TEST_ACCOUNT_PASSWORD
SUPABASE_TEST_EMAIL_B=second-test-account@example.com
SUPABASE_TEST_PASSWORD_B=YOUR_TEST_ACCOUNT_PASSWORD
SUPABASE_TEST_EMAIL_C=third-test-account@example.com
SUPABASE_TEST_PASSWORD_C=YOUR_TEST_ACCOUNT_PASSWORD
```

Then run:

```sh
pnpm test:live
```

This signs in three existing accounts, creates/reuses the A–B private chat concurrently, sends one marked test message, observes its actual WebSocket arrival, confirms persisted history and retry deduplication, and checks that C cannot access the chat. It soft-deletes the test message at the end. Credentials are never logged. The A–B conversation and a deletion tombstone remain in the test project.

### Browser acceptance checks

- New user verifies an SMS code and remains signed in after reload; sign-out returns to sign-in. Email accounts cannot enter the workspace until phone verification succeeds.
- Two eligible users choose Meet someone and connect; an unpaired user sees the waiting state and can cancel.
- Anonymous partner payloads contain the chosen alias/bio/song and fresh session identity, with no real name, username, phone, email, or underlying account ID.
- End a random conversation, rate privately or skip, optionally block, and start the next match. The previous peer cannot send once ended. A block prevents future pairing.
- Edit each profile independently; open a partner profile and verify the correct song/bio. If the browser blocks automatic audio, use the visible Play button.
- Disconnect a random participant for over 90 seconds; the remaining user sees the ended state after the next heartbeat.
- Two accounts create the same direct chat from opposite sides without duplicates.
- A sends a message; B receives it immediately, and the message remains after reload.
- Typing appears only while composing and expires; presence disappears after disconnect detection.
- B’s unread count clears only when the latest messages are visible. A sees a read receipt.
- Simulate a dropped connection. Retry a failed send and verify that it appears exactly once. Switching conversations and reloading should preserve unsent retry items in the same tab.
- Create a circle and verify all its members receive messages.
- Search, edit, and delete both recent and older messages after loading earlier history.
- On a phone: open chat, send, go back, search, open details, and edit profile without horizontal scrolling.

## Architecture and boundaries

`src/App.tsx` handles session gating, conversation state, loading, retries, and responsive navigation. `src/components.tsx` holds auth forms, dialogs, profile editing, people selection, and conversation details. `src/lib/api.ts` is the live data interface; `demo.ts` implements the explicitly local preview. `src/Discover.tsx`, `src/Personas.tsx`, and `src/PhoneAuth.tsx` handle discovery, dual profiles/music, and phone gating. Both files in `supabase/migrations/` form the backend.

Messages are persisted **before** successful delivery is shown. The client supplies a UUID to make retries idempotent. Direct chats use a canonical unique pair of user IDs and are created together with memberships in one database transaction. All mutations use RPCs that derive the sender from `auth.uid()`. Clients have read-only table grants, and table RLS limits conversations, memberships, and messages to participants.

The browser subscribes to Postgres Changes over a private per-user channel. Reconnection and periodic reconciliation recover missed events and refresh the loaded message range. Separate private conversation channels carry ephemeral typing and presence, not message bodies. Presence is advisory: clients supply presence payloads; it is never used for authorization. Removing members and changing membership after creation are intentionally not exposed.

Regular profiles expose display name, username, color, bio, and optional song to phone-verified users. Phone/email stay in Supabase Auth. Anonymous settings and the account-to-persona mapping stay in the private schema; stranger APIs use a new persona UUID for each match. Anonymous mode applies to random conversations; direct chats and circles use your regular profile. The service operator can associate accounts and messages. Users can still identify themselves in their chosen alias, bio, audio, or chat; anonymity is not a guarantee against self-disclosure. Messages use HTTPS/WSS and database authorization; **end-to-end encryption is not implemented**.

Music files are delivered from a public Storage bucket with opaque random filenames; someone with a song URL can play it. Storage metadata/upload/delete access is owner-restricted. The same object cannot be assigned to both personas (upload a separate copy if desired), but identical audio can still identify someone. Removing a song unlinks it from the profile; it does not delete the uploaded object or old conversation snapshot. Upload only audio you have permission to share. Browsers may block autoplay; the player always offers a Play control. Only one profile song plays at a time. Profile changes apply to future random sessions; the current session keeps its original profile snapshot.

Ratings are never returned to other users or shown publicly. Matching uses a weighted average of the latest rating from each distinct peer in the last 90 days, with five initial votes at 3.5 to soften early ratings. Accounts with at least five distinct raters and a weighted score below 2.6 match only within that lower-score group. Within the same group, closer scores are preferred with a small random adjustment. The same peer cannot inflate the score by repeated votes. Skipping a rating has no effect. This is community feedback, not comprehensive abuse detection. Blocks exclude pairs in either direction; recent pairs are excluded for 24 hours.

Discovery uses private per-account broadcast notifications plus an 8-second reconciliation heartbeat. Queue entries expire after 45 seconds without heartbeat, and sessions end after a participant is absent for 90 seconds. Random history is persisted and paginated while a session remains accessible; no past-random-chat archive is exposed. Transactions serialize match transitions to avoid double assignment. The app is sized for a hackathon/small community; a larger public service needs operational moderation, storage retention, and matchmaking capacity work. Voice/video calls, voice notes, AI chat, and push notifications are outside this version’s scope.

Drafts and pending retry items use `sessionStorage`; they survive reloads in the same tab, not necessarily closing the browser. Preview content uses `localStorage`. Browsers with storage disabled may not preserve either. Font loading uses Google Fonts with system-font fallbacks.

## Verified in the delivered workspace

- Production TypeScript/Vite build.
- Message merge/validation tests.
- Database/RLS/RPC checks against the migration.
- Browser interactions in the local preview on desktop and phone-sized viewports.

**Not yet verified:** hosted authentication/SMS/email flows, hosted music storage, real multi-user WebSocket delivery, or a Vercel deployment. These require the fresh Supabase/Vercel accounts and configuration described above. `pnpm test:live` is provided to verify the connected backend rather than treating local sample data as proof of real-time delivery.

## Official references

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

- [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login)
- [Database broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Browser autoplay rules](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
