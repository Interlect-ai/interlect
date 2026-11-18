import { test } from "node:test";
import assert from "node:assert/strict";
import { userMessage } from "./user-message.ts";

const quiet = <T>(run: () => T): T => {
  const original = console.error;
  console.error = () => {};
  try {
    return run();
  } finally {
    console.error = original;
  }
};

test("the server's Danish sentences reach people", () => {
  for (const message of [
    "Casen er ændret af en anden, siden du åbnede den. Genindlæs siden og prøv igen.",
    "Vælg mindst én årsag.",
    "Din rolle kan ikke beslutte investeret eller luk.",
    "Denne screening er allerede sendt til dyb analyse.",
    // Server messages without æ/ø/å (harden N3): found by scanning src/lib for thrown text.
    "Denne case screenes allerede.",
    "Opsætningen mangler mandat.",
    "Opgaven blev besvaret af en anden i mellemtiden.",
    "Dybdeanalysen mangler evidens.",
    "Datafordeleren afviste opslaget.",
    "Ukendt medlemskab.",
    "Hjemmesiden viderestillede for mange gange.",
    "Skriv en gyldig e-mail.",
    "Ugyldig filsti.",
  ]) {
    assert.equal(userMessage(new Error(message), "FALLBACK"), message);
  }
});

test("technical messages never reach people (harden P)", () => {
  for (const message of [
    "permission denied for table cases",
    "getaddrinfo ENOTFOUND db.example.supabase.co",
    "Could not find the function public.undo_case_transitions(...) in the schema cache",
    "Cannot read properties of undefined (reading 'x')",
    "Failed to fetch",
    "JWT expired",
    '[{"code":"invalid_type"}]',
    "fetch failed",
    // English that shares a word with Danish (case, i, en, et) stays out (harden F3).
    "Case not found",
    "Invalid case id",
    "Case id must be a uuid",
    "Error in case handler",
    "I/O error",
    "Something went wrong in case pipeline",
    "Model et-al unavailable",
    // …and via "for" or "cases" (harden SF5).
    "Rate limit exceeded for this model",
    "Access denied for case",
    "No cases selected",
    "Could not resolve host for db",
  ]) {
    assert.equal(
      quiet(() => userMessage(new Error(message), "FALLBACK")),
      "FALLBACK",
    );
  }
  assert.equal(
    userMessage(new Error("Unauthorized"), "X"),
    "Du er blevet logget ud. Log ind igen.",
  );
});

test("an English page gets the server's own English sentences, nothing else (T-614b4c2a)", () => {
  assert.equal(
    userMessage(new Error("The case was not found."), "FALLBACK", "en"),
    "The case was not found.",
  );
  assert.equal(
    userMessage(
      new Error(
        "Your team has made 5 trial runs in the last hour. Wait a little before trying again.",
      ),
      "FALLBACK",
      "en",
    ),
    "Your team has made 5 trial runs in the last hour. Wait a little before trying again.",
  );
  assert.equal(
    quiet(() => userMessage(new Error("Ask: drop table x"), "FALLBACK", "en")),
    "FALLBACK",
  );
  for (const message of ["Case not found", "Access denied for case", "JWT expired"]) {
    assert.equal(
      quiet(() => userMessage(new Error(message), "FALLBACK", "en")),
      "FALLBACK",
    );
  }
  // A Danish sentence still passes on an English page (a worker writes Danish without a request).
  assert.equal(
    userMessage(new Error("Casen blev ikke fundet."), "FALLBACK", "en"),
    "Casen blev ikke fundet.",
  );
});
