import type { RedactionDictionary } from "./redact.ts";

/**
 * Danish test set for the masking (accept): hard cases per kind, and values the analysis
 * needs that must survive. `secrets` must be gone from the masked text; `kept` must still be
 * there. Structured values must reach 100 %, known names at least 98 %.
 */
export const TEST_DICTIONARY: RedactionDictionary = {
  mask: [
    { name: "Line Hansen" },
    { name: "Søren Østergaard" },
    { name: "Anne-Marie Bøgh-Larsen" },
    { name: "Åse Krogh" },
    { name: "Mikkel Ærenlund" },
    { name: "Jens van der Berg" },
    { name: "Karen Louise Ølgaard", aliases: ["Karen L. Ølgaard"] },
  ],
  keep: ["Anna Jensen", "Jonas Ravn", "Pleo Technologies ApS", "Seed Capital", "Nordic Ventures"],
};

export interface TestCase {
  text: string;
  secrets: { kind: "structured" | "name"; value: string }[];
  kept?: string[];
}

const s = (value: string) => ({ kind: "structured" as const, value });
const n = (value: string) => ({ kind: "name" as const, value });

export const TEST_SET: TestCase[] = [
  // CPR
  { text: "CPR: 010190-1234.", secrets: [s("010190-1234")] },
  { text: "Personnummer 0101901234 i ejerbogen.", secrets: [s("0101901234")] },
  { text: "cpr 311299 4321", secrets: [s("311299 4321")] },
  { text: "|Navn|CPR|\n|X|290288-1111|", secrets: [s("290288-1111")] },
  // Phone numbers
  { text: "Ring på +45 12 34 56 78 i dag.", secrets: [s("+45 12 34 56 78")] },
  { text: "Mobil: +4512345678", secrets: [s("+4512345678")] },
  { text: "Telefon 0045 87654321.", secrets: [s("0045 87654321")] },
  { text: "Tlf. 0045 22 33 44 55", secrets: [s("0045 22 33 44 55")] },
  { text: "+45-31-41-59-26 er nummeret.", secrets: [s("+45-31-41-59-26")] },
  { text: "Kontakt (+45) 61 23 45 67.", secrets: [s("61 23 45 67")] },
  { text: "tlf. 23456789", secrets: [s("23456789")] },
  { text: "Direkte: 2233 4455", secrets: [s("2233 4455")] },
  { text: "Hun har nummer 42 42 42 42.", secrets: [s("42 42 42 42")] },
  { text: "Sverige: +46 70 123 45 67", secrets: [s("+46 70 123 45 67")] },
  { text: "London +44 20 7946 0958", secrets: [s("+44 20 7946 0958")] },
  { text: "US office +1 (555) 123-4567", secrets: [s("+1 (555) 123-4567")] },
  { text: "Tlf. (+45) 22334455", secrets: [s("22334455")] },
  { text: "Telephone: 22334455", secrets: [s("22334455")] },
  { text: "Phone number: 31415926", secrets: [s("31415926")] },
  { text: "Mobiltelefon: 40404040", secrets: [s("40404040")] },
  { text: "M: 22334455 | E: x@y.dk", secrets: [s("22334455"), s("x@y.dk")] },
  // E-mail addresses
  { text: "Skriv til line.hansen@gmail.com.", secrets: [s("line.hansen@gmail.com")] },
  { text: "MAIL: LINE@FIRMA.DK", secrets: [s("LINE@FIRMA.DK")] },
  { text: "Mail line (at) firma.dk for info", secrets: [s("line (at) firma.dk")] },
  { text: "soren[at]firma[dot]dk", secrets: [s("soren[at]firma[dot]dk")] },
  { text: "Skriv til soren at firma dot dk", secrets: [s("soren at firma dot dk")] },
  { text: "søren@østergaard.dk svarer", secrets: [s("søren@østergaard.dk")] },
  { text: "line+invest@firma.co.uk", secrets: [s("line+invest@firma.co.uk")] },
  // Bank accounts, IBAN and cards
  { text: "Reg.nr. 1234 kontonr. 1234567890", secrets: [s("1234"), s("1234567890")] },
  { text: "reg. 5470 konto 0001234567", secrets: [s("5470"), s("0001234567")] },
  { text: "Kontonr: 1234-1234567890", secrets: [s("1234-1234567890")] },
  { text: "Overfør til 9570-0001234567 senest fredag.", secrets: [s("9570-0001234567")] },
  { text: "Reg.nr./kontonr.: 1234/1234567890", secrets: [s("1234567890")] },
  { text: "Bankkonto: 1234 1234567890", secrets: [s("1234567890")] },
  { text: "IBAN DK50 0040 0440 1162 43", secrets: [s("DK50 0040 0440 1162 43")] },
  { text: "IBAN: DK5000400440116243.", secrets: [s("DK5000400440116243")] },
  { text: "GB82 WEST 1234 5698 7654 32", secrets: [s("GB82 WEST 1234 5698 7654 32")] },
  { text: "Kort 4111 1111 1111 1111 udløber", secrets: [s("4111 1111 1111 1111")] },
  { text: "5555-5555-5555-4444", secrets: [s("5555-5555-5555-4444")] },
  { text: "Amex 378282246310005", secrets: [s("378282246310005")] },
  // Addresses: the street goes, postcode and city stay
  {
    text: "Bor på Vesterbrogade 12, 2. th, 1620 København V.",
    secrets: [s("Vesterbrogade 12")],
    kept: ["1620 København V"],
  },
  { text: "Strandvejen 100B, 2900 Hellerup", secrets: [s("Strandvejen 100B")], kept: ["2900"] },
  { text: "Adresse: Niels Juels Gade 13", secrets: [s("Niels Juels Gade 13")] },
  { text: "Gammel Kongevej 1, st., 1610 København", secrets: [s("Gammel Kongevej 1")] },
  { text: "Strandboulevarden 12, 2100 København Ø", secrets: [s("Strandboulevarden 12")] },
  { text: "Holmens Kanal 2", secrets: [s("Holmens Kanal 2")] },
  { text: "Ellemarken 3, 2860 Søborg", secrets: [s("Ellemarken 3")] },
  {
    text: "CEO Anna Jensen\nVesterbrogade 12",
    secrets: [s("Vesterbrogade 12")],
    kept: ["CEO Anna Jensen"],
  },
  // Names from the dictionary: æ/ø/å, hyphens, genitive, first name alone, tables, CSV, PDF
  { text: "Mødet med Line Hansen gik godt.", secrets: [n("Line Hansen")] },
  { text: "Lines aktier sælges.", secrets: [n("Line")] },
  { text: "Søren Østergaards rolle er uklar.", secrets: [n("Søren Østergaard")] },
  { text: "Anne-Marie Bøgh-Larsen er sælger.", secrets: [n("Anne-Marie Bøgh-Larsen")] },
  { text: "Åse Kroghs anparter: 4 %", secrets: [n("Åse Krogh")] },
  { text: "Mikkel sagde nej.", secrets: [n("Mikkel")] },
  { text: "Hilsen Jens van der Berg", secrets: [n("Jens van der Berg")] },
  { text: "KAREN LOUISE ØLGAARD (rådgiver)", secrets: [n("KAREN LOUISE ØLGAARD")] },
  {
    text: "Karen Ølgaard og Karen L. Ølgaard",
    secrets: [n("Karen Ølgaard"), n("Karen L. Ølgaard")],
  },
  { text: "| Line Hansen | 25 % | 1.000 |", secrets: [n("Line Hansen")], kept: ["25 %", "1.000"] },
  {
    text: "navn;mail;andel\nSøren Østergaard;s@x.dk;10\nAnna Jensen;a@pleo.io;60",
    secrets: [n("Søren Østergaard"), s("s@x.dk"), s("a@pleo.io")],
    kept: ["Anna Jensen", ";10", ";60"],
  },
  { text: "Ejer\tAndel\nÅse Krogh\t5,0 %", secrets: [n("Åse Krogh")], kept: ["5,0 %"] },
  { text: "Side 3 Line  Hansen og Søren\nØstergaard", secrets: [n("Line  Hansen"), n("Søren")] },
  {
    text: "LINE HANSEN, line hansen og Hansen, Line",
    secrets: [n("LINE HANSEN"), n("line hansen"), n("Hansen, Line")],
  },
  { text: "Line B. Hansen ejer 5 %", secrets: [n("Line B. Hansen")] },
  {
    text: "Søren Øster\u00adgaard (PDF med blød bindestreg)",
    secrets: [n("Søren Øster\u00adgaard")],
  },
  { text: "Søren Øster-\ngaard sagde", secrets: [n("Søren Øster-\ngaard")] },
  // Unknown private persons next to a CPR number (owner lists)
  {
    text: "Ejerbog\nPeter Holm;020285-4321;12 %\nSeed Capital ApS;CVR 12345678;15 %",
    secrets: [n("Peter Holm"), s("020285-4321")],
    kept: ["Seed Capital ApS", "CVR 12345678", "12 %", "15 %"],
  },
  {
    text: "Kapitalejer: Maria Sørensen, CPR-nr. 150392-2222. Maria Sørensen ejer 3 %.",
    secrets: [n("Maria Sørensen"), s("150392-2222")],
  },
  {
    text: "Køber Peter Holm, CPR 020285-4321. Senere betaler Peter Holm 1 mio.",
    secrets: [n("Peter Holm"), s("020285-4321")],
    kept: ["Køber", "1 mio."],
  },
  { text: "PETER HOLM 020285-4321; PETER HOLM ejer", secrets: [n("PETER HOLM"), s("020285-4321")] },
  {
    text: "Peter K. Holm 020285-4321. Peter Holm og Peter K. Holm",
    secrets: [n("Peter Holm"), n("Peter K. Holm"), s("020285-4321")],
  },
  { text: "CPR: 010190 - 1234", secrets: [s("010190 - 1234")] },
  { text: "010190 – 1234", secrets: [s("010190 – 1234")] },
  { text: "CPR 010190-\n1234", secrets: [s("010190-\n1234")] },
  { text: "CPR 010190−1234", secrets: [s("010190−1234")] },
];

/** The analysis needs these: none may be masked. */
export const MUST_KEEP: string[] = [
  "CVR 36925715",
  "CVR-nr. 39 12 34 56",
  "CVR: 3912 3456",
  "P-nr. 1012345678",
  "SE-nr. 12345678",
  "1.250.000 kr.",
  "DKK 2,5 mio.",
  "12,5 %",
  "33.33%",
  "15.03.2024",
  "2024-03-15",
  "15/03/2024",
  "kl. 14.30",
  "2023-2025",
  "2023 2024",
  "2021 2022 2023 2024",
  "Q3 2024",
  "ISO 27001",
  "version 2.10.3",
  "2100 København Ø",
  "Seed Capital 15,0 % 1.500.000 anparter",
  "1 250 000 kr",
  "+12 345 678 kr",
  "Vækst +25 %",
  "Serie A på 20 mio. kr.",
  "EBITDA -1.234.567",
  "10 20 30 40 50",
  "Anna Jensen",
  "Jonas Ravns",
  "Pleo Technologies ApS",
  "Nordic Ventures",
  "pleo.io",
  "www.pleo.io",
  "per måned",
  "Per måned",
  "Bo i København",
  "Omsætning (t.kr.) 3500 4200",
  "2500-5000 kunder",
  "Bruttomargin 25 30 35 40",
  "Ændring i likvider +12 345 678",
  "+12 345 678 901",
  "Hans baggrund er stærk",
  "Sælger Anna Jensen, CPR",
];
