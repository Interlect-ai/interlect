# Interlect

An evidence-led AI analyst for venture funds. You describe your fund once (mandate, thesis,
scoring criteria), and Interlect screens incoming companies against it, runs deep analyses with a
team of specialists, keeps a case list from first look to decision, and builds the fund's memory
(the Brain) from everything the team learns.

- **Screening and deep analysis** scored against your own criteria, with risks, team, key
  findings and the evidence behind every claim.
- **Company registers** in the Nordics and the EU (Denmark, Sweden, Norway, Finland, Estonia,
  Latvia, Lithuania, Poland, the Netherlands, France, GLEIF), so figures come from filed accounts
  where they exist. Denmark and Sweden need a key from the register (see `.env.example`).
- **The Brain**: what the fund has seen and decided, searchable and used in later analyses.
- **Your data stays yours**: it runs on your own Supabase (EU region) and Vercel accounts. AI calls
  go through the Vercel AI Gateway with zero data retention and EU inference where offered. All
  data is scoped per fund with row-level security.

**Stack:** TanStack Start (React, Vite, Nitro), Supabase (Postgres, auth, storage), Vercel
(functions, queues, cron), Vercel AI Gateway.

## Install on your own accounts

You need Node.js 24, git, a Supabase account and a Vercel account.

```bash
git clone https://github.com/Interlect-ai/interlect.git
cd interlect
npm ci
npm run setup
```

`npm run setup` asks for a Supabase access token and a Vercel token (with links to where you make
them), the fund's name, your e-mail, a language and an EU region. It then creates the database,
runs the migrations, creates your first fund, deploys the app to Vercel, checks that it is
healthy and gives you a one-time link to create your admin account. At the end it offers ten
fictional demo cases, so every screen has content from the start; a banner lets you delete them
again with one click.

Read [docs/selfhost/README.md](docs/selfhost/README.md) for what the setup does step by step,
how to update later, and **which Vercel plan you need** (the free Hobby plan runs everything,
but Vercel allows it only for personal, non-commercial use; a fund needs Vercel Pro). Every
environment variable is listed in [.env.example](.env.example).

## Develop

```bash
npm run dev          # local dev server (needs .env.local; npm run setup can write it)
npm run build        # production build
npx eslint src       # lint
npm test             # unit tests
npm run db:local     # local Postgres for the database tests (test:rls, test:demo-data-db, ...)
npm run seed:demo    # the ten fictional demo cases (no AI calls)
```

## License

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
