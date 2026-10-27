// Wat er nieuw is in de app. Bij elke update die online gaat: bovenaan een nieuw blok met een nieuwe id.
// Iedereen ziet het nieuwste blok één keer kort bovenin; tik erop voor alles.
export type Change = { kind: "nieuw" | "beter" | "opgelost"; text: string };
export type Release = { id: string; date: string; title: string; changes: Change[] };

export const CHANGELOG: Release[] = [
  {
    id: "2026-10-27-a",
    date: "27 oktober 2026",
    title: "Tips bij gerechten: echt doen, en terug wisselen",
    changes: [
      { kind: "beter", text: "Gewisseld bij een gerecht (bijv. 'Liever vlees?')? De knop wordt nu 'Terug wisselen', zodat je met één tik weer terug bent." },
      { kind: "nieuw", text: "Andere tips bij een recept, zoals 'lekker met wat extra feta' of 'je kunt ook spinazie gebruiken', komen nu met een productvoorstel. Tik Toevoegen of Vervangen en het staat op je lijstje." },
      { kind: "nieuw", text: "Past het voorgestelde product niet? Tik 'Ander product' en kies zelf. De app onthoudt wat je kiest en stelt dat de volgende keer voor." },
      { kind: "opgelost", text: "Wisselen van vega naar vlees geldt alleen voor jou en wordt niet meer aan anderen voorgesteld." },
      { kind: "opgelost", text: "Vervangen bij een gerecht (bijv. 'Liever vlees?') gaf de melding 'Kamp niet gevonden'. Dat werkt nu. Meldingen zeggen ook 'lijstje' in plaats van 'kamp'." },
    ],
  },
  {
    id: "2026-10-26-v",
    date: "26 oktober 2026",
    title: "Bereiding die past bij jouw producten",
    changes: [
      { kind: "nieuw", text: "Gerechten zonder bereiding (bijv. zelf gemaakt in de app) krijgen een bereidingsvoorstel, op basis van je producten en wat er op de verpakking staat." },
      { kind: "nieuw", text: "Gebruik je andere producten dan in het recept (bijv. gewone gyros in plaats van vega), dan past de bereiding zich daarop aan." },
      { kind: "opgelost", text: "Recepten met vega én vlees als keuze (zoals vega pita gyros) zetten niet meer allebei op je lijst. Je kiest vega, en met 'Liever vlees?' wissel je met één knop." },
      { kind: "opgelost", text: "'Liever vlees? ...' bij een recept wordt nu ook gevonden als het in de stappen of op een andere plek staat." },
      { kind: "opgelost", text: "Gerechten die je eerder overnam en een kruidenmix (zoals 'mix voor gyros') of vlees bij een vega-ingrediënt kregen, zijn opnieuw gekozen." },
      { kind: "beter", text: "Gerecht kiezen voor een maaltijd: na Toevoegen ga je meteen terug naar je lijstje." },
      { kind: "opgelost", text: "Gerecht kiezen bij Online: het venster schuift niet meer half mee als je scrolt." },
    ],
  },
  {
    id: "2026-10-26-u",
    date: "26 oktober 2026",
    title: "Gerechten eerst bekijken, dan kiezen",
    changes: [
      { kind: "nieuw", text: "Gerecht kiezen voor een maaltijd: tik een gerecht aan en je ziet eerst wat erin zit en de bereiding, met Toevoegen of Terug. Met de tabs App, Online, Eigen en Pakketten, net als bij Gerechten." },
      { kind: "beter", text: "Tik je in je lijstje op een gerecht, dan kies je tussen het hele gerecht openen of aanpassen voor dit lijstje. Ook vanuit Op het menu open je het hele gerecht." },
      { kind: "nieuw", text: "Staat in een recept 'Liever vlees? Vervang ...', dan kun je dat met één knop doen: bij het recept, bij het kiezen en in je lijstje." },
      { kind: "beter", text: "Voorraadkast: bladeren per afdeling, dan per soort, dan je producten. Net als bij Alle producten." },
      { kind: "beter", text: "Product toevoegen is een groter venster en de zoekbalk blijft staan als je scrolt." },
      { kind: "opgelost", text: "Vega gyros (en vergelijkbare producten) kiest niet meer een kruidenmix zoals 'mix voor gyros'." },
    ],
  },
  {
    id: "2026-10-26-t",
    date: "26 oktober 2026",
    title: "Voorraadkast opnieuw ingedeeld",
    changes: [
      { kind: "beter", text: "Voorraadkast: zoeken staat bovenaan en filtert meteen ook je eigen voorraad. De voorstellen zijn ingeklapt." },
      { kind: "beter", text: "Je voorraad staat nu per afdeling en soort, net als bij Alle producten, met een filter (bijv. alleen wat bijna op is)." },
      { kind: "nieuw", text: "Per product stel je in hoe vol het nu is en hoeveel er af gaat (procent, stuks of gram) per dag, week, maand of een eigen aantal dagen. Het algemene standaardverbruik is weg." },
      { kind: "opgelost", text: "Vergelijken met andere winkels kiest minder vaak iets heel anders (zoals tonic voor suiker of soep voor kikkererwten)." },
    ],
  },
  {
    id: "2026-10-26-s",
    date: "26 oktober 2026",
    title: "Dag-menu en rustiger budget",
    changes: [
      { kind: "nieuw", text: "Tik op Home bij 'Op het menu' op een dag: je ziet de gerechten van die dag met ingrediënten en bereiding, en met één knop het boodschappenlijstje van alleen die dag, op looproute om af te vinken." },
      { kind: "beter", text: "Per dag in je boodschappenlijst staat nu per afdeling, net als het totaal." },
      { kind: "beter", text: "Budget: geen lange lijst met losse producten meer (die zie je in je boodschappenlijst). Per dag laat nu zien wat je lijstje van die dag kost." },
    ],
  },
  {
    id: "2026-10-26-r",
    date: "26 oktober 2026",
    title: "Echte PDF en product als venster",
    changes: [
      { kind: "opgelost", text: "Delen > PDF maakt nu een echte PDF in de stijl van de app. Op je telefoon kun je hem bewaren, printen of delen." },
      { kind: "beter", text: "Tik je op een product in je boodschappenlijst, dan opent een venster met prijs, andere winkels en een knop Wisselen." },
    ],
  },
  {
    id: "2026-10-26-q",
    date: "26 oktober 2026",
    title: "Nette PDF van je boodschappenlijst",
    changes: [
      { kind: "opgelost", text: "Delen > Printen of PDF werkt weer, nu met een overzichtelijke lijst in de stijl van de app." },
      { kind: "beter", text: "Verversen door omlaag te trekken gaat minder snel per ongeluk: je moet verder trekken." },
      { kind: "nieuw", text: "Home: 'Op het menu' (vandaag en morgen naast elkaar), 'Jouw lijst in de aanbieding' en wat bijna op is in je voorraadkast. Het vergelijkblok staat nu alleen bij je boodschappenlijst." },
      { kind: "beter", text: "Vernieuwen naar een nieuwe versie gaat soepeler, met een laadscherm in plaats van een wit of vastgelopen scherm." },
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
