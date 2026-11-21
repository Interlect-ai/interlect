# Set up Interlect on your own accounts

This guide takes you from nothing to a running Interlect in about **30 minutes**, one step at a
time. You do not need to be a developer, but you will paste a few commands into a terminal. Every
command is written out; copy it exactly.

**What you end up with:** your own copy of Interlect, running at an address of your own, with the
database in the EU, behind your own sign-in. Nothing is shared with anyone else, and nothing runs
on our servers.

## Contents

1. [What you need](#1-what-you-need)
2. [Install Node.js and git](#2-install-nodejs-and-git)
3. [Create your two accounts](#3-create-your-two-accounts)
4. [Make the two access tokens](#4-make-the-two-access-tokens)
5. [Download the code](#5-download-the-code)
6. [Run the setup](#6-run-the-setup)
7. [Sign in and set up your fund](#7-sign-in-and-set-up-your-fund)
8. [What it costs](#8-what-it-costs)
9. [If something stops](#9-if-something-stops)
10. [Updating later](#10-updating-later)
11. [Removing everything](#11-removing-everything)

## 1. What you need

| | |
|---|---|
| A computer | macOS, Windows or Linux, with an internet connection |
| Node.js 24 or newer | the program that runs the setup (step 2) |
| git | to download the code (step 2) |
| A Supabase account | holds the database, the sign-in and the files (step 3) |
| A Vercel account | runs the app and the AI calls (step 3) |
| About 30 minutes | most of it is waiting for the database and the first deploy |

You do **not** need an AI key. On Vercel the app calls the AI Gateway with its own project
credentials, and the AI usage is billed to your Vercel account (see [what it costs](#8-what-it-costs)).

## 2. Install Node.js and git

Open a terminal: on macOS the app **Terminal**, on Windows **PowerShell**, on Linux your terminal.
Check what you already have:

```bash
node --version
git --version
```

- If `node --version` shows `v24` or higher and git prints a version, go to step 3.
- **Node.js:** download the **LTS or Current 24.x** installer from https://nodejs.org and run it.
  Close and reopen the terminal, then check `node --version` again.
- **git:** macOS offers to install it the first time you run `git --version`. On Windows, install
  https://git-scm.com/download/win. On Linux use your package manager (`sudo apt install git`).

## 3. Create your two accounts

1. **Supabase** at https://supabase.com. Sign up and, when asked, create an **organization** (any
   name). The free plan is enough to try Interlect.
2. **Vercel** at https://vercel.com. Sign up (the free **Hobby** plan is enough to try it; see
   [what it costs](#8-what-it-costs) for what a real team needs).

## 4. Make the two access tokens

A token lets the setup create things in your account on your behalf. You make them once, paste them
into the setup, and can delete them afterwards. They are never saved to disk.

- **Supabase token:** open https://supabase.com/dashboard/account/tokens, click **Generate new
  token**, give it a name such as *interlect-setup*, and copy it.
- **Vercel token:** open https://vercel.com/account/tokens, create a token named
  *interlect-setup* (scope: your account, or the team that should own the app), and copy it.

Keep both open in a note for the next step. Treat them like passwords.

## 5. Download the code

In the terminal, go to a folder where you keep projects and run:

```bash
git clone https://github.com/Interlect-ai/interlect.git
cd interlect
npm ci
```

`npm ci` downloads everything the code needs. It takes one to three minutes and prints a lot of
text; warnings about "deprecated" packages are normal.

## 6. Run the setup

```bash
npm run setup
```

It asks, in this order:

| Question | What to answer |
|---|---|
| Supabase access token | paste the token from step 4 |
| Which Supabase organisation | pick yours (a number) |
| Vercel token | paste the token from step 4 |
| Which Vercel account | your personal account or a team (a number) |
| The fund's name | e.g. *Nordic Seed I*. This is the name your team sees |
| The admin's e-mail | **your** e-mail; the sign-in link goes to this address |
| Language, `en` or `da` | the language of the app and of the demo texts |
| Region | press Enter for `eu-central-1` (Frankfurt), or choose `eu-west-1`, `eu-west-3` or `eu-north-1` |

Then it works by itself and prints each step. It takes about **10 to 15 minutes**, and most of that
is waiting for Supabase to start and for Vercel to build:

1. creates the database project in the EU and waits until it is healthy
2. runs all database migrations and verifies row-level security on every table
3. creates your fund with a draft setup
4. creates the Vercel project, sets its variables and deploys the app
5. checks that the app is healthy
6. prints a **one-time admin link**

The very last question is whether to load **ten fictional demo cases**. Say **yes** the first time:
every screen has content from the start, no AI is called, and nothing costs money. A banner at the
top of every page says the demo data is there, and **Delete demo data** in that banner removes
exactly those rows and nothing else.

### Good to know

- **Safe to run again.** If anything stops, fix the cause and run `npm run setup` again. It
  continues where it stopped and never creates anything twice. Progress is kept in
  `.selfhost/state.json` (it contains no secrets).
- **It only touches what it made.** If your account already has a project with the same name, it
  stops and tells you instead of using it.
- **No terminal prompts?** You can give every answer as an environment variable. See the table in
  [docs/selfhost/README.md](docs/selfhost/README.md).

## 7. Sign in and set up your fund

1. Open the **one-time admin link** the setup printed. It creates your account: choose a password
   (and set up two-factor sign-in if you are asked to).
2. You land in your own Interlect. Your address is the Vercel address the setup printed at the end.
3. Open **Team setup** in the menu and describe your fund: mandate, thesis, criteria, weights and
   deal-breakers. A draft from the Venture template is already there; change it to fit your team.
   Everything Interlect does is scored against this.
4. Add a case (**New case** in the menu): upload a pitch deck or enter the company. Interlect
   reads it, checks the registers, researches the web and screens it against your thesis.
5. Invite your colleagues from **Users and access**. Sign-in is by invitation only.
6. Try **Brain**: ask it about your cases once you have a few, for example *"Which open questions
   recur across cases?"*

Using the demo cases first is the quickest way to see everything: open a deep analysis, ask Brain
about a demo company, then delete the demo data when you are ready for real cases.

## 8. What it costs

Interlect itself is free (Apache-2.0). You pay your two providers directly:

| What | Free to try | For a team in daily use |
|---|---|---|
| **Vercel** | **Hobby** (free) runs everything Interlect needs | **Pro**: Vercel's terms allow Hobby only for personal, non-commercial use, and a fund screening real deals is commercial use. Pro is $20 per member per month plus usage |
| **Supabase** | Free plan; it **pauses a project after a week without use** | **Pro** for anything in daily use |
| **AI usage** | the demo data uses no AI at all | billed to your Vercel account through the AI Gateway, per screening, deep analysis and Brain answer |

The detailed, source-checked comparison of Vercel plans (Queues, Cron, function duration) is in
[docs/selfhost/README.md](docs/selfhost/README.md#which-vercel-plan-do-you-need).

## 9. If something stops

| You see | Do this |
|---|---|
| `node: command not found` or a version below 24 | repeat [step 2](#2-install-nodejs-and-git) and open a new terminal |
| `npm ci` fails with a network error | check your connection and run it again |
| A token is refused | make a new token (step 4) and run `npm run setup` again |
| "a project with the same name already exists" | the setup will not touch something it did not create. Pick a different fund name, or delete the old project in the Supabase/Vercel dashboard |
| The setup stops half way | fix what it says, then run `npm run setup` again; it continues |
| The Vercel token "is limited to one team" | the setup asks for the team id: Vercel, Team Settings, General, **Team ID** (starts with `team_`) |
| The app opens but says it cannot reach the database | the Supabase project may be paused (free plan): open it in the Supabase dashboard and restore it |

Still stuck? Open an issue at https://github.com/Interlect-ai/interlect/issues with the last lines
the setup printed (never paste a token).

## 10. Updating later

When a new version is published:

```bash
git pull
npm ci
```

Then apply the new database migrations and redeploy:

```bash
DATABASE_URL=<your session pooler URL> node scripts/run-migrations.mjs
```

and redeploy from the Vercel dashboard. If you connect your own GitHub copy (a fork) of this
repository to the Vercel project, every push deploys automatically. Your session pooler URL is in
Supabase, **Project Settings, Database, Connection string, Session pooler**.

## 11. Removing everything

Delete the Vercel project in the Vercel dashboard and the database project in the Supabase
dashboard. That removes the app and all its data. You can also delete the two access tokens from
step 4.
