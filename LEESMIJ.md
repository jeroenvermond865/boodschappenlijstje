# Slim Boodschappenlijstje: zelf hosten

De app draait als één website. De server (FastAPI) levert zowel de API (`/api/...`) als de webversie van de Expo-app. Render bouwt alles met de `Dockerfile`.

## Wat is er veranderd ten opzichte van Emergent

- **Foto's en logo's** worden opgeslagen in MongoDB (GridFS) in plaats van in de opslag van Emergent.
- **E-mail** (wachtwoord-reset, uitnodigingen) gaat via Resend als `RESEND_API_KEY` is ingesteld. Zonder sleutel wordt e-mail overgeslagen. Een beheerder kan dan wel zelf wachtwoorden instellen bij Beheer → Gebruikers.
- **"Doorgaan met Google"** is verborgen, want dat liep via Emergent. Inloggen met e-mail en wachtwoord werkt gewoon.
- De installatiebeveiliging van Emergent (`scripts/cmd-guard`) en de ongebruikte Python-pakketten zijn verwijderd.

## Instellingen (Environment) op Render

| Naam | Waarde |
|---|---|
| `MONGO_URL` | verbindingslink van MongoDB Atlas (`mongodb+srv://...`) |
| `DB_NAME` | `boodschappenlijstje` |
| `FRONTEND_URL` | het adres van de site, bijv. `https://boodschappenlijstje.onrender.com` |
| `RESEND_API_KEY` | optioneel, voor e-mail |
| `EMAIL_FROM_ADDRESS` | optioneel, afzender bij Resend (eigen domein nodig) |
| `GMAIL_SENDER` | het Google-account dat de mails verstuurt: `beheer@slimboodschappenlijstje.nl`. Daarna eenmalig koppelen via `/api/email/gmail/connect` |
| `ADMIN_EMAIL` | krijgt back-ups, foutmeldingen en Premium-aanvragen (standaard `beheer@slimboodschappenlijstje.nl`) |
| `INFO_EMAIL` | antwoorden van gebruikers op een mail gaan hierheen (standaard `info@slimboodschappenlijstje.nl`) |
| `MOLLIE_API_KEY` | betalen voor Premium en Ultra via Mollie. Leeg: betalen staat uit en alles werkt zoals altijd. `test_...`: proberen zonder echt geld. `live_...`: echt. Mollie stuurt betalingen naar `FRONTEND_URL/api/billing/webhook` |

## Bestaande gegevens meenemen (optioneel)

Voer dit uit in de terminal van de oude Emergent-omgeving. Vervang `ATLAS_LINK` door je eigen Atlas-link:

```
cd /app/backend && export $(grep -v '^#' .env | xargs) && \
mongodump --uri "$MONGO_URL" --db "$DB_NAME" --archive | \
mongorestore --uri "ATLAS_LINK" --archive --nsFrom "$DB_NAME.*" --nsTo "boodschappenlijstje.*"
```

Dit neemt gebruikers, kampen, gerechten en producten mee. Foto's die al in Emergent stonden, gaan niet mee. Die moet je opnieuw uploaden.
