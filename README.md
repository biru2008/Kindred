# Kindred

Kindred is a real-time, web-based chat application built for the **First Commit hackathon by Kamand Prompt, IIT Mandi**. It combines private direct messages and managed group conversations with interest-based stranger matching and separate anonymous profiles.

The current application uses **email and password authentication only**. Phone sign-up and SMS verification are not part of this release.

## Features

### Accounts and profiles

- Email/password registration, confirmation, sign-in, sign-out, persistent sessions, and password reset.
- Separate regular and anonymous names, bios, profile colors, and optional uploaded songs.
- Regular profiles show display name, username, bio, color, and song; email addresses are not included in other users' profile responses.
- Profile audio supports MP3, OGG, WAV, and M4A, up to 10 MB. Browser autoplay restrictions may require pressing Play.

### Private messages

- One-to-one conversations between registered users.
- Persistent message history and live updates through Supabase Realtime.
- Typing indicators, presence, read receipts, and unread counts.
- Conversation search, message search, paginated history, editing, and soft deletion of your own messages.
- Optimistic sending, retry deduplication, emoji selection, and per-conversation drafts.
- Drafts and failed sends are retained in the current browser tab's session storage.

### Circles: private groups

- Named groups with a maximum of 20 people, counting pending invitations toward capacity.
- The creator becomes the owner; selected people receive invitations instead of automatically joining.
- Recipients can accept or decline invitations. Acceptance grants access to the group's existing history.
- Owners can promote or demote admins and transfer ownership.
- Owners and admins can invite people, revoke pending invitations, and remove regular members.
- Only owners can remove admins. Admins cannot remove owners or change roles.
- Members can leave; an owner must transfer ownership first.
- All permissions are enforced in the database, not only through visible controls.

### Meet someone

- Random text conversations using either your regular or anonymous identity.
- Select up to five interests from suggested tags or add custom tags.
- Custom tags accept 2–30 English letters/numbers with internal spaces or hyphens. Case and repeated whitespace are normalized.
- Matching prioritizes shared interests, with an optional shared-interest-only setting.
- Private conversation ratings affect future matching eligibility; ratings are not public.
- Blocking prevents matching in either direction. Recent pairs are excluded for 24 hours.
- Anonymous matches use a fresh session persona ID and do not expose the underlying account ID or regular profile link.

### Interface

- Responsive desktop/mobile layouts, keyboard controls, reduced-motion support, and accessible dialogs.
- Peach, coral, rose, berry, and plum palette: `#FFBB94`, `#FB9590`, `#DC586D`, `#A33757`, `#852E4E`.
- Fraunces headings and Nunito Sans body text, with system font fallbacks.
- Optional browser WebMCP tools list conversations or stage drafts; they do not send messages.

## Architecture

| Component | Technology | Responsibility |
|---|---|---|
| Frontend | React 19 + TypeScript | Chat, discovery, profiles, and group controls |
| Build and hosting | Vite + Vercel | Frontend build and deployment |
| Authentication | Supabase Auth | Email/password accounts and sessions |
| Database | PostgreSQL | Messages, profiles, memberships, invitations, ratings, and matching |
| Live communication | Supabase Realtime | WebSocket-based updates, presence, and typing |
| Authorization | Row-Level Security and SQL functions | Membership checks, identity isolation, and group permissions |
| Audio storage | Supabase Storage | Profile music uploads |

The frontend calls Supabase directly using its public client key. Database functions perform sensitive operations and check the authenticated identity. Private-schema tables hold anonymous identity mappings, matching queues, blocks, and ratings. No separate Express or Python application server is required.

## Requirements

- Node.js **22.13 or later**; use a compatible Node 22 or 24 environment.
- pnpm **11.25.0**, as specified in `package.json`.
- A Supabase project for live operation.
- Vercel for the intended hosted deployment.
- A custom SMTP email service for unrestricted confirmation/password-reset delivery to public users.

## Run locally

Clone or download this repository and enter the directory containing `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173/`.

If pnpm is unavailable, install the specified version:

```sh
npm install -g pnpm@11.25.0
```

Without valid Supabase environment variables, the app opens a **clearly labeled local preview**. Sample users are fictional; preview changes stay in that browser and do not reach real accounts. Preview data uses local storage. This mode is useful for exploring the interface, but is not proof of live authentication or multi-user communication.

## Set up Supabase

### 1. Install the database

For a **fresh Supabase project**, open SQL Editor and run each complete migration once, in order:

1. `supabase/migrations/001_kindred.sql` — core messaging, profiles, access policies, and Realtime configuration.
2. `supabase/migrations/002_discover.sql` — email verification gates, separate personas, stranger matching, ratings, blocks, and profile music.
3. `supabase/migrations/003_interests.sql` — interest-based matching.
4. `supabase/migrations/004_custom_interests.sql` — custom interest normalization.
5. `supabase/migrations/005_group_management.sql` — owners/admins, invitations, ownership transfer, and membership controls.

Run whole files, not selected fragments. Each migration is transactional. If a file fails, resolve the reported error before rerunning that file. Do not rerun migrations that succeeded.

**Existing email-only projects:** if migrations 001–004 are already installed, run only 005. These files are not an in-place migration from an older phone-based installation. For that version, use a fresh project and update the frontend connection details. Deleting rows alone does not update old functions and policies.

### 2. Configure authentication and email

In Supabase's authentication settings:

- Allow new users to sign up.
- Enable Email and Confirm email.
- Disable Phone.
- Set Site URL and allowed Redirect URLs to the actual deployed website origin, including `https://`. Add `http://127.0.0.1:5173` when testing live authentication locally.
- Configure custom SMTP for public registration and password reset delivery.

Supabase's built-in email sender is restricted to organization-member addresses and has a small sending allowance. Public visitors may encounter unauthorized-address or email-rate-limit errors until custom SMTP is configured. SMTP credentials belong in Supabase's settings, never in the frontend or GitHub repository.

### 3. Set frontend environment variables

Copy `.env.example` to `.env` and replace the placeholders:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

The app also accepts `VITE_SUPABASE_ANON_KEY` for the public key. Set one public-key variable; `VITE_SUPABASE_PUBLISHABLE_KEY` takes precedence if both are present.

These client values are intentionally public. **Never use a Supabase secret or service-role key**, database password, or SMTP credential in any `VITE_` variable. Do not commit `.env`.

Restart the development server after changing variables. Create and confirm separate accounts to test live operation.

## Deploy on Vercel

1. Push the complete source to GitHub, keeping `package.json` at the chosen project root.
2. Import the repository into Vercel, or use the existing connected project.
3. Set the framework to **Vite**, build command to `pnpm build`, and output directory to `dist`.
4. Set the root directory to the folder containing `package.json` and select a compatible Node version.
5. Add the Supabase URL and public-key variables for the intended environment.
6. Deploy. Changes to frontend environment variables require a new build/redeployment.
7. Put the stable production website origin in Supabase's Site URL and allowed Redirect URLs.
8. Verify the public website in an incognito window. A Vercel Request Access page is deployment protection, not Kindred authentication; use the public production domain and configure its access appropriately for judging.

`vercel.json` includes SPA rewrites and basic security headers. GitHub commits to the connected production branch normally trigger deployment. Apply required new database migrations before deploying code that depends on them.

A Vercel deployment marked **Ready** confirms that the deployment completed; it does not establish that authentication, database setup, or multi-user delivery works.

## Testing

Run local checks:

```sh
pnpm test
pnpm test:database
pnpm build
```

The latest recorded checks passed: **11 unit tests and 77 database checks**, for **88 total**, plus the production build. The database suite applies all five migrations in an isolated PGlite PostgreSQL runtime with Auth/Realtime/Storage stubs. It checks membership isolation, message retries, anonymous identity separation, matching, ratings, blocking, tags, invitations, role permissions, capacity, and access revocation.

These checks do not emulate hosted email delivery, Storage uploads, or real WebSocket delivery. The interface has been checked in local preview; the submitted deployment must be tested separately.

### Live backend smoke test

Use a test Supabase project with three distinct existing confirmed accounts. Add these private, non-Vite variables to the ignored `.env`:

```dotenv
SUPABASE_TEST_EMAIL_A=first-test-account@example.com
SUPABASE_TEST_PASSWORD_A=YOUR_TEST_PASSWORD_A
SUPABASE_TEST_EMAIL_B=second-test-account@example.com
SUPABASE_TEST_PASSWORD_B=YOUR_TEST_PASSWORD_B
SUPABASE_TEST_EMAIL_C=third-test-account@example.com
SUPABASE_TEST_PASSWORD_C=YOUR_TEST_PASSWORD_C
```

Then run:

```sh
pnpm test:live
```

This creates/reuses the A–B direct conversation, sends a marked test message, waits for database replication readiness, measures WebSocket arrival time, checks persistence and retry deduplication, and checks that C cannot access the conversation. It soft-deletes the test message afterward; the conversation and a deletion tombstone remain. Never commit the credentials.

### Delayed messages and account sessions

The message-update connection is monitored separately from presence/typing. While database updates are not ready, visible online windows reconcile saved messages every five seconds; healthy connections retain a 30-second reconciliation check for missed events. Five seconds is a polling interval, not a delivery-time guarantee. Reconnection also reloads persisted history.

If messages only arrive through polling, run `supabase/realtime-diagnostic.sql` in the Supabase SQL Editor and inspect Logs → Realtime. All five application tables should be published with authenticated SELECT access and row security enabled. The diagnostic is read-only; do not disable row security to troubleshoot.

Ordinary tabs/windows within one browser profile share sign-in state. Regular and incognito sessions should be separate, as should separate browser profiles/devices. Sign-out ends only the current Supabase session. An auth initialization guard prevents an older session lookup from overwriting a newer auth event; this does not establish the cause of any reported cross-window account switch.

### Manual acceptance checks

Use separate browsers or devices and real accounts:

- Register, confirm email, sign in, reload, sign out, and sign back in.
- Send direct messages both ways without refreshing; confirm history persists.
- Check typing, presence, unread counts, search, editing, and deletion.
- Create a circle, accept/decline invitations, promote an admin, transfer ownership, remove a member, and leave.
- Confirm pending invitees and removed members cannot read or send group messages.
- Match two eligible accounts on shared/custom tags; confirm strict filtering waits when there is no overlap.
- Check anonymous profiles, end a conversation, provide private feedback, and test blocking.
- Upload/play profile music and test the mobile layout.

## Judge access without SMTP

For a controlled demo, the project administrator can create dedicated test accounts through Supabase Auth administration and mark those accounts confirmed. Give judges distinct account credentials privately. This allows email/password sign-in without sending confirmation emails; it does not demonstrate public registration or verification of email ownership.

Keep normal email confirmation enabled. Do not grant judges Supabase organization/dashboard access just to let them use the app. Public sign-up testing still needs a configured email provider. Explain the test-account arrangement in the submission instructions.

## Privacy and limitations

- Conversations are restricted to members through database permissions. Anonymous matching separates visible personas from account identities.
- Messages are **not end-to-end encrypted**. The service operator can access stored data and associate accounts with messages.
- Profile music uses a public storage bucket with opaque paths; it is not private message media. Upload only audio you have permission to share.
- Message deletion is a soft delete, not a guarantee of permanent erasure.
- Removing a member stops future database access; it cannot recall information already downloaded or copied.
- Ratings influence matching bands; they are not an AI moderation system or a guarantee of safe behavior.
- The application currently supports **human-to-human text messaging**. Chat attachments, image/video messages, voice-note recording, push notifications, and an LLM chatbot are not implemented.
- Session drafts survive reloads within the same tab, not necessarily closing the browser. Disabled browser storage can prevent persistence.
- Hosted authentication, Storage, Realtime delivery, and the submitted deployment need independent verification. Do not treat sample preview data as live results.

## Source layout

```text
src/
  App.tsx                 Sessions and messaging workspace
  components.tsx          Auth forms, dialogs, people selection, and details
  EmailAuth.tsx           Confirmed-email workspace gate
  GroupManagement.tsx     Invitations and circle administration
  Discover.tsx            Stranger matching and conversations
  Personas.tsx            Regular/anonymous profiles and music
  styles.css              Responsive theme and layout
  lib/                    Supabase client, APIs, types, preview, matching helpers
supabase/migrations/      Five ordered database migrations
 tests/                   Unit, database, and live checks
.env.example              Public frontend configuration template
vercel.json               Hosting configuration
```

## Hackathon submission

- Submit complete source through GitHub with this README and all setup files.
- Follow the requirement to keep the repository private until the hackathon ends; it may be made public at submission. Ensure organizers can access the final source.
- Provide reproducible setup instructions and a working real-time application. Deployment is optional in the statement, but the live URL is useful for judging.
- Submit a PPT covering the idea, implementation, features, and product through a publicly accessible Google Drive link.
- Submit a short working-product demonstration on YouTube with public access.
- Verify the presentation and video links in an incognito window, and confirm the submission portal and deadline with the organizers.
- Describe only implemented features; do not claim end-to-end encryption, multimedia messaging, or AI functionality.

## References

- [Supabase authentication](https://supabase.com/docs/guides/auth)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Row-Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime)
- [Vite](https://vite.dev/guide/)
- [Vercel](https://vercel.com/docs)
