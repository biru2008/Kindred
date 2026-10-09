# Kindred

A calm, responsive real-time chat application for **First Commit**. Built with React, TypeScript, Vite, and Supabase. Deploy the frontend to Vercel.

## What is included

- Email/password sign-up and sign-in. Each account belongs to a unique email address; email confirmation is required before accessing the workspace. No phone number or SMS provider is needed.
- One-click random text conversations, with anonymous or regular identity chosen before matching.
- Choose up to five interests from 16 suggestions or create your own tags; shared interests are prioritized, with an optional shared-interest-only filter.
- Peach and rose pink, matcha green, and cream styling with Fraunces headings and Nunito Sans body text.
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

## Add custom tags to an existing deployed app

If migrations 001–003 are already installed, run **only** `supabase/migrations/004_custom_interests.sql` once in Supabase's SQL Editor, then deploy this updated source through your connected GitHub/Vercel project. If you have not installed 003 yet, apply 003 before 004. Do not rerun earlier migrations.

The Add your own interest field accepts 2–30 English letters or numbers, with spaces and hyphens between them. Custom tags share the five-tag limit with suggestions. Press Enter or Add to select a tag; use the × on its chip to remove it. Tags are normalized on both client and server: case and repeated whitespace are ignored, duplicate interests are rejected by the input, and entering a suggested tag uses its existing label. Different words still represent different interests. The matching rules, strict filter, rating bands, blocking, and account privacy continue to apply. Existing chats keep their original snapshots.

## Update an existing deployed app with interest tags

If you already ran migrations 001 and 002, run **only** `supabase/migrations/003_interests.sql` in your existing Supabase project's SQL Editor, once. Do not rerun the original setup. This adds private interest preferences to the match queue, validates selections, prioritizes overlapping tags, and supports strict shared-interest matching. Existing users, messages, ratings, and profile data are preserved; ongoing conversations keep their existing snapshots.

Apply 003 before deploying this updated frontend. The migration keeps the previous one-argument matching RPC working, so the current frontend continues to work during the change. Then update the application files in your GitHub repository and deploy through Vercel as usual. No new environment variables, paid service, or account is needed. When testing strict matching with two users, select a common tag on both; existing blocks and the 24-hour repeat-match exclusion still apply.

For a fresh project, run migrations 001, 002, 003, and 004 in order instead.

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
2. Open the project’s **SQL Editor**. Run the complete `supabase/migrations/001_kindred.sql` **once**, then run the complete `supabase/migrations/002_discover.sql` **once**, then `supabase/migrations/003_interests.sql` **once**, then `supabase/migrations/004_custom_interests.sql` **once**, then `supabase/migrations/005_group_management.sql` **once**. Run them in this order. The second migration adds email confirmation requirements, private anonymous identities, random matching, ratings, blocks, and the profile music bucket. Each file is transactional; if one fails, resolve the reported error before rerunning that entire file.
3. Under **Authentication → Sign In / Providers**, enable **Email**, keep email confirmation enabled, and disable **Phone**. Configure SMTP for confirmation and password reset emails before inviting public users. No SMS provider is needed. Email uniqueness is managed by Supabase Auth; the app normalizes entered addresses to lowercase and the database checks the actual confirmed email, never user-supplied metadata.
   This release targets a fresh database. If resetting an existing project, clear old Auth users as well as application data, and recreate the application schema before running these migrations. Deleting rows alone does not replace old functions or policies. Keep the Supabase-managed Auth, Storage, and Realtime schemas intact.
4. Under **Authentication → URL Configuration**, set the local Site URL to `http://127.0.0.1:5173` during development. Add it as an allowed redirect URL too. Add `http://localhost:5173` if you use that address instead.
5. In Realtime settings, disable **Allow public access** (private channels only). Account updates, random-match notifications, and conversation typing/presence channels are private. Postgres message access is also checked by table RLS.
6. Copy the project URL and **publishable key** from the project’s Connect dialog/API settings. The older `anon` key also works, but never use a `service_role`, `sb_secret_...`, database password, or JWT signing secret in this frontend.
7. Copy `.env.example` to `.env` and fill in:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

8. Restart the development server. Create an account with an email and password, confirm the email link, then sign in. Repeat with a different email in a separate browser profile or device. Choose **My profiles** to personalize both identities. Use **Meet someone** on both devices to match; the live queue waits for another eligible person. For direct chats, use **+** to find the other person by display name or username.
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
8. Test email sign-up, confirmation, sign-in, and password reset, direct chat, anonymous matching, private ratings, blocking, and profile songs from two devices on the deployed URL.

Vercel serves the frontend. Supabase provides Auth, Postgres storage, and the live WebSocket service. There is no separate application server to provision. Choose hosting/database service plans according to actual usage and provider limits.

## 4. Verification

```sh
pnpm test
pnpm test:database
pnpm build
```

The database suite uses an isolated in-memory PostgreSQL runtime (PGlite) with minimal Auth/Realtime schema stubs. It runs **all five actual migrations** and tests data isolation, email confirmation gates, separate anonymous identities, queue/match lifecycle, score-based eligibility, blocks, rating privacy, upload ownership, duplicate retries, private-channel policy, read receipts, and atomic conversation creation. It does **not** emulate Supabase Auth, email delivery, hosted Storage/Realtime, or network failures.

### Live backend smoke test

After setup, create and email-confirm **three disposable test accounts**, using a distinct email for each. Account C must be different from A and B. Add the following non-Vite variables to your ignored `.env`:

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

- New user confirms their email and remains signed in after reload; sign-out returns to sign-in. Unconfirmed accounts cannot enter the workspace.
- Two eligible users choose Meet someone and connect; an unpaired user sees the waiting state and can cancel.
- Select five tags and verify a sixth cannot be added; deselecting allows replacement. Preferences survive reload.
- Matching prioritizes shared tags. Strict search waits for overlap and cannot be bypassed by the other user's open search; canceling allows preferences to be changed.
- A conversation shows mutual interest badges and selected interests in the partner profile, without underlying account identifiers.
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

`src/App.tsx` handles session gating, conversation state, loading, retries, and responsive navigation. `src/components.tsx` holds auth forms, dialogs, profile editing, people selection, and conversation details. `src/lib/api.ts` is the live data interface; `demo.ts` implements the explicitly local preview. `src/Discover.tsx`, `src/Personas.tsx`, and `src/EmailAuth.tsx` handle discovery, dual profiles/music, and email gating. All five files in `supabase/migrations/` form the backend.

Messages are persisted **before** successful delivery is shown. The client supplies a UUID to make retries idempotent. Direct chats use a canonical unique pair of user IDs and are created together with memberships in one database transaction. All mutations use RPCs that derive the sender from `auth.uid()`. Clients have read-only table grants, and table RLS limits conversations, memberships, and messages to participants.

The browser subscribes to Postgres Changes over a private per-user channel. Reconnection and periodic reconciliation recover missed events and refresh the loaded message range. Separate private conversation channels carry ephemeral typing and presence, not message bodies. Presence is advisory: clients supply presence payloads; it is never used for authorization. Removing members and changing membership after creation are intentionally not exposed.

Regular profiles expose display name, username, color, bio, and optional song to email-confirmed users. Email stays in Supabase Auth. Anonymous settings and the account-to-persona mapping stay in the private schema; stranger APIs use a new persona UUID for each match. Anonymous mode applies to random conversations; direct chats and circles use your regular profile. The service operator can associate accounts and messages. Users can still identify themselves in their chosen alias, bio, audio, or chat; anonymity is not a guarantee against self-disclosure. Messages use HTTPS/WSS and database authorization; **end-to-end encryption is not implemented**.

Music files are delivered from a public Storage bucket with opaque random filenames; someone with a song URL can play it. Storage metadata/upload/delete access is owner-restricted. The same object cannot be assigned to both personas (upload a separate copy if desired), but identical audio can still identify someone. Removing a song unlinks it from the profile; it does not delete the uploaded object or old conversation snapshot. Upload only audio you have permission to share. Browsers may block autoplay; the player always offers a Play control. Only one profile song plays at a time. Profile changes apply to future random sessions; the current session keeps its original profile snapshot.

Ratings are never returned to other users or shown publicly. Matching uses a weighted average of the latest rating from each distinct peer in the last 90 days, with five initial votes at 3.5 to soften early ratings. Accounts with at least five distinct raters and a weighted score below 2.6 match only within that lower-score group. Within the same group, available people sharing more selected interests are preferred first, then closer scores with a small random adjustment. If either person enables shared-interest-only matching, they must have at least one tag in common. Without that option, matching can fall back to people with different interests. The same peer cannot inflate the score by repeated votes. Interest selection is optional and validated server-side (up to five validated tags). Preferences are stored privately in the active queue; selected interests are included in the current conversation profile snapshot, so a matched peer can see them. Browser preferences are saved per account; they do not expose an anonymous-to-regular profile link. Skipping a rating has no effect. This is community feedback, not comprehensive abuse detection. Blocks exclude pairs in either direction; recent pairs are excluded for 24 hours.

Discovery uses private per-account broadcast notifications plus an 8-second reconciliation heartbeat. Queue entries expire after 45 seconds without heartbeat, and sessions end after a participant is absent for 90 seconds. Random history is persisted and paginated while a session remains accessible; no past-random-chat archive is exposed. Transactions serialize match transitions to avoid double assignment. The app is sized for a hackathon/small community; a larger public service needs operational moderation, storage retention, and matchmaking capacity work. Voice/video calls, voice notes, AI chat, and push notifications are outside this version’s scope.

Drafts and pending retry items use `sessionStorage`; they survive reloads in the same tab, not necessarily closing the browser. Preview content uses `localStorage`. Browsers with storage disabled may not preserve either. Font loading uses Google Fonts (Fraunces and Nunito Sans) with system-font fallbacks.

## Verified in the delivered workspace

- Production TypeScript/Vite build.
- Message merge/validation tests.
- Database/RLS/RPC checks against the migration.
- Browser interactions in the local preview on desktop and phone-sized viewports.

**Not yet verified:** hosted authentication/email flows, hosted music storage, real multi-user WebSocket delivery, or a Vercel deployment. These require the fresh Supabase/Vercel accounts and configuration described above. `pnpm test:live` is provided to verify the connected backend rather than treating local sample data as proof of real-time delivery.

## Official references

- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)

- [Supabase email/password authentication](https://supabase.com/docs/guides/auth/passwords)
- [Database broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Browser autoplay rules](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)


Circle administration
---------------------
Circle creators are owners. Selected people receive in-app invitations instead of being automatically added. Recipients see invitations above their conversation list and may accept or decline; acceptance grants access to the circle and its existing history. Owners can promote/demote admins and transfer ownership. Owners and admins may invite people, revoke pending invitations, and remove ordinary members; only an owner may remove admins. Members can leave; owners must transfer ownership before leaving. The limit of 20 includes pending invitations. These permissions are enforced by server functions and row-level security, with group-level locks serializing changes. Removed members lose future database access, but previously downloaded messages cannot be recalled from their device.

To update an existing **email-only** Kindred database with migrations 001–004 already installed, run `005_group_management.sql` once, then deploy the updated source to Vercel. Do not rerun the complete fresh-setup script against an existing schema. No environment-variable change is needed. For a fresh project, run all five migrations in order or the provided combined setup script once. Browser-only preview does not deliver invitations to real users; hosted invitation acceptance and Realtime delivery must be checked with separate signed-in accounts.
