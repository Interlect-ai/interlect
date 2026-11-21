#!/usr/bin/env node
/**
 * Demovisningen: kun det engelske demoteam (slug "interlect-demo") får
 * `funds.demo_view`; nye og andre fonde står fra, og en bruger kan ikke ændre kolonnen, hverken
 * som Admin eller som Partner. Selve migrationen 0108 køres her på to fonde. 0111: et opdigtet navn
 * har én ejer pr. team, og navne for det samme selskab eller den samme person deler det. 0126
 * Demoteamet slår demovisningen fra igen, uden at andre fonde eller aliasser røres.
 *
 *   npm run db:local -- fresh && npm run test:demo-view-db
 *
 * Runs against the local test database only (scripts/local-db.mjs). Everything runs in one
 * transaction that is rolled back.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const DEMO = "a7630000-0000-4000-8000-00000000000a";
const OTHER = "a7630000-0000-4000-8000-00000000000b";
const ADMIN = "a7630000-0000-4000-8000-000000000001";

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(78)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function failsWith(client, sql, params = []) {
  await client.query("savepoint attempt");
  try {
    await client.query(sql, params);
    await client.query("release savepoint attempt");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return error.code ?? "unknown";
  }
}

const flag = async (client, id) =>
  (await client.query("select demo_view from public.funds where id = $1", [id])).rows[0]?.demo_view;

const aliasCount = async (client) =>
  Number((await client.query("select count(*)::int as n from public.display_aliases")).rows[0].n);

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, email) values ('${ADMIN}', 'demo-view-admin@interlect.test');
       insert into public.funds (id, name, slug) values ('${DEMO}', 'Demo', 'interlect-demo');
       insert into public.funds (id, name, slug) values ('${OTHER}', 'Kunde', 'kunde-t763');
       insert into public.fund_memberships (fund_id, user_id) values ('${DEMO}', '${ADMIN}');
       insert into public.fund_membership_roles (membership_id, role)
       select id, 'admin'::public.app_role from public.fund_memberships where user_id = '${ADMIN}';`,
    );
    record(
      "Nye fonde starter med demovisningen slået fra",
      (await flag(client, DEMO)) === false && (await flag(client, OTHER)) === false,
    );

    // The migration brings its own begin/commit; the test runs inside one rolled-back transaction.
    const migration = readFileSync(
      new URL("../db/migrations/0108_demo_view_for_english_team.sql", import.meta.url),
      "utf8",
    ).replace(/^(begin|commit);$/gm, "");
    await client.query(migration);
    record(
      "Efter 0108: kun det engelske demoteam har demovisning",
      (await flag(client, DEMO)) === true && (await flag(client, OTHER)) === false,
    );
    await client.query(migration);
    record(
      "0108 kan køres igen uden ændring",
      (await flag(client, DEMO)) === true && (await flag(client, OTHER)) === false,
    );

    await client.query("savepoint as_user");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated" }),
      ]);
      const code = await failsWith(
        client,
        "update public.funds set demo_view = false where id = $1",
        [DEMO],
      );
      record("Som bruger (Admin): demovisningen kan ikke slås fra", code === "42501", code);
      const codeOn = await failsWith(
        client,
        "update public.funds set demo_view = true where id = $1",
        [DEMO],
      );
      record("Som bruger (Admin): demovisningen kan ikke slås til", codeOn === "42501", codeOn);
    } finally {
      await client.query("rollback to savepoint as_user");
    }
    record("Demovisningen er uændret efter forsøgene", (await flag(client, DEMO)) === true);

    // 0111: ét opdigtet navn har én ejer pr. team; andre navne for det samme deler det.
    // Rækker fra før 0111 (alle uden ejer), som på staging: mærke- og juridisk navn deler et alias.
    await client.query(
      `insert into public.display_aliases (fund_id, kind, real_name, alias, created_at) values
         ($1, 'company', 'Veo Technologies ApS', 'Lindor Security', now() - interval '1 day'),
         ($1, 'company', 'Veo', 'Lindor Security', now()),
         ($1, 'person', 'Félix Blossier', 'Livia Korsgaard', now())`,
      [DEMO],
    );
    const migration0111 = readFileSync(
      new URL("../db/migrations/0111_display_alias_one_owner.sql", import.meta.url),
      "utf8",
    ).replace(/^(begin|commit);$/gm, "");
    await client.query(migration0111);
    await client.query(migration0111);
    const owners = (
      await client.query(
        `select real_name from public.display_aliases where fund_id = $1 and owns_alias
         order by real_name`,
        [DEMO],
      )
    ).rows.map((row) => row.real_name);
    record(
      "Efter 0111 (to gange): den første række med hvert alias ejer det",
      owners.join("|") === "Félix Blossier|Veo Technologies ApS",
      owners.join("|"),
    );
    const insertAlias = (fund, real, alias, owns) =>
      failsWith(
        client,
        `insert into public.display_aliases (fund_id, kind, real_name, alias, owns_alias)
         values ($1, 'company', $2, $3, $4)
         on conflict (fund_id, real_key) do nothing`,
        [fund, real, alias, owns],
      );
    const taken = await insertAlias(DEMO, "Northwind", "lindor security", true);
    record("Et andet navn kan ikke eje et alias, der er taget", taken === "23505", taken);
    record(
      "Et navn for det samme selskab kan dele aliaset",
      (await insertAlias(DEMO, "Veo Tech", "Lindor Security", false)) === null,
    );
    record(
      "Et navn, der allerede har et alias, springes over uden fejl",
      (await insertAlias(DEMO, "Veo", "Livia Korsgaard", true)) === null,
    );
    record(
      "Et andet team kan eje samme alias",
      (await insertAlias(OTHER, "Northwind", "Lindor Security", true)) === null,
    );

    // 0126: demovisningen slås fra igen på det engelske demoteam; intet slettes.
    await client.query("update public.funds set demo_view = true where id = $1", [OTHER]);
    const aliasesBefore = await aliasCount(client);
    const migration0126 = readFileSync(
      new URL("../db/migrations/0126_demo_view_off_interlect_demo.sql", import.meta.url),
      "utf8",
    ).replace(/^(begin|commit);$/gm, "");
    await client.query(migration0126);
    record(
      "Efter 0126: demoteamet har ikke længere demovisning; andre fonde røres ikke",
      (await flag(client, DEMO)) === false && (await flag(client, OTHER)) === true,
    );
    await client.query(migration0126);
    record(
      "0126 kan køres igen uden ændring",
      (await flag(client, DEMO)) === false && (await flag(client, OTHER)) === true,
    );
    record("0126 sletter ingen aliasser", (await aliasCount(client)) === aliasesBefore);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
  console.log(`\n${results.passed} tjek som forventet, ${results.failures.length} afvigelser.`);
  if (results.failures.length) {
    for (const failure of results.failures) console.error(`  ! ${failure}`);
    process.exit(1);
  }
}

await main();
