"""Snelle tests voor de belangrijkste dingen. Draaien met: cd backend && python -m pytest -q
Ze gebruiken een nep-database in het geheugen (mongomock), dus er gaat niets naar de echte database of winkels."""
import asyncio
import io
import json
import os
import sys
import zipfile

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:1")
os.environ.setdefault("DB_NAME", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server as S  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

_CACHE0 = dict(S._product_cache)
U1 = {"user_id": "u1", "role": "standaard"}
U2 = {"user_id": "u2", "role": "standaard"}


@pytest.fixture(autouse=True)
def nepdb():
    S.db = AsyncMongoMockClient()["test"]
    S._product_cache.clear()
    S._product_cache.update(_CACHE0)
    S._alert.update({"errors": [], "sent_at": 0.0})
    yield S.db


def run(coro):
    return asyncio.run(coro)


async def _camp(**extra):
    await S.db.camps.insert_one({"camp_id": "c1", "owner_id": "u1", "deleted_at": None, "days": [{"index": 0, "meals": {}}], **extra})
    await S.db.products.insert_many([{"product_id": p, "name": n, "deleted_at": None} for p, n in (("p1", "Vega gyros"), ("p2", "Gyros"))])


# --- Wisselen in een lijstje ---
def test_wisselen_zonder_eerdere_wissels():
    # Fout van 27-10: een lijstje zonder product_swaps gaf "niet gevonden"
    async def t():
        await _camp()
        await S.camp_product_swap("c1", S.ProductSwap(from_id="p1", to_id="p2"), U1)
        return (await S.db.camps.find_one({"camp_id": "c1"}))["product_swaps"]
    assert run(t()) == {"p1": "p2"}


def test_terug_wisselen():
    async def t():
        await _camp(product_swaps={"p1": "p2"})
        await S.camp_product_swap("c1", S.ProductSwap(from_id="p2", to_id="p1"), U1)
        return (await S.db.camps.find_one({"camp_id": "c1"}))["product_swaps"]
    assert run(t()) == {}


def test_lijstje_van_een_ander_niet_te_wijzigen():
    async def t():
        await _camp()
        await S.camp_product_swap("c1", S.ProductSwap(from_id="p1", to_id="p2"), U2)
    with pytest.raises(HTTPException) as e:
        run(t())
    assert e.value.status_code == 404 and "Lijstje" in e.value.detail


def test_lid_mag_wel_wisselen():
    async def t():
        await _camp(member_ids=["u2"])
        await S.camp_product_swap("c1", S.ProductSwap(from_id="p1", to_id="p2"), U2)
        return (await S.db.camps.find_one({"camp_id": "c1"}))["product_swaps"]
    assert run(t()) == {"p1": "p2"}


# --- Lijstjes bewaren (archiveren) ---
def test_lijstje_bewaren_en_terugzetten():
    async def t():
        await _camp(name="Week", created_at=S.now_utc(), member_ids=["u2"])
        await S.archive_camp("c1", True, U1)
        eigen = await S.list_camps(False, U1)
        bewaard = await S.list_camps(True, U1)
        ander = await S.list_camps(False, U2)  # per persoon: het lid ziet hem nog gewoon
        await S.archive_camp("c1", False, U1)
        terug = await S.list_camps(False, U1)
        return eigen, bewaard, ander, terug
    eigen, bewaard, ander, terug = run(t())
    assert eigen["camps"] == [] and eigen["archived_count"] == 1
    assert [c["id"] for c in bewaard["camps"]] == ["c1"] and bewaard["camps"][0]["archived"]
    assert [c["id"] for c in ander["camps"]] == ["c1"]
    assert [c["id"] for c in terug["camps"]] == ["c1"] and terug["archived_count"] == 0


def test_lijstje_van_een_ander_niet_te_bewaren():
    async def t():
        await _camp()
        await S.archive_camp("c1", True, U2)
    with pytest.raises(HTTPException) as e:
        run(t())
    assert e.value.status_code == 404


# --- Tips bij gerechten ---
def test_tip_product_toevoegen_en_weghalen():
    async def t():
        await _camp()
        S._product_cache["by_pid"] = {"p2": {"product_id": "p2", "name": "Feta", "aisle": "Zuivel & kaas", "_src": "Dirk"}}
        await S.camp_tip_extra("c1", S.TipExtra(product_id="p2", day_index=0, meal="avondeten"), U1)
        na_toevoegen = (await S.db.camps.find_one({"camp_id": "c1"}))["days"][0]["extras"]
        await S.camp_tip_extra("c1", S.TipExtra(product_id="p2", day_index=0, meal="avondeten", on=False), U1)
        na_weghalen = (await S.db.camps.find_one({"camp_id": "c1"}))["days"][0]["extras"]
        return na_toevoegen, na_weghalen
    erbij, weg = run(t())
    assert [x["product_id"] for x in erbij] == ["p2"] and erbij[0]["meal"] == "avondeten"
    assert weg == []


@pytest.mark.parametrize("zin,verwacht", [
    ("Lekker met wat extra feta en verse munt.", ["feta", "munt"]),
    ("Serveer met naanbrood of rijst.", ["naanbrood", "rijst"]),
    ("Voeg eventueel nog een handje cashewnoten toe.", ["cashewnoten"]),
    ("Voeg de ui toe en bak 5 minuten.", []),
])
def test_tips_herkennen(zin, verwacht):
    gevonden = [n for r in S._TIP_ADD_RES for m in r.finditer(zin) for n in S._tip_names(m.group("x"))]
    assert gevonden == verwacht


def test_tip_ook_gebruiken():
    m = S._TIP_ALT_RE.search("Je kunt ook spinazie gebruiken in plaats van andijvie.")
    assert m and S._tip_names(m.group("x")) == ["spinazie"]


def test_vega_vlees_wordt_niet_geleerd():
    assert S._diet_differs({"name": "Go Vega Shoarma"}, {"name": "Vleesmeesters Shoarma"})
    assert not S._diet_differs({"name": "Halfvolle melk 1L"}, {"name": "Halfvolle melk 1,5L"})


# --- Back-up ---
def test_backup_bevat_eigen_gegevens_zonder_geheimen():
    async def t():
        await S.db.users.insert_one({"user_id": "u1", "email": "a@b.nl"})
        await S.db.user_sessions.insert_one({"session_token": "geheim"})
        await S.db.products.insert_many([{"product_id": "g", "is_global": True}, {"product_id": "eigen", "is_global": False}])
        await S.db.price_history.insert_one({"product_id": "g", "points": []})
        return await S._backup_zip(history=False)
    data, counts = run(t())
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    assert "users.jsonl" in names and "info.json" in names
    assert "user_sessions.jsonl" not in names and "price_history.jsonl" not in names
    assert counts["products"] == 1 and "eigen" in z.read("products.jsonl").decode()
    assert json.loads(z.read("info.json"))["aantallen"]["users"] == 1


def test_backup_terugzetten_leest_zip(tmp_path):
    import backup_restore

    async def t():
        await S.db.camps.insert_one({"camp_id": "c1", "name": "Weekend"})
        return await S._backup_zip()
    data, _ = run(t())
    f = tmp_path / "b.zip"
    f.write_bytes(data)
    assert backup_restore.restore(str(f), really=False)["camps"] == 1


def test_backup_mislukt_eerst_opnieuw_dan_een_melding(monkeypatch):
    mails = []

    async def nep_mail(to, subject, html, allow_unsubscribe=True, attachments=None, raise_errors=False):
        mails.append(subject)
        if attachments:
            raise RuntimeError("Gmail weigerde de mail (413)")
        return "id"
    monkeypatch.setattr(S, "send_email", nep_mail)

    async def t():
        st1 = await S._backup_mail()
        doc = await S.db.meta.find_one({"key": "backup"})
        assert doc["fails"] == 1 and "413" in st1["error"] and not S._backup_due(doc)
        doc["at"] -= S.BACKUP_RETRY + S.timedelta(minutes=1)
        assert S._backup_due(doc)  # een uur later: nog een poging
        await S._backup_mail()
        doc = await S.db.meta.find_one({"key": "backup"})
        doc["at"] -= S.BACKUP_RETRY + S.timedelta(minutes=1)
        assert doc["fails"] == 2 and not S._backup_due(doc)  # daarna pas de volgende nacht
    run(t())
    assert [m for m in mails if m.startswith("Let op")] == ["Let op: back-up niet gelukt"]
    assert sum(m.startswith("Back-up") for m in mails) == 2


def test_backup_gelukt_zet_teller_terug(monkeypatch):
    async def nep_mail(*a, **k):
        return "id"
    monkeypatch.setattr(S, "send_email", nep_mail)

    async def t():
        await S.db.meta.insert_one({"key": "backup", "fails": 1, "at": S.now_utc()})
        st = await S._backup_mail()
        return st, await S.db.meta.find_one({"key": "backup"})
    st, doc = run(t())
    assert st["ok"] and doc["fails"] == 0 and doc["ok_at"]


def test_mail_naar_info_krijgt_bcc_naar_beheer(monkeypatch):
    verstuurd = []

    async def nep_sender():
        return {"email": "afzender@gmail.com", "refresh_token": "x"}

    async def nep_gmail(sender, to, subject, html, attachments=None, bcc=None):
        verstuurd.append((to, bcc))
        return "id"
    monkeypatch.setattr(S, "gmail_sender", nep_sender)
    monkeypatch.setattr(S, "_send_gmail", nep_gmail)
    monkeypatch.setattr(S, "INFO_EMAIL", "info@slimboodschappenlijstje.nl")
    monkeypatch.setattr(S, "ADMIN_EMAIL", "beheer@slimboodschappenlijstje.nl")
    run(S.send_email("Info@slimboodschappenlijstje.nl", "Herroeping", "<p>x</p>", allow_unsubscribe=False))
    run(S.send_email("klant@example.com", "Hallo", "<p>x</p>", allow_unsubscribe=False))
    assert verstuurd == [("Info@slimboodschappenlijstje.nl", "beheer@slimboodschappenlijstje.nl"), ("klant@example.com", None)]


# --- Snel lijstje ---
def test_snel_lijstje_gerecht_en_bewaren():
    async def t():
        await S.db.dishes.insert_one({"dish_id": "d1", "owner_id": "u1", "name": "Pasta", "is_standard": False})
        with pytest.raises(HTTPException):
            await S.today_save(S.TodaySave(), U1)  # leeg: niets te bewaren
        r = await S.today_dish(S.TodayDish(dish_id="d1"), U1)
        c = await S.db.camps.find_one({"camp_id": r["id"]})
        assert r["on"] and c["days"][0]["meals"]["avondeten"] == ["d1"]
        off = await S.today_dish(S.TodayDish(dish_id="d1"), U1)  # nog een keer: eraf
        assert not off["on"]
        await S.today_add(S.TodayAdd(name="Melk"), U1)
        await S.today_add(S.TodayAdd(name="melk"), U1)  # niet dubbel
        c = await S.db.camps.find_one({"camp_id": r["id"]})
        assert len(c["general"]) == 1
        saved = await S.today_save(S.TodaySave(name="Zaterdag"), U1)
        c = await S.db.camps.find_one({"camp_id": saved["id"]})
        assert c["daily"] is False and c["name"] == "Zaterdag"
        nxt = await S._today_camp(U1)
        return nxt["camp_id"] != saved["id"]
    assert run(t())


def test_bijna_op_niet_meer_tonen(monkeypatch):
    async def mag(user, key):
        return None
    monkeypatch.setattr(S, "require_feature", mag)
    monkeypatch.setattr(S, "has_feature", lambda user, key: True)

    async def t():
        await S.db.pantry.insert_one({"item_id": "p1", "user_id": "u1", "name": "Melk", "qty": 0, "unit": "stuks", "restock_off": True})
        r = await S.pantry_restock("", U1)
        return r["items"]
    assert run(t()) == []
    now = S.now_utc()
    assert S._restock_hidden({"restock_off": True, "restock_off_at": now, "updated_at": now - S.timedelta(days=1)})
    assert not S._restock_hidden({"restock_off": True, "restock_off_at": now, "updated_at": now + S.timedelta(minutes=5)})


# --- AI-foto bij een gerecht ---
def test_ai_foto_wordt_gemaakt_verkleind_en_hergebruikt(monkeypatch, tmp_path):
    import base64 as b64
    from PIL import Image as PILImage
    buf = io.BytesIO()
    PILImage.new("RGB", (1024, 1024), (180, 90, 40)).save(buf, "WEBP")
    calls = []

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"data": [{"b64_json": b64.b64encode(buf.getvalue()).decode()}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **k):
            calls.append(k["json"]["prompt"])
            return Resp()
    monkeypatch.setattr(S.httpx, "AsyncClient", Client)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setattr(S, "MEDIA_DIR", str(tmp_path))
    url = run(S._ai_dish_image("Spaghetti bolognese"))
    assert url.startswith("/api/files/") and len(calls) == 1 and "Spaghetti bolognese" in calls[0]
    data, kind = run(S._get_object(url[len("/api/files/"):]))
    assert kind == "image/webp" and PILImage.open(io.BytesIO(data)).size[0] <= 640
    assert run(S._ai_dish_image("spaghetti Bolognese")) == url and len(calls) == 1  # zelfde naam: niet opnieuw betalen


def test_geen_ai_foto_zonder_sleutel(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert run(S._ai_dish_image("Pannenkoeken")) is None


# --- Aanbiedingen zoeken ---
def test_actie_vinden_op_soortnaam():
    w = S._offer_words({"title": "Alle pasta", "label": "2 voor 2,00"}, [])
    assert "penne" in w and "fusilli" in w
    w2 = S._offer_words({"title": "Dirk Penne rigate 500 g", "label": "1+1"}, [])
    assert "pasta" in w2
    w3 = S._offer_words({"title": "Slagroom spuitbus", "label": ""}, [])
    assert "groente" not in w3  # "sla" hoort niet bij slagroom
    w4 = S._offer_words({"title": "Uien 1 kg", "label": ""}, [])
    assert "groente" in w4


def test_acties_zoeken_als_cluster(monkeypatch):
    async def index(store, user):
        return [{"id": f"{store}-1", "store": store, "title": "Alle pasta", "label": "2 voor 2,00", "count": 14, "image": None, "period": None,
                 "_words": S._norm_text(S._offer_words({"title": "Alle pasta"}, []))}] if store == "Dirk" else []
    monkeypatch.setattr(S, "_offer_index", index)
    r = run(S.offers_search("penne", "", U1))
    assert [o["id"] for o in r["offers"]] == ["Dirk-1"] and r["offers"][0]["count"] == 14 and "_words" not in r["offers"][0]
    assert run(S.offers_search("p", "", U1)) == {"offers": []}


# --- Slimme hulp: grens per maand ---
def test_slimme_hulp_telt_per_maand(monkeypatch):
    async def mag(user, key):
        return None
    monkeypatch.setattr(S, "require_feature", mag)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    S._plans_conf.clear()
    u = {"user_id": "u1", "premium": True, "plan": "premium"}

    async def t():
        month = S.now_utc().date().isoformat()[:8]
        # Eerder deze maand al 99 vragen, verspreid over dagen; vorige maand telt niet mee
        await S.db.ai_usage.insert_many([{"user_id": "u1", "day": month + "01", "n": 60}, {"user_id": "u1", "day": "2000-01-15", "n": 500}])
        if S.now_utc().day != 1:
            await S.db.ai_usage.insert_one({"user_id": "u1", "day": month + "02", "n": 39})
        else:
            await S.db.ai_usage.update_one({"day": month + "01"}, {"$inc": {"n": 39}})
        await S._ai_ready(u)  # de 100e mag nog
        with pytest.raises(HTTPException) as e:
            await S._ai_ready(u)
        return e.value
    err = run(t())
    assert err.status_code == 429 and "deze maand" in err.detail


# --- Bronnen van supermarkten ---
def test_recept_van_winkel_zonder_tekst_en_foto():
    S._sources.update(S.SOURCE_DEFAULTS)
    r = S._safe_recipe({"id": "ah-1", "title": "Pasta pesto", "image": "https://static.ah.nl/x.jpg", "description": "Lekker",
                        "steps": ["Kook de pasta"], "tip": "Met kaas", "alt_text": "Liever vlees?", "ingredients": [{"text": "200 g pasta"}],
                        "url": "https://www.ah.nl/allerhande/recept/R-R1"})
    assert r["title"] == "Pasta pesto" and r["ingredients"] and r["url"].startswith("https://www.ah.nl")
    assert r["description"] is None and r["steps"] == [] and r["tip"] is None and r["alt_text"] == ""
    assert r["image"]  # foto's (gelinkt) staan voorlopig aan
    S._sources["recipe_images"] = False
    try:
        assert S._safe_recipe({"image": "https://static.ah.nl/x.jpg"})["image"] is None
    finally:
        S._sources.update(S.SOURCE_DEFAULTS)


def test_bestanden_op_de_schijf_als_media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(S, "MEDIA_DIR", str(tmp_path))
    run(S._put_object("scoutkook/ai-fotos/a.webp", b"abc", "image/webp"))
    assert (tmp_path / "scoutkook/ai-fotos/a.webp").read_bytes() == b"abc"
    assert run(S._get_object("scoutkook/ai-fotos/a.webp")) == (b"abc", "image/webp")
    assert S._media_file("../geheim") is None  # nooit buiten de map


def test_bronnen_weer_aanzetten_na_toestemming(monkeypatch):
    S._sources.update(S.SOURCE_DEFAULTS)

    async def mag_alles(user, perm):
        return [perm]
    monkeypatch.setattr(S, "require_perm", mag_alles)

    async def t():
        return await S.admin_sources_update(S.SourcesUpdate(recipe_content=True), {"user_id": "a"})
    try:
        assert run(t())["recipe_content"] is True
        assert S._safe_recipe({"steps": ["Kook"], "image": "https://static.ah.nl/x.jpg"})["steps"] == ["Kook"]
    finally:
        S._sources.update(S.SOURCE_DEFAULTS)


def test_geen_winkelfotos_via_eigen_server():
    S._sources.update(S.SOURCE_DEFAULTS)
    with pytest.raises(HTTPException) as e:
        run(S.image_proxy("https://static.ah.nl/dam/product/x.jpg"))
    assert e.value.status_code == 404


def test_eerlijke_naam_bij_winkels():
    for h in (S.AH_HEADERS, S.JUMBO_HEADERS, S.DIRK_HEADERS, S._PAGE_HEADERS):
        assert h["User-Agent"] == S.APP_AGENT and "slimboodschappenlijstje.nl" in h["User-Agent"]


# --- Foutmelding ---
def test_foutmelding_pas_na_veel_fouten_en_niet_te_vaak():
    uitkomst = [S._note_error("GET /api/x: 500") for _ in range(S.ALERT_MIN * 2)]
    assert uitkomst.count(True) == 1 and uitkomst.index(True) == S.ALERT_MIN - 1


# --- Geschiedenis wissen ---
def test_geschiedenis_periode_wissen_laat_ouder_staan():
    async def t():
        await S._interest_inc("u1", "producten", {"aisles.Zuivel": 3, "brands.ah": 1})
        # Iets van lang geleden (vóór deze week)
        await S.db.user_interest.update_one({"user_id": "u1"}, {"$inc": {"aisles.Zuivel": 2}})
        await S.db.interest_log.insert_one({"user_id": "u1", "day": "2020-01-01", "kind": "producten", "inc": {"aisles": {"Zuivel": 2}}})
        await S._interest_inc("u1", "recepten", {"rwords.pasta": 2})
        weg = await S._history_delete(U1, ["producten"], "week")
        return weg, await S.db.user_interest.find_one({"user_id": "u1"}, {"_id": 0}), await S.db.interest_log.count_documents({})
    weg, doc, logs = run(t())
    assert weg == {"producten": 1}
    assert doc["aisles"] == {"Zuivel": 2}  # alleen wat van deze week was is eraf
    assert "brands" not in doc or not doc["brands"]  # op 0 uitgekomen: weg
    assert doc["rwords"] == {"pasta": 2}  # recepten niet gekozen: blijft
    assert logs == 2


def test_geschiedenis_alles_wissen_houdt_geleerde_keuzes():
    async def t():
        await S._interest_inc("u1", "recepten", {"rwords.pasta": 2, "rtags.vega": 1})
        await S.db.learned_picks.insert_one({"key": "Dirk|pasta", "pid": "p1", "users": ["u1"], "score": 1})
        await S.db.pantry.insert_many([{"user_id": "u1", "name": "zout", "learned": True, "updated_at": S.now_utc()},
                                       {"user_id": "u1", "name": "rijst", "updated_at": S.now_utc()}])
        await S._history_delete(U1, ["recepten", "voorraad"], "alles")
        return (await S.db.user_interest.find_one({"user_id": "u1"}, {"_id": 0}), await S.db.learned_picks.count_documents({}),
                [p["name"] async for p in S.db.pantry.find({})])
    doc, picks, pantry = run(t())
    assert "rwords" not in doc and "rtags" not in doc
    assert picks == 1  # wat de app van iedereen leerde blijft
    assert pantry == ["rijst"]  # zelf ingevulde voorraad blijft


def test_geschiedenis_verkeerde_keuze():
    with pytest.raises(HTTPException):
        run(S._history_delete(U1, ["iets"], "alles"))


@pytest.mark.parametrize("naam,cat,verwacht", [
    ("Stamppot boerenkool", "avondeten", ["hoofdgerecht", "groep"]),
    ("Tomatensoep", "avondeten", ["soep", "groep"]),
    ("Broodje kaas", "lunch", ["lunch", "groep"]),
    ("Vanillevla", "avondeten", ["dessert"]),
    ("Yoghurt met muesli", "ontbijt", ["ontbijt"]),
])
def test_hoofdcategorieen_vanzelf(naam, cat, verwacht):
    assert S._dish_groups({"name": naam, "category": cat}) == verwacht


def test_hoofdcategorieen_zelf_gekozen():
    d = {"name": "Stamppot", "category": "avondeten", "groups": ["groep", "onzin", "soep"]}
    assert S._dish_groups(d) == ["soep", "groep"]
    assert S._clean_groups(["onzin", "dessert"]) == ["dessert"]


def test_grote_groepen_filter_eruit():
    rest, groep = S._take_group_filter(json.dumps({"groep": ["Voor grote groepen"], "gang": ["soep"]}))
    assert groep and json.loads(rest) == {"gang": ["soep"]}
    assert S._take_group_filter('{"gang": ["soep"]}') == ('{"gang": ["soep"]}', False)


def test_zoeksuggesties_zonder_ai_en_leren():
    async def go():
        from datetime import datetime, timezone
        names = ["AH Tomatensoep", "Unox tomatensoep", "Tomatenpuree", "Cherrytomaten", "Kippensoep blik", "Kippensoep Unox", "Groentesoep"]
        S._product_cache.update(docs=[{"product_id": f"p{i}", "name": n} for i, n in enumerate(names)], at=datetime.now(timezone.utc), stale=False)
        S._suggest_dishes.update(at=S.time.time(), count={"tomatensoep": 3, "kippensoep": 2})
        await S.db.dishes.insert_one({"dish_id": "d1", "owner_id": "u1", "deleted_at": None, "name": "Oma's mosterdsoep"})
        r = (await S.search_suggest(q="tomaten", user=U1))["suggestions"]
        assert r[:2] == ["tomatensoep", "tomatenpuree"] and "cherrytomaten" in r
        r = (await S.search_suggest(q="soep", kind="dishes", user=U1))["suggestions"]
        assert "kippensoep" in r and "tomatensoep" in r and r[0] == "mosterdsoep"
        # Wat iemand kiest komt de volgende keer bovenaan
        await S.search_learn(S.SuggestLearnInput(q="soep", pick="groentesoep"), user=U2)
        assert (await S.search_suggest(q="soep", user=U2))["suggestions"][0] == "groentesoep"
        assert (await S.search_suggest(q="to", user=U1))["suggestions"] == []
        # Half getypte woorden worden niet onthouden, hele wel
        await S.search_learn(S.SuggestLearnInput(q="toma"), user=U1)
        await S.search_learn(S.SuggestLearnInput(q="tomatensoep"), user=U1)
        assert [d["term"] async for d in S.db.search_typed.find({})] == ["groentesoep", "tomatensoep"]
    run(go())


# --- Accountaanvragen (beheerder keurt nieuwe accounts goed) ---
def _req():
    from starlette.requests import Request
    return Request({"type": "http", "headers": [], "client": ("1.2.3.4", 1)})


async def _geen_mail(*a, **k):
    return None


def _reg(email):
    return S.RegisterInput(email=email, password="geheim!1234", name="Test", accept_terms=True)


async def _bevestig(email):
    # De code uit de mail (in de test: uit de database) invullen
    rec = await S.db.email_codes.find_one({"email": email, "purpose": "register"})
    return await S.verify_email(S.VerifyEmailInput(email=email, code=rec["code"]), _req())


def test_aanvragen_uit_werkt_zoals_altijd(monkeypatch):
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._attempts.clear()
    res = run(S.register(_reg("nieuw@voorbeeld.nl"), _req()))
    assert res.get("verify") and not res.get("session_token")  # eerst de code uit de mail
    ok = run(_bevestig("nieuw@voorbeeld.nl"))
    assert ok.get("session_token") and not ok.get("pending")


def test_aanvraag_wacht_op_goedkeuring(monkeypatch):
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._attempts.clear()

    async def t():
        await S.db.settings.insert_one({"key": "app", "signup_approval": True})
        res = await S.register(_reg("nieuw@voorbeeld.nl"), _req())
        assert res["verify"] and "session_token" not in res
        res = await _bevestig("nieuw@voorbeeld.nl")
        assert res["pending"] and "session_token" not in res
        with pytest.raises(HTTPException) as e:
            await S.login(S.LoginInput(identifier="nieuw@voorbeeld.nl", password="geheim!1234"), _req())
        assert e.value.status_code == 403
        admin = {"user_id": "a1", "role": "beheerder"}
        await S.db.roles.insert_one({"name": "beheerder", "permissions": ["manage_users"]})
        lijst = await S.list_signup_requests(admin)
        assert lijst["enabled"] and len(lijst["requests"]) == 1
        assert (await S.admin_list_users(admin))["users"] == []
        await S.review_signup_request(lijst["requests"][0]["id"], "approve", admin)
        return await S.login(S.LoginInput(identifier="nieuw@voorbeeld.nl", password="geheim!1234"), _req())
    assert run(t()).get("session_token")


def test_aanvraag_afwijzen_wist_account(monkeypatch):
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._attempts.clear()

    async def t():
        await S.db.settings.insert_one({"key": "app", "signup_approval": True})
        await S.db.roles.insert_one({"name": "beheerder", "permissions": ["manage_users"]})
        await S.register(_reg("weg@voorbeeld.nl"), _req())
        u = await S.db.users.find_one({"email": "weg@voorbeeld.nl"})
        await S.review_signup_request(u["user_id"], "reject", {"user_id": "a1", "role": "beheerder"})
        return await S.db.users.count_documents({})
    assert run(t()) == 0


def test_herroepen_bewaart_en_bevestigt(monkeypatch):
    # Herroepknop: opgeslagen (2 jaar), en een bevestiging naar de gebruiker plus een melding aan ons
    sent = []

    async def fake_mail(to, subject, html, **kw):
        sent.append((to, subject))
        return "id"

    monkeypatch.setattr(S, "send_email", fake_mail)
    req = type("R", (), {"headers": {}, "client": type("C", (), {"host": "1.2.3.4"})()})()
    run(S.legal_withdraw_code(S.WithdrawCodeInput(email="Test@Voorbeeld.nl"), req))  # eerst een code naar dat adres
    code = run(S.db.email_codes.find_one({"email": "test@voorbeeld.nl", "purpose": "withdraw"}))["code"]
    sent.clear()
    r = run(S.legal_withdraw(S.WithdrawInput(name="Test Persoon", email="Test@Voorbeeld.nl", code=code), req, None))
    assert r["ok"]
    doc = run(S.db.withdrawals.find_one({"withdrawal_id": r["id"]}))
    assert doc["email"] == "test@voorbeeld.nl" and doc["expires_at"] > doc["created_at"]
    assert [t for t, _ in sent] == ["test@voorbeeld.nl", S.INFO_EMAIL]
    with pytest.raises(HTTPException):
        run(S.legal_withdraw(S.WithdrawInput(name="X", email="geen-mail"), req, None))


# --- Abonnementen: Standaard, Premium en Ultra ---
def test_functie_per_abonnement():
    S._plans_conf.clear()
    std, prem, ultra = {"premium": False}, {"premium": True}, {"premium": True, "plan": "ultra"}
    assert S.user_plan(std) == "standaard" and S.user_plan(prem) == "premium" and S.user_plan(ultra) == "ultra"
    assert not S.has_feature(std, "voorraadkast") and S.has_feature(prem, "voorraadkast")
    # Beheer zet de slimme hulp op Ultra: Premium heeft hem dan niet meer, Ultra wel
    S._plans_conf.update({"features": {"slimme_hulp": "ultra"}})
    try:
        assert not S.has_feature(prem, "slimme_hulp") and S.has_feature(ultra, "slimme_hulp")
        with pytest.raises(HTTPException) as e:
            run(S.require_feature(prem, "slimme_hulp"))
        assert "Ultra" in e.value.detail
        assert "slimme_hulp" in S.public_user({"user_id": "x", **ultra})["features"]
    finally:
        S._plans_conf.clear()


# --- AI: antwoord onthouden, tweede keer gratis ---
def test_ai_antwoord_uit_geheugen(monkeypatch):
    calls = []

    class Msg:
        stop_reason = "end_turn"
        content = [type("B", (), {"type": "text", "text": '{"ok": 1}'})()]
        usage = type("U", (), {"input_tokens": 1000, "output_tokens": 100})()

    class Fake:
        def __init__(self):
            self.beta = self
            self.messages = self

        async def create(self, **kw):
            calls.append(kw)
            return Msg()

    import anthropic
    monkeypatch.setattr(anthropic, "AsyncAnthropic", Fake)

    async def t():
        a = await S._claude("lijst", "u1", max_tokens=10, messages=[{"role": "user", "content": "melk"}])
        b = await S._claude("lijst", "u1", max_tokens=10, messages=[{"role": "user", "content": "melk"}])
        u = await S.db.ai_usage.find_one({"user_id": "u1"})
        return a.content[0].text, b.content[0].text, u
    a, b, u = run(t())
    assert a == b == '{"ok": 1}'
    assert len(calls) == 1  # de tweede keer uit het geheugen
    assert calls[0]["model"] == "claude-haiku-5-5" and "fallbacks" not in calls[0]
    assert u["calls"] == 1 and u["hits"] == 1 and u["cost"] > 0


# --- Vandaag: één lijstje dat elke dag opnieuw begint ---
def test_vandaag_lijstje_en_vaak_gekocht():
    user = {"user_id": "u1", "name": "Jeroen", "store": "Dirk"}

    async def t():
        r = await S.today_open(S.TodayInput(people=1), user)
        await S.today_add(S.TodayAdd(name="Melk"), {**user, "daily_people": 1})
        await S.today_add(S.TodayAdd(name="Brood"), {**user, "daily_people": 1})
        c = await S.db.camps.find_one({"camp_id": r["id"]})
        # Gisteren: melk afgevinkt (gekocht), brood niet
        await S.db.camps.update_one({"camp_id": r["id"]}, {"$set": {"start_date": "2000-01-01", "checked": {"a": {"k": "Dirk|melk|stuks"}}}})
        for _ in range(2):
            await S._track_bought(user, {"Dirk|melk|stuks": {"name": "Melk", "unit": "stuks", "aisle": "Zuivel"}})
        info = await S.today_info({**user, "daily_people": 1})
        c2 = await S.db.camps.find_one({"camp_id": r["id"]})
        return c, info, c2
    c, info, c2 = run(t())
    assert c["daily"] and c["shop_store"] == "Dirk" and c["days"][0]["adults"] == 1
    assert [e["name"] for e in c2["general"]] == ["Brood"]  # gekochte melk is eraf, brood blijft staan
    assert info["often"][0]["name"] == "Melk" and info["people"] == 1


def test_dashboard_zonder_namen(monkeypatch):
    admin = {"user_id": "a1", "role": "beheerder"}

    async def perms(u):
        return ["manage_users"]
    monkeypatch.setattr(S, "user_permissions", perms)

    async def t():
        await S.db.users.insert_many([{"user_id": "u1", "deleted_at": None, "premium": True}, {"user_id": "u2", "deleted_at": None}])
        await S._mark_active({"user_id": "u1", "premium": True})
        await S._ai_log("hulp", "u1", 0.02)
        await S._ai_log("hulp", "u2", 0.01)
        return await S.admin_dashboard(7, "", "", admin)
    d = run(t())
    assert d["users"]["active"]["today"] == 1 and d["users"]["by_plan"]["premium"] == 1
    pp = d["ai"]["per_person"]
    assert pp["people"] == 2 and pp["cost"]["max"] == 0.02 and pp["cost"]["min"] == 0.01
    assert "u1" not in json.dumps(d)


# --- Betalen met Mollie (nep-Mollie, er gaat niets naar buiten) ---
class _NepMollie:
    def __init__(self):
        self.calls, self.payments, self.subs = [], {}, 0

    async def __call__(self, method, path, body=None):
        self.calls.append((method, path))
        if method == "POST" and path == "/customers":
            return {"id": "cst_1"}
        if method == "POST" and path.endswith("/payments"):
            self.payments["tr_1"] = {"id": "tr_1", "status": "open", "sequenceType": "first", "customerId": "cst_1", "metadata": body["metadata"], "amount": body["amount"]}
            return {**self.payments["tr_1"], "_links": {"checkout": {"href": "https://mollie.test/pay"}}}
        if method == "GET" and path.startswith("/payments/"):
            return self.payments[path.split("/")[-1]]
        if method == "POST" and path.endswith("/subscriptions"):
            self.subs += 1
            return {"id": f"sub_{self.subs}"}
        return {}


def _webhook(pid):
    from starlette.requests import Request
    body = f"id={pid}".encode()

    async def receive():
        return {"type": "http.request", "body": body}
    return Request({"type": "http", "method": "POST", "headers": [], "client": ("1.2.3.4", 1)}, receive)


def test_zonder_mollie_sleutel_blijft_alles_zoals_het_was(monkeypatch):
    monkeypatch.delenv("MOLLIE_API_KEY", raising=False)
    assert S._billing_public({"user_id": "u1"})["enabled"] is False
    with pytest.raises(HTTPException) as e:
        run(S.billing_start(S.BillingStart(plan="premium"), {"user_id": "u1", "name": "J", "email": "a@b.nl"}))
    assert e.value.status_code == 503


def test_mollie_afsluiten_verlengen_en_opzeggen(monkeypatch):
    monkeypatch.setenv("MOLLIE_API_KEY", "test_abc")
    nep = _NepMollie()
    monkeypatch.setattr(S, "_mollie", nep)
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._plans_conf.clear()

    async def t():
        await S.db.users.insert_one({"user_id": "u1", "name": "J", "email": "a@b.nl", "deleted_at": None})
        u = await S.db.users.find_one({"user_id": "u1"})
        r = await S.billing_start(S.BillingStart(plan="ultra"), u)
        assert r["checkout_url"] == "https://mollie.test/pay"
        # Nog niet betaald: niets veranderd
        await S.billing_webhook(_webhook("tr_1"))
        assert not (await S.db.users.find_one({"user_id": "u1"})).get("premium")
        # Betaald: Ultra aan, maandabonnement gestart
        nep.payments["tr_1"]["status"] = "paid"
        await S.billing_webhook(_webhook("tr_1"))
        await S.billing_webhook(_webhook("tr_1"))  # dubbele melding doet niets extra
        u = await S.db.users.find_one({"user_id": "u1"})
        assert u["premium"] and S.user_plan(u) == "ultra" and u["billing"]["subscription_id"] == "sub_1" and nep.subs == 1
        assert S.public_user(u)["subscription"] == "active"
        # Volgende maand automatisch betaald: langer Premium
        nep.payments["tr_2"] = {"id": "tr_2", "status": "paid", "sequenceType": "recurring", "customerId": "cst_1", "subscriptionId": "sub_1", "metadata": {"user_id": "u1", "plan": "ultra"}, "amount": {"value": "4.99"}}
        before = S.ensure_aware(u["premium_until"])
        await S.db.users.update_one({"user_id": "u1"}, {"$set": {"premium_until": S.now_utc()}})
        await S.billing_webhook(_webhook("tr_2"))
        u = await S.db.users.find_one({"user_id": "u1"})
        assert S.ensure_aware(u["premium_until"]) >= before - S.timedelta(minutes=1)
        # Opzeggen: blijft tot het eind van de betaalde maand
        r = await S.billing_cancel(u)
        assert r["cancelled"] and ("DELETE", "/customers/cst_1/subscriptions/sub_1") in nep.calls
        u = await S.db.users.find_one({"user_id": "u1"})
        assert u["premium"]
        # Maand voorbij en niet meer betaald: vanzelf terug naar Standaard
        await S.db.users.update_one({"user_id": "u1"}, {"$set": {"premium_until": S.now_utc() - S.timedelta(days=1)}})
        u = await S._premium_expired(await S.db.users.find_one({"user_id": "u1"}))
        assert S.user_plan(u) == "standaard"
    run(t())


def test_nep_melding_zonder_echte_betaling_doet_niets(monkeypatch):
    monkeypatch.setenv("MOLLIE_API_KEY", "test_abc")
    nep = _NepMollie()
    monkeypatch.setattr(S, "_mollie", nep)
    run(S.billing_webhook(_webhook("geen-id")))
    assert nep.calls == []


# --- Betalen: proef, huishouden, jaar, gratis vragen ---
def test_proef_van_14_dagen_en_daarna_standaard():
    f = S._trial_fields()
    assert f["premium"] and f["trial"] and 13 <= (f["premium_until"] - S.now_utc()).days <= 14

    async def t():
        u = {"user_id": "u9", "premium": True, "trial": True, "premium_until": S.now_utc() - S.timedelta(minutes=1)}
        await S.db.users.insert_one(dict(u))
        after = await S._premium_expired(u)
        doc = await S.db.users.find_one({"user_id": "u9"})
        return after, doc
    after, doc = run(t())
    assert not after["premium"] and not doc["premium"] and doc["trial"] is False and doc.get("trial_ended_at")
    assert S.public_user({**doc, "email": "a@b.nl"})["trial_ended"] is True


def test_ultra_geldt_voor_het_hele_huishouden():
    S._household_cache.clear()

    async def t():
        await S.db.users.insert_many([{"user_id": "ultra", "name": "Sanne", "premium": True, "plan": "ultra", "deleted_at": None},
                                      {"user_id": "gast", "name": "Gast", "deleted_at": None},
                                      {"user_id": "los", "name": "Los", "deleted_at": None}])
        await S.db.camps.insert_one({"camp_id": "c1", "owner_id": "ultra", "member_ids": ["gast"], "deleted_at": None})
        return await S._household_premium({"user_id": "gast"}), await S._household_premium({"user_id": "los"})
    via, none = run(t())
    assert via == "Sanne" and none is None
    assert S.user_plan({"premium": True, "premium_household": "Sanne"}) == "premium"  # Premium, geen Ultra


def test_jaarprijs_en_gratis_vragen_voor_standaard(monkeypatch):
    S._plans_conf.clear()
    assert S._amount("premium", "year") == {"currency": "EUR", "value": "24.99"}
    assert S._amount("ultra") == {"currency": "EUR", "value": "4.99"}
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    u = {"user_id": "s1", "role": "standaard"}

    async def t():
        for _ in range(3):
            await S._ai_ready(u)  # drie gratis vragen
        with pytest.raises(HTTPException) as e:
            await S._ai_ready(u)
        return e.value
    err = run(t())
    assert err.status_code == 403 and "gratis" in err.detail


# --- Leren van gebruik ---
def test_weekadvies_voor_beheer():
    async def t():
        await S.db.search_misses.insert_one({"term": "havermelk barista", "n": 7, "at": S.now_utc()})
        await S.db.usage_daily.insert_many([{"day": S.now_utc().date().isoformat(), "area": "pantry", "n": 2},
                                            {"day": S.now_utc().date().isoformat(), "area": "camps", "n": 300}])
        msg = await S._weekly_insights()
        fb = await S.db.feedback.find_one({"kind": "insight"})
        return msg, fb
    msg, fb = run(t())
    assert '"havermelk barista" (7x)' in msg and "Voorraadkast (2x)" in msg
    assert fb["user_name"] == "Slimme app (automatisch)" and fb["status"] == "new"


def test_eigen_account_leert_mee_bij_zoeken():
    S._mine_cache.clear()

    async def t():
        await S.db.bought.insert_one({"user_id": "u1", "product_id": "p3", "n": 4})
        docs = [{"product_id": f"p{i}"} for i in range(1, 6)]
        return await S._personal_first({"user_id": "u1", "favorite_products": ["p5"]}, docs)
    out = [d["product_id"] for d in run(t())]
    assert out[:2] == ["p3", "p5"] and sorted(out) == ["p1", "p2", "p3", "p4", "p5"]


# --- Prijzen: gebruikte producten elke dag, de rest eens per week ---
def test_gebruikte_producten_en_weekverdeling():
    S._used_cache.update(at=0.0, ids=set())
    days = {S._slice_today(f"id{i}") for i in range(200)}
    assert days == {True, False}  # ongeveer een zevende is vandaag aan de beurt

    async def t():
        await S.db.camps.insert_one({"camp_id": "c1", "deleted_at": None, "general": [{"product_id": "a"}], "days": [{"extras": [{"product_id": "b"}]}]})
        await S.db.dishes.insert_one({"dish_id": "d1", "deleted_at": None, "ingredients": [{"product_id": "c"}]})
        await S.db.pantry.insert_one({"item_id": "p1", "product_id": "d"})
        await S.db.users.insert_one({"user_id": "u1", "favorite_products": ["e"]})
        await S.db.bought.insert_one({"user_id": "u1", "product_id": "f", "at": S.now_utc()})
        return await S._used_product_ids()
    assert run(t()) == {"a", "b", "c", "d", "e", "f"}


def test_gebruikt_product_los_opzoeken():
    S._used_cache.update(at=S.time.time(), ids={"pa"})

    async def search(name):
        return [{"ah_id": "99", "price": 1.25, "name": name, "aisle": "Zuivel"}, {"ah_id": "1", "price": 2.0}]

    async def t():
        await S.db.products.insert_many([{"product_id": "pa", "ah_id": "1", "name": "Melk", "is_global": True, "deleted_at": None, "aisle": "Zuivel"},
                                         {"product_id": "pb", "ah_id": "2", "name": "Kaas", "is_global": True, "deleted_at": None}])
        n = await S._refresh_used_by_search("Albert Heijn", "ah_id", search, set(), {})
        return n, await S.db.products.find_one({"product_id": "pa"})
    S.USED_SEARCH_MAX, old = 10, S.USED_SEARCH_MAX
    orig_sleep = S.asyncio.sleep

    async def fast(_s):
        return None
    S.asyncio.sleep = fast
    try:
        n, doc = run(t())
    finally:
        S.asyncio.sleep = orig_sleep
        S.USED_SEARCH_MAX = old
    assert n == 1 and doc["prices"]["Albert Heijn"] == 2.0


# --- Beveiliging ---
def test_geen_beheerder_via_ongecontroleerd_adres():
    async def t():
        await S.db.users.insert_one({"user_id": "x1", "email": S.ADMIN_EMAIL.lower(), "role": "standaard", "email_verified": False})
        await S.db.users.update_many({"email": {"$in": S.ADMIN_SEED_EMAILS}, "email_verified": True}, {"$set": {"role": "beheerder"}})
        return (await S.db.users.find_one({"user_id": "x1"}))["role"]
    assert run(t()) == "standaard"


def test_foto_doorverwijzing_naar_ander_adres_geweigerd(monkeypatch):
    S._sources["image_proxy"] = True

    class Resp:
        status_code = 302
        headers = {"location": "http://169.254.169.254/latest/meta-data"}
        url = S.httpx.URL("https://static.ah.nl/x.jpg")

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            assert "169.254" not in url  # nooit naar binnen
            return Resp()
    monkeypatch.setattr(S.httpx, "AsyncClient", Client)
    S._img_cache.clear()
    try:
        with pytest.raises(HTTPException):
            run(S.image_proxy("https://static.ah.nl/x.jpg"))
    finally:
        S._sources.update(S.SOURCE_DEFAULTS)


# --- E-mailcontrole en accountbeveiliging ---
class _Req:
    client = type("C", (), {"host": "1.2.3.4"})()
    headers: dict = {}


@pytest.fixture
def mails(monkeypatch):
    sent = []

    async def fake(to, subject, html, allow_unsubscribe=True, attachments=None, raise_errors=False):
        sent.append((to, subject, html))
        return "id"
    monkeypatch.setattr(S, "send_email", fake)
    S._attempts.clear() if hasattr(S, "_attempts") else None
    return sent


def _code(sent):
    import re as _re
    return _re.search(r">(\d{6})<", sent[-1][2]).group(1)


def test_registreren_vraagt_eerst_een_code(mails, monkeypatch):
    async def no_approval():
        return False
    monkeypatch.setattr(S, "signup_approval_on", no_approval)

    async def t():
        r = await S.register(S.RegisterInput(email="nieuw@voorbeeld.nl", password="geheim!123", name="Nieuw", accept_terms=True), _Req())
        assert r["verify"] and "session_token" not in r
        with pytest.raises(HTTPException) as e:
            await S.login(S.LoginInput(identifier="nieuw@voorbeeld.nl", password="geheim!123"), _Req())
        assert e.value.status_code == 403 and "Bevestig" in e.value.detail
        with pytest.raises(HTTPException):
            await S.verify_email(S.VerifyEmailInput(email="nieuw@voorbeeld.nl", code="000000"), _Req())
        ok = await S.verify_email(S.VerifyEmailInput(email="nieuw@voorbeeld.nl", code=_code(mails)), _Req())
        assert ok["session_token"]
        u = await S.db.users.find_one({"email": "nieuw@voorbeeld.nl"})
        return u
    u = run(t())
    assert u["email_verified"] is True and u["role"] != "beheerder"


def test_wachtwoord_moet_speciaal_teken_hebben(mails):
    assert not S._password_ok("geheim123") and S._password_ok("geheim-12") and not S._password_ok("ab!")
    with pytest.raises(HTTPException):
        run(S.register(S.RegisterInput(email="a@b.nl", password="geheim123", name="A", accept_terms=True), _Req()))


def test_ander_emailadres_met_wachtwoord_en_code(mails):
    async def t():
        u = {"user_id": "u5", "email": "oud@voorbeeld.nl", "password_hash": S.hash_password("goed!wachtwoord"), "auth_provider": "password"}
        await S.db.users.insert_one(dict(u))
        with pytest.raises(HTTPException):
            await S.update_profile(S.ProfileUpdate(email="nieuw@voorbeeld.nl"), u)  # niet meer via het profiel
        with pytest.raises(HTTPException):
            await S.change_email_start(S.ChangeEmailInput(new_email="nieuw@voorbeeld.nl", password="fout"), u)
        await S.change_email_start(S.ChangeEmailInput(new_email="nieuw@voorbeeld.nl", password="goed!wachtwoord"), u)
        assert mails[-1][0] == "nieuw@voorbeeld.nl"
        await S.change_email_confirm(S.ChangeEmailConfirm(code=_code(mails)), u)
        return await S.db.users.find_one({"user_id": "u5"})
    doc = run(t())
    assert doc["email"] == "nieuw@voorbeeld.nl" and doc["email_verified"] is True
    assert mails[-1][0] == "oud@voorbeeld.nl"  # het oude adres krijgt een seintje


def test_herroepen_zonder_login_vraagt_een_code(mails):
    with pytest.raises(HTTPException):
        run(S.legal_withdraw(S.WithdrawInput(name="Piet", email="piet@voorbeeld.nl"), _Req(), None))


def test_gmail_koppelen_alleen_met_link_van_beheer():
    with pytest.raises(HTTPException) as e:
        run(S.gmail_connect(""))
    assert e.value.status_code == 403


def test_emailadres_niet_voluit_in_logs():
    assert S._mask("jeroen@gmail.com") == "j***@g***.com"
    assert "jeroen" not in S._mask("jeroen@gmail.com")


def test_csp_staat_alleen_eigen_scripts_toe():
    S._csp_cache.clear()
    v = S._csp()
    assert "default-src 'self'" in v and "frame-ancestors 'none'" in v and "unsafe-eval" not in v


# --- Blok 2: back-ups versleuteld, foto's achter de login, limieten in de database ---
def test_backup_versleuteld_en_zonder_geheimen(monkeypatch):
    import pyzipper
    monkeypatch.setenv("BACKUP_PASSWORD", "back-up-wachtwoord!")

    async def t():
        await S.db.users.insert_one({"user_id": "u1", "email": "a@b.nl", "password_hash": "HASH"})
        await S.db.settings.insert_one({"key": "gmail_sender", "email": "x@gmail.com", "refresh_token": "GEHEIM"})
        return await S._backup_zip(history=False, for_mail=True)
    data, _ = run(t())
    with pytest.raises(Exception):
        zipfile.ZipFile(io.BytesIO(data)).read("users.jsonl")  # zonder wachtwoord niet te lezen
    z = pyzipper.AESZipFile(io.BytesIO(data))
    z.setpassword(b"back-up-wachtwoord!")
    users, settings = z.read("users.jsonl").decode(), z.read("settings.jsonl").decode()
    assert "a@b.nl" in users and "HASH" not in users and "GEHEIM" not in settings


def test_foto_alleen_met_inlog(monkeypatch, tmp_path):
    monkeypatch.setattr(S, "MEDIA_DIR", str(tmp_path))  # in de test op schijf in plaats van de database

    async def t():
        await S._put_object("scoutkook/uploads/u1/foto.jpg", b"img", "image/jpeg")
        with pytest.raises(HTTPException) as e:
            await S.serve_file("scoutkook/uploads/u1/foto.jpg", None)
        assert e.value.status_code == 401
        await S.db.user_sessions.insert_one({"session_token": "tok", "user_id": "u1", "expires_at": S.now_utc() + S.timedelta(days=30)})
        await S.db.users.insert_one({"user_id": "u1", "email": "a@b.nl"})
        r = await S.serve_file("scoutkook/uploads/u1/foto.jpg", "Bearer tok")
        return r
    r = run(t())
    assert r.body == b"img" and "private" in r.headers["cache-control"]


def test_limieten_staan_in_de_database():
    async def t():
        for _ in range(3):
            await S.limit("test:x", 3, 600)
        with pytest.raises(HTTPException) as e:
            await S.limit("test:x", 3, 600)
        return e.value.status_code, await S.db.rate_hits.count_documents({"key": "test:x"})
    code, n = run(t())
    assert code == 429 and n == 3
