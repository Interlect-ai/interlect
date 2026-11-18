# Self-hosting Interlect

Interlect runs on your own **Supabase** (database, sign-in, files; EU region) and your own
**Vercel** (app, queues, cron, AI Gateway). One command sets up everything:

```bash
npm ci
npm run setup
```

It asks for two tokens and four answers, nothing else:

| Asked for | Where to get it | Why |
|---|---|---|
| Supabase access token | https://supabase.com/dashboard/account/tokens | creates the database project, runs the migrations, reads the project's API keys |
| Vercel token | https://vercel.com/account/tokens | creates the Vercel project, sets its variables, deploys |
| The fund's name, the admin's e-mail, language (en/da), EU region | you | the first fund and your admin account |

The tokens are never written to disk (you can also give them as `SUPABASE_ACCESS_TOKEN` and
`VERCEL_TOKEN`). There is no AI key to create: on Vercel the app calls the AI Gateway with the
project's own OIDC token, and the usage is billed to your Vercel account.

## What the setup does

1. Creates a Supabase project `interlect-<fund>` in the EU region you chose and waits until it is healthy.
2. Runs every migration (`db/migrations`) and checks the result: RLS on every table, nothing readable without signing in, private storage buckets.
3. Sets the language and currency and turns the **credit system off**.
4. Creates the first fund with a draft setup from the Venture template (you finish it in *Fund setup*).
5. Creates a Vercel project with the functions next to the database, the OIDC token on and Standard Protection (your production address is public and behind the app's own sign-in; previews are behind Vercel's login).
6. Sets the production variables: the project's own Supabase keys, a new random `CRON_SECRET`, zero-data-retention and EU inference for AI, credits and internal pages off.
7. Uploads this checkout's tracked files and lets Vercel build and deploy them.
8. Sets sign-in to invite-only with password and your new address, calls `/api/health`, and prints your one-time admin invitation link.
9. Offers to write `.env.local` for local development and to load fictional demo data (default yes).

Progress is saved in `.selfhost/state.json` (no secrets). If anything stops, fix it and run
`npm run setup` again: it continues where it stopped and never creates anything twice. It only
uses projects it created itself; if your account already has a project with the same name, it
stops and tells you. Without a terminal (CI), give everything as variables: `SUPABASE_ACCESS_TOKEN`,
`VERCEL_TOKEN` (+ `VERCEL_TEAM_ID`), `SUPABASE_ORG_SLUG`, `SETUP_FUND_NAME`, `SETUP_ADMIN_EMAIL`,
`SETUP_LANGUAGE`, `SETUP_REGION`.

## Demo data

The setup's last question loads **10 fictional demo cases** (default yes), so every screen has
content before your first real case: screenings, risks, team, notes, decisions and five deep
analyses with charts. No AI is called and nothing costs money; the results are pre-written. Every
company is shown with "(demo)", every address is on the reserved `.example` domain, and no company
or person in them is real. The texts are in English.

Run it yourself at any time (it never creates anything twice):

```bash
npm run seed:demo -- --fund <fundId>
```

`--fund` can be left out when the installation has one fund; `--dry-run` shows the plan. It reads
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the environment or `.env.local`.

While demo data exists, a banner at the top of every page says so. An admin removes it with
**Delete demo data** in that banner: exactly the demo rows are deleted (your own cases are never
touched), and the deletion is written to the audit log. With no cases, the case list shows the
first case in five steps.

**Updating later:** once every step is done, `npm run setup` does not migrate or redeploy again.
After `git pull`, run the new migrations with `DATABASE_URL=<your session pooler URL> node
scripts/run-migrations.mjs` and redeploy from the Vercel dashboard (or connect your fork's
GitHub repository to the Vercel project, so every push deploys).

All variables are listed in [`.env.example`](../../.env.example).

## Which Vercel plan do you need?

Checked against Vercel's documentation on 17 Nov 2026:

| Interlect uses | Hobby (free) | Pro | Source |
|---|---|---|---|
| **Vercel Queues** (screening, deep analysis, Brain) | Yes, "available in Beta on all plans"; first 1,000,000 queue operations included | Yes, usage-based | [vercel.com/docs/queues](https://vercel.com/docs/queues), [queues/pricing](https://vercel.com/docs/queues/pricing) |
| **Cron** (Brain's nightly job, `15 2 * * *`) | Yes; Hobby crons may run at most once a day, and fire within the hour (02:00–02:59) | Yes, per minute | [schedules/cron-jobs/usage-and-pricing](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing) |
| **300 s function duration** (`maxDuration: 300`) | Yes: 300 s is Hobby's default and maximum with Fluid compute (on by default) | Up to 800 s | [functions/configuring-functions/duration](https://vercel.com/docs/functions/configuring-functions/duration), [functions/limitations](https://vercel.com/docs/functions/limitations) |
| **Standard Protection** (previews behind login) | Yes, all plans | Yes | [deployment-protection](https://vercel.com/docs/deployment-protection) |
| **AI Gateway** | Pay-as-you-go credits on the account | Same | Vercel dashboard → AI Gateway |

**Technically, Hobby runs everything Interlect needs.** But Vercel's terms say a Hobby plan may
only be used "for your personal or non-commercial use" ([vercel.com/legal/terms](https://vercel.com/legal/terms), section 4).
A fund screening real deals is commercial use, so **a fund needs Vercel Pro** ($20 per member per
month plus usage). Hobby is fine to try Interlect with the demo data.

Notes:
- Interlect's only cron runs once a day, so Hobby's daily limit is enough.
- Every analysis phase is built to finish within 300 s (`nitro.config.ts`), so Pro's longer limit is not needed.
- Supabase's free plan pauses a project after a week without use; a fund in daily use should use Supabase Pro.
