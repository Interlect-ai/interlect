/**
 * Access, credits, the AI data rules and the process rules speak the page's (or the
 * worker's fund) language, and Danish is unchanged outside a scope. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLanguage } from "../i18n/language-scope.server.ts";
import { aiGatewayOptions, aiPolicyBlockedText } from "../ai/gateway-options.ts";
import { topUpMailto } from "../ai/credit-meter.ts";
import { authorizeProcessStageChange } from "../domain/workflow.ts";
import { userMessage } from "../errors/user-message.ts";
import { RoleChangeInconsistentError, applyRoleChange } from "./role-change.ts";
import { seatLimitMessage } from "./seats.ts";

const en = <T>(work: () => T) => withLanguage("en", async () => work());

test("seat limits are refused in the given language; Danish by default", () => {
  const usage = { seatsUsed: 3, seatLimit: 3, readersUsed: 2, readerLimit: 2 };
  const none = { seat: false, reader: false };
  assert.equal(
    seatLimitMessage(usage, ["member"], none),
    "Alle 3 pladser er brugt. Deaktivér et medlem eller invitér som læser.",
  );
  assert.equal(
    seatLimitMessage(usage, ["member"], none, "en"),
    "All 3 seats are in use. Deactivate a member or invite them as a reader.",
  );
  assert.equal(seatLimitMessage(usage, ["reader"], none, "en"), "All 2 reader seats are in use.");
});

test("a role change's refusals follow the language", async () => {
  assert.equal(
    new RoleChangeInconsistentError().message,
    "Rollen blev kun delvist ændret. Kontrollér personens rolle, og prøv igen.",
  );
  assert.equal(
    new RoleChangeInconsistentError("en").message,
    "The role was only partly changed. Check the person's role and try again.",
  );
  const store = {
    add: async () => {},
    remove: async () => {},
  } as unknown as Parameters<typeof applyRoleChange>[0]["store"];
  await assert.rejects(
    applyRoleChange({ current: [], desired: [], grantedBy: null, store, language: "en" }),
    { message: "A membership must have at least one role." },
  );
  await assert.rejects(applyRoleChange({ current: [], desired: [], grantedBy: null, store }), {
    message: "Et medlemskab skal have mindst én rolle.",
  });
});

test("the process rule explains a refusal in the given language", () => {
  // Only a person may move the process: an agent is refused before anything else is read.
  const request = {
    actorType: "agent",
    actorRoles: [],
    from: "initial_screening",
    to: "initial_screening",
    reason: "",
  } as unknown as Parameters<typeof authorizeProcessStageChange>[0];
  const danish = authorizeProcessStageChange(request);
  const english = authorizeProcessStageChange(request, "en");
  assert.ok(!danish.allowed && !english.allowed);
  assert.equal(danish.allowed ? "" : danish.code, english.allowed ? "" : english.code);
  assert.equal(
    danish.allowed ? "" : danish.message,
    "Kun en autoriseret person kan flytte investeringsprocessen. PAP må aldrig gøre det.",
  );
  assert.match(english.allowed ? "" : english.message, /^Only an authorised person/);
});

test("the AI data rules stop a call in the worker's language and the page can show it", async () => {
  const model = "not-a-real/model";
  const stop = () => {
    try {
      aiGatewayOptions({ model, data: "confidential" });
    } catch (cause) {
      return cause;
    }
    return null;
  };
  const english = await en(stop);
  assert.equal(
    (english as Error).message,
    "The AI model is not approved for Interlect's data security (the ZDR table). The call was stopped.",
  );
  assert.equal(userMessage(english, "fallback", "en"), (english as Error).message);
  assert.match((stop() as Error).message, /^AI-modellen er ikke godkendt/);
  assert.match(await en(aiPolicyBlockedText), /^Stopped by Interlect's data security rules/);
  assert.match(aiPolicyBlockedText(), /^Stoppet af Interlects regler for datasikkerhed/);
});

test("the top-up mail is written in the fund's language", () => {
  const input = { email: "a@b.dk", fundName: "Fond", balanceText: "12 kr.", state: "low" as const };
  const danish = decodeURIComponent(topUpMailto(input));
  assert.match(danish, /\[Interlect · Fyld op\] Fond/);
  assert.match(danish, /Hej Interlect,\nVi vil gerne|Hej Interlect,\n\nVi vil gerne/);
  assert.match(danish, /Saldo nu: 12 kr\./);
  const english = decodeURIComponent(topUpMailto({ ...input, language: "en" }));
  assert.match(english, /\[Interlect · Top up\] Fond/);
  assert.match(english, /Balance now: 12 kr\./);
  assert.match(english, /Amount we want to top up with: \[enter amount\]/);
});
