/**
 * Danish texts for Sikkerhed og data. Name-free (beslutningslog 15. okt): no
 * model, provider or service names; the subprocessors stand only in the data processing agreement.
 */
export const security = {
  page: {
    title: "Sikkerhed og data",
    description: "Gennemsigtigt, ikke bare sikkert — sådan behandles jeres data i dag",
    loadingAccess: "Henter adgang …",
    noAccess: "Du har ikke adgang til en investeringstese endnu. Kontakt en Admin.",
    adminOnly: "Kun en Admin kan se sikkerheds- og dataoversigten.",
  },
  built: {
    title: "Sådan er det bygget i dag",
    rls: "Data er adskilt pr. investeringstese med databaseregler (RLS): ingen kan se en anden investeringsteses cases, uanset delt drift.",
    storage: "Pitch decks ligger i et privat lager, aldrig offentligt tilgængeligt.",
    encryption:
      "Data er krypteret i hvile og under transport, og adgang kræver invitation fra en Admin. Der er ingen offentlig oprettelse.",
    audit: "Alle administrative ændringer skrives til en revisionslog, der ikke kan ændres.",
    region:
      "Databasen ligger i EU. Al jeres strukturerede data, dokumenter og login opbevares inden for EU.",
    noAutoDelete:
      'Intet, der er hentet eller skrevet i Interlect, slettes automatisk. Viden fjernes kun, når I vælger "Glem kilde" eller "Glem person" i Brain.',
    forgetPerson:
      'En Admin kan glemme en person (registreredes ret): åbn personen i Brain og vælg "Glem person". Personens fakta og side slettes, navnet renses overalt i jeres data, og filer, der nævner personen, kan slettes med. Det skrives i revisionsloggen uden navnet.',
  },
  ai: {
    title: "Hvad sendes til AI",
    intro:
      "Interlect skelner mellem to slags AI-kald. Ingen af dem bruges til at træne AI: hvert kald forbyder det.",
    confidentialTitle: "Fortroligt materiale",
    confidentialBody:
      "Decks, noter, memoer, beslutninger, regnskaber og jeres investeringstese sendes kun til AI med nul datalagring: intet gemmes, når svaret er givet. Personoplysninger, der ikke er nødvendige, erstattes først af pladsholdere (maskering), og svaret oversættes tilbage hos os.",
    zdrOn: "Gennemtvunget for hvert kald.",
    zdrOff:
      "Ikke slået til endnu i jeres installation; indtil da kører kaldene uden denne låsning.",
    publicTitle: "Offentlige søgninger på nettet",
    publicBody:
      "Research og websøgning bruger en søgemaskine uden nul datalagring. Derfor sendes kun offentlige søgeord: selskabets navn, domæne, CVR og founders samt korte offentlige påstande. Jeres investeringstese, vægte, tærskler, risikoprofil og interne noter sendes aldrig. Resultatet gemmes hos jer som kilde.",
    regionTitle: "Region",
    regionBody:
      "Hvor det kan lade sig gøre, låses AI-kaldene til EU. Hvor det ikke kan, vælger vi hellere nul datalagring end EU uden.",
    euOn: "Låsning til EU er slået til, hvor det er muligt.",
    euOff: "Låsning til EU er ikke slået til i dag.",
  },
  processors: {
    title: "Hvem ser jeres data",
    body: "Interlect drives med nogle få underleverandører til database, hosting og AI. De står i databehandleraftalen, og ingen af dem får adgang til data fra andre investeringsteser end jeres egen.",
  },
  retention: {
    title: "Hvor længe gemmes det",
    aiLog:
      "AI-loggen (hvad der blev sendt til AI) gemmes i 90 dage. Derefter slettes teksten, og kun tal og tidspunkt bliver.",
    searchLog: "Brains søgelog gemmes i 180 dage.",
    chats:
      "Samtaler i Brain slettes efter 24 måneders inaktivitet. Alt andet gemmes, til I sletter det.",
  },
  forget: {
    title: "Ret til at blive glemt",
    body: "I kan til enhver tid få en kilde, en person, en case, et selskab eller en hel investeringstese slettet permanent, ikke kun skjult. Kontakt jeres Admin eller Interlect direkte; vi bekræfter sletningen skriftligt.",
  },
} as const;
