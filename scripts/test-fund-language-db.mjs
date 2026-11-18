#!/usr/bin/env node
/**
 * Fondens sprog: eksisterende og nye fonde er dansk, kun 'da' og 'en' er gyldige,
 * en ny fond får installationens standardsprog, og en bruger kan ikke selv ændre sproget (kun
 * serveren efter et rettighedstjek, som de øvrige fondsindstillinger i 0032). Brains
 * modstrids-indsigter fra databasen følger fondens sprog, og det gør natkørslens og
 * refleksionens indsigter også.
 *
 *   npm run db:local -- fresh && npm run test:fund-language-db
 *
 * Runs against the local test database only (scripts/local-db.mjs); the connection string is
 * built here and always points at 127.0.0.1. Everything runs in one transaction that is rolled
 * back.
 */
import pg from "pg";

const PORT = process.env["LOCAL_DB_PORT"] ?? "54322";
const LOCAL_URL = `postgresql://postgres:local-only@127.0.0.1:${PORT}/postgres`;

const FUND = "a6140000-0000-4000-8000-00000000000a";
const FUND_EN = "a6140000-0000-4000-8000-00000000000b";
const ADMIN = "a6140000-0000-4000-8000-000000000001";

const results = { passed: 0, failures: [] };
function record(name, ok, detail = "") {
  console.log(`${name.padEnd(78)} ${ok ? "✓" : "!"}`);
  if (ok) results.passed += 1;
  else results.failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

/** Runs the statement in a savepoint; returns the SQLSTATE it failed with, or null. */
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

async function language(client, fundId) {
  const { rows } = await client.query("select language from public.funds where id = $1", [fundId]);
  return rows[0]?.language;
}

async function main() {
  const client = new pg.Client({ connectionString: LOCAL_URL });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into auth.users (id, email) values ('${ADMIN}', 'language-admin@interlect.test');
       insert into public.funds (id, name, slug) values ('${FUND}', 'Sprog', 'sprog');
       insert into public.fund_memberships (fund_id, user_id) values ('${FUND}', '${ADMIN}');
       insert into public.fund_membership_roles (membership_id, role)
       select id, 'admin'::public.app_role from public.fund_memberships where user_id = '${ADMIN}';`,
    );
    record("Ny fond er dansk som standard", (await language(client, FUND)) === "da");

    const { rows: settings } = await client.query(
      "select default_language from public.ai_settings where id",
    );
    record(
      "Installationens standardsprog er dansk",
      settings.length === 0 || settings[0]?.default_language === "da",
      JSON.stringify(settings),
    );

    record(
      "Sproget kan sættes til en af serveren",
      (await failsWith(client, "update public.funds set language = 'en' where id = $1", [FUND])) ===
        null && (await language(client, FUND)) === "en",
    );
    record(
      "Et ukendt sprog afvises",
      (await failsWith(client, "update public.funds set language = 'de' where id = $1", [FUND])) ===
        "23514",
    );
    record(
      "Installationens standardsprog kan kun være da eller en",
      (await failsWith(
        client,
        `insert into public.ai_settings (id, default_language) values (true, 'sv')
           on conflict (id) do update set default_language = excluded.default_language`,
      )) === "23514",
    );

    await client.query(
      `insert into public.ai_settings (id, default_language) values (true, 'en')
         on conflict (id) do update set default_language = excluded.default_language`,
    );
    await client.query(
      `insert into public.funds (id, name, slug) values ('${FUND_EN}', 'Language', 'language')`,
    );
    record(
      "En ny fond får installationens standardsprog (en)",
      (await language(client, FUND_EN)) === "en",
    );
    record(
      "En eksisterende fond ændres ikke af installationens standard",
      (await language(client, FUND)) === "en" &&
        (await failsWith(client, "update public.funds set language = 'da' where id = $1", [
          FUND,
        ])) === null &&
        (await language(client, FUND)) === "da",
    );

    // The database's own contradiction insights follow the fund's language.
    const insight = async (fundId, title, body, key) => {
      const { rows } = await client.query(
        `insert into public.brain_insights (fund_id, kind, title, body_md, created_by_loop, dedupe_key)
         values ($1, 'contradiction', $2, $3, 'L1_extract', $4) returning title, body_md`,
        [fundId, title, body, key],
      );
      return rows[0];
    };
    const sameBody =
      "Brain har to forskellige oplysninger om det samme for samme periode. Søgningen foretrækker den med højest tillid, indtil en af dem er rettet eller afvist.";
    const english = await insight(
      FUND_EN,
      "Modstridende oplysninger: Revenue 2024 was 12m",
      sameBody,
      "t624-en",
    );
    record(
      "Engelsk fond: modstridsindsigten står på engelsk (titel og forklaring)",
      english?.title === "Conflicting information: Revenue 2024 was 12m" &&
        english?.body_md.startsWith("Brain has two different pieces"),
      JSON.stringify(english),
    );
    const sources = await insight(FUND_EN, "Modstridende kilder: ARR", "Egen tekst.", "t624-src");
    record(
      "Engelsk fond: 'Modstridende kilder' bliver 'Conflicting sources', egen tekst røres ikke",
      sources?.title === "Conflicting sources: ARR" && sources?.body_md === "Egen tekst.",
      JSON.stringify(sources),
    );
    const danish = await insight(FUND, "Modstridende kilder: ARR", sameBody, "t624-da");
    record(
      "Dansk fond: indsigten er uændret",
      danish?.title === "Modstridende kilder: ARR" && danish?.body_md === sameBody,
      JSON.stringify(danish),
    );

    // The nightly run's and the reflection's insights follow the team's language too.
    const insightOf = async (fundId, kind, title, body, key, refs = []) => {
      const { rows } = await client.query(
        `insert into public.brain_insights (fund_id, kind, title, body_md, refs, created_by_loop, dedupe_key)
         values ($1, $2, $3, $4, $5::jsonb, 'L4_nightly', $6) returning title, body_md`,
        [fundId, kind, title, body, JSON.stringify(refs), key],
      );
      return rows[0];
    };
    const staleBody =
      "Det nyeste nøgletal, Brain har om Acme, Inc., gælder 31-12-2023, mere end 18 måneder siden. Hent nye tal, før casen vurderes igen.";
    const stale = await insightOf(
      FUND_EN,
      "stale_fact",
      "Forældede nøgletal: Acme, Inc.",
      staleBody,
      "t628-stale",
    );
    record(
      "Engelsk team: forældede nøgletal på engelsk, navn og dato står",
      stale?.title === "Outdated key figures: Acme, Inc." &&
        stale?.body_md ===
          "The newest key figure Brain has about Acme, Inc. is from 31-12-2023, more than 18 months ago. Get new figures before the case is assessed again.",
      JSON.stringify(stale),
    );
    const { rows: entities } = await client.query(
      `insert into public.brain_entities (fund_id, type, name, normalized_key) values
         ($1, 'company', 'Nordic "Labs" ApS', 'nordic-labs'), ($1, 'company', 'Nordic Labs', 'nordic-labs-2')
       returning id`,
      [FUND_EN],
    );
    const entityMerge = await insightOf(
      FUND_EN,
      "merge_candidate",
      'Er "Nordic "Labs" ApS" og "Nordic Labs" det samme?',
      "De har samme CVR-nummer, men Brain kunne ikke lægge dem sammen automatisk. Læg dem sammen, hvis de er det samme.",
      "t628-merge-entity",
      entities.map((row) => ({ kind: "entity", id: row.id })),
    );
    record(
      "Engelsk team: to enheder, der måske er det samme, på engelsk (navne med citationstegn står)",
      entityMerge?.title === 'Are "Nordic "Labs" ApS" and "Nordic Labs" the same?' &&
        entityMerge?.body_md ===
          "They have the same CVR number, but Brain could not merge them automatically. Merge them if they are the same.",
      JSON.stringify(entityMerge),
    );
    const renamed = await insightOf(
      FUND_EN,
      "merge_candidate",
      'Er "Nordic Labs Old" og "Nordic Labs" det samme?',
      "De har samme domæne, men Brain kunne ikke lægge dem sammen automatisk. Læg dem sammen, hvis de er det samme.",
      "t628-merge-renamed",
      entities.map((row) => ({ kind: "entity", id: row.id })),
    );
    record(
      "Engelsk team: en titel, hvis navne ikke længere passer, står helt på dansk (ikke halvt)",
      renamed?.title === 'Er "Nordic Labs Old" og "Nordic Labs" det samme?' &&
        renamed?.body_md.startsWith("De har samme domæne"),
      JSON.stringify(renamed),
    );
    const lessonMerge = await insightOf(
      FUND_EN,
      "merge_candidate",
      "Er lektion L-3 og L-7 den samme?",
      "De to lektioner siger næsten det samme. Læg dem sammen, eller afvis den ene.",
      "t628-merge-bullet",
    );
    record(
      "Engelsk team: to lektioner, der måske er den samme, på engelsk",
      lessonMerge?.title === "Are lessons L-3 and L-7 the same?" &&
        lessonMerge?.body_md ===
          "The two lessons say almost the same thing. Merge them, or reject one of them.",
      JSON.stringify(lessonMerge),
    );
    const retire = await insightOf(
      FUND_EN,
      "bullet_retire",
      "Pensionér lektion L-3?",
      'Lektionen "Check churn before ARR" har talt imod 4 gange og for 1 gange. Brain foreslår at pensionere den.',
      "t628-retire",
    );
    record(
      "Engelsk team: forslag om at pensionere en lektion på engelsk, lektionens tekst står",
      retire?.title === "Retire lesson L-3?" &&
        retire?.body_md ===
          'The lesson "Check churn before ARR" stands at 4 against and 1 for. Brain suggests retiring it.',
      JSON.stringify(retire),
    );
    const lesson = await insightOf(
      FUND_EN,
      "lesson_candidate",
      "Ny lektion L-9: Check churn before ARR",
      'Brain foreslår lektionen "Check churn before ARR" ud fra beslutningen. Den bliver aktiv, når en anden bruger bekræfter den i en anden case, eller når den godkendes under Brain · Lært.',
      "t628-lesson",
    );
    record(
      "Engelsk team: ny lektion på engelsk",
      lesson?.title === "New lesson L-9: Check churn before ARR" &&
        lesson?.body_md ===
          'Brain suggests the lesson "Check churn before ARR" from the decision. It becomes active when another user confirms it in another case, or when it is approved under Brain · Learned.',
      JSON.stringify(lesson),
    );
    const ownText = await insightOf(
      FUND_EN,
      "stale_fact",
      "Old figures",
      "Our own words.",
      "t628-own",
    );
    record(
      "Engelsk team: en tekst uden det danske mønster røres ikke",
      ownText?.title === "Old figures" && ownText?.body_md === "Our own words.",
      JSON.stringify(ownText),
    );
    const danishStale = await insightOf(
      FUND,
      "stale_fact",
      "Forældede nøgletal: Acme, Inc.",
      staleBody,
      "t628-da",
    );
    record(
      "Dansk team: natkørslens indsigt er uændret",
      danishStale?.title === "Forældede nøgletal: Acme, Inc." && danishStale?.body_md === staleBody,
      JSON.stringify(danishStale),
    );

    await client.query("savepoint as_user");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ADMIN]);
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: ADMIN, role: "authenticated" }),
      ]);
      const { rows } = await client.query("select language from public.funds where id = $1", [
        FUND,
      ]);
      record(
        "Som bruger: fondens sprog kan læses",
        rows[0]?.language === "da",
        JSON.stringify(rows),
      );
      const code = await failsWith(
        client,
        "update public.funds set language = 'en' where id = $1",
        [FUND],
      );
      record("Som bruger (Admin): sproget kan ikke ændres direkte", code === "42501", code);
    } finally {
      await client.query("rollback to savepoint as_user");
    }
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
