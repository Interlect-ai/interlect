# Contributing

Thank you for your interest in Interlect.

- Open an issue before a larger change, so we can agree on the approach first.
- Keep pull requests focused, and run `npx tsc --noEmit`, `npx eslint src` and `npm test`
  before you open one. Changes to `db/migrations/` also need `npm run db:local -- fresh` and
  `npm run test:rls`.
- A published migration is never edited; add a new one instead.
- By contributing you agree that your contribution is licensed under the Apache License 2.0.
