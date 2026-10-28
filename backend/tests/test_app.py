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
    return S.RegisterInput(email=email, password="geheim1234", name="Test", accept_terms=True)


def test_aanvragen_uit_werkt_zoals_altijd(monkeypatch):
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._attempts.clear()
    res = run(S.register(_reg("nieuw@voorbeeld.nl"), _req()))
    assert res.get("session_token") and not res.get("pending")


def test_aanvraag_wacht_op_goedkeuring(monkeypatch):
    monkeypatch.setattr(S, "send_email", _geen_mail)
    S._attempts.clear()

    async def t():
        await S.db.settings.insert_one({"key": "app", "signup_approval": True})
        res = await S.register(_reg("nieuw@voorbeeld.nl"), _req())
        assert res["pending"] and "session_token" not in res
        with pytest.raises(HTTPException) as e:
            await S.login(S.LoginInput(identifier="nieuw@voorbeeld.nl", password="geheim1234"), _req())
        assert e.value.status_code == 403
        admin = {"user_id": "a1", "role": "beheerder"}
        await S.db.roles.insert_one({"name": "beheerder", "permissions": ["manage_users"]})
        lijst = await S.list_signup_requests(admin)
        assert lijst["enabled"] and len(lijst["requests"]) == 1
        assert (await S.admin_list_users(admin))["users"] == []
        await S.review_signup_request(lijst["requests"][0]["id"], "approve", admin)
        return await S.login(S.LoginInput(identifier="nieuw@voorbeeld.nl", password="geheim1234"), _req())
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
    r = run(S.legal_withdraw(S.WithdrawInput(name="Test Persoon", email="Test@Voorbeeld.nl"), req, None))
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
