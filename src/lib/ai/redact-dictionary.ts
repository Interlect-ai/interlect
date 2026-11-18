import type { RedactionDictionary } from "./redact.ts";

/**
 * Who is a private person (masked) and who the analysis needs (kept), from the fund's own data
 * (decision log 4 Oct 2026). Kept: founders, management and board, and every company,
 * investor firm and fund. Everyone else we know by name is masked: employees who are not key
 * people, advisers, persons who own shares privately, contacts named in notes.
 */
export interface DictionaryPerson {
  name: string;
  aliases?: readonly string[];
  /** Role titles: company_people.role_title/registry_role and Brain's has_role facts. */
  roles: readonly string[];
  /** company_people.is_founder, or in Brain: founded_by a company or board_member_of one. */
  keyPerson: boolean;
}

// Founders, C-level, directors and the board, in Danish and English. "Ejer" alone is
// not a key role: a person who only owns shares is a private owner (cap tables, ejerbøger), and
// a "founding engineer" is an early employee.
const KEY_ROLE = new RegExp(
  [
    "co-?founder",
    "founder",
    "med-?stifter",
    "stifter",
    "stiftere",
    "grundlægger",
    "medgrundlægger",
    "ejer-?leder",
    "c[a-z]{1,2}o",
    "chief",
    "vp",
    "vice president",
    "head of",
    "managing",
    "adm\\.? ?dir\\.?",
    "direktør",
    "direktion",
    "direktionen",
    "director",
    "president",
    "formand",
    "næstformand",
    "bestyrelse",
    "bestyrelsen",
    "bestyrelsesmedlem",
    "bestyrelsesformand",
    "board",
    "chair",
    "chairman",
    "chairwoman",
    "chairperson",
  ]
    .map((role) => `(?:^|[^\\p{L}])${role}(?=$|[^\\p{L}])`)
    .join("|"),
  "iu",
);

// Around a key word but not a key role: "Advisory Board Member", "Rådgiver for bestyrelsen",
// "Founder's Associate", "Assistant to the CEO".
const NOT_KEY_ROLE = /advis|rådgiv|assist|associate|to the|for bestyrelsen|intern\b|praktikant/iu;

export function isKeyRole(role: string): boolean {
  return KEY_ROLE.test(role.trim()) && !NOT_KEY_ROLE.test(role);
}

function isKept(person: DictionaryPerson): boolean {
  return person.keyPerson || person.roles.some(isKeyRole);
}

export function buildRedactionDictionary(input: {
  people: readonly DictionaryPerson[];
  /** Companies, investor firms and funds: never masked, even when named after a person. */
  organisations: readonly string[];
}): RedactionDictionary {
  const keep = new Set<string>();
  const mask: RedactionDictionary["mask"][number][] = [];
  for (const person of input.people) {
    const names = [person.name, ...(person.aliases ?? [])].map((n) => n.trim()).filter(Boolean);
    if (names.length === 0) continue;
    if (isKept(person)) {
      for (const name of names) keep.add(name);
    } else {
      const [name = "", ...aliases] = names;
      mask.push({ name, aliases });
    }
  }
  // An "investor" in Brain can be a private person ("Peter Holm"): a name we also know as a
  // private person is masked, not kept as an organisation.
  const key = (name: string) => name.trim().replace(/\s+/gu, " ").toLowerCase();
  const masked = new Set(mask.flatMap((p) => [p.name, ...(p.aliases ?? [])]).map(key));
  for (const name of input.organisations) {
    if (name.trim() && !masked.has(key(name))) keep.add(name.trim());
  }
  return { mask, keep: [...keep] };
}
