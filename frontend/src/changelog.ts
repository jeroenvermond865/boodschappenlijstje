// Wat er nieuw is in de app. Bij elke update die online gaat: bovenaan een nieuw blok met een nieuwe id.
// Iedereen ziet het nieuwste blok één keer kort bovenin; tik erop voor alles.
export type Change = { kind: "nieuw" | "beter" | "opgelost"; text: string };
export type Release = { id: string; date: string; title: string; changes: Change[] };

export const CHANGELOG: Release[] = [
  {
    id: "2026-10-26-n",
    date: "26 oktober 2026",
    title: "Nette PDF van je boodschappenlijst",
    changes: [
      { kind: "opgelost", text: "Delen > Printen of PDF werkt weer, nu met een overzichtelijke lijst in de stijl van de app." },
      { kind: "beter", text: "Verversen door omlaag te trekken gaat minder snel per ongeluk: je moet verder trekken." },
      { kind: "opgelost", text: "Het budget rekent nu met hetzelfde bedrag als je boodschappenlijst." },
      { kind: "opgelost", text: "Vergelijken tussen winkels kiest dezelfde soort: gewone penne wordt niet meer vergeleken met volkoren of glutenvrij." },
      { kind: "beter", text: "Looproute: uitleg dat je hem zelf goed zet voor jouw filiaal (met 'Niet meer tonen')." },
      { kind: "beter", text: "Eén balkje bovenin je lijst laat zien waar je alles haalt; tik erop om terug te gaan naar je eigen winkels." },
      { kind: "beter", text: "De losse PDF- en verversknop bovenin de boodschappenlijst zijn weg (PDF staat onder Delen)." },
    ],
  },
  {
    id: "2026-10-26-i",
    date: "26 oktober 2026",
    title: "Producten naast elkaar vergelijken",
    changes: [
      { kind: "beter", text: "Afvinken wat al in je voorraadkast staat: je ziet eerst welke producten het zijn en zet uit wat je toch wilt kopen." },
      { kind: "nieuw", text: "Tik op 'Bij Dirk € …, hier € …' onder een product: je ziet beide producten naast elkaar, andere keuzes bij je winkel (ook grotere verpakkingen die per kilo goedkoper zijn) en wat de andere winkels hebben." },
    ],
  },
  {
    id: "2026-10-26-g",
    date: "26 oktober 2026",
    title: "De app leert van jouw keuzes",
    changes: [
      { kind: "nieuw", text: "Kies je zelf een beter product bij een ingrediënt, dan onthoudt de app dat. Kiezen meer mensen hetzelfde, dan krijgt iedereen dat product voorgesteld." },
      { kind: "beter", text: "Bespaaroverzicht: wat je met slim splitsen over winkels nog kunt besparen staat er nu ook bij. Zonder Premium zie je wat het je zou opleveren." },
      { kind: "opgelost", text: "Saffraan is weer gewoon saffraan (en geen saffraanrijst)." },
      { kind: "opgelost", text: "Zwarte peperkorrels worden nu gewone zwarte peper uit het kruidenrek." },
    ],
  },
  {
    id: "2026-10-26-e",
    date: "26 oktober 2026",
    title: "Meer voorstellen voor je voorraadkast",
    changes: [
      { kind: "nieuw", text: "Bij de voorstellen voor je voorraadkast zoek je ook zelf een product, bijvoorbeeld je eigen afwasmiddel." },
      { kind: "nieuw", text: "Bij wisselen van een product kun je ook zoeken." },
      { kind: "beter", text: "Per product kies je: bijhouden in aantal of in procent, en hoeveel je per week gebruikt. Of het meetelt bij gerechten zet je met één tik aan of uit." },
      { kind: "beter", text: "Veel meer voorstellen (sauzen, gebakken uitjes, snoep, verzorging) en 'Andere voorstellen' geeft steeds een mix uit alle groepen." },
    ],
  },
  {
    id: "2026-10-26-d",
    date: "26 oktober 2026",
    title: "Slimmere voorraadkast en echte besparing",
    changes: [
      { kind: "nieuw", text: "Voorraadkast: stel per product in hoeveel je er zelf per week van gebruikt, en of het meetelt voor je gerechten." },
      { kind: "nieuw", text: "Bijna op? Dan zie je het bovenaan je boodschappenlijst en zet je het er met één tik bij." },
      { kind: "nieuw", text: "Bespaaroverzicht: al bespaard (wat je hebt afgevinkt) apart van wat je nog gaat besparen." },
      { kind: "nieuw", text: "Bij het verwijderen van een lijstje kies je of de gekochte besparing bewaard blijft." },
      { kind: "beter", text: "Verversen op Home geeft andere recepten en aanbiedingen die bij je passen." },
      { kind: "beter", text: "De voorraadkast staat overzichtelijk in groepen, en 'Andere voorstellen' laat steeds nieuwe dingen zien." },
    ],
  },
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
