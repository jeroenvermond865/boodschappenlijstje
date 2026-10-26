// Wat er nieuw is in de app. Bij elke update die online gaat: bovenaan een nieuw blok met een nieuwe id.
// Iedereen ziet het nieuwste blok één keer kort bovenin; tik erop voor alles.
export type Change = { kind: "nieuw" | "beter" | "opgelost"; text: string };
export type Release = { id: string; date: string; title: string; changes: Change[] };

export const CHANGELOG: Release[] = [
  {
    id: "2026-10-26-b",
    date: "26 oktober 2026",
    title: "Meer besparen en slimmer zoeken",
    changes: [
      { kind: "nieuw", text: "Het bespaaroverzicht is er nu voor iedereen, met wat de app je scheelt en wat Premium er nog bij doet." },
      { kind: "nieuw", text: "De voorraadkast leert van je recepten: wat je niet meekoopt omdat je het al hebt, komt er vanzelf in." },
      { kind: "nieuw", text: "Stel in hoeveel van je voorraad er per week op gaat (olie, kruiden en zo)." },
      { kind: "nieuw", text: "Omlaag trekken om te verversen, op Home en op de meeste lijsten." },
      { kind: "beter", text: "Zoeken snapt andere woorden en tikfouten: curry vindt ook kerrie." },
      { kind: "beter", text: "De balk bovenin schuift mee als je naar beneden scrollt en komt meteen terug als je omhoog gaat." },
      { kind: "beter", text: "Pop-ups zijn groter en komen rustig in beeld." },
      { kind: "beter", text: "Op Home zie je over welk lijstje de besparing gaat." },
      { kind: "opgelost", text: "Een nieuw account had meteen Albert Heijn als favoriete winkel. Nu kies je dat zelf." },
    ],
  },
];
