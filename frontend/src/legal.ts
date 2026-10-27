// Algemene voorwaarden, privacyverklaring, cookiebeleid en herroepen (bedenktijd).
// Pas je hier iets wezenlijks aan, zet dan ook TERMS_VERSION in backend/server.py op de nieuwe datum:
// dan geeft iedereen opnieuw akkoord bij de volgende keer inloggen.

export const LEGAL = {
  owner: "Jeroen Vermond",
  email: "info@slimboodschappenlijstje.nl",
  site: "slimboodschappenlijstje.nl",
  updated: "27 oktober 2026",
  minAge: 16,
  aiDaily: 60,
};

export type LegalDoc = "voorwaarden" | "privacy" | "cookies" | "herroepen";
export type LegalSection = { h: string; p: string[] };

const { owner, email, site, minAge, aiDaily } = LEGAL;

export const LEGAL_DOCS: Record<LegalDoc, { title: string; intro: string; sections: LegalSection[] }> = {
  voorwaarden: {
    title: "Algemene voorwaarden",
    intro:
      `Deze voorwaarden gelden voor het gebruik van Slim Boodschappenlijstje (de app en de website ${site}), gratis of met Premium. ` +
      "Door een account aan te maken ga je ermee akkoord. We hebben ze zo kort en duidelijk mogelijk gehouden.",
    sections: [
      {
        h: "1. Wie zijn wij",
        p: [
          `Slim Boodschappenlijstje wordt gemaakt en aangeboden door ${owner}. Zodra je Premium kunt kopen, staan hier ook ons adres en KvK-nummer.`,
          `Vragen of klachten? Mail naar ${email}. Je krijgt binnen twee weken een inhoudelijk antwoord.`,
        ],
      },
      {
        h: "2. Wat de app doet",
        p: [
          "Met de app plan je maaltijden en boodschappen, voor thuis, een kamp of een weekend. Je kiest dagen, aantal personen en gerechten, en de app maakt er een boodschappenlijst van. Je ziet prijzen, aanbiedingen en folders van supermarkten, houdt je voorraadkast bij, ziet wat je bespaart en werkt samen met anderen aan een planning.",
          "Sommige functies gebruiken kunstmatige intelligentie (AI), bijvoorbeeld Slimme hulp, het nakijken van productvoorstellen en slimmer zoeken. Lees daarover meer in punt 7.",
          "De app is nog volop in ontwikkeling. Functies kunnen veranderen, erbij komen of verdwijnen.",
        ],
      },
      {
        h: "3. Je account",
        p: [
          `Je moet ${minAge} jaar of ouder zijn om een account aan te maken. Ben je jonger, dan mag het alleen met toestemming van je ouder of verzorger. Wil je later Premium kopen en ben je jonger dan 18, dan moet je ouder of verzorger daar ook mee akkoord zijn.`,
          "Vul echte gegevens in en houd je wachtwoord geheim. Een account is voor één persoon: deel je inloggegevens niet. Merk je dat iemand anders in je account zit, verander dan je wachtwoord en laat het ons weten.",
          "Je kunt je account altijd zelf verwijderen via Account → Profiel & wachtwoord. Daarmee stopt ook deze overeenkomst. Heb je betaald Premium, dan stopt dat dan ook (zie punt 5 voor terugbetaling).",
        ],
      },
      {
        h: "4. Gratis en Premium",
        p: [
          "De gewone app is gratis en zonder advertenties. Premium geeft extra functies, zoals de voorraadkast, slim splitsen over winkels, aanbiedingen op je boodschappendag, prijsmeldingen en Slimme hulp met AI. Op het Premium-scherm zie je altijd welke functies erbij horen.",
          "Premium kun je nu op twee manieren krijgen. Verenigingen (zoals scouting of een sportclub) krijgen het gratis na een aanvraag die wij goedkeuren. En je kunt Premium verdienen door de app te delen (zie punt 6). Gratis Premium voor een vereniging kunnen we stopzetten als het niet meer voor de vereniging wordt gebruikt. Dat laten we je dan eerst weten.",
          "Later kun je Premium ook kopen voor thuisgebruik. Daarvoor gelden dan deze afspraken:",
          "• Je ziet vooraf de prijs in euro's, inclusief btw, en of het per maand of per jaar is. Er zijn geen verborgen kosten.",
          "• Je neemt Premium alleen als je daar zelf voor kiest. Wat je nu al gratis kunt, gaat je niet ongemerkt geld kosten.",
          "• Het abonnement loopt door tot je opzegt. Opzeggen kan altijd, zonder reden en zonder kosten, met een knop in de app. Je houdt Premium tot het einde van de periode die je al betaald hebt, en je krijgt een bevestiging per e-mail.",
          "• Gaat de prijs omhoog, dan laten we je dat minstens 30 dagen vooraf weten. Je kunt dan opzeggen voordat de nieuwe prijs ingaat.",
          "• Lukt een betaling niet, dan krijg je een e-mail en heb je minstens 14 dagen om alsnog te betalen. Daarna stopt Premium. Je planningen en lijstjes blijven gewoon bewaard.",
        ],
      },
      {
        h: "5. Bedenktijd (herroepingsrecht)",
        p: [
          "Koop je Premium, dan heb je 14 dagen bedenktijd. Die gaan in op de dag dat je Premium afsluit. In die tijd kun je de koop zonder reden ongedaan maken (herroepen).",
          "Premium is een digitale dienst die je direct kunt gebruiken. Daarom vragen we je bij het afsluiten of je wilt dat Premium meteen start. Zeg je ja en herroep je binnen de 14 dagen, dan betaal je alleen voor de dagen dat je Premium al had. De rest krijg je terug.",
          "Herroepen kan zo: in de app via Account → Voorwaarden, privacy & cookies → Herroepen, met de knop \"Herroep de overeenkomst hier\". Of mail het naar " +
            `${email}, eventueel met het modelformulier dat je daar ook vindt. Je krijgt meteen een bevestiging per e-mail.`,
          "We betalen je binnen 14 dagen na je herroeping terug, op dezelfde manier als waarop je betaalde.",
          "Heb je Premium gratis gekregen, bijvoorbeeld voor een vereniging of door te delen, dan heb je niets betaald en hoef je ook niets te herroepen. Wil je het niet meer, mail ons dan.",
        ],
      },
      {
        h: "6. Delen en Premium verdienen",
        p: [
          "Je kunt de app delen met je eigen link of code. Neemt iemand via jouw link of code Premium, dan krijg je een maand Premium erbij. Heb je al Premium zonder einddatum, dan komt de maand op je tegoed en gaat die in zodra je eigen Premium stopt.",
          "Je kunt zo maximaal 12 maanden verdienen. Een code moet je binnen twee weken na het aanmaken van je account invullen. Gratis Premium voor verenigingen telt niet mee.",
          "Nep-accounts aanmaken om Premium te verdienen mag niet. Zien we dat, dan halen we de verdiende maanden weg.",
        ],
      },
      {
        h: "7. Slimme hulp en AI",
        p: [
          "Slimme hulp (Premium) maakt met AI een menu uit één zin, bedenkt gerechten met je restjes, neemt recepten over van een tekst, link of foto, zet je getypte boodschappen op je lijst en geeft bespaartips. Daarnaast kijkt AI op de achtergrond productvoorstellen na en helpt het bij zoeken.",
          "AI maakt soms fouten. Een gerecht, hoeveelheid, product of tip kan dus niet kloppen. Kijk het altijd even na, zeker bij allergieën en diëten. Jij beslist wat er op je lijst komt.",
          `Je kunt Slimme hulp tot ${aiDaily} keer per dag gebruiken. AI kost ons geld per vraag, daarom kunnen we deze grens later aanpassen.`,
          "Zet in Slimme hulp geen gevoelige gegevens, zoals medische informatie. Maak alleen foto's van recepten die je zelf mag gebruiken, en gebruik overgenomen recepten alleen voor jezelf.",
        ],
      },
      {
        h: "8. Prijzen, aanbiedingen en productinformatie",
        p: [
          "Prijzen, aanbiedingen, folders en productgegevens halen we van de websites van supermarkten. Dat gaat automatisch en kan achterlopen of fout gaan. De prijs in de winkel is altijd leidend. Aan prijzen, totalen en besparingen in de app kun je geen rechten ontlenen.",
          "Slim Boodschappenlijstje is niet verbonden aan Albert Heijn, Jumbo, Dirk of een andere supermarkt. Namen en logo's van winkels en merken zijn van hun eigenaren.",
          "Let op bij allergieën en diëten. Of iets vegetarisch is of welke allergenen erin zitten, kan in de app onvolledig of fout zijn. Controleer altijd de verpakking.",
        ],
      },
      {
        h: "9. Recepten van andere websites",
        p: [
          "Online recepten komen van andere websites. We tonen ze met een verwijzing naar de bron. De rechten op die recepten liggen bij de makers ervan.",
        ],
      },
      {
        h: "10. Wat jij in de app zet",
        p: [
          "Gerechten, planningen, foto's en andere dingen die je zelf toevoegt, blijven van jou. Je geeft ons alleen toestemming om ze op te slaan en te tonen, voor zover dat nodig is om de app te laten werken. Bijvoorbeeld aan de mensen met wie je een planning deelt.",
          "Meld je een gerecht aan als standaardgerecht, dan mag iedereen in de app het zien en gebruiken, ook als je later je account verwijdert.",
          "Zet niets in de app wat niet van jou is of wat niet mag, zoals foto's van anderen zonder toestemming. Nodig alleen mensen uit die het goed vinden dat je hun e-mailadres gebruikt.",
        ],
      },
      {
        h: "11. Netjes gebruik",
        p: [
          "Gebruik de app niet om te spammen, om anderen lastig te vallen, om de AI te misbruiken of om de app te hacken, te overbelasten of automatisch leeg te halen. Doe je dat toch, dan mogen we je account blokkeren of verwijderen. Heb je dan betaald Premium, dan krijg je het deel terug van de periode die je niet meer kunt gebruiken, behalve als je ons met opzet schade hebt gedaan.",
        ],
      },
      {
        h: "12. Beschikbaarheid",
        p: [
          "We doen ons best om de app goed te laten werken, maar beloven niet dat hij altijd zonder storing werkt. Soms is de app even niet bereikbaar, bijvoorbeeld door onderhoud of een update. We houden de overlast zo klein mogelijk.",
          "Stopt de app of Premium helemaal, dan laten we je dat minstens een maand van tevoren weten, zodat je je gegevens kunt bewaren. Wat je vooruit hebt betaald voor de tijd daarna, krijg je terug.",
        ],
      },
      {
        h: "13. Aansprakelijkheid",
        p: [
          "We zijn niet aansprakelijk voor schade door verkeerde prijzen, ontbrekende producten, fouten in productinformatie of AI-voorstellen, of doordat de app even niet werkt.",
          "Zijn we toch aansprakelijk, dan hoogstens tot het bedrag dat je in de 12 maanden daarvoor aan Premium hebt betaald. Gebruik je de app gratis, dan is dat nul.",
          "Deze grenzen gelden niet bij opzet of bewuste roekeloosheid van onze kant, en ze nemen je wettelijke rechten als consument niet weg.",
        ],
      },
      {
        h: "14. Klachten",
        p: [
          `Ben je ergens niet tevreden over, mail dan naar ${email} en vertel wat er aan de hand is. Je krijgt binnen twee weken een inhoudelijk antwoord. Komen we er samen niet uit, dan kun je naar de bevoegde rechter in Nederland.`,
        ],
      },
      {
        h: "15. Wijzigingen",
        p: [
          "Als we deze voorwaarden of de privacyverklaring wezenlijk veranderen, vragen we je bij de volgende keer inloggen opnieuw akkoord te geven. Heb je betaald Premium, dan laten we het je minstens 30 dagen vooraf per e-mail weten, en kun je opzeggen voordat de wijziging ingaat. Ben je het er niet mee eens, dan kun je je account verwijderen.",
        ],
      },
      {
        h: "16. Recht",
        p: [
          "Op deze voorwaarden is Nederlands recht van toepassing. Woon je in een ander land van de Europese Unie, dan houd je de bescherming die de wet van jouw land je als consument geeft.",
        ],
      },
    ],
  },

  privacy: {
    title: "Privacyverklaring",
    intro:
      "In deze verklaring lees je welke gegevens Slim Boodschappenlijstje van je bewaart, waarom, en wat je rechten zijn. " +
      "Kort gezegd: we bewaren alleen wat nodig is om de app te laten werken. We verkopen je gegevens niet en volgen je niet op andere websites.",
    sections: [
      {
        h: "1. Wie is verantwoordelijk",
        p: [
          `${owner} is verantwoordelijk voor de verwerking van je gegevens in Slim Boodschappenlijstje. Voor vragen over privacy mail je naar ${email}.`,
        ],
      },
      {
        h: "2. Welke gegevens we bewaren",
        p: [
          "Accountgegevens: je naam en e-mailadres, en je wachtwoord in versleutelde vorm (we kunnen het zelf niet lezen). Log je in met Google, dan krijgen we van Google je naam, e-mailadres en profielfoto. We bewaren ook wanneer je akkoord gaf met de voorwaarden.",
          "Wat je zelf invult (niet verplicht): gebruikersnaam, telefoonnummer, profielfoto en favoriete winkel.",
          "Wat je in de app maakt: je planningen (dagen, aantal personen en vega-eters, maaltijden, budget), boodschappenlijsten, eigen gerechten en pakketten, je voorraadkast, prijsmeldingen, favoriete producten en recepten, feedback en supermarkt-aanvragen.",
          "Premium: of je Premium hebt en tot wanneer, je aanvraag voor een vereniging (naam van de vereniging en je toelichting), en wie jou heeft uitgenodigd of wie jij hebt uitgenodigd met je deelcode. Kun je later Premium kopen, dan bewaren we ook je betalingen (bedrag, datum en of het gelukt is). Je bankgegevens zelf ziet alleen de betaaldienst.",
          "Slimme hulp: wat je typt, de link die je plakt of de foto die je maakt, zodat de AI er een menu, gerecht of lijstje van kan maken. Het resultaat wordt alleen bewaard als je het opslaat.",
          "Mensen die je uitnodigt: hun e-mailadres, zodat we ze een uitnodiging kunnen sturen.",
          "Wat je bekijkt en kiest: welke afdelingen, merken, producten en recepten je opzoekt en kiest, en wat de voorraadkast leert van je recepten. Hiermee zetten we aanbiedingen en recepten in een voor jou handige volgorde. Je kunt dit wissen en uitzetten (zie punt 4).",
          "Herroepen: gebruik je de herroepknop, dan bewaren we je naam, e-mailadres, wat je herroept en wanneer.",
          "Technische gegevens: een inlogcode op je apparaat zodat je ingelogd blijft, en je IP-adres in de logboeken van de server en om misbruik (zoals te veel inlogpogingen) tegen te gaan.",
          "We vragen nooit om bijzondere gegevens, zoals gezondheid of geloof. Vul die ook niet in bij namen, notities of Slimme hulp. Allergieën en dieet die je bij Account instelt, blijven alleen op je eigen apparaat. Die krijgen wij niet te zien.",
        ],
      },
      {
        h: "3. Waarom we dit doen",
        p: [
          "Om de app te laten werken (uitvoering van de overeenkomst): je account, je planningen en lijstjes bewaren, samenwerken met anderen, Premium en Slimme hulp, en e-mails die bij de app horen, zoals een code om je wachtwoord te herstellen, een uitnodiging, een prijsmelding of een bevestiging.",
          "Omdat de wet het vraagt (wettelijke plicht): betalingen bewaren voor de belastingdienst, en herroepingen bevestigen en bewaren.",
          "Omdat we daar een gerechtvaardigd belang bij hebben: de app beveiligen tegen misbruik, back-ups maken zodat er niets kwijtraakt, fouten opsporen en oplossen, de app verbeteren met je feedback, en de volgorde van aanbiedingen en recepten aanpassen aan wat jij vaak bekijkt.",
          "We nemen geen besluiten over jou die je merkbaar raken op basis van alleen automatische verwerking. De persoonlijke volgorde en de AI veranderen alleen wat je eerst ziet of wat de app je voorstelt. Jij kiest zelf.",
        ],
      },
      {
        h: "4. Je geschiedenis wissen of uitzetten",
        p: [
          "Bij Account → Mijn geschiedenis wis je wat je bekeek: alles, of alleen producten, recepten of geleerde voorraad, over een periode die je zelf kiest.",
          "Wil je helemaal niet dat we bijhouden wat je bekijkt? Zet dan bij Account → Profiel & wachtwoord het vinkje bij \"Persoonlijke aanbiedingen en recepten\" uit. Wat we tot dan hadden bijgehouden, wordt direct gewist.",
        ],
      },
      {
        h: "5. Wie je gegevens kan zien",
        p: [
          "Mensen met wie je een planning deelt, zien je naam en wat je in die planning zet.",
          "Beheerders van de app kunnen je naam, e-mailadres, rol en Premium zien om accounts te beheren en hulp te geven. Feedback en aanvragen die je instuurt, zien ze ook.",
          "Voor het draaien van de app gebruiken we deze diensten, die je gegevens alleen voor ons verwerken:",
          "• Render: hosting van de app en de database, met servers in Frankfurt (Duitsland).",
          "• Google Workspace (Gmail): versturen van e-mails van de app, en de mailbox waarin back-ups en foutmeldingen binnenkomen. Als reserve kan e-mail ook via Resend gaan.",
          "• Anthropic (Claude): de AI achter Slimme hulp, het nakijken van productvoorstellen en slimmer zoeken. Anthropic krijgt alleen wat nodig is voor de vraag, zoals wat je in Slimme hulp typt of fotografeert, of een zoekwoord. Geen naam of e-mailadres. Anthropic gebruikt dit niet om zijn AI te trainen.",
          "• Google: alleen als je kiest voor \"Doorgaan met Google\".",
          "• Later een betaaldienst (bijvoorbeeld voor iDEAL), als je Premium koopt. Die noemen we hier zodra het zover is.",
          "Sommige van deze bedrijven zijn Amerikaans. Komen gegevens buiten de Europese Unie terecht, dan gebeurt dat met de waarborgen uit de AVG, zoals het EU-VS Data Privacy Framework of de standaardcontractbepalingen van de Europese Commissie.",
          "We verkopen je gegevens nooit en geven ze niet aan adverteerders of supermarkten.",
        ],
      },
      {
        h: "6. Hoe lang we gegevens bewaren",
        p: [
          "Zolang je account bestaat. Verwijder je je account, dan worden je gegevens direct en definitief uit de app gewist. Gedeelde planningen blijven bestaan voor de andere deelnemers, en standaardgerechten die je hebt aangemeld blijven zonder je naam staan.",
          "Back-ups: elke nacht maken we een back-up van de database. Daarin kunnen je gegevens nog staan tot de back-up wordt gewist. We bewaren back-ups hoogstens 30 dagen en gebruiken ze alleen om gegevens terug te zetten na een storing.",
          "Dingen die je zelf verwijdert, staan nog 30 dagen in \"Recent verwijderd\" zodat je ze terug kunt zetten. Daarna zijn ze weg.",
          "Een inlogsessie verloopt na 7 dagen. Een code om je wachtwoord te herstellen verloopt na 1 uur.",
          "Gebruik je je account twee jaar niet, dan sturen we je een e-mail. Log je daarna binnen 30 dagen niet in, dan verwijderen we je account en je gegevens. Inloggen is genoeg om je account te houden.",
          "Herroepingen bewaren we 2 jaar, als bewijs voor jou en voor ons. Betalingen bewaren we 7 jaar, omdat de belastingwet dat vraagt.",
          "Logboeken van de server worden na korte tijd automatisch gewist.",
        ],
      },
      {
        h: "7. Beveiliging",
        p: [
          "De verbinding met de app is altijd versleuteld (https). Wachtwoorden worden versleuteld opgeslagen. Alleen beheerders hebben toegang tot het beheer van de app. Merken we een datalek dat jou raakt, dan laten we het je weten en melden we het waar nodig bij de Autoriteit Persoonsgegevens.",
        ],
      },
      {
        h: "8. E-mails van de app",
        p: [
          "We mailen je alleen over dingen die bij de app horen, zoals uitnodigingen, je wachtwoord, Premium, prijsmeldingen en bevestigingen. Geen reclame van anderen. Onder de meeste mails staat een link om je af te melden. Mails die je echt nodig hebt, zoals een wachtwoordcode of een bevestiging van een herroeping, krijg je altijd.",
        ],
      },
      {
        h: "9. Jouw rechten",
        p: [
          "Je mag je gegevens inzien, laten verbeteren of laten verwijderen. Je mag bezwaar maken tegen het gebruik ervan, het gebruik laten beperken, en je gegevens in een handig bestand opvragen om mee te nemen.",
          "Veel kun je zelf in de app: je gegevens aanpassen en je account verwijderen bij Account → Profiel & wachtwoord, en je geschiedenis wissen bij Account → Mijn geschiedenis. Voor de rest mail je naar " +
            `${email}. We reageren binnen een maand.`,
          "Ben je niet tevreden over hoe we met je gegevens omgaan, laat het ons dan weten. Je mag ook een klacht indienen bij de Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).",
        ],
      },
      {
        h: "10. Kinderen",
        p: [
          `De app is bedoeld voor mensen van ${minAge} jaar en ouder. Ben je jonger, dan heb je toestemming van je ouder of verzorger nodig. Denkt een ouder dat het kind zonder toestemming een account heeft, mail ons dan, dan verwijderen we het.`,
        ],
      },
      {
        h: "11. Wijzigingen",
        p: ["Passen we deze verklaring wezenlijk aan, dan vragen we je bij de volgende keer inloggen opnieuw akkoord te geven."],
      },
    ],
  },

  cookies: {
    title: "Cookiebeleid",
    intro:
      "Slim Boodschappenlijstje gebruikt geen tracking- of advertentiecookies. Daarom zie je bij ons ook geen cookiemelding. " +
      "Komen er later advertenties of statistieken die cookies gebruiken, dan vragen we eerst je toestemming en passen we dit beleid aan.",
    sections: [
      {
        h: "1. Wat we wel opslaan op je apparaat",
        p: [
          "Om je ingelogd te houden, bewaren we een inlogcode op je apparaat. In de browser staat die in de lokale opslag (localStorage), in de app in de beveiligde opslag van je telefoon.",
          "Daarnaast onthouden we een paar dingen op je apparaat: keuzes zoals welke weergave je het laatst gebruikte en wat je op je lijst hebt afgevinkt, je allergieën en dieet, een kopie van je lijstjes zodat je ze ook zonder internet kunt zien, en de deelcode van iemand die jou de app aanraadde.",
          "Dit is nodig om de app te laten werken. Volgens de Telecommunicatiewet hoeven we daar geen toestemming voor te vragen. Als je uitlogt, wordt de inlogcode gewist.",
        ],
      },
      {
        h: "2. Wat we niet doen",
        p: [
          "We gebruiken geen Google Analytics of andere bezoekersstatistieken van anderen, geen advertentienetwerken, geen social-media-knoppen en geen andere cookies die je volgen.",
        ],
      },
      {
        h: "3. Afbeeldingen en lettertypen van andere websites",
        p: [
          "Sommige afbeeldingen (zoals productfoto's van supermarkten, folders en receptfoto's) worden rechtstreeks van andere websites geladen, en het lettertype komt van jsDelivr. Daarbij ziet die website je IP-adres, net als bij elke website die je bezoekt. Wij zetten daarbij zelf geen cookies.",
          "Kies je \"Doorgaan met Google\", dan ga je even naar Google om in te loggen. Google kan daar zijn eigen cookies gebruiken.",
        ],
      },
      {
        h: "4. Zelf wissen",
        p: [
          "Je kunt de opgeslagen gegevens altijd wissen door uit te loggen, of via de instellingen van je browser of telefoon. Je moet daarna opnieuw inloggen.",
          `Vragen? Mail naar ${email}.`,
        ],
      },
    ],
  },

  herroepen: {
    title: "Herroepen",
    intro:
      "Heb je Premium gekocht? Dan heb je 14 dagen bedenktijd. In die tijd kun je de koop zonder reden ongedaan maken. Dat heet herroepen. " +
      "Heb je Premium gratis gekregen, dan hoef je niets te herroepen.",
    sections: [
      {
        h: "Zo werkt het",
        p: [
          "Tik hieronder op \"Herroep de overeenkomst hier\", vul je gegevens in en tik op \"Bevestig herroeping\". Je krijgt meteen een bevestiging per e-mail.",
          "Zei je bij het afsluiten dat Premium meteen mocht starten? Dan betaal je alleen voor de dagen dat je Premium al had. De rest krijg je binnen 14 dagen terug, op dezelfde manier als waarop je betaalde.",
          `Liever mailen? Stuur dan het modelformulier hieronder naar ${email}.`,
        ],
      },
      {
        h: "Modelformulier voor herroeping",
        p: [
          `Aan: ${owner}, Slim Boodschappenlijstje, ${email}`,
          "Ik deel hierbij mee dat ik mijn overeenkomst over de volgende dienst herroep:",
          "• Dienst: Slim Boodschappenlijstje Premium",
          "• Afgesloten op: [datum]",
          "• Naam: [je naam]",
          "• E-mailadres van je account: [e-mailadres]",
          "• Datum: [vandaag]",
        ],
      },
    ],
  },
};
