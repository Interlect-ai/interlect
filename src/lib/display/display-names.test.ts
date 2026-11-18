import assert from "node:assert/strict";
import { test } from "node:test";
import {
  brandName,
  createDisplayNamer,
  inventAlias,
  namesABody,
  type DisplayAlias,
} from "./display-names.ts";

const aliases: DisplayAlias[] = [
  { kind: "company", real: "Veo Technologies ApS", alias: "Alder Labs" },
  { kind: "company", real: "Pleo", alias: "Brixen Bio" },
  { kind: "person", real: "Maria Holmgaard", alias: "Elin Vester" },
  { kind: "person", real: "Jens Holmgaard", alias: "Marek Brandt" },
];
const namer = createDisplayNamer(aliases);

test("full names and the short company form are replaced, case-insensitively", () => {
  assert.equal(
    namer.apply("Veo Technologies ApS and veo technologies raised; PLEO too."),
    "Alder Labs and Alder Labs raised; Brixen Bio too.",
  );
});

test("a name inside a longer word is left alone; possessives keep their ending", () => {
  assert.equal(namer.apply("Pleotropic and Pleo's board"), "Pleotropic and Brixen Bio's board");
});

test("a first name alone is replaced, a last name two people share is not", () => {
  assert.equal(namer.apply("Maria joined; Holmgaard stayed"), "Elin joined; Holmgaard stayed");
  assert.equal(namer.apply("Jens Holmgaard"), "Marek Brandt");
});

test("applyJson changes string values only", () => {
  const out = namer.applyJson({ title: "Pleo", n: 3, list: ["Maria Holmgaard", null], Pleo: true });
  assert.deepEqual(out, { title: "Brixen Bio", n: 3, list: ["Elin Vester", null], Pleo: true });
});

test("a name split over streamed chunks is replaced once, nothing is lost", () => {
  const chunks = [
    "Se ",
    "Veo Tech",
    "nologies",
    " ApS har ",
    "Pl",
    "eo",
    " og Maria",
    " Holm",
    "gaard.",
  ];
  const s = namer.stream();
  const out = chunks.map((c) => s.push(c)).join("") + s.flush();
  assert.equal(out, "Se Alder Labs har Brixen Bio og Elin Vester.");
});

test("streaming holds back only a possible name and the word being written", () => {
  const s = namer.stream();
  assert.equal(s.push("Hello there "), "Hello there ");
  assert.equal(s.push("Ma"), "");
  // The last word waits for its end: it may still turn into a compound or an address.
  assert.equal(s.push("rs is"), "Mars ");
  assert.equal(s.flush(), "is");
});

test("a streamed answer is named as if it came in one piece, however it is cut (T-769)", () => {
  for (const text of [
    "Se veo.dk og Pleo. Pleos plan, pleo@x.dk og Maria Holmgaard.",
    "Veo Technologies ApS/Pleo-aftalen og https://pleo.io",
  ]) {
    const whole = namer.apply(text);
    for (let i = 0; i <= text.length; i += 1) {
      const s = namer.stream();
      const out = s.push(text.slice(0, i)) + s.push(text.slice(i)) + s.flush();
      assert.equal(out, whole, `cut at ${i}: ${JSON.stringify(text.slice(0, i))}`);
    }
  }
});

test("a stream never shows half a name when another name starts with its last word", () => {
  const overlap = createDisplayNamer([
    { kind: "person", real: "Maria Holmgaard", alias: "Elin Vester" },
    { kind: "person", real: "Jens Holmgaard", alias: "Marek Brandt" },
    { kind: "company", real: "Holmgaard Energy", alias: "Calder Energy" },
  ]);
  const text = "Maria Holmgaard er her";
  assert.equal(overlap.apply(text), "Elin Vester er her");
  for (let i = 0; i <= text.length; i += 1) {
    const s = overlap.stream();
    const out = s.push(text.slice(0, i)) + s.push(text.slice(i)) + s.flush();
    assert.equal(out, "Elin Vester er her", `cut at ${i}`);
  }
});

test("decomposed accents and a longer lower case never let a split name through", () => {
  for (const chunks of [
    ["Cafe\u0301 med Veo Techno", "logies ApS"],
    ["İstanbul: Veo Techno", "logies er her"],
    ["Cafe", "\u0301 og Pleo", " igen"],
  ]) {
    const s = namer.stream();
    const out = chunks.map((c) => s.push(c)).join("") + s.flush();
    // An accent mark that comes in the next chunk cannot join a letter already sent: same text,
    // other code points, so compared composed.
    assert.equal(out.normalize("NFC"), namer.apply(chunks.join("")), chunks.join("|"));
    assert.ok(!/Veo|Pleo/.test(out), out);
  }
});

test("a name in a compound word is still a name (T-775)", () => {
  assert.equal(
    namer.apply("Pleo-appen og Pleo/Veo Technologies"),
    "Brixen Bio-appen og Brixen Bio/Alder Labs",
  );
  assert.equal(namer.apply("Maria Holmgaard-sagen"), "Elin Vester-sagen");
  assert.equal(namer.apply("pleo_kort og #Pleo"), "Brixen Bio_kort og #Brixen Bio");
  // A word with a dot that is no web address: a missing space, a file name.
  assert.equal(
    namer.apply("Pleo.The deck: pleo-deck.pdf"),
    "Brixen Bio.The deck: Brixen Bio-deck.pdf",
  );
});

test("in a web or mail address a name becomes the invented name as one word (T-775)", () => {
  assert.equal(
    namer.apply("https://www.linkedin.com/company/pleo/"),
    "https://www.linkedin.com/company/brixen-bio/",
  );
  assert.equal(
    namer.apply("linkedin.com/in/maria-holmgaard-1a2b"),
    "linkedin.com/in/elin-vester-1a2b",
  );
  assert.equal(namer.apply("maria.holmgaard@x.dk"), "elin-vester@x.dk");
  // A host with a real name that is not a known address of the company leads nowhere real.
  assert.equal(
    namer.apply("se pleo.com og blog.pleo-app.com/x"),
    "se brixen-bio.example og blog.brixen-bio-app.example/x",
  );
  assert.equal(
    namer.apply("https://alder-labs.example/pleo"),
    "https://alder-labs.example/brixen-bio",
  );
  // No name, no change: an address of someone else, numbers and abbreviations.
  assert.equal(
    namer.apply("techcrunch.com/2024 og 1.000 kr. f.eks."),
    "techcrunch.com/2024 og 1.000 kr. f.eks.",
  );
});

test("a link keeps the punctuation after it; a name running on after a link is whole (T-775)", () => {
  assert.equal(namer.apply("[Pleo](https://pleo.io)"), "[Brixen Bio](https://brixen-bio.example)");
  assert.equal(
    namer.apply("https://pleo.io, samt (https://www.pleo-blog.com)."),
    "https://brixen-bio.example, samt (https://www.brixen-bio-blog.example).",
  );
  assert.equal(
    namer.apply("https://www.google.com/search?q=Veo Technologies ApS"),
    "https://www.google.com/search?q=Alder Labs",
  );
  assert.equal(namer.apply("x.dk/?q=Maria Holmgaard"), "x.dk/?q=Elin Vester");
});

test("a company name that is also a host is a name where it is used as one (T-775)", () => {
  const hungry = createDisplayNamer([
    { kind: "company", real: "Hungry.dk ApS", alias: "Calder Health" },
  ]);
  assert.equal(hungry.apply("Hungry.dk ApS"), "Calder Health");
  assert.equal(
    hungry.apply("Hungry.dk ApS rejste, Hungry.dk voksede og hungry.dk/om"),
    "Calder Health rejste, Calder Health voksede og calder-health.example/om",
  );
});

test("a typed address with an invented name goes back to the real one (T-775)", () => {
  assert.equal(
    namer.reverse("site:linkedin.com/company/brixen-bio"),
    "site:linkedin.com/company/pleo",
  );
  assert.equal(
    namer.reverse("elin-vester@alder-labs.example"),
    "maria-holmgaard@alder-labs.example",
  );
  assert.equal(namer.reverse("Brixen Bio-appen"), "Pleo-appen");
});

test("compound words and addresses stream as if they came in one piece (T-775)", () => {
  for (const text of [
    "Pleo-appen, Pleo/Veo Technologies og Maria Holmgaard-sagen.",
    "https://www.linkedin.com/company/pleo/ og maria.holmgaard@x.dk",
    "se pleo.com, Pleo.The og pleo-deck.pdf",
    "Maria Holm-x og Pleo/pleo",
    "[Pleo](https://pleo.io). google.com/?q=Veo Technologies ApS",
    "x.dk/?q=Maria Holmgaard.",
  ]) {
    const whole = namer.apply(text);
    assert.ok(!/Pleo|Maria/i.test(whole), whole);
    for (let i = 0; i <= text.length; i += 1) {
      for (let j = i; j <= text.length; j += text.length > 30 ? text.length : 1) {
        const s = namer.stream();
        const out =
          s.push(text.slice(0, i)) + s.push(text.slice(i, j)) + s.push(text.slice(j)) + s.flush();
        assert.equal(out, whole, `cuts at ${i}, ${j}: ${JSON.stringify(text)}`);
      }
    }
  }
});

test("an empty list changes nothing", () => {
  const none = createDisplayNamer([]);
  assert.equal(none.apply("Pleo"), "Pleo");
  const s = none.stream();
  assert.equal(s.push("Pl"), "Pl");
});

test("invented aliases are stable, avoid taken names and differ per name", () => {
  const a = inventAlias("company", "Pleo", "fund-1", new Set());
  assert.equal(a, inventAlias("company", "Pleo", "fund-1", new Set()));
  assert.notEqual(a, inventAlias("company", "Veo", "fund-1", new Set()));
  assert.notEqual(inventAlias("company", "Pleo", "fund-1", new Set([a.toLowerCase()])), a);
  assert.match(inventAlias("person", "Maria Holmgaard", "fund-1", new Set()), /^\S+ \S+$/);
});

test("when every combination is taken, the numbered fallback is never a taken name (T-765 c)", () => {
  const taken = new Set<string>();
  // Fill every investor name, then the numbered ones as they come.
  for (let i = 0; i < 400; i += 1) {
    const alias = inventAlias("company", `Investor Number${i}`, "fund-1", taken, {
      investor: true,
    });
    assert.ok(!taken.has(alias.toLowerCase()), `${alias} given twice`);
    taken.add(alias.toLowerCase());
  }
});

test("a typed alias goes back to the real name, a short alias to the short real form", () => {
  assert.equal(
    namer.reverse("What does Alder Labs say about Elin Vester and Elin?"),
    "What does Veo Technologies ApS say about Maria Holmgaard and Maria?",
  );
  assert.equal(namer.reverse("nothing to change"), "nothing to change");
  assert.equal(createDisplayNamer([]).reverse("Alder Labs"), "Alder Labs");
});

test("whitespace variants, genitive, decomposed accents, urls and short words", () => {
  const s = namer.stream();
  assert.equal(
    s.push("Hi Veo\n") + s.push("Technologies rocks") + s.flush(),
    "Hi Alder Labs rocks",
  );
  assert.equal(namer.apply("Pleos grundlæggere"), "Brixen Bios grundlæggere");
  const accents = createDisplayNamer([{ kind: "company", real: "Café Ørn", alias: "Alder Labs" }]);
  assert.equal(accents.apply("Café Ørn"), "Alder Labs");
  const one = createDisplayNamer([{ kind: "company", real: "Oneida", alias: "Kestrel Cloud" }]);
  assert.equal(
    one.apply("https://oneida.com and oneida-liners"),
    "https://kestrel-cloud.example and Kestrel Cloud-liners",
  );
  assert.deepEqual(namer.applyJson({ d: new Date(0) }).d, new Date(0));
});

test("a one-word name only Brain knows is a name where it is written as one (T-777)", () => {
  const brain = createDisplayNamer([
    { kind: "company", real: "Root AS", alias: "Lindor Cloud", outside: true },
    { kind: "company", real: "Visa", alias: "Elmwood Devices", outside: true },
    { kind: "company", real: "TWO AS", alias: "Arvik Networks" },
    { kind: "company", real: "Pleo", alias: "Brixen Bio" },
    { kind: "person", real: "Tesi Bonde", alias: "Thea Lindqvist", outside: true },
  ]);
  // In small letters in a sentence it is the word; with a capital letter it is the name.
  assert.equal(
    brain.apply("Root raised; the root cause was a visa. VISA and Visa's deal."),
    "Lindor Cloud raised; the root cause was a visa. Elmwood Devices and Elmwood Devices's deal.",
  );
  // In a file name, a tag or a path it is the name in any case.
  assert.equal(
    brain.apply("root-deck.pdf, root_kort, #visa and docs/root"),
    "Lindor Cloud-deck.pdf, Lindor Cloud_kort, #Elmwood Devices and docs/Lindor Cloud",
  );
  // The team's own name is hidden in any case, unless it is a small word like "two".
  assert.equal(
    brain.apply("pleo had two founders and a two-year runway; Two and TWO AS raised"),
    "Brixen Bio had two founders and a two-year runway; Arvik Networks and Arvik Networks raised",
  );
  // A person's first or last name alone follows the same rule ("bonde" is a Danish word).
  assert.equal(brain.apply("Bonde and bonde"), "Lindqvist and bonde");
  // A stream names it as the whole text does.
  const text = "the root cause: Root (root-deck.pdf) and two of Two's founders.";
  for (let size = 1; size < text.length; size += 3) {
    const s = brain.stream();
    let out = "";
    for (let i = 0; i < text.length; i += size) out += s.push(text.slice(i, i + size));
    assert.equal(out + s.flush(), brain.apply(text), `chunks of ${size}`);
  }
  // Typed input goes back in any case.
  assert.equal(brain.reverse("lindor cloud"), "Root AS");
});

test("a long run of names without a space is walked once (T-777)", () => {
  const brain = createDisplayNamer([
    { kind: "company", real: "Root", alias: "Lindor Cloud", outside: true },
  ]);
  const run = Array.from({ length: 20_000 }, () => "root").join(",");
  const started = Date.now();
  assert.equal(brain.apply(run), Array.from({ length: 20_000 }, () => "Lindor Cloud").join(","));
  assert.ok(Date.now() - started < 3_000, `${Date.now() - started} ms`);
});

test("a person only Brain knows never takes a first name from the team's own (T-777)", () => {
  const both = createDisplayNamer([
    { kind: "person", real: "Maria Holmgaard", alias: "Elin Vester" },
    { kind: "person", real: "Maria Jensen", alias: "Saga Ravn", outside: true },
    { kind: "person", real: "Holmgaard", alias: "Noor Solberg", outside: true },
  ]);
  assert.equal(both.apply("Maria said"), "Elin said");
  // The whole name of one word keeps its alias, matched as strictly as the own last name.
  assert.equal(both.apply("holmgaard's deck"), "Noor Solberg's deck");
});

test("a legal form and quotes before a name are a short form too (T-777)", () => {
  const sia = createDisplayNamer([
    { kind: "company", real: 'SIA "Sonarworks"', alias: "Juniper Therapeutics" },
  ]);
  assert.equal(
    sia.apply('SIA "Sonarworks" (Sonarworks) and sonarworks'),
    "Juniper Therapeutics (Juniper Therapeutics) and Juniper Therapeutics",
  );
  // "AB" and "AS" before a name that is not quoted are initials, not a legal form.
  const initials = createDisplayNamer([
    { kind: "company", real: "AB Testing Ltd", alias: "Kestrel Labs" },
  ]);
  assert.equal(initials.apply("AB Testing ran Testing"), "Kestrel Labs ran Testing");
});

test("an invented company name keeps its kind; an investor sounds like one (T-777)", () => {
  const none = new Set<string>();
  assert.match(inventAlias("company", "Sequoia Capital", "f", none), /^\S+ Capital$/);
  assert.match(inventAlias("company", "Danske Bank A/S", "f", none), /^\S+ Bank$/);
  assert.match(inventAlias("company", "Kinmel Bay Football Club", "f", none), / Football Club$/);
  assert.match(inventAlias("company", "Zetta Venture Partners", "f", none), / Venture Partners$/);
  // The first word is always the name's own, even when it is a kind word too.
  assert.match(inventAlias("company", "Capital Group", "f", none), /^\S+ Group$/);
  assert.match(
    inventAlias("company", "Atomico", "f", none, { investor: true }),
    /^\S+ (Capital|Ventures|Partners|Invest|Growth)$/,
  );
  // Stable, and never a name already taken.
  const a = inventAlias("company", "Sequoia Capital", "f", none);
  assert.equal(inventAlias("company", "Sequoia Capital", "f", none), a);
  assert.notEqual(inventAlias("company", "Sequoia Capital", "f", new Set([a.toLowerCase()])), a);
});

test("the name a company goes by is the first part of its name its address gives (T-782)", () => {
  assert.equal(brandName("Veo Technologies", ["veo.co"]), "Veo");
  assert.equal(brandName("Veo Technologies ApS", ["veo.co", "veo.dk"]), "Veo");
  assert.equal(brandName("Alder Labs Group", ["alderlabs.com"]), "Alder Labs");
  assert.equal(brandName("Veo-Tech Solutions", ["veo-tech.io"]), "Veo-Tech");
  assert.equal(brandName("Veo Technologies", ["app.veo.co"]), "Veo");
  assert.equal(brandName("Veo Technologies", ["veo.co.uk"]), "Veo");
  // Already the name, another name, or no address: nothing new.
  assert.equal(brandName("Weaviate", ["weaviate.io"]), null);
  assert.equal(brandName('SIA "Sonarworks"', ["sonarworks.com"]), null);
  assert.equal(brandName("Northvolt Battery Systems", ["example.com"]), null);
  assert.equal(brandName("Veo Technologies", []), null);
});

test("a name with a word for a body in it is an organisation, a place alone is not (T-910)", () => {
  assert.equal(namesABody("Business Finland"), true);
  assert.equal(namesABody("Nordic Innovation"), true);
  assert.equal(namesABody("Niklas Zennström"), false);
  assert.equal(namesABody("Israel Englander"), false);
  assert.equal(namesABody("Anna Holland"), false);
});

test("a place or a body word is never a name part of a name only Brain knows (T-910)", () => {
  const stored = createDisplayNamer([
    // Stored as a person fixed the reading.
    { kind: "person", real: "Business Finland", alias: "Anton Korsgaard", outside: true },
    { kind: "person", real: "Anna Holland", alias: "Elin Vester", outside: true },
  ]);
  const out = stored.apply(
    "Helsinki, Finland. Business plan reviewed. Business Finland and Anna Holland met; Anna said yes; offices in Holland.",
  );
  assert.equal(
    out,
    "Helsinki, Finland. Business plan reviewed. Anton Korsgaard and Elin Vester met; Elin said yes; offices in Holland.",
  );
});

test("the team's own people keep every name part, places and body words too (T-910)", () => {
  const own = createDisplayNamer([
    { kind: "person", real: "Israel Nilsson", alias: "Anton Brandt" },
    { kind: "person", real: "Lars Norden", alias: "Elin Vester" },
    { kind: "person", real: "Maria Board", alias: "Saga Lund" },
  ]);
  const out = own.apply("Israel joined in 2021. Norden built it. Maria said yes.");
  assert.equal(out, "Anton joined in 2021. Vester built it. Saga said yes.");
});

test("a name with an accent is hidden in an address written without it (T-911)", () => {
  const accents = createDisplayNamer([
    { kind: "person", real: "Joachim Krüger", alias: "Anton Brandt" },
    { kind: "person", real: "Søren Bækgaard", alias: "Elin Vester" },
  ]);
  for (const [input, expected] of [
    ["https://www.linkedin.com/in/joachimkruger", "https://www.linkedin.com/in/anton-brandt"],
    ["linkedin.com/in/joachim-krueger-1a2b", "linkedin.com/in/anton-brandt-1a2b"],
    ["linkedin.com/in/joachim-krüger", "linkedin.com/in/anton-brandt"],
    ["linkedin.com/in/soren-baekgaard", "linkedin.com/in/elin-vester"],
    ["linkedin.com/in/soeren-baekgaard", "linkedin.com/in/elin-vester"],
  ]) {
    assert.equal(accents.apply(input!), expected, input);
  }
});

test("a genitive inside an address is hidden with its name (T-911)", () => {
  const genitive = createDisplayNamer([
    { kind: "company", real: "STRISE AS", alias: "Tamsin Devices" },
  ]);
  assert.equal(
    genitive.apply("https://blog.example.test/connecting-with-strises-aml-automation-cloud"),
    "https://blog.example.test/connecting-with-tamsin-devices-aml-automation-cloud",
  );
  assert.equal(
    createDisplayNamer([{ kind: "company", real: "Veo", alias: "Lindor Security" }]).apply(
      "https://x.test/veos-team",
    ),
    "https://x.test/lindor-securitys-team",
  );
  // A longer word that only starts with the name is another word.
  assert.equal(genitive.apply("https://x.test/strisesque"), "https://x.test/strisesque");
});

test("a name written without its accents is hidden in text too, and goes back as written (T-911)", () => {
  const accents = createDisplayNamer([
    { kind: "person", real: "Joachim Krüger", alias: "Anton Brandt" },
    { kind: "person", real: "Søren Bækgaard", alias: "Elin Vester" },
    { kind: "person", real: "Kim Høst", alias: "Saga Lund" },
  ]);
  assert.equal(
    accents.apply("Joachim Kruger and Soren Baekgaard met; Kruger said yes."),
    "Anton Brandt and Elin Vester met; Brandt said yes.",
  );
  assert.equal(accents.reverse("Anton Brandt"), "Joachim Krüger");
  // A short word without its accents is an ordinary word ("Høst" is not "host").
  assert.equal(
    accents.apply("How to host a party: https://x.test/how-to-host"),
    "How to host a party: https://x.test/how-to-host",
  );
});

test("letters written as percent codes in an address are read (T-911)", () => {
  const coded = createDisplayNamer([
    { kind: "person", real: "Kim Høst", alias: "Saga Lund" },
    { kind: "person", real: "Søren Bækgaard", alias: "Elin Vester" },
    { kind: "person", real: "Joachim Krüger", alias: "Anton Brandt" },
    { kind: "person", real: "Łukasz Michał", alias: "Marek Lind" },
  ]);
  assert.equal(
    coded.apply("https://da.wikipedia.org/wiki/Kim_H%C3%B8st"),
    "https://da.wikipedia.org/wiki/saga-lund",
  );
  assert.equal(
    coded.apply("linkedin.com/in/s%C3%B8ren-b%C3%A6kgaard-12"),
    "linkedin.com/in/elin-vester-12",
  );
  assert.equal(coded.apply("linkedin.com/in/joachim-kr%C3%BCger"), "linkedin.com/in/anton-brandt");
  assert.equal(coded.apply("linkedin.com/in/lukasz-michal"), "linkedin.com/in/marek-lind");
  // An address without a name keeps its codes.
  assert.equal(coded.apply("https://x.test/caf%C3%A9-menu"), "https://x.test/caf%C3%A9-menu");
});
