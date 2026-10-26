// Wat er nieuw is in de app. Bij elke update die online gaat: bovenaan een nieuw blok met een nieuwe id.
// Iedereen ziet het nieuwste blok één keer kort bovenin; tik erop voor alles.
export type Change = { kind: "nieuw" | "beter" | "opgelost"; text: string };
export type Release = { id: string; date: string; title: string; changes: Change[] };

export const CHANGELOG: Release[] = [
  {
    id: "2026-10-26-c",
    date: "26 oktober 2026",
    title: "Vegen, verversen en een snelle voorraadkast",
    changes: [
      { kind: "nieuw", text: "Voorraadkast in één keer vullen: vink aan wat je al in huis hebt uit wat veel mensen hebben, met een product erbij dat je kunt wisselen." },
      { kind: "nieuw", text: "In de voorraadkast zoek je nu naar echte producten om toe te voegen." },
      { kind: "nieuw", text: "Bij een lijstje veeg je opzij naar de vorige of volgende dag." },
      { kind: "nieuw", text: "Bij een aanbieding blader je met Vorige en Volgende (of vegen) door de andere aanbiedingen. Na een product bekijken kom je terug bij de keuzes." },
      { kind: "beter", text: "Omlaag trekken om te verversen werkt nu ook in de webapp op je telefoon." },
      { kind: "beter", text: "De balk bovenin schuift rustig mee met je vinger, ook terug." },
      { kind: "beter", text: "Zoeken op brood geeft eerst gewoon brood, geen kokosbrood of broodjes." },
      { kind: "beter", text: "Slim splitsen over winkels is nu Premium. Wat je daarmee bespaart, telt mee in je bespaaroverzicht." },
    ],
  },
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
