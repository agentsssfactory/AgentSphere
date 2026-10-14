# AgentSphere

An AI-agent workspace: customers run agents and request custom ones, the admin team reviews, quotes and takes payment, and everything is tracked.

- `index.html`: the whole site
- `lib/backend.js`: sign-in, access rules and storage (**Neon Postgres**, or a local file during development)
- `server.js`: runs everything on your computer (`npm start`)
- `api/index.js` + `vercel.json`: the same backend as a Vercel serverless function

## Deploy to Vercel with Neon Postgres

1. **Push to GitHub.** In this folder:
   `git init -b main && git add . && git commit -m "AgentSphere"`, create an empty repository online, then
   `git remote add origin <url> && git push -u origin main`.
2. **Import in Vercel.** Add New → Project → pick the repository. No build settings are needed.
3. **Add the database.** In the project: Storage → Create Database → **Neon (Postgres)** → connect it to this project. Vercel adds `DATABASE_URL` for you.
   (Using an existing Neon project instead? Copy its connection string from Neon → Connection details and add it as `DATABASE_URL`.)
4. **Set environment variables** (Settings → Environment Variables):

   | Name | Value |
   |---|---|
   | `SESSION_SECRET` | **required.** Long random text, e.g. the output of `openssl rand -hex 32` |
   | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | the admin login created on first use (defaults: `admin@agentsphere.com` / `admin1234`) |
   | `TEAM_EMAIL` / `TEAM_PASSWORD` | the pricing-team login (defaults: `team@agentsphere.com` / `team1234`) |
   | `ANTHROPIC_API_KEY` | optional: turns on the Research, Finance, Support and Social agents |

5. **Deploy** (or Redeploy after adding variables). The table `agentsphere_kv` and the admin accounts are created automatically on the first request.

If something is missing, the sign-in screen says what (for example "DATABASE_URL is not set").

## Run it on your computer

1. Install [Node.js 20+](https://nodejs.org/), unzip this folder and open a terminal in it.
2. `cp .env.example .env` (Windows: `copy .env.example .env`) and fill in what you need.
3. `npm install` (adds the Neon driver), then `npm start`, then open http://localhost:3000

Without `DATABASE_URL`, data is kept in `data/kv.json` on your computer. Put your Neon connection string in `DATABASE_URL` to use the same database as your Vercel site.

## Sign in

| Who | Choose | Email | Password |
|---|---|---|---|
| Customer | **User** | create one with "Create one!" | your choice (8+ characters) |
| Admin | **Admin** | `ADMIN_EMAIL` (default `admin@agentsphere.com`) | `ADMIN_PASSWORD` (default `admin1234`) |
| Pricing team | **Admin** | `TEAM_EMAIL` (default `team@agentsphere.com`) | `TEAM_PASSWORD` (default `team1234`) |

Change the default passwords before you share the site. Changing `ADMIN_PASSWORD` later does not change an existing admin; use **Settings → Change password**.
The 5-minute walkthrough is in [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).

## How data and sign-in work

- **Accounts:** passwords are checked on the server and stored as salted scrypt hashes. The browser never receives a password hash.
- **Sessions:** signing in returns a signed token (HMAC with `SESSION_SECRET`, valid 14 days). Every data request needs it.
- **Who sees what:** a customer only receives their own account, requests, payments and workspace. Staff (admin, pricing team) see all customers.
- **Who changes what:** a customer can only change their own data. Only an admin can suspend, delete or reset a customer. Roles can't be changed from the browser.
- **Storage:** one Postgres table, `agentsphere_kv (k, v, at, updated_at)`. It holds `as_users`, `as_requests`, `as_admin` and one `as_data:<email>` row per customer workspace, written last-writer-wins.

## My Workplace

A customer's single AI workspace (menu: **My Workplace**). Instead of a chat per agent, one assistant answers across all of the customer's agents and cites where each fact came from.

- **What it searches, per agent:** its capabilities, knowledge the customer added (paste text or upload `.txt`, `.md`, `.csv` or `.json`, up to 40 KB per item and 150 KB in total), completed run results, and its records (leads, jobs, slips, quotes, part orders).
- **How:** the question is ranked against all of that (BM25 keyword ranking, de-duplicated, at most three passages per agent). The best passages go to Claude with strict instructions to answer only from them and cite `[n]`. Broad questions ("summarize…", "latest…") pull the newest material from every agent.
- **Where it runs:** with `server.js` or Vercel, retrieval and the AI call happen on the server, from the signed-in customer's own workspace only (`POST /api/workplace/chat`). On the hosted claude.ai page they run in the browser on the customer's own data.
- **Without an AI key:** it shows the most relevant saved passages with sources instead of an answer, and says so.
- **Saved:** conversations and knowledge are stored with the customer's workspace (Neon on the server), so they follow the customer across devices.
- **Limits, stated in the UI:** no live access to outside systems. Answers come from saved data and say "as recorded on <date>". It is keyword retrieval, not vector search; swap in embeddings when knowledge grows beyond a few hundred passages.

## Connectors

Marketplace → **Connectors** lists Gmail, Google Calendar, Drive, GitHub, Slack, Notion, Stripe, Shopify and 30 more.

- **Connect** opens the provider's official sign-in page in a pop-up (for example accounts.google.com → "Choose an account").
  After the customer approves, the provider sends them back to `/api/connectors/callback`, the server exchanges the code
  for tokens and stores them **encrypted** (AES-256-GCM, key derived from `SESSION_SECRET`) under `as_conn:<email>`.
  Tokens never go to the browser, not even to admins. **Disconnect** deletes them.
- Services without a sign-in page (Stripe — checked against Stripe before saving, Plaid, Vercel, Wix, Trello, Twilio, WhatsApp, PostgreSQL, Granola) ask for an API key
  instead, stored the same way.
- **Custom** (New Connector → Custom) saves a name and server URL for your own connector.

To turn a provider on:
1. Create an OAuth app in that company's developer console.
2. Set its redirect URL to `<APP_URL>/api/connectors/callback` (e.g. `https://your-app.vercel.app/api/connectors/callback`).
3. Put `<GROUP>_CLIENT_ID` and `<GROUP>_CLIENT_SECRET` in `.env` / Vercel env vars (see `.env.example`), plus `APP_URL`.
4. Google, Microsoft and some others review apps that ask for mailbox or file access before other people can use them.
   Until then only test users you add in their console can sign in.

Without a provider's keys, Connect says the connector isn't set up yet. In the claude.ai preview (no server) Connect opens the
service's official page in a new tab and explains that connecting needs the server.

**Agents use connected apps live.** When a customer asks the Workplace Assistant or any agent a question, the server
(`lib/live.js`) reads the relevant connected apps right then with that customer's own access, and the answer cites them
as "Live · Gmail", "Live · Stripe", … with a link back to the item. Read-only; nothing is changed in the apps.

| App | What agents can read |
|---|---|
| Gmail | recent / unread / matching emails (sender, subject, preview) |
| Google Calendar | events today, tomorrow or the next 7 days |
| Google Drive | files matching the question, or recently changed files |
| Outlook / Microsoft 365 | emails and the next 7 days of calendar |
| GitHub | pull requests and issues involving you, recent repositories |
| Slack | messages matching the question |
| Notion | pages matching the question, with their text |
| Stripe | balance and the latest payments |
| Box | files matching the question |
| Twilio | latest SMS |
| HubSpot | contacts matching the question |

Expired Google / Microsoft tokens are refreshed automatically. If an app can't be read (for example access was revoked),
the answer says so and asks the customer to reconnect it in Plugins. Other connectors are stored and shown as connected;
their readers can be added the same way in `lib/live.js`.

Logos: put official logo files in `logos/` and list them in `WP_LOGOS` (see `logos/README.md`).

## What is real and what is a demo

| Area | Status |
|---|---|
| Sign-in, accounts, roles | Real: server-checked, stored in Neon |
| My Workplace (one assistant across all agents) | Real retrieval over the customer's own agent data with cited sources; AI answers need `ANTHROPIC_API_KEY` |
| Requests → review → quote → pay → deliver | Works end to end, stored in Neon |
| The six tool agents (ChangeSlip, FormFirst, AfterJob, Nudge, OpenPing, PartPing) | **Run** opens each agent's live app; **Download** gives its code |
| Research / Finance / Support / Social agents | Real AI answers when `ANTHROPIC_API_KEY` is set |
| Payments | **Simulated checkout.** No money moves. Test card `4242 4242 4242 4242`, any future date, any 3 digits |
| Emails / SMS | Never sent. The agents write the text and you copy it |

## Before this is a production product

- A real payment gateway (Razorpay or Stripe) confirmed on the server.
- Real email and SMS delivery.
- Proper tables (users, requests, payments) instead of one key-value table, once the data model settles.
- Rate limits stored in the database rather than per server instance.

## Files

- `index.html`: the site
- `lib/backend.js`: backend logic (storage, sign-in, access rules, AI proxy)
- `api/index.js`, `vercel.json`: Vercel function and routing
- `server.js`: local server (`npm start`)
- `zips/`: the agent downloads (ZIP files stored as base64 text)
- `.env.example`: settings template
- `docs/DEMO-SCRIPT.md`: presenter's walkthrough
