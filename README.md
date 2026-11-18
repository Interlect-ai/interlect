# Interlect

Interlect is an AI analyst for investment teams. A team writes down its investment thesis once;
Interlect then turns a pitch deck, a website or a short description into a case, researches the
company in public sources and company registers, screens it against the thesis, and, when a
person asks for it, runs a deep analysis with a team of specialists. Brain, the team's own
knowledge layer, remembers what the team has learned across cases.

A few principles run through the code:

- **AI does the groundwork; people decide.** Interlect never contacts founders or moves a case
  to a decision on its own.
- **Scores and financial maths are computed in code, never by a model.** Missing input is shown
  as "cannot be calculated", never guessed.
- **Only stored evidence may be cited**, and missing data lowers confidence instead of counting
  against a company.
- **Teams never see each other's data**: every table is scoped to its team and protected by
  row-level security.

## Stack

- [TanStack Start](https://tanstack.com/start) (React 19, Vite), deployed on Vercel
- [Supabase](https://supabase.com) (Postgres 17, Auth, Storage) with row-level security
- Model calls through the Vercel AI Gateway (`ai` SDK), with zero data retention enforced
- Background work (screening, deep analysis, Brain) on Vercel Queues

## Getting started

Requirements: Node 24, npm, and Docker for the local test database.

```bash
npm ci
cp .env.example .env.local   # fill in your Supabase project and AI Gateway key
npm run dev
```

Apply the migrations in `db/migrations/` to your Supabase project in order:

```bash
DATABASE_URL=postgres://... node scripts/run-migrations.mjs
```

## Checks

```bash
npx tsc --noEmit
npx eslint src
npm test
npm run db:local -- fresh   # a throwaway Postgres in Docker with every migration
npm run test:rls            # row-level security tests against that database
```

## Licence

Apache License 2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
