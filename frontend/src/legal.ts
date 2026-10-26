// Algemene voorwaarden, privacyverklaring en cookiebeleid.
// Pas je hier iets wezenlijks aan, zet dan ook TERMS_VERSION in backend/server.py op de nieuwe datum:
// dan geeft iedereen opnieuw akkoord bij de volgende keer inloggen.

export const LEGAL = {
  owner: "Jeroen Vermond",
  email: "info@slimboodschappenlijstje.nl",
  site: "slimboodschappenlijstje.nl",
  updated: "25 oktober 2026",
  minAge: 16,
};

export type LegalDoc = "voorwaarden" | "privacy" | "cookies";
export type LegalSection = { h: string; p: string[] };

const { owner, email, site, minAge } = LEGAL;

export const LEGAL_DOCS: Record<LegalDoc, { title: string; intro: string; sections: LegalSection[] }> = {
  voorwaarden: {
    title: "Algemene voorwaarden",
    intro:
      `Deze voorwaarden gelden voor het gebruik van Slim Boodschappenlijstje (de app en de website ${site}). ` +
      "Door een account aan te maken ga je ermee akkoord. We hebben ze zo kort en duidelijk mogelijk gehouden.",
    sections: [
      {
        h: "1. Wie zijn wij",
        p: [
          `Slim Boodschappenlijstje wordt gemaakt en aangeboden door ${owner}, als privépersoon.`,
          `Vragen of klachten? Mail naar ${email}. We reageren zo snel mogelijk, en in ieder geval binnen twee weken.`,
        ],
      },
      {
        h: "2. Wat de app doet",
        p: [
          "Met de app plan je maaltijden en boodschappen, bijvoorbeeld voor een kamp, een weekend of gewoon thuis. Je kiest dagen, aantal personen en gerechten, en de app maakt er een boodschappenlijst van. Je ziet prijzen en aanbiedingen van supermarkten en kunt samen met anderen aan een planning werken.",
          "De app is nu gratis en zonder advertenties. Er kunnen later advertenties of een betaalde versie met extra functies komen. Dat laten we je vooraf weten, en wat je al gratis kon, blijft je niet ongemerkt geld kosten. Een betaald abonnement neem je alleen als je daar zelf voor kiest.",
        ],
      },
      {
        h: "3. Je account",
        p: [
          `Je moet ${minAge} jaar of ouder zijn om een account aan te maken. Ben je jonger, dan mag het alleen met toestemming van je ouder of verzorger.`,
          "Vul echte gegevens in en houd je wachtwoord geheim. Een account is voor één persoon. Merk je dat iemand anders in je account zit, verander dan je wachtwoord en laat het ons weten.",
          "Je kunt je account altijd zelf verwijderen via Account → Profiel & wachtwoord. Daarmee stopt ook deze overeenkomst.",
        ],
      },
      {
        h: "4. Prijzen, aanbiedingen en productinformatie",
        p: [
          "Prijzen, aanbiedingen en productgegevens halen we van de websites van supermarkten. Dat gaat automatisch en kan achterlopen of fout gaan. De prijs in de winkel is altijd leidend. Aan prijzen en totalen in de app kun je geen rechten ontlenen.",
          "Slim Boodschappenlijstje is niet verbonden aan Albert Heijn, Jumbo, Dirk of een andere supermarkt. Namen en logo's van winkels en merken zijn van hun eigenaren.",
          "Let op bij allergieën en diëten. Of iets vegetarisch is of welke allergenen erin zitten, kan in de app onvolledig of fout zijn. Controleer altijd de verpakking.",
        ],
      },
      {
        h: "5. Recepten van andere websites",
        p: [
          "Online recepten komen van andere websites. We tonen ze met een verwijzing naar de bron. De rechten op die recepten liggen bij de makers ervan.",
        ],
      },
      {
        h: "6. Wat jij in de app zet",
        p: [
          "Gerechten, planningen, foto's en andere dingen die je zelf toevoegt, blijven van jou. Je geeft ons alleen toestemming om ze op te slaan en te tonen, voor zover dat nodig is om de app te laten werken. Bijvoorbeeld aan de mensen met wie je een planning deelt.",
          "Meld je een gerecht aan als standaardgerecht, dan mag iedereen in de app het zien en gebruiken, ook als je later je account verwijdert.",
          "Zet niets in de app wat niet van jou is of wat niet mag, zoals foto's van anderen zonder toestemming. Nodig alleen mensen uit die het goed vinden dat je hun e-mailadres gebruikt.",
        ],
      },
      {
        h: "7. Netjes gebruik",
        p: [
          "Gebruik de app niet om te spammen, om anderen lastig te vallen of om de app te hacken, te overbelasten of automatisch leeg te halen. Doe je dat toch, dan mogen we je account blokkeren of verwijderen.",
        ],
      },
      {
        h: "8. Beschikbaarheid",
        p: [
          "We doen ons best om de app goed te laten werken, maar het is een hobbyproject. Soms is de app even niet bereikbaar, bijvoorbeeld door onderhoud of een storing. We kunnen functies veranderen of weghalen.",
          "Stopt de app helemaal, dan laten we je dat minstens een maand van tevoren weten, zodat je je gegevens kunt bewaren.",
        ],
      },
      {
        h: "9. Aansprakelijkheid",
        p: [
          "De app is gratis en wordt gebruikt zoals hij is. We zijn niet aansprakelijk voor schade door verkeerde prijzen, ontbrekende producten, fouten in productinformatie, of doordat de app even niet werkt. Dit geldt niet als de schade komt door opzet of grove nalatigheid van onze kant.",
        ],
      },
      {
        h: "10. Wijzigingen",
        p: [
          "Als we deze voorwaarden of de privacyverklaring wezenlijk veranderen, vragen we je bij de volgende keer inloggen opnieuw akkoord te geven. Ben je het er niet mee eens, dan kun je je account verwijderen.",
        ],
      },
      {
        h: "11. Recht",
        p: ["Op deze voorwaarden is Nederlands recht van toepassing. Komen we er samen niet uit, dan beslist de bevoegde rechter in Nederland."],
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
          `${owner} (privépersoon) is verantwoordelijk voor de verwerking van je gegevens in Slim Boodschappenlijstje. Voor vragen over privacy mail je naar ${email}.`,
        ],
      },
      {
        h: "2. Welke gegevens we bewaren",
        p: [
          "Accountgegevens: je naam en e-mailadres, en je wachtwoord in versleutelde vorm (we kunnen het zelf niet lezen). Log je in met Google, dan krijgen we van Google je naam, e-mailadres en profielfoto.",
          "Wat je zelf invult (niet verplicht): gebruikersnaam, telefoonnummer, profielfoto en favoriete winkel.",
          "Wat je in de app maakt: je planningen (dagen, aantal personen en vega-eters, maaltijden, budget), boodschappenlijsten, eigen gerechten en pakketten, favoriete producten en recepten, feedback en supermarkt-aanvragen.",
          "Mensen die je uitnodigt: hun e-mailadres, zodat we ze een uitnodiging kunnen sturen.",
          "Wat je bekijkt: welke afdelingen, merken, producten en recepten je opzoekt en kiest. Dit gebruiken we alleen om aanbiedingen en recepten op de startpagina in een voor jou handige volgorde te zetten. Je kunt dit uitzetten (zie punt 4).",
          "Technische gegevens: een inlogcode op je apparaat zodat je ingelogd blijft, en je IP-adres in de logboeken van de server.",
          "We vragen nooit om bijzondere gegevens, zoals gezondheid of geloof. Vul die ook niet in bij namen of notities. Allergieën en dieet die je bij Account instelt, blijven alleen op je eigen apparaat. Die krijgen wij niet te zien.",
        ],
      },
      {
        h: "3. Waarom we dit doen",
        p: [
          "Om de app te laten werken (uitvoering van de overeenkomst): je account, je planningen en lijstjes bewaren, samenwerken met anderen, en e-mails die bij de app horen, zoals een code om je wachtwoord te herstellen of een uitnodiging.",
          "Omdat we daar een gerechtvaardigd belang bij hebben: de app beveiligen tegen misbruik, fouten oplossen, de app verbeteren met je feedback, en de volgorde van aanbiedingen en recepten aanpassen aan wat jij vaak bekijkt.",
          "We nemen geen besluiten over jou die je merkbaar raken op basis van alleen automatische verwerking. De persoonlijke volgorde verandert alleen wat je eerst ziet.",
        ],
      },
      {
        h: "4. Persoonlijke aanbiedingen uitzetten",
        p: [
          "Wil je niet dat we bijhouden wat je bekijkt? Zet dan bij Account → Profiel & wachtwoord het vinkje bij \"Persoonlijke aanbiedingen en recepten\" uit. Wat we tot dan hadden bijgehouden, wordt direct gewist.",
        ],
      },
      {
        h: "5. Wie je gegevens kan zien",
        p: [
          "Mensen met wie je een planning deelt, zien je naam en wat je in die planning zet.",
          "Beheerders van de app kunnen je naam, e-mailadres en rol zien om accounts te beheren en hulp te geven. Feedback en aanvragen die je instuurt, zien ze ook.",
          "Voor het draaien van de app gebruiken we deze diensten, die je gegevens alleen voor ons verwerken:",
          "• Render (hosting van de app, servers in Frankfurt, Duitsland).",
          "• MongoDB Atlas (database waarin je gegevens staan).",
          "• Resend of Google Gmail (versturen van e-mails van de app).",
          "• Google (alleen als je kiest voor \"Doorgaan met Google\").",
          "Sommige van deze bedrijven zijn Amerikaans. Komen gegevens buiten de Europese Unie terecht, dan gebeurt dat met de waarborgen uit de AVG, zoals het EU-VS Data Privacy Framework of de standaardcontractbepalingen van de Europese Commissie.",
          "We verkopen je gegevens nooit en geven ze niet aan adverteerders of supermarkten.",
        ],
      },
      {
        h: "6. Hoe lang we gegevens bewaren",
        p: [
          "Zolang je account bestaat. Verwijder je je account, dan worden je gegevens direct en definitief gewist. Gedeelde planningen blijven bestaan voor de andere deelnemers, en standaardgerechten die je hebt aangemeld blijven zonder je naam staan.",
          "Dingen die je zelf verwijdert, staan nog 30 dagen in \"Recent verwijderd\" zodat je ze terug kunt zetten. Daarna zijn ze weg.",
          "Een inlogsessie verloopt na 7 dagen. Een code om je wachtwoord te herstellen verloopt na 1 uur.",
          "Gebruik je je account twee jaar niet, dan sturen we je een e-mail. Log je daarna binnen 30 dagen niet in, dan verwijderen we je account en je gegevens. Inloggen is genoeg om je account te houden.",
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
        h: "8. Jouw rechten",
        p: [
          "Je mag je gegevens inzien, laten verbeteren of laten verwijderen. Je mag bezwaar maken tegen het gebruik ervan, het gebruik laten beperken, en je gegevens in een handig bestand opvragen om mee te nemen.",
          "Veel kun je zelf in de app: je gegevens aanpassen bij Account → Profiel & wachtwoord, en daar ook je account verwijderen. Voor de rest mail je naar " +
            `${email}. We reageren binnen een maand.`,
          "Ben je niet tevreden over hoe we met je gegevens omgaan, laat het ons dan weten. Je mag ook een klacht indienen bij de Autoriteit Persoonsgegevens (autoriteitpersoonsgegevens.nl).",
        ],
      },
      {
        h: "9. Kinderen",
        p: [
          `De app is bedoeld voor mensen van ${minAge} jaar en ouder. Ben je jonger, dan heb je toestemming van je ouder of verzorger nodig. Denkt een ouder dat zijn of haar kind zonder toestemming een account heeft, mail ons dan, dan verwijderen we het.`,
        ],
      },
      {
        h: "10. Wijzigingen",
        p: ["Passen we deze verklaring wezenlijk aan, dan vragen we je bij de volgende keer inloggen opnieuw akkoord te geven."],
      },
    ],
  },

  cookies: {
    title: "Cookiebeleid",
    intro:
      "Slim Boodschappenlijstje gebruikt op dit moment geen tracking- of advertentiecookies. Daarom zie je bij ons ook geen cookiemelding. " +
      "Komen er later advertenties die cookies gebruiken, dan vragen we eerst je toestemming en passen we dit beleid aan.",
    sections: [
      {
        h: "1. Wat we wel opslaan op je apparaat",
        p: [
          "Om je ingelogd te houden, bewaren we een inlogcode op je apparaat. In de browser staat die in de lokale opslag (localStorage), in de app in de beveiligde opslag van je telefoon. Daarnaast onthouden we een paar keuzes, zoals welke weergave je het laatst gebruikte, wat je op je lijst hebt afgevinkt en je allergieën en dieet.",
          "Dit is nodig om de app te laten werken. Volgens de Telecommunicatiewet hoeven we daar geen toestemming voor te vragen. Als je uitlogt, wordt de inlogcode gewist.",
        ],
      },
      {
        h: "2. Wat we niet doen",
        p: [
          "We gebruiken geen Google Analytics of andere bezoekersstatistieken, geen advertentienetwerken, geen social-media-knoppen en geen andere cookies die je volgen.",
        ],
      },
      {
        h: "3. Afbeeldingen en lettertypen van andere websites",
        p: [
          "Sommige afbeeldingen (zoals productfoto's van supermarkten en receptfoto's) en het lettertype worden rechtstreeks van andere websites geladen. Daarbij ziet die website je IP-adres, net als bij elke website die je bezoekt. Wij zetten daarbij zelf geen cookies.",
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
};
