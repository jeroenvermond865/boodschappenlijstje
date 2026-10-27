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
