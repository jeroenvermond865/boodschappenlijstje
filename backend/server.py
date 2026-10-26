from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, Request, UploadFile, File
from fastapi.responses import Response, HTMLResponse, RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import sys
import logging
import asyncio
import functools
import json
import math
import itertools
import time
import uuid
import random
import re
import secrets
import base64
import ipaddress
import unicodedata
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from urllib.parse import urlencode, urlparse
import bcrypt
import httpx
from html import escape
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# MongoDB connection
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get("DB_NAME", "boodschappenlijstje")]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Slim Boodschappenlijstje")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "onboarding@resend.dev")

ADMIN_SEED_EMAILS = ["jeroenvermond865@gmail.com"]
DEFAULT_ROLE = "gebruiker"
ALL_PERMISSIONS = ["manage_standard_dishes", "review_submissions", "manage_users", "manage_roles", "view_budget", "manage_budget", "manage_settings", "manage_products"]
# Drie rollen: de beheerder (alles), medebeheerders (alles behalve rollen aanpassen) en standaard gebruikers.
# Premium is geen rol maar een schakelaar per gebruiker (zie /admin/users/{id}/premium).
DEFAULT_ROLES = [
    {"name": "beheerder", "label": "Beheerder", "permissions": list(ALL_PERMISSIONS), "is_system": True},
    {"name": "medebeheerder", "label": "Medebeheerder", "permissions": [p for p in ALL_PERMISSIONS if p != "manage_roles"], "is_system": True},
    {"name": "gebruiker", "label": "Standaard gebruiker", "permissions": ["view_budget", "manage_budget"], "is_system": True},
]

MEAL_CATEGORIES = ["ontbijt", "lunch", "avondeten", "snacks"]
# Product departments, mirroring the Dirk supermarket layout
AISLES = [
    "Aardappelen, groente & fruit",
    "Vlees & vis",
    "Brood, beleg & koek",
    "Zuivel & kaas",
    "Dranken, sap, koffie & thee",
    "Voorraadkast",
    "Maaltijden, salades & tapas",
    "Diepvries",
    "Huishoud & huisdieren",
    "Kind & drogisterij",
    "Non food",
    "Snacks & snoep",
    "Overig",
]
# Legacy department names -> new Dirk-style departments (startup migration)
OLD_AISLE_MAP = {
    "Groente & Fruit": "Aardappelen, groente & fruit",
    "Brood & Banket": "Brood, beleg & koek",
    "Zuivel & Eieren": "Zuivel & kaas",
    "Vlees & Vis": "Vlees & vis",
    "Houdbaar": "Voorraadkast",
    "Dranken": "Dranken, sap, koffie & thee",
    "Dranken (alcohol)": "Dranken, sap, koffie & thee",
    "Snacks & Snoep": "Snacks & snoep",
    "Borrelhapjes": "Snacks & snoep",
}

STORES = ["Albert Heijn", "Jumbo", "Lidl", "Aldi", "Plus", "Dirk", "Overig"]
STORE_MULT = {"Albert Heijn": 1.10, "Jumbo": 1.05, "Plus": 1.08, "Lidl": 0.90, "Aldi": 0.88, "Dirk": 0.92, "Overig": 1.0}
DEFAULT_STORE = "Albert Heijn"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def new_user_id() -> str:
    return f"user_{uuid.uuid4().hex[:12]}"


def new_token() -> str:
    return uuid.uuid4().hex + uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Beveiliging: wachtwoorden en het afremmen van bots die blijven proberen
# ---------------------------------------------------------------------------
MIN_PASSWORD = 8
_attempts: Dict[str, list] = {}


def client_ip(request: Request) -> str:
    # Achter de proxy van Render: het laatste openbare adres in X-Forwarded-For is de bezoeker (eerdere kan iemand zelf invullen)
    for part in reversed((request.headers.get("x-forwarded-for") or "").split(",")):
        try:
            ip = ipaddress.ip_address(part.strip())
        except ValueError:
            continue
        if ip.is_global:
            return str(ip)
    return request.client.host if request.client else "?"


def _recent(key: str, window: int) -> list:
    now = time.monotonic()
    hits = [t for t in _attempts.get(key, []) if now - t < window]
    if hits:
        _attempts[key] = hits
    else:
        _attempts.pop(key, None)
    return hits


def check_limit(key: str, limit: int, window: int) -> None:
    hits = _recent(key, window)
    if len(hits) >= limit:
        wait = max(1, math.ceil((window - (time.monotonic() - hits[0])) / 60))
        logger.warning("Te veel pogingen: %s", key.split(":")[0])
        raise HTTPException(status_code=429, detail=f"Te veel pogingen. Probeer het over {wait} minuten opnieuw.")


def add_attempt(key: str) -> None:
    _attempts.setdefault(key, []).append(time.monotonic())
    if len(_attempts) > 50000:  # geheugen begrenzen bij een grote aanval
        for k in list(_attempts)[:10000]:
            _attempts.pop(k, None)


def limit(key: str, max_hits: int, window: int) -> None:
    # Elke poging telt mee (voor registreren, resetcodes e.d.)
    check_limit(key, max_hits, window)
    add_attempt(key)


async def create_session(user_id: str) -> str:
    await _mark_seen(user_id)
    token = new_token()
    await db.user_sessions.insert_one(
        {
            "session_token": token,
            "user_id": user_id,
            "created_at": now_utc(),
            "expires_at": now_utc() + timedelta(days=7),
        }
    )
    return token


# Datum van de huidige voorwaarden en privacyverklaring. Verander je de teksten wezenlijk, zet dan een nieuwe datum:
# iedereen moet dan bij de volgende keer inloggen opnieuw akkoord geven.
TERMS_VERSION = "2026-10-25"


def public_user(doc: dict) -> dict:
    return {
        "id": doc["user_id"],
        "email": doc.get("email"),
        "name": doc.get("name"),
        "username": doc.get("username"),
        "phone": doc.get("phone"),
        "picture": doc.get("picture"),
        "role": doc.get("role", DEFAULT_ROLE),
        "store": doc.get("store", DEFAULT_STORE),
        "email_opt_out": doc.get("email_opt_out", False),
        "terms_ok": doc.get("terms_version") == TERMS_VERSION,
        "onboarded": bool(doc.get("onboarded_at")),
        "has_password": bool(doc.get("password_hash")),
        "no_personal": doc.get("no_personal", False),
        "premium": bool(doc.get("premium")),
        "premium_welcome": bool(doc.get("premium") and doc.get("premium_welcome")),
        "premium_org": doc.get("premium_org") if doc.get("premium") else None,
        "premium_until": doc.get("premium_until").isoformat() if doc.get("premium") and doc.get("premium_until") else None,
    }


async def get_active_stores() -> list:
    docs = await db.stores.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(200)
    if not docs:
        return list(STORES)
    return list(dict.fromkeys(d["name"] for d in docs))


async def default_role(exclude: Optional[str] = None) -> str:
    # Standaardrol voor nieuwe gebruikers; bestaat die niet meer, dan de rol met de minste rechten
    if DEFAULT_ROLE != exclude and await db.roles.find_one({"name": DEFAULT_ROLE}):
        return DEFAULT_ROLE
    docs = [d for d in await db.roles.find({"name": {"$nin": ["beheerder", exclude]}}, {"_id": 0}).to_list(1000)]
    if not docs:
        return DEFAULT_ROLE
    return min(docs, key=lambda d: len(d.get("permissions") or []))["name"]


async def role_permissions(role_name: str) -> list:
    r = await db.roles.find_one({"name": role_name}, {"_id": 0})
    return r.get("permissions", []) if r else []


async def user_permissions(user: dict) -> list:
    return await role_permissions(user.get("role", DEFAULT_ROLE))


async def require_perm(user: dict, perm: str) -> list:
    perms = await user_permissions(user)
    if perm not in perms:
        raise HTTPException(status_code=403, detail="Je hebt hier geen rechten voor")
    return perms


async def accept_invitations(user: dict) -> None:
    invs = await db.invitations.find({"email": user["email"], "accepted": False}).to_list(1000)
    for inv in invs:
        await db.camps.update_one(
            {"camp_id": inv["camp_id"], "deleted_at": None},
            {"$addToSet": {"member_ids": user["user_id"]}},
        )
        await db.invitations.update_one({"invite_id": inv["invite_id"]}, {"$set": {"accepted": True}})


def _assert_safe_email(subject: str, html: str) -> None:
    low = html.lower()
    if any(t in low for t in ("<form", "<input", "<textarea", "<select")):
        raise ValueError("No forms in email")
    for m in re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', html, re.I):
        u = m.strip().lower()
        if u.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not u.startswith("https://"):
            raise ValueError("Email links must be absolute https")


async def _unsub_token(email: str) -> str:
    doc = await db.email_prefs.find_one({"email": email})
    if doc and doc.get("token"):
        return doc["token"]
    token = uuid.uuid4().hex
    await db.email_prefs.update_one(
        {"email": email},
        {"$setOnInsert": {"email": email, "token": token, "opted_out": False}},
        upsert=True,
    )
    doc = await db.email_prefs.find_one({"email": email})
    return doc["token"]


async def is_opted_out(email: str) -> bool:
    doc = await db.email_prefs.find_one({"email": email})
    return bool(doc and doc.get("opted_out"))


async def gmail_sender() -> Optional[dict]:
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return None
    return await db.settings.find_one({"key": "gmail_sender"})


async def _send_gmail(sender: dict, to: str, subject: str, html: str) -> Optional[str]:
    msg = EmailMessage()
    msg["From"] = formataddr((EMAIL_FROM_NAME, sender["email"]))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid()
    msg.set_content("Open deze e-mail in een programma dat HTML kan tonen.")
    msg.add_alternative(html, subtype="html")
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await c.post("https://oauth2.googleapis.com/token", data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": sender["refresh_token"],
            "grant_type": "refresh_token",
        })
        tok.raise_for_status()
        resp = await c.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers={"Authorization": f"Bearer {tok.json()['access_token']}"},
            json={"raw": raw},
        )
        resp.raise_for_status()
        return resp.json().get("id")


async def send_email(to: str, subject: str, html: str, allow_unsubscribe: bool = True) -> Optional[str]:
    sender = await gmail_sender()
    if not sender and not RESEND_API_KEY and not EMAIL_KEY:
        logger.warning("Geen e-maildienst ingesteld (Gmail koppelen of RESEND_API_KEY); e-mail overgeslagen")
        return None
    if allow_unsubscribe:
        if await is_opted_out(to):
            logger.info("E-mail overgeslagen (afgemeld): %s", to)
            return None
        token = await _unsub_token(to)
        base = (FRONTEND_URL or "").rstrip("/")
        link = f"{base}/api/email/unsubscribe/{token}"
        html = html + (
            f'<p style="font-size:12px;color:#999;text-align:center;margin-top:16px">'
            f'Geen e-mails meer ontvangen? <a href="{escape(link)}" style="color:#999">Afmelden</a>.</p>'
        )
    _assert_safe_email(subject, html)
    if sender:
        try:
            return await _send_gmail(sender, to, subject, html)
        except Exception as e:
            logger.error("Email send error: %s", e)
            return None
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            if RESEND_API_KEY:
                resp = await c.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                    json={"from": f"{EMAIL_FROM_NAME} <{EMAIL_FROM_ADDRESS}>", "to": [to], "subject": subject, "html": html},
                )
            else:
                resp = await c.post(
                    f"{EMAIL_BASE_URL}/api/v1/email/send",
                    headers={"X-Email-Key": EMAIL_KEY},
                    json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME},
                )
        resp.raise_for_status()
        return resp.json().get("id")
    except Exception as e:
        logger.error("Email send error: %s", e)
        return None


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Niet ingelogd")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Sessie ongeldig")
    if ensure_aware(session["expires_at"]) < now_utc():
        raise HTTPException(status_code=401, detail="Sessie verlopen")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user or user.get("deleted_at"):
        raise HTTPException(status_code=401, detail="Gebruiker niet gevonden")
    if user.get("premium") and user.get("premium_until") and ensure_aware(user["premium_until"]) < now_utc():
        user = await _premium_expired(user)
    seen = user.get("last_seen_at")
    if not seen or ensure_aware(seen) < now_utc() - timedelta(hours=12):
        await _mark_seen(user["user_id"])
    return user


async def _mark_seen(user_id: str) -> None:
    # Wie de app gebruikt, is actief: een waarschuwing over verwijderen vervalt dan
    await db.users.update_one({"user_id": user_id}, {"$set": {"last_seen_at": now_utc()}, "$unset": {"inactive_warned_at": ""}})


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str
    accept_terms: bool = False


class LoginInput(BaseModel):
    identifier: str
    password: str


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    store: Optional[str] = None
    email_opt_out: Optional[bool] = None
    picture: Optional[str] = None
    no_personal: Optional[bool] = None


class DeleteAccount(BaseModel):
    password: Optional[str] = None


class ChangePassword(BaseModel):
    current_password: Optional[str] = None
    new_password: str


class ForgotPassword(BaseModel):
    email: EmailStr


class ResetPassword(BaseModel):
    email: EmailStr
    code: str
    new_password: str


class SessionInput(BaseModel):
    session_id: str


class Ingredient(BaseModel):
    name: str
    unit: str = "stuks"
    qty_adult: float = 0
    qty_child: float = 0
    aisle: str = "Overig"
    price: float = 0
    product_id: Optional[str] = None
    diet: str = "all"  # all | vega | meat
    store: Optional[str] = None
    recipe_text: Optional[str] = None


class DishInput(BaseModel):
    name: str
    category: str
    ingredients: List[Ingredient] = []
    pantry: Optional[List[Ingredient]] = None  # "waarschijnlijk al in huis", niet op de boodschappenlijst
    is_standard: bool = False


class ExtraItem(BaseModel):
    name: str
    unit: str = "stuks"
    qty: float = 1
    aisle: str = "Overig"
    product_id: Optional[str] = None
    store: Optional[str] = None
    meal: Optional[str] = None  # bij welke maaltijd van de dag (ontbijt, lunch, ...); leeg = los voor de dag


class DayInput(BaseModel):
    adults: int = 0
    children: int = 0
    is_shopping_day: bool = True
    meals: Dict[str, List[str]] = Field(default_factory=dict)
    extras: List[ExtraItem] = Field(default_factory=list)
    leftovers: Dict[str, int] = Field(default_factory=dict)  # maaltijd -> dag waarop je dit al kookte (restje)


class CampCreate(BaseModel):
    name: str
    days: List[DayInput]
    vega_adults: int = 0
    vega_children: int = 0
    general: List[ExtraItem] = Field(default_factory=list)
    budget_target: float = 0
    start_date: Optional[str] = None  # JJJJ-MM-DD, eerste dag


class CampUpdate(BaseModel):
    name: Optional[str] = None
    days: Optional[List[DayInput]] = None
    vega_adults: Optional[int] = None
    vega_children: Optional[int] = None
    general: Optional[List[ExtraItem]] = None
    budget_target: Optional[float] = None
    start_date: Optional[str] = None  # "" wist de datum


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(data: RegisterInput, request: Request):
    limit(f"register:{client_ip(request)}", 10, 3600)
    if len(data.password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Wachtwoord moet minstens {MIN_PASSWORD} tekens zijn")
    if not data.accept_terms:
        raise HTTPException(status_code=400, detail="Ga eerst akkoord met de voorwaarden en de privacyverklaring")
    email = data.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        if existing.get("deleted_at"):
            raise HTTPException(status_code=400, detail="Dit account is verwijderd. Vraag de beheerder om het terug te zetten")
        raise HTTPException(status_code=400, detail="E-mailadres is al in gebruik")
    user_id = new_user_id()
    is_admin = email in ADMIN_SEED_EMAILS
    doc = {
        "user_id": user_id,
        "email": email,
        "name": data.name.strip() or email.split("@")[0],
        "username": None,
        "phone": None,
        "password_hash": hash_password(data.password),
        "picture": None,
        "auth_provider": "password",
        "role": "beheerder" if is_admin else await default_role(),
        "created_at": now_utc(),
        "terms_version": TERMS_VERSION,
        "terms_accepted_at": now_utc(),
    }
    await db.users.insert_one(doc)
    await accept_invitations(doc)
    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(doc)}


@api_router.post("/auth/login")
async def login(data: LoginInput, request: Request):
    ident = data.identifier.lower().strip()
    ip_key, acc_key = f"login-ip:{client_ip(request)}", f"login-acc:{ident}"
    check_limit(ip_key, 20, 900)
    check_limit(acc_key, 8, 900)
    user = await db.users.find_one({"$or": [{"email": ident}, {"username": ident}]})
    if not user or user.get("deleted_at") or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        add_attempt(ip_key)
        add_attempt(acc_key)
        raise HTTPException(status_code=401, detail="Onjuiste inloggegevens")
    _attempts.pop(acc_key, None)
    token = await create_session(user["user_id"])
    return {"session_token": token, "user": public_user(user)}


@api_router.put("/auth/profile")
async def update_profile(data: ProfileUpdate, user: dict = Depends(get_current_user)):
    update: dict = {}
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.phone is not None:
        update["phone"] = data.phone.strip() or None
    if data.store is not None and data.store in (await get_active_stores()):
        update["store"] = data.store
    if data.email_opt_out is not None:
        update["email_opt_out"] = data.email_opt_out
        if user.get("email"):
            await db.email_prefs.update_one(
                {"email": user["email"]},
                {"$set": {"opted_out": data.email_opt_out}, "$setOnInsert": {"email": user["email"], "token": uuid.uuid4().hex}},
                upsert=True,
            )
    if data.no_personal is not None:
        update["no_personal"] = data.no_personal
        if data.no_personal:
            # Uitgezet: wat we over je voorkeuren bijhielden, gaat meteen weg
            await db.user_interest.delete_many({"user_id": user["user_id"]})
    if data.picture is not None:
        update["picture"] = data.picture.strip() or None
    if data.username is not None:
        uname = data.username.lower().strip() or None
        if uname:
            clash = await db.users.find_one({"username": uname, "user_id": {"$ne": user["user_id"]}})
            if clash:
                raise HTTPException(status_code=400, detail="Deze gebruikersnaam is al in gebruik")
        update["username"] = uname
    if data.email is not None:
        new_email = data.email.lower().strip()
        clash = await db.users.find_one({"email": new_email, "user_id": {"$ne": user["user_id"]}})
        if clash:
            raise HTTPException(status_code=400, detail="Dit e-mailadres is al in gebruik")
        update["email"] = new_email
    if update:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": public_user(updated)}


@api_router.post("/auth/change-password")
async def change_password(data: ChangePassword, user: dict = Depends(get_current_user)):
    if len(data.new_password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Wachtwoord moet minstens {MIN_PASSWORD} tekens zijn")
    if user.get("password_hash"):
        if not data.current_password or not verify_password(data.current_password, user["password_hash"]):
            limit(f"pw-check:{user['user_id']}", 8, 900)
            raise HTTPException(status_code=400, detail="Huidig wachtwoord is onjuist")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": hash_password(data.new_password)}})
    return {"ok": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPassword, request: Request):
    email = data.email.lower().strip()
    limit(f"forgot-ip:{client_ip(request)}", 10, 3600)
    limit(f"forgot-acc:{email}", 3, 3600)
    user = await db.users.find_one({"email": email})
    if user and user.get("password_hash"):
        code = f"{secrets.randbelow(1_000_000):06d}"
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({"email": email, "code": code, "expires_at": now_utc() + timedelta(hours=1)})
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
            f'<h2 style="color:#2E5E38;margin:0 0 12px">Wachtwoord opnieuw instellen</h2>'
            f'<p>Gebruik deze code in de Slim Boodschappenlijstje-app om een nieuw wachtwoord in te stellen:</p>'
            f'<p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#2E5E38">{escape(code)}</p>'
            f'<p>De code is 1 uur geldig. Heb je dit niet aangevraagd? Negeer deze e-mail.</p>'
            f'<p style="font-size:12px;color:#888">Verstuurd door Slim Boodschappenlijstje. We vragen nooit je wachtwoord via e-mail.</p>'
            '</td></tr></table>'
        )
        await send_email(email, "Je Slim Boodschappenlijstje wachtwoord-resetcode", html)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPassword, request: Request):
    limit(f"reset-ip:{client_ip(request)}", 20, 900)
    if len(data.new_password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Wachtwoord moet minstens {MIN_PASSWORD} tekens zijn")
    email = data.email.lower().strip()
    rec = await db.password_resets.find_one({"email": email})
    if not rec or ensure_aware(rec["expires_at"]) < now_utc() or rec.get("attempts", 0) >= 5:
        raise HTTPException(status_code=400, detail="Ongeldige of verlopen code")
    if rec["code"] != data.code.strip():
        # Na 5 foute pogingen vervalt de code, zodat hij niet te raden is
        await db.password_resets.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        raise HTTPException(status_code=400, detail="Ongeldige of verlopen code")
    await db.users.update_one({"email": email}, {"$set": {"password_hash": hash_password(data.new_password)}})
    await db.password_resets.delete_many({"email": email})
    return {"ok": True}


def google_callback_url() -> str:
    return (FRONTEND_URL or "").rstrip("/") + "/api/auth/google/callback"


def allowed_redirect(url: str) -> bool:
    # Alleen terug naar de eigen site of naar de app (eigen URL-schema)
    base = (FRONTEND_URL or "").rstrip("/")
    if url.startswith("http://") or url.startswith("https://"):
        return bool(base) and (url == base or url.startswith(base + "/"))
    return url.startswith(("frontend://", "exp://"))


@api_router.get("/email/gmail/connect")
async def gmail_connect():
    # Eenmalig: koppel het Gmail-account van de beheerder als afzender
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google is niet ingesteld")
    state = secrets.token_urlsafe(24)
    redirect = (FRONTEND_URL or "").rstrip("/") + "/"
    await db.google_logins.insert_one({"state": state, "redirect": redirect, "purpose": "gmail", "expires_at": now_utc() + timedelta(minutes=10)})
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": google_callback_url(),
        "response_type": "code",
        "scope": "openid email https://www.googleapis.com/auth/gmail.send",
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))


@api_router.get("/auth/google/start")
async def google_start(redirect: str = ""):
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        raise HTTPException(status_code=503, detail="Google inloggen is niet ingesteld")
    redirect = redirect or (FRONTEND_URL or "").rstrip("/") + "/"
    if not allowed_redirect(redirect):
        raise HTTPException(status_code=400, detail="Ongeldige redirect")
    state = secrets.token_urlsafe(24)
    await db.google_logins.insert_one({"state": state, "redirect": redirect, "expires_at": now_utc() + timedelta(minutes=10)})
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": google_callback_url(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params))


@api_router.get("/auth/google/callback")
async def google_callback(state: str = "", code: str = "", error: str = ""):
    rec = await db.google_logins.find_one({"state": state, "session_id": {"$exists": False}})
    if not rec or ensure_aware(rec["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="Inlogpoging verlopen, probeer opnieuw")
    if error or not code:
        await db.google_logins.delete_one({"_id": rec["_id"]})
        return RedirectResponse(rec["redirect"])
    async with httpx.AsyncClient(timeout=15) as http:
        tok = await http.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": google_callback_url(),
            "grant_type": "authorization_code",
        })
        if tok.status_code != 200:
            raise HTTPException(status_code=401, detail="Google inloggen mislukt")
        info = await http.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {tok.json().get('access_token')}"},
        )
    if info.status_code != 200 or not info.json().get("email_verified"):
        raise HTTPException(status_code=401, detail="Google inloggen mislukt")
    profile = info.json()
    if rec.get("purpose") == "gmail":
        await db.google_logins.delete_one({"_id": rec["_id"]})
        email = (profile.get("email") or "").lower()
        refresh_token = tok.json().get("refresh_token")
        allowed = (os.environ.get("GMAIL_SENDER") or "").lower().strip()
        if not allowed or email != allowed or not refresh_token:
            raise HTTPException(status_code=403, detail="Dit Gmail-account is niet ingesteld als afzender (GMAIL_SENDER)")
        await db.settings.update_one(
            {"key": "gmail_sender"},
            {"$set": {"email": email, "refresh_token": refresh_token, "updated_at": now_utc()}},
            upsert=True,
        )
        return HTMLResponse(f"<p style='font-family:sans-serif'>Gmail gekoppeld: e-mails worden nu verstuurd vanaf {escape(email)}.</p>")
    session_id = secrets.token_urlsafe(32)
    await db.google_logins.update_one(
        {"_id": rec["_id"]},
        {"$set": {
            "session_id": session_id,
            "email": profile.get("email"),
            "name": profile.get("name"),
            "picture": profile.get("picture"),
            "expires_at": now_utc() + timedelta(minutes=5),
        }},
    )
    sep = "&" if "#" in rec["redirect"] else "#"
    return RedirectResponse(f"{rec['redirect']}{sep}session_id={session_id}")


@api_router.post("/auth/session")
async def auth_session(data: SessionInput, request: Request):
    limit(f"session-ip:{client_ip(request)}", 30, 900)
    payload = await db.google_logins.find_one_and_delete({"session_id": data.session_id})
    if not payload or ensure_aware(payload["expires_at"]) < now_utc():
        raise HTTPException(status_code=401, detail="Google inloggen mislukt")
    email = payload.get("email", "").lower().strip()
    name = payload.get("name")
    picture = payload.get("picture")
    if not email:
        raise HTTPException(status_code=401, detail="Geen e-mail ontvangen")

    existing = await db.users.find_one({"email": email})
    if existing and existing.get("deleted_at"):
        raise HTTPException(status_code=403, detail="Dit account is verwijderd. Vraag de beheerder om het terug te zetten")
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name or existing.get("name"), "picture": picture or existing.get("picture")}},
        )
        user = await db.users.find_one({"user_id": user_id})
    else:
        user_id = new_user_id()
        user = {
            "user_id": user_id,
            "email": email,
            "name": name or email.split("@")[0],
            "username": None,
            "phone": None,
            "picture": picture,
            "password_hash": None,
            "auth_provider": "google",
            "role": "beheerder" if email in ADMIN_SEED_EMAILS else await default_role(),
            "created_at": now_utc(),
        }
        await db.users.insert_one(user)
        await accept_invitations(user)

    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(user)}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    return {"user": public_user(user), "permissions": perms}


@api_router.post("/auth/accept-terms")
async def accept_terms(user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"terms_version": TERMS_VERSION, "terms_accepted_at": now_utc()}})
    return {"ok": True}


@api_router.post("/auth/onboarded")
async def mark_onboarded(user: dict = Depends(get_current_user)):
    # De uitleg is gezien: niet meer vanzelf tonen (blijft te vinden onder Account)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"onboarded_at": now_utc()}})
    return {"ok": True}


@api_router.post("/auth/delete-account")
async def delete_account(data: DeleteAccount, user: dict = Depends(get_current_user)):
    # Recht op verwijdering (AVG): alles van deze gebruiker gaat direct en definitief weg
    uid = user["user_id"]
    if user.get("password_hash") and (not data.password or not verify_password(data.password, user["password_hash"])):
        limit(f"pw-check:{uid}", 8, 900)
        raise HTTPException(status_code=400, detail="Wachtwoord is onjuist")
    if user.get("role") == "beheerder" and not await db.users.find_one(
        {"role": "beheerder", "deleted_at": None, "user_id": {"$ne": uid}}
    ):
        raise HTTPException(status_code=400, detail="Je bent de enige beheerder. Maak eerst iemand anders beheerder")
    await _erase_user(user)
    return {"ok": True}


async def _erase_user(user: dict) -> None:
    uid = user["user_id"]
    # Gedeelde kampen blijven bestaan voor de andere leiders: de eerste leider wordt eigenaar
    async for camp in db.camps.find({"owner_id": uid, "member_ids.0": {"$exists": True}}, {"_id": 0, "camp_id": 1, "member_ids": 1}):
        others = [m for m in camp.get("member_ids") or [] if m != uid]
        if others:
            await db.camps.update_one({"camp_id": camp["camp_id"]}, {"$set": {"owner_id": others[0]}, "$pull": {"member_ids": others[0]}})
    # Standaardgerechten zijn van iedereen: die blijven, zonder maker
    await db.dishes.update_many({"owner_id": uid, "is_standard": True}, {"$set": {"owner_id": None}})
    await _purge_docs("user", [user])
    await db.packages.delete_many({"owner_id": uid})
    await db.user_interest.delete_many({"user_id": uid})
    await db.feedback.delete_many({"user_id": uid})
    await db.store_requests.delete_many({"requested_by": uid})
    await db.premium_requests.delete_many({"user_id": uid})
    await db.pantry.delete_many({"user_id": uid})
    await db.price_alerts.delete_many({"user_id": uid})
    await db.auto_alert_marks.delete_many({"user_id": uid})
    if user.get("email"):
        for coll in (db.email_prefs, db.password_resets, db.invitations):
            await coll.delete_many({"email": user["email"]})


# Accounts die lang niet gebruikt zijn (zie privacyverklaring): eerst een mail, na 30 dagen zonder inloggen weg
INACTIVE_DAYS = 730
INACTIVE_GRACE_DAYS = 30


async def _cleanup_inactive_users() -> None:
    now = now_utc()
    stale = now - timedelta(days=INACTIVE_DAYS)
    base = (FRONTEND_URL or "").rstrip("/")
    async for u in db.users.find(
        {"deleted_at": None, "role": {"$ne": "beheerder"}, "last_seen_at": {"$lt": stale}, "inactive_warned_at": {"$exists": False}},
        {"_id": 0},
    ):
        if not u.get("email"):
            continue
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
            f'<h2 style="color:#2E5E38;margin:0 0 12px">We missen je!</h2>'
            f'<p>Hoi {escape(u.get("name") or "")},</p>'
            f'<p>Je hebt je account bij Slim Boodschappenlijstje al twee jaar niet gebruikt. Om je gegevens niet langer te bewaren dan nodig, '
            f'verwijderen we je account over {INACTIVE_GRACE_DAYS} dagen, samen met je planningen, gerechten en favorieten.</p>'
            f'<p><b>Wil je je account houden?</b> Log dan voor die tijd één keer in'
            + (f' op <a href="{escape(base)}" style="color:#2E5E38">{escape(base.replace("https://", ""))}</a>' if base else "")
            + '. Meer hoef je niet te doen.</p>'
            f'<p>Wil je het niet meer gebruiken? Dan hoef je niets te doen.</p>'
            f'<p style="font-size:12px;color:#888">Verstuurd door Slim Boodschappenlijstje.</p>'
            '</td></tr></table>'
        )
        # Alleen als de mail echt weg is, gaat de termijn lopen: zonder waarschuwing verwijderen we niets
        if await send_email(u["email"], "Je Slim Boodschappenlijstje-account wordt binnenkort verwijderd", html, allow_unsubscribe=False):
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": {"inactive_warned_at": now}})
            logger.info("Inactief account gewaarschuwd: %s", u["user_id"])
    async for u in db.users.find(
        {"deleted_at": None, "role": {"$ne": "beheerder"}, "last_seen_at": {"$lt": stale},
         "inactive_warned_at": {"$lt": now - timedelta(days=INACTIVE_GRACE_DAYS)}},
        {"_id": 0},
    ):
        await _erase_user(u)
        logger.info("Inactief account verwijderd: %s", u["user_id"])


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Dishes
# ---------------------------------------------------------------------------
# Vlees en vis in een gerecht: daar hebben vega-eters een vervanger voor nodig
_MEAT_RE = re.compile(r"kip|gehakt|rookworst|worst|spek|\bham\b|hamlap|beenham|achterham|schouderham|hamblokjes|hamreepjes|bacon|biefstuk|varken|rund|kalkoen|kalfs|lams|\blam\b|"
                      r"hamburger|burger|schnitzel|shoarma|gyros|saucijs|slavink|frikandel|kroket|salami|chorizo|pancetta|prosciutto|"
                      r"filet americain|ossenhaas|entrecote|steak|stoofvlees|riblap|sukade|vlees|karbonade|speklap|braadworst|knakworst|"
                      r"\bvis\b|visstick|zalm|tonijn|kabeljauw|pangasius|koolvis|tilapia|garnaal|garnalen|kibbeling|lekkerbek|makreel|haring|mosselen|inktvis|ansjovis|surimi")
_FISH_RE = re.compile(r"\bvis\b|visstick|zalm|tonijn|kabeljauw|pangasius|koolvis|tilapia|garnaal|garnalen|kibbeling|lekkerbek|makreel|haring|"
                      r"mosselen|inktvis|ansjovis|surimi|schelvis|forel|heek|scampi|sardine|vissoep|visfilet")
_VEGA_RE = re.compile(r"vega|vegetari|plantaardig|vegan|veggie|garden gourmet|beyond|valess|like meat|vegetarische slager|vivera|quorn|"
                      r"tofu|tempeh|seitan|falafel|groenteburger|zonder vlees|vleesvervang|kikkererwt|linzen")


def _is_meat(ing: dict) -> bool:
    name = _norm_text(ing.get("name") or "")
    return bool(_MEAT_RE.search(name)) and not _VEGA_RE.search(name) and not re.search(r"bouillon|fond\b|kruiden|saus|vleestomaat|speculaas|eieren|\bei\b|jus\b|smaak", name)


def _ing_diet(ing: dict) -> str:
    # Vlees en vis zijn nooit voor iedereen: ook als het zo is opgeslagen, gaat het alleen naar de vleeseters
    d = ing.get("diet") or "all"
    return "meat" if d == "all" and _is_meat(ing) else d


def _needs_vega(doc: dict) -> list:
    # Vlees of vis waar de vega-eters nog niets voor in de plaats hebben
    ings = doc.get("ingredients") or []
    if doc.get("vega_done") or any(_ing_diet(i) == "vega" for i in ings):
        return []
    return [k for k, i in enumerate(ings) if _ing_diet(i) == "meat" and _is_meat(i)]


def dish_public(doc: dict) -> dict:
    return {
        "id": doc["dish_id"],
        "name": doc["name"],
        "category": doc["category"],
        "is_standard": doc.get("is_standard", False),
        "ingredients": [{**i, "diet": _ing_diet(i)} for i in doc.get("ingredients", [])],
        "source": doc.get("source"),
        "pantry": doc.get("pantry") or [],
        "needs_vega": bool(_needs_vega(doc)),
        "online": bool(doc.get("online")),
        "image": doc.get("image") or (doc.get("source") or {}).get("image"),
        "price_pp": doc.get("price_pp"),  # app-gerechten: ongeveer per volwassene per winkel (deel van de verpakking)
        "camp_id": doc.get("camp_id"),  # aangepast voor één activiteit
        "owner_id": doc.get("owner_id"),
    }


# Vega-vervangers: "kipfilet" -> vegetarische kipstukjes, "gehakt" -> vegetarisch gehakt
_VEGA_FOR = [(r"kip", ["vegetarische kipstukjes", "vega kip", "plantaardige kipstukjes"]),
             (r"gehakt", ["vegetarisch gehakt", "vega gehakt", "plantaardig gehakt"]),
             (r"rookworst", ["vegetarische rookworst", "vega rookworst"]),
             (r"worst|saucijs|braadworst|knakworst", ["vegetarische worst", "vega worstjes"]),
             (r"spek|bacon|pancetta", ["vegetarische spekjes", "vega spekreepjes"]),
             (r"burger", ["vegaburger", "vegetarische burger", "groenteburger"]),
             (r"schnitzel", ["vegetarische schnitzel", "vega schnitzel"]),
             (r"shoarma|gyros|kebab", ["vegetarische shoarma", "vega shoarma"]),
             (r"ham|salami|filet americain", ["vegetarische ham", "vega beleg"]),
             (r"zalm|tonijn|kabeljauw|vis|pangasius|koolvis|kibbeling|lekkerbek", ["vegetarische vis", "vega visstick", "tofu"]),
             (r"garna", ["vegetarische garnalen", "tofu"]),
             (r"biefstuk|steak|stoofvlees|riblap|sukade|rund|varken|vlees|lap|karbonade", ["vegetarische stukjes", "vega reepjes", "tempeh"])]


def _vega_options(ing: dict, docs: list, limit: int = 5) -> list:
    name = _norm_text(ing.get("name") or "")
    store = ing.get("store")
    pool = [d for d in docs if d.get("is_global") and (not store or d.get("_src") == store)] or [d for d in docs if d.get("is_global")]
    core = _alt_terms(name, None) or name
    queries = [f"vegetarische {core}", f"vega {core}"]
    for rx, qs in _VEGA_FOR:
        if re.search(rx, name):
            queries += qs
            break
    queries += ["vegetarische stukjes", "tofu"]
    seen, out = set(), []
    for q in queries:
        for d in _best_matches(pool, q, 12):
            if d["product_id"] in seen or not _VEGA_RE.search(d["_norm"] + " " + _norm_text(d.get("brand") or "")):
                continue
            if _NONFOOD_RE.search(d["_norm"]):
                continue
            seen.add(d["product_id"])
            out.append(d)
        if len(out) >= limit * 2:
            break
    # Wat op het vlees lijkt eerst: bij rookworst een vega rookworst, bij zalm een vega zalm
    keys = [w for w in core.split() if len(w) > 2] + [w for q in queries[2:4] for w in q.split() if not _VEGA_RE.search(w)]
    out.sort(key=lambda d: 0 if any(k[:5] in d["_norm"] for k in keys) else 1)
    return out[:limit]


# ---- Pakketten: vaste spullen die je elke keer nodig hebt (afwasborstel, vuilniszakken) ----
class PackageInput(BaseModel):
    name: str
    items: List[ExtraItem] = []


def package_public(doc: dict) -> dict:
    return {"id": doc["package_id"], "name": doc["name"], "items": doc.get("items") or [], "owner_id": doc.get("owner_id")}


_H, _V, _D = "Huishoud & huisdieren", "Voorraadkast", "Kind & drogisterij"
# Startpakketten die je in een gewoon huishouden (of op kamp) vaak nodig hebt; daarna zelf aan te passen
DEFAULT_PACKAGES = [
    ("Afwassen", [("Afwasmiddel", 1, _H), ("Afwasborstel", 1, _H), ("Sponsjes", 1, _H), ("Theedoeken", 2, _H), ("Vaatdoekjes", 1, _H)]),
    ("Schoonmaken", [("Allesreiniger", 1, _H), ("WC-reiniger", 1, _H), ("Schoonmaakdoekjes", 1, _H), ("Vuilniszakken", 1, _H),
                     ("Handzeep", 1, _D), ("Glasreiniger", 1, _H)]),
    ("Keuken basis", [("Keukenpapier", 1, _H), ("Aluminiumfolie", 1, _H), ("Huishoudfolie", 1, _H), ("Diepvrieszakjes", 1, _H),
                      ("Bakpapier", 1, _H)]),
    ("Voorraadkast basis", [("Zout", 1, _V), ("Peper", 1, _V), ("Zonnebloemolie", 1, _V), ("Olijfolie", 1, _V), ("Suiker", 1, _V),
                            ("Bloem", 1, _V), ("Ketchup", 1, _V), ("Mayonaise", 1, _V), ("Bouillonblokjes", 1, _V)]),
    ("Ontbijt en lunch basis", [("Boter", 1, "Zuivel & kaas"), ("Hagelslag", 1, "Brood, beleg & koek"), ("Pindakaas", 1, "Brood, beleg & koek"),
                                ("Jam", 1, "Brood, beleg & koek"), ("Thee", 1, "Dranken, sap, koffie & thee"), ("Koffie", 1, "Dranken, sap, koffie & thee"),
                                ("Ranja", 1, "Dranken, sap, koffie & thee")]),
    ("Toilet en verzorging", [("Toiletpapier", 1, _H), ("Tandpasta", 1, _D), ("Douchegel", 1, _D), ("Zonnebrand", 1, _D), ("Pleisters", 1, _D)]),
    ("Wegwerp voor groepen", [("Bordjes", 1, "Non food"), ("Bekers", 1, "Non food"), ("Servetten", 1, "Non food"), ("Plastic bestek", 1, "Non food")]),
]


async def _seed_packages(user: dict, have: set) -> None:
    # Eén keer per gebruiker: koppel de spullen meteen aan een product in je eigen winkel, dan staat de prijs erbij
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"packages_seeded": True}})
    docs = await _global_products()
    store = user.get("store") if user.get("store") in COUPLED_STORES else "Dirk"
    pool = [d for d in docs if d.get("_src") == store and d.get("is_global")]

    def build():
        out = []
        for name, items in DEFAULT_PACKAGES:
            if name.lower() in have:
                continue
            its = []
            for n, qty, aisle in items:
                hit = (_best_matches(pool, n, 1) or [None])[0] if pool else None
                its.append(ExtraItem(name=hit["name"] if hit else n, unit="stuks", qty=qty, aisle=(hit or {}).get("aisle") or aisle,
                                     product_id=(hit or {}).get("product_id"), store=store if hit else None).model_dump())
            out.append({"package_id": f"pkg_{uuid.uuid4().hex[:12]}", "owner_id": user["user_id"], "name": name, "items": its,
                        "deleted_at": None, "created_at": now_utc()})
        return out
    new = await asyncio.to_thread(build)
    if new:
        await db.packages.insert_many(new)


@api_router.get("/packages")
async def list_packages(user: dict = Depends(get_current_user)):
    docs = await db.packages.find({"owner_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("name", 1).to_list(500)
    if not user.get("packages_seeded"):
        await _seed_packages(user, {d["name"].lower() for d in docs})
        docs = await db.packages.find({"owner_id": user["user_id"], "deleted_at": None}, {"_id": 0}).sort("name", 1).to_list(500)
    return {"packages": [package_public(d) for d in docs]}


@api_router.get("/packages/{package_id}")
async def get_package(package_id: str, user: dict = Depends(get_current_user)):
    doc = await db.packages.find_one({"package_id": package_id, "owner_id": user["user_id"], "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pakket niet gevonden")
    return package_public(doc)


@api_router.post("/packages")
async def create_package(data: PackageInput, user: dict = Depends(get_current_user)):
    doc = {"package_id": f"pkg_{uuid.uuid4().hex[:12]}", "owner_id": user["user_id"], "name": data.name.strip()[:80] or "Pakket",
           "items": [i.model_dump() for i in data.items], "deleted_at": None, "created_at": now_utc()}
    await db.packages.insert_one(doc)
    return package_public(doc)


@api_router.put("/packages/{package_id}")
async def update_package(package_id: str, data: PackageInput, user: dict = Depends(get_current_user)):
    res = await db.packages.update_one({"package_id": package_id, "owner_id": user["user_id"], "deleted_at": None},
                                       {"$set": {"name": data.name.strip()[:80] or "Pakket", "items": [i.model_dump() for i in data.items]}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Pakket niet gevonden")
    return await get_package(package_id, user)


@api_router.delete("/packages/{package_id}")
async def delete_package(package_id: str, user: dict = Depends(get_current_user)):
    await db.packages.update_one({"package_id": package_id, "owner_id": user["user_id"]}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


@api_router.get("/dishes")
async def list_dishes(user: dict = Depends(get_current_user)):
    # Ook de gerechten in activiteiten waar je bij hoort (van andere deelnemers of alleen voor die activiteit aangepast)
    camps = await db.camps.find(camp_access_filter(user["user_id"]), {"_id": 0, "days.meals": 1}).to_list(200)
    used = list({x for c in camps for d in c.get("days") or [] for ids in (d.get("meals") or {}).values() for x in ids})
    cursor = db.dishes.find(
        {
            "deleted_at": None,
            "$or": [{"is_standard": True}, {"owner_id": user["user_id"]}, {"dish_id": {"$in": used}}],
        },
        {"_id": 0},
    )
    docs = await cursor.to_list(1000)
    docs.sort(key=lambda d: (MEAL_CATEGORIES.index(d["category"]) if d["category"] in MEAL_CATEGORIES else 99, d["name"].lower()))
    return {"dishes": [dish_public(d) for d in docs]}


@api_router.post("/dishes")
async def create_dish(data: DishInput, user: dict = Depends(get_current_user)):
    if data.category not in MEAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    make_standard = False
    if data.is_standard:
        await require_perm(user, "manage_standard_dishes")
        make_standard = True
    dish_id = f"dish_{uuid.uuid4().hex[:12]}"
    doc = {
        "dish_id": dish_id,
        "name": data.name.strip(),
        "category": data.category,
        "is_standard": make_standard,
        "owner_id": None if make_standard else user["user_id"],
        "ingredients": [i.model_dump() for i in data.ingredients],
        "pantry": [i.model_dump() for i in data.pantry or []],
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.dishes.insert_one(doc)
    return dish_public(doc)


@api_router.put("/dishes/{dish_id}")
async def update_dish(dish_id: str, data: DishInput, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if doc.get("is_standard"):
        await require_perm(user, "manage_standard_dishes")
    elif doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen gerechten aanpassen")
    if data.category not in MEAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    await db.dishes.update_one(
        {"dish_id": dish_id},
        {"$set": {
            "name": data.name.strip(),
            "category": data.category,
            "ingredients": [i.model_dump() for i in data.ingredients],
            **({"pantry": [i.model_dump() for i in data.pantry]} if data.pantry is not None else {}),
            "online": False,  # aangepast: nu een eigen gerecht
        }},
    )
    updated = await db.dishes.find_one({"dish_id": dish_id}, {"_id": 0})
    return dish_public(updated)


@api_router.put("/camps/{camp_id}/dishes/{dish_id}")
async def save_camp_dish(camp_id: str, dish_id: str, data: DishInput, user: dict = Depends(get_current_user)):
    # Een gerecht aanpassen voor alleen deze activiteit: de eerste keer maken we er een eigen versie voor de activiteit van
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Niet gevonden")
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if data.category not in MEAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    fields = {"name": data.name.strip(), "category": data.category, "ingredients": [i.model_dump() for i in data.ingredients],
              **({"pantry": [i.model_dump() for i in data.pantry]} if data.pantry is not None else {})}
    if doc.get("camp_id") == camp_id:
        await db.dishes.update_one({"dish_id": dish_id}, {"$set": fields})
        return dish_public(await db.dishes.find_one({"dish_id": dish_id}, {"_id": 0}))
    new_id = f"dish_{uuid.uuid4().hex[:12]}"
    copy = {"dish_id": new_id, "is_standard": False, "owner_id": user["user_id"], "source": doc.get("source"), "camp_id": camp_id,
            "from_dish": dish_id, "pantry": doc.get("pantry") or [], "deleted_at": None, "created_at": now_utc(), **fields}
    await db.dishes.insert_one(copy)
    days = camp.get("days") or []
    for d in days:
        for cat, ids in (d.get("meals") or {}).items():
            d["meals"][cat] = [new_id if x == dish_id else x for x in ids]
    await db.camps.update_one({"camp_id": camp_id}, {"$set": {"days": days}})
    return dish_public(copy)


async def _editable_dish(dish_id: str, user: dict) -> dict:
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if doc.get("is_standard"):
        await require_perm(user, "manage_standard_dishes")
    elif doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen gerechten aanpassen")
    return doc


@api_router.get("/dishes/{dish_id}/vega")
async def vega_suggestions(dish_id: str, user: dict = Depends(get_current_user)):
    # Per stuk vlees of vis in het gerecht een paar vega-vervangers uit dezelfde winkel
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    docs = await _global_products()
    favs = set(user.get("favorite_products") or [])
    ings = doc.get("ingredients") or []

    def run():
        return [{"index": k, "name": ings[k]["name"], "unit": ings[k].get("unit"), "qty_adult": ings[k].get("qty_adult"),
                 "options": [product_public(_clean(d), ings[k].get("store") or d["_src"], user["user_id"], favs) for d in _vega_options(ings[k], docs)]}
                for k in _needs_vega(doc)]
    return {"items": await asyncio.to_thread(run)}


class VegaChoice(BaseModel):
    index: int
    product_id: Optional[str] = None  # leeg: vega-eters slaan dit over


class VegaInput(BaseModel):
    choices: List[VegaChoice]


@api_router.post("/dishes/{dish_id}/vega")
async def set_vega(dish_id: str, body: VegaInput, user: dict = Depends(get_current_user)):
    # Het vlees gaat alleen naar de vleeseters, de vervanger met dezelfde hoeveelheid naar de vega-eters
    doc = await _editable_dish(dish_id, user)
    ings = list(doc.get("ingredients") or [])
    extra = []
    for ch in body.choices:
        if not (0 <= ch.index < len(ings)):
            continue
        meat = {**ings[ch.index], "diet": "meat"}
        ings[ch.index] = meat
        if ch.product_id:
            p = await db.products.find_one({"product_id": ch.product_id, "deleted_at": None}, {"_id": 0})
            if not p:
                continue
            extra.append({**meat, "name": p["name"], "product_id": p["product_id"], "aisle": p.get("aisle") or meat.get("aisle") or "Overig",
                          "diet": "vega", "store": meat.get("store") or product_source(p), "recipe_text": None,
                          "price": resolve_price(p.get("prices") or {}, meat.get("store") or product_source(p), p.get("unavailable") or [])})
    await db.dishes.update_one({"dish_id": dish_id}, {"$set": {"ingredients": ings + extra, "vega_done": True}})
    return dish_public(await db.dishes.find_one({"dish_id": dish_id}, {"_id": 0}))


@api_router.delete("/dishes/{dish_id}")
async def delete_dish(dish_id: str, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if doc.get("is_standard"):
        await require_perm(user, "manage_standard_dishes")
    elif doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen gerechten verwijderen")
    await db.dishes.update_one({"dish_id": dish_id}, {"$set": {"deleted_at": now_utc()}})
    return {"ok": True}


@api_router.post("/dishes/{dish_id}/submit")
async def submit_dish(dish_id: str, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if doc.get("is_standard") or doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=400, detail="Je kunt alleen je eigen gerecht aanmelden")
    existing = await db.submissions.find_one({"dish_id": dish_id, "status": "pending"})
    if existing:
        raise HTTPException(status_code=400, detail="Dit gerecht is al in behandeling")
    sub = {
        "submission_id": f"sub_{uuid.uuid4().hex[:12]}",
        "dish_id": dish_id,
        "submitted_by": user["user_id"],
        "submitter_name": user.get("name"),
        "name": doc["name"],
        "category": doc["category"],
        "ingredients": doc.get("ingredients", []),
        "status": "pending",
        "created_at": now_utc(),
    }
    await db.submissions.insert_one(sub)
    return {"ok": True}


@api_router.post("/dishes/{dish_id}/restore")
async def restore_dish(dish_id: str, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"dish_id": dish_id, "owner_id": user["user_id"]})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    await db.dishes.update_one({"dish_id": dish_id}, {"$set": {"deleted_at": None}})
    restored = await db.dishes.find_one({"dish_id": dish_id}, {"_id": 0})
    return dish_public(restored)


@api_router.get("/meta")
async def meta(user: dict = Depends(get_current_user)):
    return {"categories": MEAL_CATEGORIES, "aisles": AISLES, "stores": await get_active_stores()}


# ---------------------------------------------------------------------------
# Camps
# ---------------------------------------------------------------------------
def camp_public(doc: dict) -> dict:
    return {
        "id": doc["camp_id"],
        "name": doc["name"],
        "days": doc.get("days", []),
        "vega_adults": doc.get("vega_adults", 0),
        "vega_children": doc.get("vega_children", 0),
        "general": doc.get("general", []),
        "budget_target": doc.get("budget_target", 0),
        "start_date": doc.get("start_date"),
        "owner_id": doc.get("owner_id"),
        "member_ids": doc.get("member_ids", []),
        "created_at": doc["created_at"].isoformat() if isinstance(doc.get("created_at"), datetime) else doc.get("created_at"),
    }


def _build_days(day_inputs) -> list:
    days = []
    for idx, d in enumerate(day_inputs):
        meals = {c: d.meals.get(c, []) for c in MEAL_CATEGORIES}
        days.append({
            "index": idx,
            "adults": d.adults,
            "children": d.children,
            "is_shopping_day": d.is_shopping_day,
            "meals": meals,
            "extras": [e.model_dump() for e in d.extras],
            "leftovers": {c: v for c, v in (d.leftovers or {}).items() if c in MEAL_CATEGORIES and 0 <= v < idx},
        })
    return days


def _leftover_from(day: dict, cat: str, dish_id: str, days_by_index: dict) -> Optional[int]:
    # Is deze maaltijd een restje van een eerdere dag (zelfde gerecht, één keer gekookt)? Dan de index van die dag
    src = (day.get("leftovers") or {}).get(cat)
    if src is None or src == day.get("index"):
        return None
    prev = days_by_index.get(src)
    if not prev or dish_id not in ((prev.get("meals") or {}).get(cat) or []):
        return None
    return src


def camp_access_filter(user_id: str) -> dict:
    return {
        "deleted_at": None,
        "$or": [{"owner_id": user_id}, {"member_ids": user_id}],
    }


class MemberInput(BaseModel):
    email: EmailStr


@api_router.get("/camps")
async def list_camps(user: dict = Depends(get_current_user)):
    cursor = db.camps.find(camp_access_filter(user["user_id"]), {"_id": 0}).sort("created_at", -1)
    docs = await cursor.to_list(1000)
    return {"camps": [camp_public(d) for d in docs]}


@api_router.post("/camps")
async def create_camp(data: CampCreate, user: dict = Depends(get_current_user)):
    camp_id = f"camp_{uuid.uuid4().hex[:12]}"
    doc = {
        "camp_id": camp_id,
        "owner_id": user["user_id"],
        "member_ids": [],
        "name": data.name.strip() or "Nieuw kamp",
        "days": _build_days(data.days),
        "vega_adults": max(0, data.vega_adults),
        "vega_children": max(0, data.vega_children),
        "general": [e.model_dump() for e in data.general],
        "budget_target": max(0, data.budget_target),
        "start_date": _iso_day(data.start_date),
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.camps.insert_one(doc)
    return camp_public(doc)


@api_router.get("/camps/{camp_id}")
async def get_camp(camp_id: str, user: dict = Depends(get_current_user)):
    doc = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    return camp_public(doc)


@api_router.put("/camps/{camp_id}")
async def update_camp(camp_id: str, data: CampUpdate, user: dict = Depends(get_current_user)):
    doc = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])})
    if not doc:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    update: dict = {}
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.days is not None:
        update["days"] = _build_days(data.days)
    if data.vega_adults is not None:
        update["vega_adults"] = max(0, data.vega_adults)
    if data.vega_children is not None:
        update["vega_children"] = max(0, data.vega_children)
    if data.start_date is not None:
        update["start_date"] = _iso_day(data.start_date)
    if data.general is not None:
        update["general"] = [e.model_dump() for e in data.general]
    if data.budget_target is not None:
        if "manage_budget" not in (await user_permissions(user)):
            raise HTTPException(status_code=403, detail="Alleen de penningmeester of beheerder kan het budget instellen")
        update["budget_target"] = max(0, data.budget_target)
    if update:
        await db.camps.update_one({"camp_id": camp_id}, {"$set": update})
    updated = await db.camps.find_one({"camp_id": camp_id}, {"_id": 0})
    return camp_public(updated)


class AutoMenuInput(BaseModel):
    categories: List[str] = ["avondeten"]
    exclude: List[str] = []  # gerechten die niet passen (bijv. allergieën, die kent alleen het apparaat)
    overwrite: bool = False
    days: Optional[List[int]] = None  # alleen deze dagen (index); leeg = alle dagen
    day_categories: Dict[int, List[str]] = {}  # per dag andere maaltijden (dag-index -> maaltijden); anders "categories"
    style: str = "mix"  # vertrouwd (wat je vaker eet), mix, nieuw (iets nieuws proberen)
    diet: str = ""  # leeg = alles; anders een of meer van vega, vegan, vlees, vis (met komma's)
    store: str = ""  # oud: één winkel (ah, jumbo, dirk)
    stores: List[str] = []  # recepten van deze winkels (ah, jumbo, dirk); leeg = alle winkels
    cook_twice: bool = True  # kleine groep: één keer koken voor twee dagen (lunch en avondeten), dan blijft er minder over
    cheap: bool = False  # goedkope gerechten eerst
    kind: str = "alles"  # oud: gewoon, recepten of alles
    kinds: List[str] = []  # app (gewone app-gerechten), recepten (van de winkels), eigen (zelf gemaakt); leeg = alles
    promos: bool = True  # gerechten met aanbiedingen eerst
    prefer: List[str] = []  # hier hebben we zin in (woorden in gerecht of ingrediënten)
    avoid: List[str] = []  # liever niet
    remember: bool = True


_MENU_PREF_KEYS = ("categories", "style", "diet", "store", "stores", "cook_twice", "cheap", "kinds", "promos", "prefer", "avoid")


@api_router.get("/menu-prefs")
async def get_menu_prefs(user: dict = Depends(get_current_user)):
    return user.get("menu_prefs") or {}


def _dish_cost(d: dict, by_pid: dict) -> Optional[float]:
    # Ongeveer wat het gerecht per volwassene kost (aandeel van de verpakking), voor "goedkoop eerst"
    total, found = 0.0, 0
    for i in d.get("ingredients") or []:
        p = by_pid.get(i.get("product_id") or "")
        if not p:
            continue
        price = resolve_price(p.get("prices") or {}, p.get("_src") or product_source(p) or DEFAULT_STORE, p.get("unavailable") or [])
        if price:
            total += price * _pack_share(i.get("unit") or "stuks", p.get("unit") or "", p.get("name") or "", p.get("pack_count")) * (i.get("qty_adult") or 1)
            found += 1
    return total if found else None


@api_router.post("/camps/{camp_id}/auto-menu")
async def auto_menu(camp_id: str, data: AutoMenuInput, user: dict = Depends(get_current_user)):
    # Premium: lege maaltijden vullen met gerechten die bij je passen: je voorkeuren, wat je eerder at, en aanbiedingen
    await require_premium(user)
    uid = user["user_id"]
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(uid)}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    day_cats = {int(k): [c for c in v if c in MEAL_CATEGORIES] for k, v in (data.day_categories or {}).items()}
    base_cats = [c for c in data.categories if c in MEAL_CATEGORIES]
    cats = [c for c in MEAL_CATEGORIES if c in base_cats or any(c in v for v in day_cats.values())]

    def cat_on(di, cat):
        # Deze maaltijd op deze dag invullen? Per dag gekozen, anders wat voor alle dagen geldt
        return cat in day_cats.get(di, base_cats)
    if not cats:
        raise HTTPException(status_code=400, detail="Kies minstens één maaltijd")
    if data.remember:
        prefs = {k: getattr(data, k) for k in _MENU_PREF_KEYS}
        await db.users.update_one({"user_id": uid}, {"$set": {"menu_prefs": prefs}})
    exclude = set(data.exclude[:2000])
    # Standaardgerechten, je eigen gerechten en de recepten (AH, Jumbo, Dirk) die je eerder in een lijstje zette
    dishes = await db.dishes.find({"deleted_at": None, "category": {"$in": cats}, "camp_id": None,
                                   "$or": [{"is_standard": True, "online": {"$ne": True}}, {"owner_id": uid}]}, {"_id": 0}).to_list(2000)
    seen_rec: set = set()
    pool_docs = []
    for d in dishes:
        rid = (d.get("source") or {}).get("recipe_id")
        if d["dish_id"] in exclude or not d.get("ingredients") or (rid and (rid, d["category"]) in seen_rec):
            continue
        if rid:
            seen_rec.add((rid, d["category"]))
        pool_docs.append(d)
    dishes = pool_docs

    def text_of(d):
        return _norm_text(d["name"] + " " + " ".join(i.get("name") or "" for i in d["ingredients"]))
    avoid = [w for w in (_norm_text(x) for x in data.avoid[:30]) if w]
    prefer = [w for w in (_norm_text(x) for x in data.prefer[:30]) if w]

    stores = [x for x in dict.fromkeys(data.stores or ([data.store] if data.store else [])) if x in _RECIPE_SOURCES]
    if len(stores) == len(_RECIPE_SOURCES):
        stores = []  # alle winkels aan
    kinds = {x for x in data.kinds if x in ("app", "recepten", "eigen")} or (
        {"app", "eigen"} if data.kind == "gewoon" else {"recepten", "eigen"} if data.kind == "recepten" else {"app", "recepten", "eigen"})

    def kind_of(d):
        return "app" if d.get("basic") else "recepten" if (d.get("source") or {}).get("store") else "eigen"

    # Voorkeuren (meerdere tegelijk mogelijk): een gerecht past als het bij minstens één ervan hoort
    picks = {x for x in (data.diet or "").split(",") if x in ("vega", "vegan", "vlees", "vis")}

    def fits_diet(d):
        names = [i.get("name") or "" for i in d["ingredients"]]
        main = d.get("category") in ("lunch", "avondeten")
        if not main and picks & {"vlees", "vis"}:
            return True  # met vlees of vis geldt voor lunch en avondeten; ontbijt en tussendoor blijven gewoon
        vega, vegan = _diet_of(names)[:2]
        if ("vega" in picks and vega) or ("vegan" in picks and vegan):
            return True
        meat = [_norm_text(n) for n in names if _is_meat({"name": n})]
        fish = [n for n in meat if _FISH_RE.search(n)]
        return bool(("vis" in picks and fish) or ("vlees" in picks and [n for n in meat if n not in fish]))

    def fits(d):
        # Gekozen winkels: geen recepten van een andere winkel (je eigen gerechten en de gewone gerechten wel)
        src = (d.get("source") or {}).get("store")
        if stores and src and src not in stores:
            return False
        # Soort gerechten: alleen gewone maaltijden, of juist de uitgebreide recepten van de winkels
        if kind_of(d) not in kinds:
            return False
        if avoid and any(w in text_of(d) for w in avoid):
            return False
        if picks and not fits_diet(d):
            return False
        return True
    dishes = [d for d in dishes if fits(d)]

    # Te weinig eigen gerechten voor de lege plekken (bijv. een nieuw account)? Vul aan met recepten van AH, Jumbo en Dirk
    days_all = camp.get("days", [])
    only_days = set(data.days) if data.days else None

    def replaced(idx, day, cat):
        # Wordt deze maaltijd nu (opnieuw) ingevuld?
        return cat_on(day.get("index", idx), cat) and (only_days is None or day.get("index", idx) in only_days) and (data.overwrite or not (day.get("meals") or {}).get(cat))
    # Wat blijft staan in dit lijstje: dat liever niet nog eens kiezen (wat we nu vervangen telt niet mee)
    keep = {did for idx, day in enumerate(days_all) for cat, ids in (day.get("meals") or {}).items()
            if not replaced(idx, day, cat) for did in ids}
    added_online = 0
    t_start = time.time()
    for cat in cats:
        slots = sum(1 for idx, day in enumerate(days_all) if replaced(idx, day, cat))
        # Elke dag iets anders: zoveel verschillende gerechten heb je nodig (bij "Iets nieuws" de helft nieuw)
        have = sum(1 for d in dishes if d["category"] == cat and d["dish_id"] not in keep)
        want = min(slots, MENU_MAX_DIFFERENT)
        need = want - have if data.style != "nieuw" else want - min(have, slots // 2)
        if need <= 0 or "recepten" not in kinds:
            continue
        if added_online >= MENU_ONLINE_MAX or time.time() - t_start > MENU_ONLINE_SECONDS:
            break
        found = []
        for st in stores or [""]:
            try:
                found += await _menu_recipes(cat, prefer, avoid, max(3, need * 3 // max(1, len(stores))), st)
            except Exception as e:
                logger.warning("Menu aanvullen met recepten: %r", e)
        random.shuffle(found)
        have_rec = {(d.get("source") or {}).get("recipe_id") for d in dishes}
        picks = [r for r in found if r["id"] not in have_rec][: need + 3]

        async def take(r, cat=cat):
            try:
                return await _recipe_to_dish(r["id"], cat, user, reuse=True, light=True)
            except Exception as e:
                logger.warning("Recept %s overnemen: %r", r.get("id"), e)
                return None
        # Eén voor één en met een grens: elk recept koppelen aan producten kost geheugen en tijd (anders loopt de server vol)
        got = 0
        for r in picks:
            if got >= need or added_online + got >= MENU_ONLINE_MAX or time.time() - t_start > MENU_ONLINE_SECONDS:
                break
            d = await take(r)
            if d and d.get("ingredients") and fits(d):
                dishes.append(d)
                got += 1
        added_online += got

    # Geschiedenis van het account: hoe vaak je een gerecht eerder op je lijstje had, en wat je de laatste twee weken at
    hist: Dict[str, int] = {}
    recent: set = set()
    two_weeks = (now_utc() - timedelta(days=14)).date().isoformat()
    async for c in db.camps.find({**camp_access_filter(uid), "camp_id": {"$ne": camp_id}}, {"_id": 0, "days.meals": 1, "start_date": 1}):
        is_recent = str(c.get("start_date") or "")[:10] >= two_weeks
        for day in c.get("days") or []:
            for ids in (day.get("meals") or {}).values():
                for did in ids:
                    hist[did] = hist.get(did, 0) + 1
                    if is_recent:
                        recent.add(did)
    # Smaak: woorden van recepten en gerechten die je bekijkt of kiest
    interest = {} if user.get("no_personal") else await db.user_interest.find_one({"user_id": uid}, {"_id": 0, "rwords": 1}) or {}
    rwords = interest.get("rwords") or {}
    rtop = max(list(rwords.values()) + [1])

    pids = list({i["product_id"] for d in dishes for i in d["ingredients"] if i.get("product_id")})
    on_promo = set()
    # Ga je later boodschappen doen? Dan tellen de aanbiedingen van die dag (ook uit de folder van volgende week)
    shop_day = _first_shop_day(camp)
    later = shop_day if shop_day and shop_day > _iso_day(now_utc().isoformat()) else None
    if data.promos:
        if later:
            await _folders_fresh(wait=False)
        async for p in db.products.find(_live({"product_id": {"$in": pids}}), {"_id": 0}):
            if (_promo_on_day(p, later) is not None) if later else (_hist_now(p)[1] is not None):
                on_promo.add(p["product_id"])
    costs: Dict[str, Optional[float]] = {}
    if data.cheap:
        await _global_products()
        by_pid = _product_cache.get("by_pid") or {}
        own_store = user.get("store") if user.get("store") in COMPARE_STORES else DEFAULT_STORE
        costs = {d["dish_id"]: _dish_cost(d, by_pid) or (d.get("price_pp") or {}).get(own_store) for d in dishes}
    known = [v for v in costs.values() if v]
    lo, hi = (min(known), max(known)) if known else (0, 1)

    def score(d):
        did = d["dish_id"]
        n = hist.get(did, 0)
        s = sum(1 for i in d["ingredients"] if i.get("product_id") in on_promo) * 0.6
        if data.style == "vertrouwd":
            s += 2 + min(n, 5) * 0.5 if n else 0
        elif data.style == "nieuw":
            s += 3 if not n else -min(n, 3)
            # Nieuw, maar wel naar je smaak
            s += min(1.5, sum(rwords.get(_ikey(w), 0) for w in re.findall(r"[a-z]{4,}", _norm_text(d["name"]))) / rtop * 1.5)
        else:
            s += 1 if n else 0.5
        if did in recent:
            s -= 1.5  # net nog gegeten: liever wat afwisseling
        if prefer and any(w in text_of(d) for w in prefer):
            s += 3
        if data.cheap and costs.get(did):
            s += 2.5 * (1 - (costs[did] - lo) / ((hi - lo) or 1))
        if data.cheap and d.get("basic"):
            s += 1  # gewone maaltijden (brood met beleg, stamppot) zijn meestal goedkoper dan uitgebreide recepten
        return s + random.random() * 0.9  # bij gelijke stand wat afwisseling

    used = set(keep)
    filled, promo_dishes, twice = 0, set(), 0
    days = camp.get("days", [])
    only = set(data.days) if data.days else None
    # Kleine groep (bijv. 1 of 2 personen): hele verpakkingen voor één portie geven veel over.
    # Dan liever gerechten met dezelfde producten, en lunch/avondeten één keer koken voor twee dagen.
    small = max((d.get("adults", 0) + d.get("children", 0) for d in days), default=0) <= 4
    chosen_pids = {i.get("product_id") for did in keep for d in dishes if d["dish_id"] == did for i in d["ingredients"] if i.get("product_id")}

    def overlap(d):
        return sum(1 for i in d["ingredients"] if i.get("product_id") in chosen_pids)
    for cat in cats:
        pool = sorted((d for d in dishes if d["category"] == cat), key=score, reverse=True)
        if not pool:
            continue
        k = 0
        prev = None  # (dag-index, gerecht) dat vandaag ook voor morgen gekookt kan worden
        for idx, day in enumerate(days):
            if (only is not None and day.get("index", idx) not in only) or not cat_on(day.get("index", idx), cat):
                continue
            meals = day.setdefault("meals", {})
            if meals.get(cat) and not data.overwrite:
                prev = None
                continue
            di = day.get("index", idx)
            left = day.setdefault("leftovers", {})
            left.pop(cat, None)
            if data.cook_twice and small and cat in ("lunch", "avondeten") and prev and prev[0] == di - 1:
                # Restje van gisteren: zelfde gerecht, niets extra kopen
                meals[cat] = [prev[1]["dish_id"]]
                left[cat] = prev[0]
                prev = None
                filled += 1
                twice += 1
                continue
            # Eerst wat nog niet in het lijstje staat, daarna pas herhalen (nooit één gerecht voor alle dagen als er meer zijn)
            unused = [d for d in pool if d["dish_id"] not in used]
            if unused:
                cand = unused[:6]
                pick = max(cand, key=lambda d: overlap(d) * 0.8 - cand.index(d) * 0.3) if small else cand[0]
            else:
                pick = pool[k % len(pool)]
                k += 1
            meals[cat] = [pick["dish_id"]]
            used.add(pick["dish_id"])
            chosen_pids.update(i.get("product_id") for i in pick["ingredients"] if i.get("product_id"))
            prev = (di, pick)
            filled += 1
            if any(i.get("product_id") in on_promo for i in pick["ingredients"]):
                promo_dishes.add(pick["name"])
    if filled:
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {"days": days}})
    updated = await db.camps.find_one({"camp_id": camp_id}, {"_id": 0})
    return {"camp": camp_public(updated), "filled": filled, "promo_dishes": sorted(promo_dishes), "pool": len(dishes), "added_online": added_online, "twice": twice}


MENU_MAX_DIFFERENT = 14  # zoveel verschillende gerechten per maaltijd; bij langere activiteiten komen ze na twee weken terug
MENU_ONLINE_MAX = 16  # zoveel nieuwe recepten per keer invullen; de rest vult de app met wat er al is (herhalen)
MENU_ONLINE_SECONDS = 45

_MENU_COURSE = {"ontbijt": "ontbijt", "lunch": "lunch", "avondeten": "hoofdgerecht", "snacks": "borrel"}


async def _menu_recipes(cat: str, prefer: list, avoid: list, n: int, store: str = "") -> list:
    # Recepten uit de winkels voor één soort maaltijd, passend bij wat je graag (niet) wilt; willekeurig voor afwisseling
    import json as _json
    course = _MENU_COURSE.get(cat, "hoofdgerecht")
    flt = {"gang": [course]}  # vega/vegan controleren we na het overnemen (ingrediënten)
    if store:
        # Eén winkel: het filter in de woorden van die winkel
        k, v = _COURSE_MAP[store].get(course, (None, None))
        flt = {k: [v]} if k else {}
    where = store or "all"
    out: list = []
    start = random.randint(0, 1)  # wat afwisseling, maar niet voorbij het einde van een kleine receptenlijst
    pages = [("", start + i) for i in range(max(2, min(5, n // 6 + 1)))]
    for q, page in ([(q, 0) for q in prefer[:3]] or pages):
        try:
            res = await _search_recipes(q, where, page, _json.dumps(flt))
        except HTTPException:
            continue
        out += res.get("recipes") or []
    if len(out) < n and (prefer or start):
        out += (await _search_recipes("", where, 0, _json.dumps(flt))).get("recipes") or []
    out = [r for r in out if r.get("id") and not any(w in _norm_text(r.get("title") or "") for w in avoid)]
    random.shuffle(out)
    seen, uniq = set(), []
    for r in out:
        if r["id"] not in seen:
            seen.add(r["id"])
            uniq.append(r)
    return uniq[:n]


@api_router.delete("/camps/{camp_id}")
async def delete_camp(camp_id: str, user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    doc = await db.camps.find_one({"camp_id": camp_id, "deleted_at": None, "$or": [{"owner_id": uid}, {"member_ids": uid}]})
    if not doc:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    if doc.get("owner_id") == uid:
        # Owner removes the whole camp
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {"deleted_at": now_utc()}})
        return {"ok": True, "left": False}
    # Member leaves the camp (removes it from their own list)
    await db.camps.update_one({"camp_id": camp_id}, {"$pull": {"member_ids": uid}, "$addToSet": {"left_ids": uid}})
    return {"ok": True, "left": True}


@api_router.post("/camps/{camp_id}/restore")
async def restore_camp(camp_id: str, user: dict = Depends(get_current_user)):
    uid = user["user_id"]
    doc = await db.camps.find_one({"camp_id": camp_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    if doc.get("owner_id") == uid:
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {"deleted_at": None}})
    elif uid in doc.get("left_ids", []):
        # Member re-joins the camp (undo leave); alleen wie zelf vertrok
        await db.camps.update_one({"camp_id": camp_id}, {"$addToSet": {"member_ids": uid}, "$pull": {"left_ids": uid}})
    else:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    restored = await db.camps.find_one({"camp_id": camp_id}, {"_id": 0})
    return camp_public(restored)


@api_router.post("/camps/{camp_id}/duplicate")
async def duplicate_camp(camp_id: str, user: dict = Depends(get_current_user)):
    src = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not src:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    new_id = f"camp_{uuid.uuid4().hex[:12]}"
    doc = {
        "camp_id": new_id,
        "owner_id": user["user_id"],
        "member_ids": [],
        "name": f"{src['name']} (kopie)",
        "days": src.get("days", []),
        "vega_adults": src.get("vega_adults", 0),
        "vega_children": src.get("vega_children", 0),
        "general": src.get("general", []),
        "budget_target": src.get("budget_target", 0),
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.camps.insert_one(doc)
    return camp_public(doc)


@api_router.get("/camps/{camp_id}/members")
async def get_members(camp_id: str, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    ids = [camp["owner_id"]] + camp.get("member_ids", [])
    users = await db.users.find({"user_id": {"$in": ids}, "deleted_at": None}, {"_id": 0}).to_list(1000)
    by_id = {u["user_id"]: u for u in users}
    result = []
    for uid in ids:
        u = by_id.get(uid)
        if not u:
            continue
        result.append({
            "id": uid,
            "name": u.get("name"),
            "email": u.get("email"),
            "is_owner": uid == camp["owner_id"],
        })
    return {"members": result, "owner_id": camp["owner_id"]}


@api_router.post("/camps/{camp_id}/members")
async def add_member(camp_id: str, data: MemberInput, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, "owner_id": user["user_id"], "deleted_at": None})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden of je bent geen eigenaar")
    email = data.email.lower().strip()
    target = await db.users.find_one({"email": email})
    if target and target.get("deleted_at"):
        raise HTTPException(status_code=400, detail="Dit account is verwijderd")
    if target:
        if target["user_id"] == camp["owner_id"]:
            raise HTTPException(status_code=400, detail="Jij bent al de eigenaar")
        await db.camps.update_one({"camp_id": camp_id}, {"$addToSet": {"member_ids": target["user_id"]}})
        return {"ok": True, "invited": False}

    # No account yet -> store invitation + send email with register link
    await db.invitations.update_one(
        {"email": email, "camp_id": camp_id},
        {"$setOnInsert": {
            "invite_id": f"inv_{uuid.uuid4().hex[:12]}",
            "email": email,
            "camp_id": camp_id,
            "inviter_name": user.get("name"),
            "accepted": False,
            "created_at": now_utc(),
        }},
        upsert=True,
    )
    link = FRONTEND_URL or "https://scoutkook.app"
    t = await _terms()
    html = (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
        f'<h2 style="color:#2E5E38;margin:0 0 12px">Uitnodiging voor Slim Boodschappenlijstje</h2>'
        f'<p>{escape(user.get("name") or "Een leider")} nodigt je uit om samen te plannen in {t["de"]} {escape(t["one"])} '
        f'<strong>{escape(camp["name"])}</strong>.</p>'
        f'<p>Maak een account aan met dit e-mailadres ({escape(email)}) en je wordt automatisch aan {t["de"]} {escape(t["one"])} toegevoegd.</p>'
        f'<p style="margin:20px 0"><a href="{escape(link)}" style="background:#2E5E38;color:#fff;'
        f'padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">Open Slim Boodschappenlijstje</a></p>'
        f'<p style="font-size:12px;color:#888">Verstuurd door Slim Boodschappenlijstje. We vragen nooit je wachtwoord via e-mail.</p>'
        '</td></tr></table>'
    )
    await send_email(email, f"Je bent uitgenodigd voor een {t['one']} in Slim Boodschappenlijstje", html)
    return {"ok": True, "invited": True}


@api_router.delete("/camps/{camp_id}/members/{member_id}")
async def remove_member(camp_id: str, member_id: str, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, "owner_id": user["user_id"], "deleted_at": None})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden of je bent geen eigenaar")
    await db.camps.update_one({"camp_id": camp_id}, {"$pull": {"member_ids": member_id, "left_ids": member_id}})
    return {"ok": True}


def round_qty(v: float) -> float:
    return round(v + 1e-9, 2)


def _group_items(item_map: dict) -> tuple:
    items = list(item_map.values())
    for it in items:
        it["qty"] = round_qty(it["qty"])
    items.sort(key=lambda x: (AISLES.index(x["aisle"]) if x["aisle"] in AISLES else 99, x["name"].lower()))
    by_aisle: Dict[str, list] = {}
    for it in items:
        by_aisle.setdefault(it["aisle"], []).append(it)
    grouped = [{"aisle": a, "items": by_aisle[a]} for a in AISLES if a in by_aisle]
    return items, grouped


def _add_item(store_map: dict, store: str, name: str, unit: str, aisle: str, qty: float, product_id: Optional[str] = None):
    if qty <= 0:
        return
    smap = store_map.setdefault(store, {})
    key = (name.lower(), unit)
    if key not in smap:
        smap[key] = {"name": name, "unit": unit, "aisle": aisle if aisle in AISLES else "Overig", "qty": 0, "product_id": product_id}
    smap[key]["qty"] += qty
    if product_id and not smap[key].get("product_id"):
        smap[key]["product_id"] = product_id


def _match_missing(blocks: list, docs: list, prods: dict) -> None:
    # Regels zonder product: zoek op naam in de winkel van die regel, en zet ze bij de goede afdeling in plaats van "Overig"
    pools: dict = {}
    found: dict = {}
    for b in blocks:
        moved = False
        for it in b["flat"]:
            if it.get("product_id") or _norm_text(it["name"]) in _ALWAYS_HOME:
                continue
            k = (b["store"], _norm_text(it["name"]))
            if k not in found:
                if b["store"] not in pools:
                    pools[b["store"]] = [d for d in docs if d.get("_src") == b["store"] and d.get("is_global")]
                found[k] = _cheapest_good(pools[b["store"]], it["name"], b["store"]) if pools[b["store"]] else None
            d = found[k]
            if not d:
                continue
            prods.setdefault(d["product_id"], _clean(d))
            it["product_id"] = d["product_id"]
            it["matched"] = True  # door de app gekozen: je kunt het zelf nog wisselen
            if it.get("aisle") == "Overig" and d.get("aisle") in AISLES and d["aisle"] != "Overig":
                it["aisle"] = d["aisle"]
                moved = True
        if moved:
            by_aisle: Dict[str, list] = {}
            for it in sorted(b["flat"], key=lambda x: (AISLES.index(x["aisle"]) if x["aisle"] in AISLES else 99, x["name"].lower())):
                by_aisle.setdefault(it["aisle"], []).append(it)
            b["grouped"] = [{"aisle": a, "items": by_aisle[a]} for a in AISLES if a in by_aisle]


async def _basic_dish_info_loop() -> None:
    # App-gerechten: een foto (van het belangrijkste product) en ongeveer wat het per volwassene kost bij elke winkel.
    # Eén keer na het opstarten en daarna elke dag, één gerecht tegelijk zodat de server er niet traag van wordt.
    await asyncio.sleep(120)
    while True:
        try:
            docs = await _global_products()
            pools = {st: [d for d in docs if d.get("_src") == st and d.get("is_global")] for st in COMPARE_STORES}
            found: dict = {}
            async for dish in db.dishes.find({"basic": True, "deleted_at": None}, {"_id": 0}):
                info = await asyncio.to_thread(_basic_dish_info, dish, pools, found)
                await db.dishes.update_one({"dish_id": dish["dish_id"]}, {"$set": info})
            logger.info("App-gerechten: foto's en prijzen bijgewerkt")
        except Exception as e:
            logger.warning("App-gerechten bijwerken: %r", e)
        await asyncio.sleep(24 * 3600)


def _basic_dish_info(dish: dict, pools: dict, found: dict) -> dict:
    ings = dish.get("ingredients") or []
    # Het belangrijkste product staat in de naam: "Boterham met hagelslag" -> hagelslag
    title = set(re.findall(r"[a-z]{4,}", _norm_text(dish["name"])))
    hero = next((i for i in ings if title & set(re.findall(r"[a-z]{4,}", _norm_text(i["name"])))), ings[0] if ings else None)
    out: dict = {"price_pp": {}}
    for st, pool in pools.items():
        total, ok = 0.0, 0
        for i in ings:
            k = (st, i["name"])
            if k not in found:
                found[k] = _cheapest_good(pool, i["name"], st) if pool else None
            p = found[k]
            price = resolve_price(p.get("prices") or {}, st, p.get("unavailable") or []) if p else 0
            if price:
                total += price * _pack_share(i.get("unit") or "stuks", p.get("unit") or "", p.get("name") or "", p.get("pack_count")) * (i.get("qty_adult") or 1)
                ok += 1
            if i is hero and p and p.get("image") and not out.get("image") and st == "Albert Heijn":
                out["image"] = p["image"]
        if ok:
            out["price_pp"][st] = round(total, 2)
    if hero and not out.get("image"):
        for st in COMPARE_STORES:
            p = found.get((st, hero["name"]))
            if p and p.get("image"):
                out["image"] = p["image"]
                break
    return out


def _item_grams(qty: float, unit: str, p: dict) -> Optional[float]:
    # Hoeveelheid in gram of ml, zodat 0,38 kg en 1 stuk aardappel samen op één regel kunnen
    u = (unit or "").lower().strip()
    if u in _MEASURE:
        return qty * _MEASURE[u]
    if u in ("", "stuks", "stuk", "st") and not _pack_count(p.get("unit") or "") and not p.get("pack_count"):
        piece = _piece_grams(p.get("name") or "")
        return qty * piece if piece else None
    return None


def _merge_same_product(block: dict, prods: dict) -> dict:
    # Hetzelfde product op meerdere regels (gram en eetlepel, stuks en takje): één regel, en één keer de verpakkingen tellen
    first: dict = {}
    for it in block["flat"]:
        if it.get("product_id") in prods:
            first.setdefault(it["product_id"], []).append(it)
    need, gone = {}, set()
    for pid, its in first.items():
        if len(its) < 2:
            continue
        p = prods[pid]
        keep = its[0]
        grams = [_item_grams(i["qty"], i["unit"], p) for i in its]
        if all(g is not None for g in grams):
            keep["qty"], keep["unit"] = round_qty(sum(grams)), "gram"
        else:
            need[id(keep)] = sum(i["qty"] * _pack_share(i["unit"], p.get("unit") or "", p.get("name") or "", p.get("pack_count")) for i in its)
            keep["unit"] = " + ".join([keep["unit"]] + [f"{_fmt_qty(i['qty'])} {i['unit']}" for i in its[1:]])
        keep["also"] = [i["name"] for i in its[1:] if i["name"].lower() != keep["name"].lower()]
        gone.update(id(i) for i in its[1:])
    if gone:
        block["flat"] = [i for i in block["flat"] if id(i) not in gone]
        for g in block.get("grouped") or []:
            g["items"] = [i for i in g["items"] if id(i) not in gone]
        block["grouped"] = [g for g in block.get("grouped") or [] if g["items"]]
    return need


def _fmt_qty(v: float) -> str:
    return f"{round_qty(v):g}".replace(".", ",")


def _diet_counts(day: dict, camp: dict) -> dict:
    adults = day.get("adults", 0)
    children = day.get("children", 0)
    va = min(camp.get("vega_adults", 0) or 0, adults)
    vc = min(camp.get("vega_children", 0) or 0, children)
    return {"all": (adults, children), "vega": (va, vc), "meat": (adults - va, children - vc)}


class ProductSwap(BaseModel):
    from_id: str
    to_id: str


@api_router.post("/camps/{camp_id}/product-swap")
async def camp_product_swap(camp_id: str, data: ProductSwap, user: dict = Depends(get_current_user)):
    # Op de boodschappenlijst een ander product kiezen, alleen voor dit kamp
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0, "product_swaps": 1})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    if not await db.products.find_one({"product_id": data.to_id, "deleted_at": None}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    # Al eens gewisseld? Dan vervangt het nieuwe product het oorspronkelijke
    old = camp.get("product_swaps") or {}
    origin = next((k for k, v in old.items() if v == data.from_id), data.from_id)
    swaps = {**old, origin: data.to_id}
    await db.camps.update_one({"camp_id": camp_id}, {"$set": {"product_swaps": swaps}})
    return {"ok": True}


# --- Samen afvinken: wat iemand in de winkel afvinkt, zien de anderen op hun lijst meteen ook ---
class CheckedInput(BaseModel):
    on: List[str] = []
    off: List[str] = []


def _check_hash(k: str) -> str:
    import hashlib
    return hashlib.sha1(k.encode()).hexdigest()[:16]


@api_router.get("/camps/{camp_id}/checked")
async def get_checked(camp_id: str, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0, "checked": 1, "member_ids": 1})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    items = list((camp.get("checked") or {}).values())
    return {"keys": [x["k"] for x in items],
            "by": {x["k"]: x.get("by") for x in items if x.get("uid") != user["user_id"] and x.get("by")},
            "shared": bool(camp.get("member_ids"))}


@api_router.post("/camps/{camp_id}/checked")
async def set_checked(camp_id: str, data: CheckedInput, user: dict = Depends(get_current_user)):
    if not await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    name = (user.get("name") or "").split(" ")[0] or None
    sets = {f"checked.{_check_hash(k)}": {"k": k[:300], "uid": user["user_id"], "by": name, "at": now_utc()} for k in data.on[:500]}
    unsets = {f"checked.{_check_hash(k)}": "" for k in data.off[:500] if k not in data.on}
    upd = {**({"$set": sets} if sets else {}), **({"$unset": unsets} if unsets else {})}
    if upd:
        await db.camps.update_one({"camp_id": camp_id}, upd)
    return {"ok": True}


@api_router.get("/camps/{camp_id}/shopping-list")
async def shopping_list(camp_id: str, user: dict = Depends(get_current_user), _for_compare: bool = False):
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")

    active = await get_active_stores()
    primary_store = user.get("store", DEFAULT_STORE)
    if primary_store not in active:
        primary_store = active[0]

    # Gekozen bij "Waar is je lijst het goedkoopst?": alles bij één winkel (niet voor de vergelijking zelf)
    shop_store = None if _for_compare else camp.get("shop_store")
    split_stores = [x for x in camp.get("split_stores") or [] if x in active] if shop_store == "split" else []
    item_stores = (camp.get("item_stores") or {}) if split_stores else {}
    if shop_store and shop_store not in active and not split_stores:
        shop_store = None

    def store_of(item: dict) -> str:
        # Gesplitst: elk product bij de winkel waar het het goedkoopst is
        if split_stores:
            st = item_stores.get(_ikey(_norm_text(item.get("name") or "")))
            if st in split_stores:
                return st
        elif shop_store:
            return shop_store
        st = item.get("store")
        return st if st in active else primary_store

    dish_ids = set()
    for day in camp.get("days", []):
        for cat in MEAL_CATEGORIES:
            for did in day.get("meals", {}).get(cat, []):
                dish_ids.add(did)
    dish_docs = await db.dishes.find({"dish_id": {"$in": list(dish_ids)}}, {"_id": 0}).to_list(1000)
    dishes_by_id = {d["dish_id"]: d for d in dish_docs}

    total_store_map: Dict[str, dict] = {}
    per_day = []
    day_maps: Dict[int, dict] = {}
    days_by_index = {d.get("index"): d for d in camp.get("days", [])}

    for day in camp.get("days", []):
        if not day.get("is_shopping_day"):
            continue
        counts = _diet_counts(day, camp)
        day_store_map = day_maps.setdefault(day["index"], {})
        for cat in MEAL_CATEGORIES:
            for did in day.get("meals", {}).get(cat, []):
                dish = dishes_by_id.get(did)
                if not dish:
                    continue
                # Restje van een eerdere dag (één keer koken voor twee dagen): inkopen op die eerdere dag
                tgt_day = _leftover_from(day, cat, did, days_by_index)
                tgt_map = day_maps.get(tgt_day, day_store_map) if tgt_day is not None else day_store_map
                for ing in dish.get("ingredients", []):
                    a, c = counts.get(_ing_diet(ing), counts["all"])
                    qty = ing.get("qty_adult", 0) * a + ing.get("qty_child", 0) * c
                    store = store_of(ing)
                    for tgt in (total_store_map, tgt_map):
                        _add_item(tgt, store, ing["name"], ing.get("unit", "stuks"), ing.get("aisle", "Overig"), qty, ing.get("product_id"))
        for ex in day.get("extras", []):
            store = store_of(ex)
            for tgt in (total_store_map, day_store_map):
                _add_item(tgt, store, ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), ex.get("qty", 0), ex.get("product_id"))
    for day in camp.get("days", []):
        if day.get("index") not in day_maps:
            continue
        day_store_map = day_maps[day["index"]]
        day_by_store = []
        for store in sorted(day_store_map.keys()):
            flat, grouped = _group_items(day_store_map[store])
            day_by_store.append({"store": store, "grouped": grouped, "flat": flat})
        per_day.append({
            "index": day["index"],
            "adults": day.get("adults", 0),
            "children": day.get("children", 0),
            "by_store": day_by_store,
        })

    # General ("Algemeen") sheet – loose items for the whole camp
    general_store_map: Dict[str, dict] = {}
    for ex in camp.get("general", []):
        store = store_of(ex)
        for tgt in (total_store_map, general_store_map):
            _add_item(tgt, store, ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), ex.get("qty", 0), ex.get("product_id"))

    def pack(store_map: dict) -> list:
        out = []
        for store in sorted(store_map.keys()):
            flat, grouped = _group_items(store_map[store])
            out.append({"store": store, "grouped": grouped, "flat": flat})
        return out

    by_store = pack(total_store_map)
    general = pack(general_store_map)
    stores = sorted(total_store_map.keys())

    # Prijzen: hoeveel verpakkingen je nodig hebt en wat dat kost (150 gram uit een pak van 500 gram = 1 pak)
    # Zelf gewisseld naar een ander product (bijv. een voordeligere verpakking): alleen voor dit kamp
    swaps = camp.get("product_swaps") or {}
    store_products = (camp.get("store_products") or {}) if shop_store else {}
    for b in by_store + general + [x for d in per_day for x in d["by_store"]]:
        for it in b["flat"]:
            it["orig_product_id"] = it.get("product_id")
            if store_products.get(_ikey(_norm_text(it["name"]))):
                it["product_id"] = store_products[_ikey(_norm_text(it["name"]))]
            if it.get("product_id") in swaps:
                it["product_id"] = swaps[it["product_id"]]
    pids = {it.get("product_id") for b in by_store + general + [x for d in per_day for x in d["by_store"]] for it in b["flat"] if it.get("product_id")}
    prods = {p["product_id"]: p for p in await db.products.find(_live({"product_id": {"$in": list(pids)}}), {"_id": 0}).to_list(5000)} if pids else {}
    # Ingrediënten zonder product (bijv. uit een recept van een andere winkel): zelf het best passende product zoeken
    if any(not it.get("product_id") for b in by_store + general for it in b["flat"]):
        docs = await _global_products()
        await asyncio.to_thread(_match_missing, by_store + general + [x for d in per_day for x in d["by_store"]], docs, prods)
    piece_ids = {it.get("product_id") for b in by_store + general for it in b["flat"] if (it.get("unit") or "").lower().strip() in ("", "stuks", "stuk", "st")}
    await _learn_pack_counts([prods[x] for x in piece_ids if x in prods], 4)

    def priced(blocks: list) -> None:
        for b in blocks:
            total = 0.0
            saving = 0.0
            need = _merge_same_product(b, prods)
            for it in b["flat"]:
                p = prods.get(it.get("product_id") or "")
                price = resolve_price(p.get("prices", {}), b["store"], p.get("unavailable", [])) if p else 0
                if price > 0:
                    plan = _pack_plan(p, it["qty"], it["unit"], b["store"], need.get(id(it))) or {}
                    packs = plan.get("packs") or 1
                    it.update({"packs": packs, "pack_unit": p.get("unit") or "", "price": round(packs * price, 2), "pack_price": price,
                               "product": p.get("name"), "image": p.get("image"), "better": plan.get("better")})
                    total += packs * price
                    # Korting door een aanbieding: normale prijs min wat je nu betaalt
                    off = _promo_saving(p, price, packs)
                    if off > 0:
                        it["saving"] = off
                        saving += off
            b["total"] = round(total, 2)
            b["saving"] = round(saving, 2)
    await _global_products()  # voor voorstellen van een grotere verpakking

    def price_all():
        priced(by_store)
        priced(general)
        for d in per_day:
            priced(d["by_store"])
    await asyncio.to_thread(price_all)
    # Voor het bespaaroverzicht: per lijst onthouden wat de aanbiedingen schelen
    sv = {"promo": round(sum(b.get("saving") or 0 for b in by_store), 2), "total": round(sum(b.get("total") or 0 for b in by_store), 2)}
    old = camp.get("savings") or {}
    if (old.get("promo"), old.get("total")) != (sv["promo"], sv["total"]):
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {"savings": {**sv, "at": now_utc()}}})
    # Premium: wat je al in je voorraadkast hebt, zetten we erbij
    has_pantry = False
    if user.get("premium"):
        pantry = await _pantry_index(user["user_id"])
        if pantry:
            for b in by_store + general + [x for d in per_day for x in d["by_store"]]:
                for it in b["flat"]:
                    have = _pantry_have(pantry, it["name"], it.get("unit") or "")
                    if have:
                        it["in_pantry"] = round(have, 2)
                        has_pantry = True
    # Premium: ga je later boodschappen doen (bijv. volgende week)? Dan zie je welke producten op die dag in de aanbieding zijn
    shop_day, promo_then = _first_shop_day(camp), 0
    if user.get("premium") and shop_day and shop_day > _iso_day(now_utc().isoformat()):
        await _folders_fresh(wait=False)
        for b in by_store:
            for it in b["flat"]:
                p = prods.get(it.get("product_id") or "")
                then = _promo_on_day(p, shop_day) if p else None
                if then and (_promo_public(p, it.get("pack_price") or 0)[0] or {}).get("label") != then["label"]:
                    it["promo_then"] = then
                    promo_then += 1
    return {
        "by_store": by_store,
        "general": general,
        "per_day": per_day,
        "stores": stores,
        "multi_store": len(stores) > 1,
        "has_pantry": has_pantry,
        "shop_day": shop_day,
        "promo_then": promo_then,
        "shop_store": shop_store,
        "split_stores": split_stores,
    }


# ---------------------------------------------------------------------------
# Voorraadkast (Premium): wat je al in huis hebt
# ---------------------------------------------------------------------------
_UNIT_BASE = {"g": ("g", 1), "gr": ("g", 1), "gram": ("g", 1), "kg": ("g", 1000), "kilo": ("g", 1000),
              "ml": ("ml", 1), "cl": ("ml", 10), "dl": ("ml", 100), "l": ("ml", 1000), "liter": ("ml", 1000),
              "st": ("stuks", 1), "stuk": ("stuks", 1), "stuks": ("stuks", 1), "": ("stuks", 1)}


def _unit_base(unit: str):
    u = (unit or "").lower().strip().rstrip(".")
    return _UNIT_BASE.get(u, (u, 1))


async def _pantry_index(user_id: str) -> dict:
    out: dict = {}
    async for p in db.pantry.find({"user_id": user_id}, {"_id": 0}):
        base, f = _unit_base(p.get("unit") or "")
        k = (_norm_text(p.get("name") or ""), base)
        out[k] = out.get(k, 0) + float(p.get("qty") or 0) * f
    return out


def _pantry_have(index: dict, name: str, unit: str) -> float:
    # Hoeveel van dit product je in huis hebt, in de eenheid van de boodschappenlijst
    base, f = _unit_base(unit)
    have = index.get((_norm_text(name), base), 0)
    return have / f if have > 0 else 0


async def require_premium(user: dict):
    if not user.get("premium"):
        raise HTTPException(status_code=403, detail="Dit is een Premium-functie")


class PantryInput(BaseModel):
    name: str
    qty: float = 1
    unit: str = "stuks"


def _pantry_public(p: dict) -> dict:
    return {"id": p["item_id"], "name": p["name"], "qty": p.get("qty", 0), "unit": p.get("unit") or "stuks", "updated_at": p.get("updated_at")}


@api_router.get("/pantry")
async def list_pantry(user: dict = Depends(get_current_user)):
    await require_premium(user)
    items = await db.pantry.find({"user_id": user["user_id"]}, {"_id": 0}).sort("name_l", 1).to_list(1000)
    return {"items": [_pantry_public(p) for p in items]}


def _pantry_clean(data: PantryInput) -> dict:
    name = (data.name or "").strip()[:80]
    if not name:
        raise HTTPException(status_code=400, detail="Vul een productnaam in")
    qty = max(0.0, min(float(data.qty or 0), 100000))
    return {"name": name, "name_l": name.lower(), "qty": round(qty, 2), "unit": (data.unit or "stuks").strip()[:20], "updated_at": now_utc()}


@api_router.post("/pantry")
async def add_pantry(data: PantryInput, user: dict = Depends(get_current_user)):
    await require_premium(user)
    clean = _pantry_clean(data)
    same = await db.pantry.find_one({"user_id": user["user_id"], "name_l": clean["name_l"], "unit": clean["unit"]})
    if same:
        # Zelfde product en eenheid: optellen in plaats van een tweede regel
        clean["qty"] = round(float(same.get("qty") or 0) + clean["qty"], 2)
        clean["name"] = same["name"]
        await db.pantry.update_one({"item_id": same["item_id"]}, {"$set": clean})
        return {"item": _pantry_public({**same, **clean})}
    if await db.pantry.count_documents({"user_id": user["user_id"]}) >= 500:
        raise HTTPException(status_code=400, detail="Je voorraadkast is vol (maximaal 500 producten)")
    doc = {"item_id": f"pan_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"], **clean}
    await db.pantry.insert_one(doc)
    return {"item": _pantry_public(doc)}


@api_router.put("/pantry/{item_id}")
async def update_pantry(item_id: str, data: PantryInput, user: dict = Depends(get_current_user)):
    await require_premium(user)
    clean = _pantry_clean(data)
    res = await db.pantry.update_one({"item_id": item_id, "user_id": user["user_id"]}, {"$set": clean})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail="Niet gevonden")
    return {"ok": True}


@api_router.delete("/pantry/{item_id}")
async def delete_pantry(item_id: str, user: dict = Depends(get_current_user)):
    await require_premium(user)
    await db.pantry.delete_one({"item_id": item_id, "user_id": user["user_id"]})
    return {"ok": True}


def _promo_saving(p: dict, price: float, packs: int) -> float:
    # Wat een aanbieding je op dit aantal verpakkingen scheelt (lagere prijs, of bijv. 1+1 gratis als je er genoeg koopt)
    now_p, _ = _promo_public(p, price)
    if not now_p:
        return 0.0
    regular = float(now_p.get("regular") or 0)
    pay = min(price, float(now_p.get("price") or price))
    if regular > pay:
        return round(packs * (regular - pay), 2)
    deal = now_p.get("deal") or {}
    n = int(deal.get("count") or 0)
    if n > 1 and packs >= n and deal.get("total"):
        return round(max(0.0, (packs // n) * (n * price - float(deal["total"]))), 2)
    if n == 1 and deal.get("total") and float(deal["total"]) < price:
        return round(packs * (price - float(deal["total"])), 2)
    return 0.0


@api_router.get("/savings")
async def savings_overview(user: dict = Depends(get_current_user)):
    await require_premium(user)
    camps = await db.camps.find(camp_access_filter(user["user_id"]), {"_id": 0, "camp_id": 1, "name": 1, "start_date": 1, "created_at": 1, "savings": 1}).to_list(500)
    months: Dict[str, dict] = {}
    for c in camps:
        sv = c.get("savings") or {}
        if not sv.get("total"):
            continue
        when = c.get("start_date") or (c.get("created_at").isoformat() if isinstance(c.get("created_at"), datetime) else str(c.get("created_at") or ""))
        m = (when or "")[:7]
        if not m:
            continue
        row = months.setdefault(m, {"month": m, "saving": 0.0, "total": 0.0, "lists": []})
        row["saving"] += sv.get("promo") or 0
        row["total"] += sv.get("total") or 0
        row["lists"].append({"id": c["camp_id"], "name": c.get("name"), "saving": sv.get("promo") or 0, "total": sv.get("total") or 0})
    out = sorted(months.values(), key=lambda r: r["month"], reverse=True)[:12]
    for r in out:
        r["saving"] = round(r["saving"], 2)
        r["total"] = round(r["total"], 2)
    return {"months": out, "saving": round(sum(r["saving"] for r in out), 2), "total": round(sum(r["total"] for r in out), 2)}


@api_router.get("/camps/{camp_id}/budget")
async def camp_budget(camp_id: str, user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    if "view_budget" not in perms:
        raise HTTPException(status_code=403, detail="Je hebt geen rechten voor het budget")
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")

    dish_ids = set()
    for day in camp.get("days", []):
        for cat in MEAL_CATEGORIES:
            for did in day.get("meals", {}).get(cat, []):
                dish_ids.add(did)
    dish_docs = await db.dishes.find({"dish_id": {"$in": list(dish_ids)}}, {"_id": 0}).to_list(1000)
    dishes_by_id = {d["dish_id"]: d for d in dish_docs}

    active = await get_active_stores()
    primary_store = user.get("store", DEFAULT_STORE)
    if primary_store not in active:
        primary_store = active[0]

    def store_of(item: dict) -> str:
        st = item.get("store")
        return st if st in active else primary_store

    prod_ids = set()
    for d in dish_docs:
        for ing in d.get("ingredients", []):
            if ing.get("product_id"):
                prod_ids.add(ing["product_id"])
    for day in camp.get("days", []):
        for ex in day.get("extras", []):
            if ex.get("product_id"):
                prod_ids.add(ex["product_id"])
    for ex in camp.get("general", []):
        if ex.get("product_id"):
            prod_ids.add(ex["product_id"])
    prod_docs = await db.products.find(_live({"product_id": {"$in": list(prod_ids)}}), {"_id": 0}).to_list(5000)
    products_by_id = {p["product_id"]: p for p in prod_docs}

    swaps = camp.get("product_swaps") or {}
    extra_ids = [v for v in swaps.values() if v not in products_by_id]
    if extra_ids:
        products_by_id.update({p["product_id"]: p for p in await db.products.find(_live({"product_id": {"$in": extra_ids}}), {"_id": 0}).to_list(500)})

    def unit_price(item: dict, store: str) -> float:
        # Prijs per eenheid van het ingrediënt: 150 gram van een pak van 500 gram is 0,3 pak, niet 150 pakken
        pid = item.get("product_id")
        pid = swaps.get(pid, pid)
        p = products_by_id.get(pid) if pid else None
        price = resolve_price(p.get("prices", {}), store, p.get("unavailable", [])) if p else (item.get("price", 0) or 0)
        return price * _pack_share(item.get("unit") or "stuks", (p or {}).get("unit") or "", (p or {}).get("name") or item.get("name") or "", (p or {}).get("pack_count"))

    total_cost = 0.0
    total_person_days = 0
    per_day = []
    aisle_cost: Dict[str, float] = {}
    store_cost: Dict[str, float] = {}
    items_map: Dict[tuple, dict] = {}

    def record(name, unit, aisle, store, qty, cost):
        nonlocal total_cost
        if cost <= 0 and qty <= 0:
            return
        total_cost += cost
        aisle_cost[aisle] = aisle_cost.get(aisle, 0) + cost
        store_cost[store] = store_cost.get(store, 0) + cost
        key = (store, name.lower(), unit)
        if key not in items_map:
            items_map[key] = {"name": name, "unit": unit, "qty": 0, "cost": 0, "aisle": aisle, "store": store}
        items_map[key]["qty"] += qty
        items_map[key]["cost"] += cost

    for day in camp.get("days", []):
        if not day.get("is_shopping_day"):
            continue
        counts = _diet_counts(day, camp)
        day_cost = 0.0
        for cat in MEAL_CATEGORIES:
            for did in day.get("meals", {}).get(cat, []):
                dish = dishes_by_id.get(did)
                if not dish:
                    continue
                for ing in dish.get("ingredients", []):
                    a, c = counts.get(_ing_diet(ing), counts["all"])
                    qty = ing.get("qty_adult", 0) * a + ing.get("qty_child", 0) * c
                    store = store_of(ing)
                    cost = qty * unit_price(ing, store)
                    day_cost += cost
                    record(ing["name"], ing.get("unit", "stuks"), ing.get("aisle", "Overig"), store, qty, cost)
        for ex in day.get("extras", []):
            qty = ex.get("qty", 0)
            store = store_of(ex)
            cost = qty * unit_price(ex, store)
            day_cost += cost
            record(ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), store, qty, cost)
        people = day.get("adults", 0) + day.get("children", 0)
        total_person_days += people
        per_day.append({
            "index": day["index"],
            "cost": round_qty(day_cost),
            "people": people,
            "per_person": round_qty(day_cost / people) if people else 0,
        })

    for ex in camp.get("general", []):
        qty = ex.get("qty", 0)
        store = store_of(ex)
        cost = qty * unit_price(ex, store)
        record(ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), store, qty, cost)

    items = sorted(items_map.values(), key=lambda x: (x["store"], x["aisle"], x["name"].lower()))
    for it in items:
        it["qty"] = round_qty(it["qty"])
        it["cost"] = round_qty(it["cost"])
    per_aisle = [{"aisle": a, "cost": round_qty(aisle_cost[a])} for a in AISLES if a in aisle_cost]
    per_store = [{"store": s, "cost": round_qty(store_cost[s])} for s in sorted(store_cost.keys())]
    has_prices = any(it["cost"] > 0 for it in items)
    target = camp.get("budget_target", 0) or 0
    total_cost = round_qty(total_cost)
    return {
        "total_cost": total_cost,
        "budget_target": round_qty(target),
        "remaining": round_qty(target - total_cost) if target else 0,
        "over_budget": bool(target and total_cost > target),
        "pct_used": round(min(total_cost / target, 9.99) * 100) if target else 0,
        "per_person_per_day": round_qty(total_cost / total_person_days) if total_person_days else 0,
        "per_day": per_day,
        "per_aisle": per_aisle,
        "per_store": per_store,
        "items": items,
        "has_prices": has_prices,
        "store": primary_store,
        "multi_store": len(per_store) > 1,
        "currency": "EUR",
    }


# ---------------------------------------------------------------------------
# Roles, users & submissions (admin)
# ---------------------------------------------------------------------------
class RoleInput(BaseModel):
    name: str
    label: str
    permissions: List[str] = []


class RoleUpdate(BaseModel):
    label: Optional[str] = None
    permissions: Optional[List[str]] = None


class SetRoleInput(BaseModel):
    role: str


def role_public(doc: dict) -> dict:
    return {
        "name": doc["name"],
        "label": doc.get("label", doc["name"]),
        "permissions": doc.get("permissions", []),
        "is_system": doc["name"] == "beheerder",
    }


@api_router.get("/roles")
async def list_roles(user: dict = Depends(get_current_user)):
    docs = await db.roles.find({}, {"_id": 0}).to_list(1000)
    return {"roles": [role_public(d) for d in docs], "all_permissions": ALL_PERMISSIONS}


@api_router.post("/admin/roles")
async def create_role(data: RoleInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_roles")
    name = data.name.strip().lower().replace(" ", "_")
    if not name:
        raise HTTPException(status_code=400, detail="Naam is verplicht")
    if await db.roles.find_one({"name": name}):
        raise HTTPException(status_code=400, detail="Deze rol bestaat al")
    perms = [p for p in data.permissions if p in ALL_PERMISSIONS]
    doc = {"name": name, "label": data.label.strip() or name, "permissions": perms, "is_system": False}
    await db.roles.insert_one(doc)
    return role_public(doc)


@api_router.put("/admin/roles/{name}")
async def update_role(name: str, data: RoleUpdate, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_roles")
    doc = await db.roles.find_one({"name": name})
    if not doc:
        raise HTTPException(status_code=404, detail="Rol niet gevonden")
    if name == "beheerder":
        raise HTTPException(status_code=400, detail="De Beheerder-rol kan niet worden aangepast")
    update: dict = {}
    if data.label is not None:
        update["label"] = data.label.strip()
    if data.permissions is not None:
        update["permissions"] = [p for p in data.permissions if p in ALL_PERMISSIONS]
    if update:
        await db.roles.update_one({"name": name}, {"$set": update})
    updated = await db.roles.find_one({"name": name}, {"_id": 0})
    return role_public(updated)


@api_router.delete("/admin/roles/{name}")
async def delete_role(name: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_roles")
    doc = await db.roles.find_one({"name": name})
    if not doc:
        raise HTTPException(status_code=404, detail="Rol niet gevonden")
    if name == "beheerder":
        raise HTTPException(status_code=400, detail="De Beheerder-rol kan niet worden verwijderd")
    fallback = await default_role(exclude=name)
    await db.users.update_many({"role": name}, {"$set": {"role": fallback}})
    await db.roles.delete_one({"name": name})
    return {"ok": True}


def guard_target(actor: dict, target: dict, new_role: Optional[str] = None) -> None:
    # Medebeheerders mogen veel, maar niet aan beheerders komen of iemand beheerder maken
    if actor.get("role") == "beheerder":
        return
    if target.get("role") == "beheerder" or new_role == "beheerder":
        raise HTTPException(status_code=403, detail="Alleen de beheerder kan dit")


class PremiumInput(BaseModel):
    premium: bool


@api_router.put("/admin/users/{target_id}/premium")
async def admin_set_premium(target_id: str, data: PremiumInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    target = await db.users.find_one({"user_id": target_id, "deleted_at": None})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    await _set_premium(target, data.premium, user["user_id"])
    return {"ok": True, "premium": data.premium}


async def _set_premium(target: dict, premium: bool, by_user_id: str, org: Optional[str] = None):
    newly = premium and not target.get("premium")
    # Net premium geworden: bij de volgende keer openen een felicitatie in de app, en een mail
    update = {
        "premium": premium, "premium_by": by_user_id, "premium_at": now_utc(),
        "premium_welcome": bool(newly) or (target.get("premium_welcome", False) and premium),
    }
    if org:
        update["premium_org"] = org
    # Door de beheerder aan of uit gezet: geen einddatum (meer) van een verdiende maand
    await db.users.update_one({"user_id": target["user_id"]}, {"$set": update, "$unset": {"premium_until": ""}})
    if newly and not org and target.get("referred_by") and not target.get("referral_rewarded"):
        asyncio.ensure_future(_referral_reward(target))
    if not premium and target.get("premium_bank", 0) > 0:
        # Eigen Premium gestopt, maar nog verdiende maanden op het tegoed: die gaan nu in
        await db.users.update_one({"user_id": target["user_id"]}, {"$set": {"premium": True, "premium_until": now_utc() + timedelta(days=30)}, "$inc": {"premium_bank": -1}})
    if not premium:
        await db.premium_requests.update_many({"user_id": target["user_id"], "status": "approved"}, {"$set": {"status": "ended"}})
    if newly and target.get("email"):
        base = (FRONTEND_URL or "").rstrip("/")
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
            f'<h2 style="color:#B07A1E;margin:0 0 12px">&#11088; Je bent nu Premium!</h2>'
            f'<p>Hoi {escape(target.get("name") or "")},</p>'
            f'<p>Je account bij Slim Boodschappenlijstje is omgezet naar <b>Premium</b>. Bedankt voor je steun!</p>'
            + (f'<p><a href="{escape(base)}" style="display:inline-block;background:#2E5E38;color:#fff;padding:12px 20px;'
               f'border-radius:10px;text-decoration:none;font-weight:bold">Open de app</a></p>' if base else "")
            + '<p style="font-size:12px;color:#888">Verstuurd door Slim Boodschappenlijstje.</p>'
            '</td></tr></table>'
        )
        asyncio.create_task(send_email(target["email"], "Je bent nu Premium bij Slim Boodschappenlijstje", html, allow_unsubscribe=False))


# ---------------------------------------------------------------------------
# Delen en Premium verdienen: wie via jouw link komt en Premium neemt, levert jou een maand Premium op.
# Net als bij Dropbox/Bol-achtige "vriend werft vriend": beloning pas bij een echte aankoop, niet bij aanmelden
# (anders maak je met nep-accounts gratis Premium). Maximaal 12 maanden per persoon.
# ---------------------------------------------------------------------------
REFERRAL_MAX_MONTHS = 12
REFERRAL_CLAIM_DAYS = 14  # een code kun je tot twee weken na het aanmelden nog invullen
_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


async def _ref_code(user: dict) -> str:
    if user.get("ref_code"):
        return user["ref_code"]
    for _ in range(20):
        code = "".join(secrets.choice(_REF_ALPHABET) for _ in range(6))
        if not await db.users.find_one({"ref_code": code}, {"_id": 1}):
            await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"ref_code": code}})
            return code
    raise HTTPException(status_code=500, detail="Kon geen code maken, probeer het nog eens")


async def _premium_expired(user: dict) -> dict:
    # Verdiende maand voorbij: nog tegoed? Dan de volgende maand, anders weer gewoon account
    if user.get("premium_bank", 0) > 0:
        until = ensure_aware(user["premium_until"]) + timedelta(days=30)
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"premium_until": until}, "$inc": {"premium_bank": -1}})
        return {**user, "premium_until": until, "premium_bank": user["premium_bank"] - 1}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"premium": False}, "$unset": {"premium_until": ""}})
    return {**user, "premium": False, "premium_until": None}


async def _referral_reward(friend: dict):
    try:
        res = await db.users.update_one({"user_id": friend["user_id"], "referral_rewarded": {"$ne": True}}, {"$set": {"referral_rewarded": True, "referral_rewarded_at": now_utc()}})
        if not res.modified_count:
            return
        ref = await db.users.find_one({"user_id": friend["referred_by"], "deleted_at": None}, {"_id": 0})
        if not ref or ref.get("referral_months", 0) >= REFERRAL_MAX_MONTHS:
            return
        inc = {"referral_months": 1}
        if ref.get("premium") and not ref.get("premium_until"):
            # Al Premium (zonder einddatum): de maand komt op je tegoed
            inc["premium_bank"] = 1
            await db.users.update_one({"user_id": ref["user_id"]}, {"$inc": inc})
            what = "De maand staat op je tegoed: die gaat in zodra je eigen Premium stopt."
        else:
            start = ensure_aware(ref["premium_until"]) if ref.get("premium") and ref.get("premium_until") else now_utc()
            until = max(start, now_utc()) + timedelta(days=30)
            await db.users.update_one({"user_id": ref["user_id"]}, {"$set": {"premium": True, "premium_until": until, "premium_welcome": not ref.get("premium")}, "$inc": inc})
            what = f"Je hebt nu Premium tot en met {until.strftime('%-d-%-m-%Y')}."
        if ref.get("email"):
            base = (FRONTEND_URL or "").rstrip("/")
            html = (
                '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
                '<h2 style="color:#B07A1E;margin:0 0 12px">&#127873; Je hebt een maand Premium verdiend!</h2>'
                f'<p>Hoi {escape(ref.get("name") or "")},</p>'
                f'<p>{escape((friend.get("name") or "Iemand").split(" ")[0])} kwam via jouw link en heeft nu Premium. Bedankt voor het delen! {escape(what)}</p>'
                + (f'<p><a href="{escape(base)}/invite" style="display:inline-block;background:#2E5E38;color:#fff;padding:12px 20px;'
                   f'border-radius:10px;text-decoration:none;font-weight:bold">Deel nog een keer</a></p>' if base else "")
                + '<p style="font-size:12px;color:#888">Verstuurd door Slim Boodschappenlijstje.</p>'
                '</td></tr></table>'
            )
            await send_email(ref["email"], "Je hebt een maand Premium verdiend", html, allow_unsubscribe=False)
    except Exception as e:
        logger.warning("Delen-beloning: %r", e)


@api_router.get("/referral")
async def my_referral(user: dict = Depends(get_current_user)):
    code = await _ref_code(user)
    base = (FRONTEND_URL or "").rstrip("/")
    invited = await db.users.count_documents({"referred_by": user["user_id"], "deleted_at": None})
    rewarded = await db.users.count_documents({"referred_by": user["user_id"], "referral_rewarded": True})
    created = ensure_aware(user.get("created_at") or now_utc())
    can_claim = not user.get("referred_by") and created > now_utc() - timedelta(days=REFERRAL_CLAIM_DAYS)
    return {"code": code, "link": f"{base}/?ref={code}" if base else None, "invited": invited, "rewarded": rewarded,
            "months": user.get("referral_months", 0), "max_months": REFERRAL_MAX_MONTHS, "bank": user.get("premium_bank", 0),
            "referred": bool(user.get("referred_by")), "can_claim": can_claim}


class ReferralClaimInput(BaseModel):
    code: str


@api_router.post("/referral/claim")
async def claim_referral(data: ReferralClaimInput, request: Request, user: dict = Depends(get_current_user)):
    # Aangemeld via iemands link (of de code zelf ingevuld): onthouden wie je heeft uitgenodigd
    limit(f"refclaim:{user['user_id']}", 10, 3600)
    code = re.sub(r"[^A-Z0-9]", "", (data.code or "").upper())
    if user.get("referred_by"):
        return {"ok": False, "detail": "Je bent al uitgenodigd door iemand"}
    if ensure_aware(user.get("created_at") or now_utc()) < now_utc() - timedelta(days=REFERRAL_CLAIM_DAYS):
        return {"ok": False, "detail": "Een code kun je alleen in de eerste twee weken na het aanmelden invullen"}
    ref = await db.users.find_one({"ref_code": code, "deleted_at": None}, {"_id": 0, "user_id": 1, "name": 1})
    if not ref or ref["user_id"] == user["user_id"]:
        raise HTTPException(status_code=400, detail="Deze code klopt niet")
    await db.users.update_one({"user_id": user["user_id"], "referred_by": {"$exists": False}}, {"$set": {"referred_by": ref["user_id"], "referred_at": now_utc()}})
    return {"ok": True, "by": (ref.get("name") or "").split(" ")[0]}


class PremiumRequestInput(BaseModel):
    org_name: str
    message: Optional[str] = None


def _premium_request_public(r: Optional[dict]) -> Optional[dict]:
    if not r:
        return None
    return {k: r.get(k) for k in ("req_id", "org_name", "message", "status", "created_at", "reviewed_at", "user_name", "user_email")}


# Verenigingen (scouting, sportclubs, ...) kunnen gratis Premium aanvragen; beheer keurt goed
@api_router.get("/premium/request")
async def my_premium_request(user: dict = Depends(get_current_user)):
    r = await db.premium_requests.find_one({"user_id": user["user_id"]}, {"_id": 0}, sort=[("created_at", -1)])
    return {"request": _premium_request_public(r)}


@api_router.post("/premium/request")
async def request_premium(data: PremiumRequestInput, user: dict = Depends(get_current_user)):
    org = (data.org_name or "").strip()[:100]
    msg = (data.message or "").strip()[:1000] or None
    if len(org) < 2:
        raise HTTPException(status_code=400, detail="Vul de naam van je vereniging in")
    if user.get("premium"):
        raise HTTPException(status_code=400, detail="Je bent al Premium")
    if await db.premium_requests.find_one({"user_id": user["user_id"], "status": "pending"}):
        raise HTTPException(status_code=400, detail="Je hebt al een aanvraag lopen")
    recent = await db.premium_requests.count_documents({"user_id": user["user_id"], "created_at": {"$gte": now_utc() - timedelta(days=1)}})
    if recent >= 3:
        raise HTTPException(status_code=429, detail="Probeer het morgen nog eens")
    doc = {
        "req_id": f"preq_{uuid.uuid4().hex[:12]}", "user_id": user["user_id"],
        "user_name": user.get("name"), "user_email": user.get("email"),
        "org_name": org, "message": msg, "status": "pending", "created_at": now_utc(),
    }
    await db.premium_requests.insert_one(doc)
    # Beheerders krijgen een seintje, zodat een aanvraag niet blijft liggen
    base = (FRONTEND_URL or "").rstrip("/")
    html = (
        '<div style="font-family:Arial,sans-serif;color:#1C1B1A">'
        f'<p>Nieuwe aanvraag voor gratis Premium van <b>{escape(org)}</b>.</p>'
        f'<p>Aangevraagd door {escape(user.get("name") or "")} ({escape(user.get("email") or "")}).</p>'
        + (f'<p>{escape(msg)}</p>' if msg else "")
        + (f'<p><a href="{escape(base)}/admin/premium-requests">Bekijk de aanvragen</a></p>' if base else "")
        + '</div>'
    )
    async for admin in db.users.find({"role": "beheerder", "deleted_at": None, "email": {"$ne": None}}, {"email": 1}):
        asyncio.create_task(send_email(admin["email"], f"Premium-aanvraag: {org}", html, allow_unsubscribe=False))
    return {"request": _premium_request_public(doc)}


@api_router.get("/admin/premium-requests")
async def list_premium_requests(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    reqs = await db.premium_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {"requests": [_premium_request_public(r) for r in reqs]}


@api_router.post("/admin/premium-requests/{req_id}/{action}")
async def review_premium_request(req_id: str, action: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=404, detail="Onbekende actie")
    req = await db.premium_requests.find_one({"req_id": req_id, "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Aanvraag niet gevonden")
    target = await db.users.find_one({"user_id": req["user_id"], "deleted_at": None})
    status = "approved" if action == "approve" and target else "rejected"
    await db.premium_requests.update_one({"req_id": req_id}, {"$set": {"status": status, "reviewed_at": now_utc(), "reviewed_by": user["user_id"]}})
    if status == "approved":
        await _set_premium(target, True, user["user_id"], org=req.get("org_name"))
    return {"ok": True, "status": status}


@api_router.post("/auth/premium-seen")
async def premium_seen(user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"premium_welcome": False}})
    return {"ok": True}


@api_router.get("/admin/users")
async def admin_list_users(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    docs = await db.users.find({"deleted_at": None}, {"_id": 0}).sort("created_at", 1).to_list(5000)
    return {"users": [public_user(d) for d in docs]}


class AdminUserUpdate(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    role: Optional[str] = None


@api_router.put("/admin/users/{target_id}")
async def admin_update_user(target_id: str, data: AdminUserUpdate, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    target = await db.users.find_one({"user_id": target_id})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    guard_target(user, target, data.role)
    update: dict = {}
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.username is not None:
        uname = data.username.strip().lower() or None
        if uname and await db.users.find_one({"username": uname, "user_id": {"$ne": target_id}}):
            raise HTTPException(status_code=400, detail="Gebruikersnaam is al in gebruik")
        update["username"] = uname
    if data.email is not None:
        em = data.email.lower()
        if await db.users.find_one({"email": em, "user_id": {"$ne": target_id}}):
            raise HTTPException(status_code=400, detail="E-mailadres is al in gebruik")
        update["email"] = em
    if data.phone is not None:
        update["phone"] = data.phone.strip() or None
    if data.role is not None:
        if not await db.roles.find_one({"name": data.role}):
            raise HTTPException(status_code=400, detail="Onbekende rol")
        update["role"] = data.role
    if update:
        await db.users.update_one({"user_id": target_id}, {"$set": update})
    doc = await db.users.find_one({"user_id": target_id}, {"_id": 0})
    return public_user(doc)


@api_router.delete("/admin/users/{target_id}")
async def admin_delete_user(target_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    if target_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Je kunt je eigen account niet verwijderen")
    target = await db.users.find_one({"user_id": target_id, "deleted_at": None})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    guard_target(user, target)
    # Naar "Recent verwijderd": 30 dagen terug te zetten, samen met alles van deze gebruiker
    ts = now_utc()
    await db.users.update_one({"user_id": target_id}, {"$set": {"deleted_at": ts}})
    await db.user_sessions.delete_many({"user_id": target_id})
    for coll in (db.camps, db.dishes, db.products):
        await coll.update_many(
            {"owner_id": target_id, "deleted_at": None},
            {"$set": {"deleted_at": ts, "deleted_with_user": target_id}},
        )
    return {"ok": True}


class AdminSetPassword(BaseModel):
    new_password: str


@api_router.post("/admin/users/{target_id}/set-password")
async def admin_set_password(target_id: str, data: AdminSetPassword, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    if len(data.new_password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Wachtwoord moet minstens {MIN_PASSWORD} tekens zijn")
    target = await db.users.find_one({"user_id": target_id})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    guard_target(user, target)
    await db.users.update_one(
        {"user_id": target_id},
        {"$set": {"password_hash": hash_password(data.new_password), "auth_provider": "password"}},
    )
    return {"ok": True}


@api_router.put("/admin/users/{target_id}/role")
async def admin_set_role(target_id: str, data: SetRoleInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    role = await db.roles.find_one({"name": data.role})
    if not role:
        raise HTTPException(status_code=400, detail="Onbekende rol")
    target = await db.users.find_one({"user_id": target_id})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
    guard_target(user, target, data.role)
    if target_id == user["user_id"] and data.role != user.get("role"):
        raise HTTPException(status_code=400, detail="Je kunt je eigen rol niet veranderen")
    await db.users.update_one({"user_id": target_id}, {"$set": {"role": data.role}})
    return {"ok": True}


@api_router.get("/admin/submissions")
async def list_submissions(user: dict = Depends(get_current_user)):
    await require_perm(user, "review_submissions")
    docs = await db.submissions.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"submissions": docs}


@api_router.get("/admin/submissions/count")
async def submissions_count(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    if "review_submissions" not in perms:
        return {"pending": 0}
    n = await db.submissions.count_documents({"status": "pending"})
    return {"pending": n}


@api_router.post("/admin/submissions/{submission_id}/approve")
async def approve_submission(submission_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "review_submissions")
    sub = await db.submissions.find_one({"submission_id": submission_id, "status": "pending"})
    if not sub:
        raise HTTPException(status_code=404, detail="Inzending niet gevonden")
    new_dish = {
        "dish_id": f"dish_{uuid.uuid4().hex[:12]}",
        "name": sub["name"],
        "category": sub["category"],
        "is_standard": True,
        "owner_id": None,
        "ingredients": sub.get("ingredients", []),
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.dishes.insert_one(new_dish)
    await db.submissions.update_one(
        {"submission_id": submission_id},
        {"$set": {"status": "approved", "reviewed_at": now_utc(), "reviewed_by": user["user_id"]}},
    )
    return dish_public(new_dish)


@api_router.post("/admin/submissions/{submission_id}/reject")
async def reject_submission(submission_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "review_submissions")
    sub = await db.submissions.find_one({"submission_id": submission_id, "status": "pending"})
    if not sub:
        raise HTTPException(status_code=404, detail="Inzending niet gevonden")
    await db.submissions.update_one(
        {"submission_id": submission_id},
        {"$set": {"status": "rejected", "reviewed_at": now_utc(), "reviewed_by": user["user_id"]}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Products (supermarket catalog)
# ---------------------------------------------------------------------------
class ProductInput(BaseModel):
    name: str
    aisle: str = "Overig"
    unit: str = "stuks"
    brand: Optional[str] = None
    barcode: Optional[str] = None
    prices: Dict[str, float] = Field(default_factory=dict)
    unavailable: List[str] = Field(default_factory=list)
    is_global: bool = False


def resolve_price(prices: dict, store: str, unavailable: Optional[list] = None) -> float:
    unavailable = unavailable or []
    if store in prices and prices[store]:
        return float(prices[store])
    # fall back to another store's price so budgets still estimate
    vals = [float(v) for v in prices.values() if v]
    if store in unavailable:
        return round(sum(vals) / len(vals), 2) if vals else 0.0
    if prices.get("Overig"):
        return float(prices["Overig"])
    return round(sum(vals) / len(vals), 2) if vals else 0.0


def product_source(doc: dict) -> Optional[str]:
    if doc.get("dirk_id"):
        return "Dirk"
    if doc.get("ah_id"):
        return "Albert Heijn"
    if doc.get("jumbo_id"):
        return "Jumbo"
    return None


def product_public(doc: dict, store: str, user_id: str, favorites: Optional[set] = None) -> dict:
    prices = doc.get("prices", {}) or {}
    store = product_source(doc) or store
    unavailable = doc.get("unavailable", []) or []
    price = resolve_price(prices, store, unavailable)
    up = _unit_value(price, doc.get("unit") or "")
    promo, promo_next = _promo_public(doc, price)
    return {
        "id": doc["product_id"],
        "name": doc["name"],
        "aisle": doc.get("aisle", "Overig"),
        "unit": doc.get("unit", "stuks"),
        "brand": doc.get("brand"),
        "barcode": doc.get("barcode"),
        "prices": prices,
        "unavailable": unavailable,
        "price": price,
        "unit_price": f"{_euro(up[0])}/{'kg' if up[1] == 'kilo' else 'l'}" if up else None,
        "unavailable_here": store in unavailable,
        "is_global": doc.get("is_global", False),
        "is_own": doc.get("owner_id") == user_id,
        "image": doc.get("image"),
        "is_favorite": doc["product_id"] in (favorites or set()),
        "source": product_source(doc),
        "subcategory": doc.get("subcategory"),
        "on_offer": bool(doc.get("on_offer")) or promo is not None,
        "promo": promo,
        "promo_next": promo_next,
    }


# Productlijst in het geheugen, zodat niet bij elke aanvraag ~30.000 producten uit de database komen.
# De server heeft weinig rekenkracht: verversen gebeurt op de achtergrond en ondertussen blijft
# de vorige lijst gewoon werken.
PRODUCT_CACHE_SECONDS = 3 * 3600  # wijzigingen (prijsupdate, beheer) verversen de lijst toch al meteen
_product_cache: dict = {"at": None, "docs": [], "stale": True, "task": None}
_search_cache: dict = {}


def _invalidate_products() -> None:
    _product_cache["stale"] = True
    _search_cache.clear()
    _sub_images.clear()
    _own_cache.clear()


def _prep_product(d: dict, known_brands: list) -> None:
    d["_norm"] = _norm_text(d["name"])
    d["_src"] = product_source(d)
    extra = _norm_text(" ".join(x for x in (d.get("brand"), d.get("subcategory")) if x))
    d["_hay"] = f"{d['_norm']} {extra}" if extra else d["_norm"]
    if not (d.get("brand") or "").strip():
        # Geen merk van de winkel: merk afleiden uit het begin van de naam ("AH Halfvolle melk" -> AH)
        for b, nb in known_brands:
            if d["_norm"].startswith(nb + " "):
                d["brand"] = b
                break
    d["_bio"] = bool(_BIO_RE.search(d["_norm"]) or _BIO_RE.search(_norm_text(d.get("brand") or "")))
    price = resolve_price(d.get("prices") or {}, d["_src"] or DEFAULT_STORE, d.get("unavailable") or [])
    d["_up"] = _unit_value(price, d.get("unit") or "")


def _live(q: dict) -> dict:
    # Alleen producten die nog verkocht worden: wat de winkel niet meer heeft, laten we gewoon niet meer zien
    cutoff = now_utc() - timedelta(days=ASSORTMENT_GRACE_DAYS)
    return {**q, "deleted_at": None, "$or": [{"missing_since": None}, {"missing_since": {"$gt": cutoff}}]}


_HOUSE_BRAND = {"Albert Heijn": "AH", "Jumbo": "Jumbo", "Dirk": "Dirk"}


def _fill_brands(docs: list) -> None:
    # Producten zonder merk: eerst hetzelfde product (barcode) bij een andere winkel, anders is los groente en fruit
    # (en wat Dirk zonder merk verkoopt) gewoon het huismerk van de winkel
    by_ean = {d["barcode"]: d["brand"] for d in docs if d.get("barcode") and (d.get("brand") or "").strip()}
    for d in docs:
        if (d.get("brand") or "").strip():
            continue
        b = by_ean.get(d.get("barcode")) if d.get("barcode") else None
        if not b and d.get("_src") in _HOUSE_BRAND and (d["_src"] == "Dirk" or d.get("aisle") == "Aardappelen, groente & fruit"):
            b = _HOUSE_BRAND[d["_src"]]
        if b:
            d["brand"] = sys.intern(b)
            d["_bio"] = d.get("_bio") or bool(_BIO_RE.search(_norm_text(b)))


async def _load_products() -> None:
    try:
        cutoff = now_utc() - timedelta(days=ASSORTMENT_GRACE_DAYS)
        docs = await db.products.find({"deleted_at": None, "is_global": True,
                                       "$or": [{"missing_since": None}, {"missing_since": {"$gt": cutoff}}]},
                                      {"_id": 0, "created_at": 0, "updated_at": 0, "missing_since": 0, "owner_id": 0, "deleted_at": 0}).to_list(None)
        # Veel producten delen dezelfde afdeling, merk en verpakking: één keer in het geheugen is genoeg (scheelt bij 50.000+ producten)
        for d in docs:
            for k in ("aisle", "subcategory", "brand", "unit"):
                v = d.get(k)
                if isinstance(v, str):
                    d[k] = sys.intern(v)
            d["owner_id"] = None
            d["deleted_at"] = None
        counts: Dict[str, int] = {}
        for d in docs:
            b = (d.get("brand") or "").strip()
            if b:
                counts[b] = counts.get(b, 0) + 1
        known = sorted(((b, _norm_text(b)) for b, n in counts.items() if n >= 3 and len(b) >= 2), key=lambda x: -len(x[1]))
        known = [k for k in known if k[1]]
        docs.sort(key=lambda d: (AISLES.index(d["aisle"]) if d.get("aisle") in AISLES else 99, d["name"].lower()))
        for i, d in enumerate(docs):
            _prep_product(d, known)
            if i % 2000 == 0:
                await asyncio.sleep(0)  # andere aanvragen niet blokkeren
        _product_cache["docs"] = docs
        _product_cache["by_pid"] = {d["product_id"]: d for d in docs}
        _product_cache["by_sid"] = {(d["_src"], str(d.get("dirk_id") or d.get("ah_id") or d.get("jumbo_id"))): d
                                    for d in docs if d.get("_src")}
        _product_cache["at"] = datetime.now(timezone.utc)
        _search_cache.clear()
        import gc
        gc.collect()  # de vorige lijst meteen opruimen, anders staan er twee in het geheugen
        _fill_brands(docs)
        missing: Dict[str, list] = {}
        for d in docs:
            if not d.get("brand"):
                missing.setdefault(d.get("_src") or "-", []).append(d["name"])
        logger.info("Productlijst geladen: %d producten; zonder merk: %s", len(docs),
                    {k: (len(v), v[:12]) for k, v in missing.items()})
    except Exception as e:
        logger.warning("Productlijst laden mislukt: %s", e)
    asyncio.ensure_future(_warm_search())


async def _warm_search() -> None:
    # De Producten-pagina meteen snel: alle producten en elke afdeling alvast klaarzetten, per favoriete winkel
    docs = _product_cache["docs"]
    try:
        await asyncio.to_thread(_aisle_images, docs)
        for store in COUPLED_STORES:
            for aisle in [""] + AISLES:
                if _product_cache["docs"] is not docs:
                    return  # er is intussen een nieuwe lijst
                key = ("", store, aisle, "", "", "", False, False, "", None, None)
                if key not in _search_cache:
                    _search_cache[key] = await asyncio.to_thread(_run_search, docs, "", "", aisle, None, "", "", False, False, "", store)
                await asyncio.sleep(0.2)
    except Exception as e:
        logger.info("Producten klaarzetten: %r", e)


async def _global_products() -> list:
    c = _product_cache
    now = datetime.now(timezone.utc)
    old = c["at"] is None or (now - c["at"]).total_seconds() > PRODUCT_CACHE_SECONDS
    if (c["stale"] or old) and not (c["task"] and not c["task"].done()):
        c["stale"] = False
        c["task"] = asyncio.create_task(_load_products())
    if c["at"] is None:
        await c["task"]
    return c["docs"]


_own_cache: dict = {}


async def _own_products(user: dict) -> list:
    hit = _own_cache.get(user["user_id"])
    now = datetime.now(timezone.utc)
    if hit and (now - hit[0]).total_seconds() < 120:
        return hit[1]
    own = await db.products.find({"deleted_at": None, "is_global": {"$ne": True}, "owner_id": user["user_id"]}, {"_id": 0}).to_list(2000)
    for d in own:
        _prep_product(d, [])
    if len(_own_cache) > 500:
        _own_cache.clear()
    _own_cache[user["user_id"]] = (now, own)
    return own


async def _visible_products(user: dict) -> list:
    docs = await _global_products()
    own = await _own_products(user)
    return own + docs if own else docs


def _norm_text(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9%.,]+", " ", s).strip()


def _term_score(name: str, words: list, term: str) -> int:
    # Lager is beter: "melk" geeft eerst melk, dan karnemelk, pas daarna melkchocolade
    if name == term:
        return 0
    if name.startswith(term + " "):
        return 1
    if term in words:
        return 2
    if any(w.endswith(term) for w in words):
        return 3
    if name.startswith(term):
        return 4
    if any(w.startswith(term) for w in words):
        return 5
    if term in name:
        return 6
    return -1


def _search_products(docs: list, q: str) -> list:
    terms = _norm_text(q).split()
    if not terms:
        return docs
    scored = []
    for d in docs:
        name = d["_norm"]
        # Ook zoeken in merk en soort: "heel brood" vindt zo "Bakker van der Akker Rond wit heel" (soort: Brood)
        hay = d.get("_hay") or name
        if not all(t in hay for t in terms):
            continue
        words = name.split()
        total = 0
        for t in terms:
            sc = _term_score(name, words, t)
            total += sc if sc >= 0 else 7
        scored.append((total, len(name), name, d))
    scored.sort(key=lambda x: (x[0], x[1], x[2]))
    return [x[3] for x in scored]


def _clean(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if not k.startswith("_")}


@api_router.get("/products")
async def list_products(user: dict = Depends(get_current_user)):
    store = user.get("store", DEFAULT_STORE)
    docs = await _visible_products(user)
    favorites = set(user.get("favorite_products") or [])
    return {"products": [product_public(_clean(d), store, user["user_id"], favorites) for d in docs], "stores": await get_active_stores()}


_BIO_RE = re.compile(r"\b(bio|biologisch|biologische|organic)\b")


def _is_bio(d: dict) -> bool:
    return bool(d.get("_bio"))


def _split_list(v: str) -> list:
    return [x for x in (v or "").split("|") if x]


_sub_images: dict = {}


def _sub_image(sub: str, docs: list) -> Optional[str]:
    # Het product dat het best bij de soort past: bij "Kaas" een stuk kaas, geen kaasstengels
    if sub in _sub_images:
        return _sub_images[sub]
    want = [w for w in re.split(r"[^a-z]+", _norm_text(sub)) if len(w) > 2 and w not in ("en", "met", "overig", "overige")]

    def score(d):
        words = _alt_terms(d["name"], d).split()
        hit = sum(1 for w in want if w in words or (w.endswith("en") and w[:-2] in words) or w + "en" in words or w + "s" in words)
        part = sum(1 for w in want if any(w in x for x in words))
        return (-hit, -part, len(words), d["name"])
    cands = [d for d in docs if d.get("image")]
    best = min(cands, key=score) if cands else None
    _sub_images[sub] = best["image"] if best else None
    return _sub_images[sub]


def _facet(docs: list, field: str, top: int = 60) -> list:
    counts: Dict[str, int] = {}
    members: Dict[str, list] = {}  # voor een voorbeeldfoto per soort, op de tegels van de Producten-pagina
    for d in docs:
        v = (d.get(field) or "").strip()
        if v:
            counts[v] = counts.get(v, 0) + 1
            if field == "subcategory" and v not in _sub_images:
                members.setdefault(v, []).append(d)
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:top]
    if field != "subcategory":
        return [{"value": k, "count": n, "image": None} for k, n in items]
    return [{"value": k, "count": n, "image": _sub_image(k, members.get(k) or [])} for k, n in items]


def _has_offer(d: dict) -> bool:
    if d.get("on_offer"):
        return True
    sid = d.get("dirk_id") or d.get("ah_id") or d.get("jumbo_id")
    if not sid:
        return False
    today = _iso_day(datetime.now(timezone.utc).isoformat())
    return any((it["start"] or "") <= today <= (it["end"] or "9999") for it in _folders["by_id"].get((d.get("_src"), str(sid)), []))


def _run_search(docs: list, q: str, source: str, aisle: str, favs: Optional[set], sub: str, brand: str,
                offer: bool, bio: bool, sort: str, store: str) -> tuple:
    if source:
        docs = [d for d in docs if d.get("_src") == source]
    if favs is not None:
        docs = [d for d in docs if d["product_id"] in favs]
    aisle_counts: Dict[str, int] = {}
    for d in docs:
        a = d.get("aisle", "Overig")
        aisle_counts[a] = aisle_counts.get(a, 0) + 1
    if aisle:
        docs = [d for d in docs if d.get("aisle") == aisle]
    if q.strip():
        docs = _relevant_products(docs, q) if sort in ("", "relevance") else _search_products(docs, q)

    # Filters zoals op de sites; de keuzes (soort, merk) hangen af van de afdeling en zoekterm.
    # Elke lijst telt mee met de andere filters, maar niet met zichzelf.
    subs, brands = set(_split_list(sub)), set(_split_list(brand))
    def keep(d: dict, skip: str = "") -> bool:
        if subs and skip != "sub" and (d.get("subcategory") or "") not in subs:
            return False
        if brands and skip != "brand" and (d.get("brand") or "") not in brands:
            return False
        if offer and skip != "offer" and not _has_offer(d):
            return False
        if bio and skip != "bio" and not d.get("_bio"):
            return False
        return True
    facets = [
        {"key": "sub", "label": "Soort", "options": _facet([d for d in docs if keep(d, "sub")], "subcategory", 200)},
        {"key": "brand", "label": "Merk", "options": _facet([d for d in docs if keep(d, "brand")], "brand", 80)},
        {"key": "offer", "label": "Aanbieding", "count": sum(1 for d in docs if keep(d, "offer") and _has_offer(d))},
        {"key": "bio", "label": "Biologisch", "count": sum(1 for d in docs if keep(d, "bio") and d.get("_bio"))},
    ]
    if subs or brands or offer or bio:
        docs = [d for d in docs if keep(d)]

    if sort in ("price_asc", "price_desc"):
        def price_of(d):
            v = resolve_price(d.get("prices") or {}, d.get("_src") or store, d.get("unavailable") or [])
            return v if v > 0 else None
        priced = [d for d in docs if price_of(d) is not None]
        rest = [d for d in docs if price_of(d) is None]
        docs = sorted(priced, key=price_of, reverse=(sort == "price_desc")) + rest
    elif sort in ("unit_asc", "unit_desc"):
        # Prijs per kilo of liter: zo vergelijk je verschillende verpakkingen; zonder kiloprijs achteraan
        with_up = [d for d in docs if d.get("_up")]
        docs = sorted(with_up, key=lambda d: d["_up"][0], reverse=(sort == "unit_desc")) + [d for d in docs if not d.get("_up")]
    elif sort == "name":
        docs = sorted(docs, key=lambda d: d["_norm"])
    if sort in ("", "relevance") and store and not source:
        docs = sorted(docs, key=lambda d: 0 if d.get("_src") == store else 1)  # je favoriete winkel eerst (volgorde blijft verder gelijk)
    return docs, aisle_counts, facets


@api_router.get("/products/search")
async def search_products(
    q: str = "",
    source: str = "",
    aisle: str = "",
    favorites: bool = False,
    sub: str = "",
    brand: str = "",
    offer: bool = False,
    bio: bool = False,
    sort: str = "",
    offset: int = 0,
    limit: int = 50,
    user: dict = Depends(get_current_user),
):
    store = user.get("store", DEFAULT_STORE)
    favs = set(user.get("favorite_products") or [])
    own = await _own_products(user)
    await _folders_fresh(wait=False)
    # Dezelfde zoekopdracht (ook bij verder scrollen) komt uit het geheugen
    key = (source, store, aisle, _norm_text(q), sub, brand, offer, bio, sort,
           tuple(sorted(favs)) if favorites else None, user["user_id"] if own else None)
    hit = _search_cache.get(key)
    if hit is None:
        # In een aparte thread: zo blijft de rest van de app bereikbaar terwijl er gezocht wordt
        hit = await asyncio.to_thread(_run_search, own + (await _global_products()) if own else await _global_products(),
                                      q, source, aisle, favs if favorites else None, sub, brand, offer, bio, sort, store)
        if len(_search_cache) > 150:
            _search_cache.pop(next(iter(_search_cache)))
        _search_cache[key] = hit
    docs, aisle_counts, facets = hit
    if offset == 0 and (aisle or brand or sub) and not user.get("no_personal"):
        # Wat iemand opzoekt telt mee voor de aanbiedingen op Home
        inc = {f"aisles.{_ikey(aisle)}": 1} if aisle else {}
        inc.update({f"brands.{_ikey(_norm_text(b))}": 1 for b in _split_list(brand)})
        inc.update({f"subs.{_ikey(x)}": 1 for x in _split_list(sub)})
        asyncio.ensure_future(db.user_interest.update_one({"user_id": user["user_id"]}, {"$inc": inc}, upsert=True))

    offset = max(0, offset)
    limit = max(1, min(limit, 200))
    page = docs[offset:offset + limit]
    return {
        "products": [product_public(_clean(d), store, user["user_id"], favs) for d in page],
        "total": len(docs),
        "next_offset": offset + limit if offset + limit < len(docs) else None,
        "aisle_counts": aisle_counts,
        "aisle_images": await asyncio.to_thread(_aisle_images, await _global_products()) if offset == 0 else None,
        "facets": facets,
    }


# Een herkenbaar plaatje per hoofdafdeling, zoals ijsblokjes bij diepvries
AISLE_PICTURE_TERMS = {
    "Aardappelen, groente & fruit": "bananen", "Vlees & vis": "kipfilet", "Brood, beleg & koek": "volkoren brood",
    "Zuivel & kaas": "halfvolle melk", "Dranken, sap, koffie & thee": "sinaasappelsap", "Voorraadkast": "spaghetti",
    "Maaltijden, salades & tapas": "hummus", "Diepvries": "ijsblokjes", "Huishoud & huisdieren": "afwasmiddel",
    "Kind & drogisterij": "tandpasta", "Non food": "batterijen", "Snacks & snoep": "chips naturel",
}
_aisle_pictures: dict = {"docs": None, "map": {}}


def _aisle_images(docs: list) -> dict:
    if _aisle_pictures["docs"] is docs:
        return _aisle_pictures["map"]
    out = {}
    for a, term in AISLE_PICTURE_TERMS.items():
        for store in ("Albert Heijn", "Jumbo", "Dirk"):
            pool = [d for d in docs if d.get("is_global") and d.get("_src") == store and d.get("aisle") == a and d.get("image")]
            hit = (_best_matches(pool, term, 1) or [None])[0] if pool else None
            if hit:
                out[a] = hit["image"]
                names = _aisle_pictures.setdefault("names", {})
                names[a] = hit["name"]
                break
    logger.info("Afdelingsplaatjes: %s", _aisle_pictures.get("names"))
    _aisle_pictures.update(docs=docs, map=out)
    return out


class PackPlanItem(BaseModel):
    product_id: str
    qty: float
    unit: str = ""
    packs: Optional[float] = None  # zoveel verpakkingen zet de site zelf in het mandje (al omgerekend)


class PackPlanInput(BaseModel):
    items: List[PackPlanItem]


@api_router.post("/packs/plan")
async def pack_plans(body: PackPlanInput, user: dict = Depends(get_current_user)):
    # Voor recepten met meer personen: hoeveel verpakkingen, en een voorstel voor een grotere verpakking
    await _global_products()
    by_pid = _product_cache.get("by_pid") or {}
    missing = [i.product_id for i in body.items if i.product_id not in by_pid]
    extra = {d["product_id"]: d for d in await db.products.find(_live({"product_id": {"$in": missing}}), {"_id": 0}).to_list(200)} if missing else {}
    pieces = [by_pid.get(i.product_id) or extra.get(i.product_id) for i in body.items if (i.unit or "").lower().strip() in ("", "stuks", "stuk", "st") and not i.packs]
    await _learn_pack_counts([p for p in pieces if p])

    def run():
        out = []
        for i in body.items[:80]:
            p = by_pid.get(i.product_id) or extra.get(i.product_id)
            out.append(_pack_plan(p, i.qty, i.unit, site_packs=i.packs) if p else None)
        return out
    return {"plans": await asyncio.to_thread(run)}


@api_router.get("/folders")
async def get_folders(store: str = "Albert Heijn", user: dict = Depends(get_current_user)):
    f = await _folders_fresh()
    await _global_products()
    by_sid = _product_cache.get("by_sid") or {}
    favs = set(user.get("favorite_products") or [])
    today = _iso_day(datetime.now(timezone.utc).isoformat())
    periods = []
    for i, per in enumerate((f["data"] or {}).get(store) or []):
        items = []
        for it in per["items"]:
            if it["end"] and it["end"] < today:
                continue
            docs = [by_sid[(store, x)] for x in it["ids"] if (store, x) in by_sid]
            first = product_public(_clean(docs[0]), store, user["user_id"], favs) if docs else None
            price, regular = it.get("price"), it.get("regular")
            if first and len(docs) == 1:
                price = price or (first["promo"] or {}).get("price")
                regular = regular or first["price"]
            deal = _promo_deal(it["label"], regular or (first or {}).get("price") or 0) if len(docs) <= 1 else None
            cat = it.get("category") or (docs[0].get("aisle") if docs else None) or "Overig"
            items.append({**{k: v for k, v in it.items() if k not in ("ids", "prices")}, "category": cat, "price": price, "regular": regular, "deal": deal,
                          "image": ((first or {}).get("image") if store == "Dirk" else None) or it.get("image") or (first or {}).get("image"),
                          "product_ids": [d["product_id"] for d in docs], "count": len(docs) or len(it["ids"]),
                          "period": f"{_nice_day(it['start'])} t/m {_nice_day(it['end'])}" if it["start"] and it["end"] else None})
        if not items:
            continue
        # Indeling zoals op de site: AH in de volgorde van de bonuspagina, anders per afdeling
        def cat_rank(c):
            return AISLES.index(c) if c in AISLES else 50
        if store == "Albert Heijn":
            items.sort(key=lambda x: x.get("order") or 0)
        else:
            items.sort(key=lambda x: (cat_rank(x["category"]), x["category"], 0 if x.get("image") else 1, x["title"].lower()))
        counts: Dict[str, int] = {}
        for x in items:
            counts[x["category"]] = counts.get(x["category"], 0) + 1
        cats = [{"name": k, "count": v} for k, v in counts.items()]
        is_next = (per.get("start") or "") > today
        periods.append({"key": "next" if is_next else "current", "title": "Volgende week" if is_next else "Deze week",
                        "start": per.get("start"), "end": per.get("end"),
                        "period": f"{_nice_day(per.get('start'))} t/m {_nice_day(per.get('end'))}" if per.get("start") and per.get("end") else None,
                        "folder_url": per.get("folder_url"), "categories": cats, "items": items})
    have = {p["key"] for p in periods}
    for ex in (f.get("extra") or {}).get(store) or []:
        if not isinstance(ex, dict) or not ex.get("pages") or ex["key"] in have or ex["key"] in ("next", "extra", "dirck3"):
            continue  # Dirk: alleen losse acties, geen folderplaatjes
        periods.append({**ex, "period": f"{_nice_day(ex['start'])} t/m {_nice_day(ex['end'])}" if ex.get("start") and ex.get("end") else None,
                        "categories": [], "items": []})
    return {"store": store, "stores": list(COUPLED_STORES), "periods": periods, "loading": f["at"] is None,
            "next_expected": _next_expected(store, (f["data"] or {}).get(store) or []),
            "updated_at": f["at"].isoformat() if f["at"] else None}


@api_router.get("/products/by-ids")
async def products_by_ids(ids: str, user: dict = Depends(get_current_user)):
    wanted = [x for x in ids.split(",") if x][:200]
    docs = {d["product_id"]: d for d in await _global_products()}
    favs = set(user.get("favorite_products") or [])
    store = user.get("store", DEFAULT_STORE)
    return {"products": [product_public(_clean(docs[i]), store, user["user_id"], favs) for i in wanted if i in docs]}


@api_router.get("/products/{product_id}")
async def get_product(product_id: str, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"product_id": product_id, "deleted_at": None}, {"_id": 0})
    if not doc or (not doc.get("is_global") and doc.get("owner_id") != user["user_id"]):
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    favs = set(user.get("favorite_products") or [])
    if doc.get("is_global"):
        if not user.get("no_personal"):
            asyncio.create_task(_track_interest(user["user_id"], doc))
    return product_public(doc, user.get("store", DEFAULT_STORE), user["user_id"], favs)


@api_router.get("/products/{product_id}/stores")
async def product_other_stores(product_id: str, user: dict = Depends(get_current_user)):
    # Hetzelfde product (barcode) of iets vergelijkbaars bij de andere winkels, met prijs
    docs = await _global_products()
    by_pid = _product_cache.get("by_pid") or {}
    base = by_pid.get(product_id)
    if not base:
        return {"stores": []}

    def work():
        src = base.get("_src")
        cands = {st: [] for st in COMPARE_STORES if st != src}
        by_ean: dict = {}
        for d in docs:
            if d.get("_src") in cands and d.get("is_global"):
                cands[d["_src"]].append(d)
                if d.get("barcode"):
                    by_ean.setdefault((d["_src"], d["barcode"]), d)
        own = resolve_price(base.get("prices") or {}, src or DEFAULT_STORE, base.get("unavailable") or [])
        out = []
        for st, pool in cands.items():
            hit, alt = _compare_hit(st, pool, by_ean, base["name"], base)
            price = resolve_price(hit.get("prices") or {}, st, hit.get("unavailable") or []) if hit else 0
            if not hit or not price:
                out.append({"store": st, "product": None})
                continue
            up = hit.get("_up")
            out.append({"store": st, "product_id": hit["product_id"], "product": hit["name"], "unit": hit.get("unit") or "",
                        "image": hit.get("image"), "price": round(price, 2), "same": not alt,
                        "unit_price": f"{_euro(up[0])} per {up[1]}" if up else None,
                        "diff": round(price - own, 2) if own and not alt else None})
        return out
    return {"stores": await asyncio.to_thread(work)}


# --- Productdetails zoals op de site van de winkel (live opgehaald, even bewaard) ---
DETAIL_CACHE_SECONDS = 6 * 3600
_detail_cache: dict = {}
_detail_logged = {"Jumbo": 0}
_PAGE_HEADERS = {"Accept": "text/html", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def _euro(v: float) -> str:
    return f"€ {v:.2f}".replace(".", ",")


def _unit_price_from(price: float, qty: str) -> Optional[str]:
    v = _unit_value(price, qty)
    return f"{_euro(v[0])} per {v[1]}" if v else None


_UNIT_RE = re.compile(r"(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|kilo|kilogram|gram|gr|g|liter|ltr|l|cl|ml)\b")


# Maten in een recept, omgerekend naar gram of milliliter (eetlepel, theelepel en snufje bij benadering)
_MEASURE = {"gram": 1, "g": 1, "kg": 1000, "ml": 1, "cl": 10, "dl": 100, "liter": 1000, "l": 1000, "el": 15, "tl": 5, "snuf": 0.5,
            "scheut": 15}
# Losse delen van een verpakking: een teen van een bol knoflook, een takje van een bosje
_PART_OF_PACK = {"teen": 0.1, "takje": 0.1, "handje": 0.25, "plak": 0.1}


def _pack_count(pack: str) -> Optional[int]:
    # "6 stuks", "2 st", "4-pack": zoveel stuks zitten er in de verpakking
    m = re.search(r"(\d+)\s*(?:stuks|stuk|st|-pack|pack)\b", (pack or "").lower())
    return int(m.group(1)) if m and 0 < int(m.group(1)) <= 100 else None


def _pack_size(pack: str) -> Optional[float]:
    # Inhoud van een verpakking in gram of milliliter
    m = _UNIT_RE.search((pack or "").lower())
    if not m:
        return None
    amount = float(m.group(2).replace(",", ".")) * int(m.group(1) or 1)
    return amount * {"kg": 1000, "kilo": 1000, "kilogram": 1000, "liter": 1000, "ltr": 1000, "l": 1000, "cl": 10}.get(m.group(3), 1) or None


_size_alts: dict = {}


def _bigger_pack(p: dict, need: float, unit: str, store: str, packs: int, cost: float) -> Optional[dict]:
    # Heb je veel nodig, dan is een grotere verpakking vaak goedkoper: 3 zakken van 2 kilo of 1 zak van 5 kilo
    u = (unit or "").lower().strip()
    by_weight = u in _MEASURE
    if packs < 2 or not (by_weight or u in ("", "stuks", "stuk", "st")):
        return None
    alts = _size_alts.get((p["product_id"], store))
    if alts is None:
        pool = [d for d in _product_cache.get("docs") or [] if d.get("_src") == store and d.get("is_global")]
        hits = _best_matches(pool, _alt_terms(p["name"], p) or p["name"], 20)
        sub = p.get("subcategory")
        alts = [d for d in hits if d["product_id"] != p["product_id"] and (not sub or d.get("subcategory") in (sub, None)) and _same_kind(p, d)]
        if len(_size_alts) > 3000:
            _size_alts.clear()
        _size_alts[(p["product_id"], store)] = alts
    best = None
    own = _pack_size(p.get("unit") or "") if by_weight else (_pack_count(p.get("unit") or "") or p.get("pack_count") or 1)
    for d in alts:
        price = resolve_price(d.get("prices") or {}, store, d.get("unavailable") or [])
        size = _pack_size(d.get("unit") or "") if by_weight else (_pack_count(d.get("unit") or "") or d.get("pack_count") or 1)
        if not price or not size or (own and size <= own):
            continue  # alleen een grotere verpakking voorstellen
        n = max(1, math.ceil(round(need / size, 3)))
        if n * price < cost * 0.95 - 0.05 and (not best or n * price < best["cost"]):
            best = {"product_id": d["product_id"], "name": d["name"], "image": d.get("image"), "pack_unit": d.get("unit") or "",
                    "packs": n, "pack_price": round(price, 2), "cost": round(n * price, 2), "saving": round(cost - n * price, 2)}
    return best


def _pack_plan(p: dict, qty: float, unit: str, store: Optional[str] = None, site_packs: Optional[float] = None) -> Optional[dict]:
    # Hoeveel verpakkingen heb je nodig, wat kost dat, en is een andere verpakking voordeliger?
    store = store or p.get("_src") or product_source(p)
    price = resolve_price(p.get("prices") or {}, store, p.get("unavailable") or [])
    if not price or not qty:
        return None
    share = _pack_share(unit, p.get("unit") or "", p.get("name") or "", p.get("pack_count"))
    packs = max(1, math.ceil(round(site_packs if site_packs else qty * share, 3)))
    cost = packs * price
    u = (unit or "").lower().strip()
    need = qty * _MEASURE[u] if u in _MEASURE else qty
    better = None
    try:
        better = _bigger_pack(p, need, unit, store, packs, cost)
    except Exception as e:
        logger.warning("Grotere verpakking %s: %r", p.get("name"), e)
    return {"packs": packs, "pack_unit": p.get("unit") or "", "pack_price": round(price, 2), "cost": round(cost, 2), "better": better}


# Gewicht van één stuk, voor producten die per gewicht verkocht worden: 6 blaadjes gelatine passen in één pakje van 23 gram
_PIECE_GRAMS = [("gelatine", 1.65), ("knoflook", 50), ("sjalot", 30), ("ui", 100), ("uien", 100), ("aardappel", 150), ("wortel", 80),
                ("paprika", 150), ("tomaat", 100), ("tomaten", 100), ("appel", 150), ("peer", 150), ("citroen", 100), ("limoen", 70),
                ("banaan", 120), ("bananen", 120), ("sinaasappel", 200), ("mandarijn", 80), ("champignon", 20), ("ei", 60), ("eieren", 60),
                # Kleine stukjes: bessen, blaadjes van verse kruiden, vellen deeg
                ("blaadje", 1), ("blaadjes", 1), ("laurierblaadjes", 0.2), ("salie", 1), ("munt", 1), ("basilicum", 1), ("peterselie", 1),
                ("koriander", 1), ("dragon", 1), ("tijm", 1), ("rozemarijn", 1), ("laurier", 0.2), ("bieslook", 1), ("dille", 1),
                ("bramen", 5), ("braam", 5), ("frambozen", 4), ("framboos", 4), ("aardbeien", 15), ("aardbei", 15), ("bosbessen", 1),
                ("bessen", 1), ("kersen", 8), ("druiven", 5), ("cherrytomaatjes", 15), ("cherrytomaten", 15), ("olijven", 4),
                ("radijs", 10), ("radijsjes", 10), ("bladerdeeg", 45), ("filodeeg", 25), ("courgette", 300), ("komkommer", 350),
                ("aubergine", 300), ("prei", 200), ("avocado", 150), ("mango", 300), ("kiwi", 80), ("kipfilet", 150), ("kipdijfilet", 100),
                ("aardappelen", 150), ("aardappels", 150), ("krieltjes", 30), ("wortels", 80), ("wortelen", 80), ("appels", 150),
                ("peren", 150), ("citroenen", 100), ("limoenen", 70), ("sinaasappels", 200), ("mandarijnen", 80), ("champignons", 20),
                ("sjalotten", 30), ("courgettes", 300), ("komkommers", 350), ("aubergines", 300)]


def _piece_grams(name: str) -> Optional[float]:
    words = set(re.findall(r"[a-z]+", _norm_text(name or "")))
    for w, g in _PIECE_GRAMS:
        if w in words:
            return g
    return None


def _pack_share(item_unit: str, pack: str, name: str = "", count: Optional[int] = None) -> float:
    # Welk deel van één verpakking is één eenheid van het ingrediënt?
    u = (item_unit or "").lower().strip()
    if u in _MEASURE:
        m = _UNIT_RE.search((pack or "").lower())
        if m:
            amount = float(m.group(2).replace(",", ".")) * int(m.group(1) or 1)
            base = {"kg": 1000, "kilo": 1000, "kilogram": 1000, "liter": 1000, "ltr": 1000, "l": 1000, "cl": 10}.get(m.group(3), 1)
            if amount * base > 0:
                return _MEASURE[u] / (amount * base)
        return _MEASURE[u] / 500  # onbekende verpakking: reken met een gewoon pak van 500 gram
    if u in ("", "stuks", "stuk", "st"):
        n = _pack_count(pack) or count or _count_in_text(pack) or _count_in_text(name)
        if n:
            return 1 / n
        m = _UNIT_RE.search((pack or "").lower())
        piece = _piece_grams(name)
        if m and piece and m.group(3) not in ("ml", "cl", "l", "liter", "ltr"):
            amount = float(m.group(2).replace(",", ".")) * int(m.group(1) or 1)
            grams = amount * {"kg": 1000, "kilo": 1000, "kilogram": 1000}.get(m.group(3), 1)
            if grams > piece:
                return piece / grams
        if piece and piece <= 1 and not m:
            return _PART_OF_PACK["takje"]  # een blaadje uit een bosje verse kruiden
        if m and m.group(3) not in ("ml", "cl", "l", "liter", "ltr"):
            # Klein potje of zakje (verse kruiden, specerijen): een "stuk" is dan een blaadje of snufje, geen heel potje
            grams = float(m.group(2).replace(",", ".")) * int(m.group(1) or 1) * {"kg": 1000, "kilo": 1000, "kilogram": 1000}.get(m.group(3), 1)
            if 0 < grams <= 50:
                return min(1.0, 1 / grams)
        return 1.0
    if u in _PART_OF_PACK:
        if u == "plak":
            m = re.search(r"(\d+)\s*(plakken|plakjes|st)", (pack or "").lower())
            if m and int(m.group(1)) > 0:
                return 1 / int(m.group(1))
        return _PART_OF_PACK[u]
    return 1.0


# --- Aantal stuks in een verpakking, uit de productgegevens zelf: naam, verpakking, productinformatie,
# hetzelfde product (barcode) bij een andere winkel, en als laatste de foto van de verpakking ---
_COUNT_WORDS = (r"stuks|stuk|st|blaadjes|blaadje|bladen|vellen|plakjes|plakken|zakjes|zakje|sachets|builtjes|theezakjes|tabletten|"
                r"capsules|rollen|eieren|bollen|bolletjes|repen|wraps|tortilla'?s|broodjes|pads|cups|porties|knoflookbollen|-pack|pack")
_COUNT_RE = re.compile(r"(\d+)\s*(?:" + _COUNT_WORDS + r")\b|(\d+)\s*x\s*\d")


def _count_in_text(text: str) -> Optional[int]:
    for m in _COUNT_RE.finditer((text or "").lower()):
        n = int(m.group(1) or m.group(2))
        if 1 < n <= 200:
            return n
    return None


_count_running: set = set()
PACK_COUNT_RECHECK_DAYS = 30


def _needs_count(p: dict) -> bool:
    if not p or p.get("pack_count") or _pack_count(p.get("unit") or "") or _count_in_text(p.get("unit") or "") or _count_in_text(p.get("name") or ""):
        return False
    checked = p.get("pack_count_checked")
    return not checked or checked < (datetime.now(timezone.utc) - timedelta(days=PACK_COUNT_RECHECK_DAYS)).isoformat()


async def _ai_pack_count(p: dict) -> Optional[int]:
    if not os.environ.get("ANTHROPIC_API_KEY") or not p.get("image"):
        return None
    from anthropic import AsyncAnthropic
    msg = await AsyncAnthropic().beta.messages.create(
        model=DIRK_AI_MODEL, max_tokens=300, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": {
            "type": "object", "additionalProperties": False, "required": ["count"],
            "properties": {"count": {"anyOf": [{"type": "integer"}, {"type": "null"}]}}}}},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "url", "url": p["image"]}},
            {"type": "text", "text": (f"Product: {p.get('name')} ({p.get('unit') or 'geen verpakking bekend'}). Hoeveel losse stuks "
                                      "(blaadjes, plakjes, zakjes, eieren, bollen enz.) zitten er in deze verpakking? Geef alleen een "
                                      "getal als het op de verpakking staat of duidelijk te tellen is, anders null.")}]}])
    text = next((b.text for b in msg.content if b.type == "text"), "")
    n = (json.loads(text) if text and msg.stop_reason not in ("refusal", "max_tokens") else {}).get("count")
    return n if isinstance(n, int) and 1 < n <= 200 else None


async def _learn_pack_count(p: dict) -> Optional[int]:
    pid = p["product_id"]
    if pid in _count_running:
        return None
    _count_running.add(pid)
    n, how = None, None
    try:
        # 1. Hetzelfde product bij een andere winkel (zelfde barcode) noemt het aantal soms wel
        if p.get("barcode"):
            async for o in db.products.find({"barcode": p["barcode"], "product_id": {"$ne": pid}, "deleted_at": None},
                                            {"_id": 0, "unit": 1, "name": 1, "pack_count": 1}).limit(10):
                n = o.get("pack_count") or _pack_count(o.get("unit") or "") or _count_in_text(o.get("unit") or "") or _count_in_text(o.get("name") or "")
                if n:
                    how = "barcode"
                    break
        # 2. De productinformatie van de winkel (omschrijving, gebruik, inhoud)
        src = product_source(p)
        fn = {"Dirk": _dirk_details, "Albert Heijn": _ah_details, "Jumbo": _jumbo_details}.get(src)
        if not n and fn:
            try:
                d = await asyncio.wait_for(fn(p), 15)
                texts = [d.get("description"), d.get("usage"), d.get("storage")] + [f"{e.get('label')}: {e.get('value')}" for e in d.get("extra") or []]
                n = next((c for c in (_count_in_text(t or "") for t in texts) if c), None)
                how = "productinfo" if n else None
            except Exception as e:
                logger.info("Aantal per pak %s: productinfo %r", p.get("name"), e)
        # 3. De foto van de verpakking laten lezen
        if not n:
            try:
                n = await _ai_pack_count(p)
                how = "foto" if n else None
            except Exception as e:
                logger.warning("Aantal per pak %s: foto lezen %r", p.get("name"), e)
        now = datetime.now(timezone.utc).isoformat()
        await db.products.update_one({"product_id": pid}, {"$set": {"pack_count": n, "pack_count_from": how, "pack_count_checked": now}})
        for c in ((_product_cache.get("by_pid") or {}).get(pid), p):
            if c is not None:
                c.update({"pack_count": n, "pack_count_from": how, "pack_count_checked": now})
        if n:
            logger.info("Aantal per pak: %s = %s stuks (%s)", p.get("name"), n, how)
        return n
    finally:
        _count_running.discard(pid)


async def _learn_pack_counts(products: list, wait: float = 8) -> None:
    # Ontbreekt het aantal stuks, zoek het op; even wachten zodat de eerste berekening al klopt, de rest loopt door
    todo = [p for p in products if _needs_count(p)][:12]
    if not todo:
        return
    tasks = [asyncio.create_task(_learn_pack_count(p)) for p in todo]
    try:
        await asyncio.wait(tasks, timeout=wait)
    except Exception:
        pass


def _unit_value(price: float, qty: str) -> Optional[tuple]:
    # "2 liter", "1,5 l", "6 x 330 ml", "500 gram" -> (prijs per liter of kilo, "liter"/"kilo")
    if not price or not qty:
        return None
    m = _UNIT_RE.search(qty.lower())
    if not m:
        return None
    amount = float(m.group(2).replace(",", ".")) * int(m.group(1) or 1)
    u = m.group(3)
    if u in ("g", "gr", "gram"):
        amount, per = amount / 1000, "kilo"
    elif u in ("kg", "kilo", "kilogram"):
        per = "kilo"
    elif u == "ml":
        amount, per = amount / 1000, "liter"
    elif u == "cl":
        amount, per = amount / 100, "liter"
    else:
        per = "liter"
    if amount <= 0:
        return None
    return (round(price / amount, 2), per)


def _strip_html(h: str) -> str:
    from html import unescape
    t = re.sub(r"<li[^>]*>", "\n• ", h or "")
    t = re.sub(r"</p>|<br\s*/?>", "\n", t)
    t = unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n\s*\n+", "\n", t).strip()


def _texts(x) -> list:
    # Haalt leesbare tekst uit een onbekende structuur
    if x is None or x == "" or isinstance(x, bool):
        return []
    if isinstance(x, (str, int, float)):
        return [str(x).strip()] if str(x).strip() else []
    if isinstance(x, list):
        out = []
        for v in x:
            out += _texts(v)
        return out
    if isinstance(x, dict):
        for k in ("text", "label", "name", "description", "title", "value"):
            if isinstance(x.get(k), (str, int, float)) and str(x.get(k)).strip():
                return [str(x[k]).strip()]
        out = []
        for k, v in x.items():
            if k.startswith("__"):
                continue
            out += _texts(v)
        return out
    return []


def _join(x) -> Optional[str]:
    t = [v for v in _texts(x) if v]
    return "\n".join(t) if t else None


def _empty_details(source: str, url: str) -> dict:
    return {"source": source, "url": url, "description": None, "unit_price": None, "ingredients": None, "allergens": [],
            "nutrition": None, "storage": None, "usage": None, "origin": None, "nutriscore": None, "labels": [], "diets": [], "extra": []}


async def _dirk_details(doc: dict) -> dict:
    pid = str(doc["dirk_id"])
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
        r = await c.get(f"https://www.dirk.nl/boodschappen/x/x/x/{pid}", headers=_PAGE_HEADERS)
    data = _nuxt_data(r.text)
    out = _empty_details("Dirk", str(r.url))
    if not data:
        raise RuntimeError(f"Dirk-pagina zonder gegevens ({r.status_code})")
    prod = _find_dict(data, "productInformation") or {}
    info = prod.get("productInformation") or {}
    decl_holder = _find_dict(data, "declarations") or {}
    decl = decl_holder.get("declarations") or {}
    out["description"] = (info.get("subText") or "").strip() or None
    price = prod.get("offerPrice") or prod.get("normalPrice") or 0
    out["unit_price"] = _unit_price_from(float(price or 0), info.get("packaging") or doc.get("unit") or "")
    ing = (decl.get("ingredients") or "").strip()
    out["ingredients"] = re.sub(r"^ingredi[eë]nten\s*:\s*", "", ing, flags=re.I) or None
    for k, v in decl.items():
        if "allerg" in k.lower():
            out["allergens"] += _texts(v)
    ni = decl.get("nutritionalInformation") or {}
    rows = []
    for nv in ni.get("nutritionalValues") or []:
        rows.append([nv.get("text") or "", str(nv.get("value") or "").replace(".", ",")])
        for sv in nv.get("nutritionalSubValues") or []:
            rows.append(["  " + (sv.get("text") or ""), str(sv.get("value") or "").replace(".", ",")])
    if rows:
        basis = (ni.get("standardPackagingUnit") or "100 g").replace("MLT", "ml").replace("GRM", "g")
        out["nutrition"] = {"columns": ["", f"Per {basis}"], "rows": rows}
    out["storage"] = _join(decl.get("storageInstructions"))
    out["usage"] = _join((decl.get("instructionsForUse") or []) + (decl.get("cookingInstructions") or []))
    out["labels"] = [l.get("description") for l in (info.get("logos") or []) if isinstance(l, dict) and l.get("description")]
    contact = decl.get("contactInformation") or {}
    if contact.get("contactName"):
        out["extra"].append({"label": "Afzender", "value": ", ".join(x for x in [contact.get("contactName"), contact.get("contactAdress")] if x)})
    # Vangnet: allergenen staan soms los in de pagina, als lijst met {"text": "Bevat ..."}
    if not out["allergens"]:
        found = []
        def walk(x, depth=0):
            if depth > 8 or len(found) > 20:
                return
            if isinstance(x, dict):
                for v in x.values():
                    walk(v, depth + 1)
            elif isinstance(x, list):
                if x and all(isinstance(i, dict) and set(i.keys()) == {"text"} for i in x):
                    t = [i["text"] for i in x if isinstance(i.get("text"), str)]
                    if any(re.match(r"(bevat|kan .*bevatten|sporen)", v, re.I) for v in t):
                        found.extend(t)
                        return
                for v in x:
                    walk(v, depth + 1)
        walk(decl_holder)
        out["allergens"] = found
    return out


async def _ah_details(doc: dict) -> dict:
    pid = str(doc["ah_id"])
    out = _empty_details("Albert Heijn", f"https://www.ah.nl/producten/product/wi{pid}")
    async with httpx.AsyncClient(timeout=15, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        r = await c.get(f"https://api.ah.nl/mobile-services/product/detail/v4/fir/{pid}",
                        headers={"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"})
    body = r.json() or {}
    card = body.get("productCard") or {}
    trade = body.get("tradeItem") or {}
    props = body.get("properties") or {}
    if not card:
        raise RuntimeError(f"AH gaf geen product ({r.status_code})")
    desc = "\n".join(x for x in [_strip_html(card.get("descriptionHighlights") or ""), _strip_html(card.get("descriptionFull") or "")] if x)
    out["description"] = desc or None
    price = card.get("currentPrice") or card.get("priceBeforeBonus") or 0
    upd = (card.get("unitPriceDescription") or "").strip()
    out["unit_price"] = (upd[0].upper() + upd[1:]) if upd else _unit_price_from(float(price or 0), card.get("salesUnitSize") or "")
    ing = _find_dict(trade, "ingredientStatement")
    if ing:
        out["ingredients"] = _join(ing.get("ingredientStatement"))
    if not out["ingredients"]:
        for k, v in trade.items():
            if "ingredient" in k.lower():
                out["ingredients"] = _join(v)
                break
    if out["ingredients"]:
        out["ingredients"] = re.sub(r"^ingredi[eë]nten\s*:\s*", "", out["ingredients"], flags=re.I)
    groups: Dict[str, list] = {}
    for block in trade.get("allergenInformation") or []:
        for it in (block or {}).get("items") or []:
            lvl = ((it.get("levelOfContainmentCode") or {}).get("label") or "Bevat").strip()
            name = ((it.get("typeCode") or {}).get("label") or "").strip()
            if name:
                groups.setdefault(lvl, []).append(name.lower())
    out["allergens"] = [f"{lvl}: {', '.join(v)}" for lvl, v in groups.items()]
    headers = ((trade.get("nutritionalInformation") or {}).get("nutrientHeaders") or [])
    if headers:
        h = headers[0]
        bq = h.get("nutrientBasisQuantity") or {}
        unit = ((bq.get("measurementUnitCode") or {}).get("value") or "").strip()
        val = bq.get("value")
        basis = f"{int(val) if isinstance(val, (int, float)) and float(val).is_integer() else val} {unit}".strip() if val else "100 g"
        rows = []
        for nd in h.get("nutrientDetail") or []:
            label = ((nd.get("nutrientTypeCode") or {}).get("label") or "").strip()
            qc = (nd.get("quantityContained") or [{}])[0] or {}
            v = qc.get("value")
            u = ((qc.get("measurementUnitCode") or {}).get("value") or "")
            vs = (f"{v:g}" if isinstance(v, (int, float)) else str(v or "")).replace(".", ",")
            rows.append([("  " + label) if label.lower().startswith("waarvan") else label, f"{vs} {u}".strip()])
        if rows:
            out["nutrition"] = {"columns": ["", f"Per {basis}"], "rows": rows}
    ci = trade.get("consumerInstructions") or {}
    out["storage"] = _join(ci.get("storageInstructions"))
    out["usage"] = _join(ci.get("usageInstructions"))
    ns = props.get("nutriscore") or [card.get("nutriscore")]
    out["nutriscore"] = (ns[0] if ns and ns[0] else None)
    acc = {"WEIDEMELK": "Weidemelk", "ON_THE_WAY_TO_PLANETPROOF": "On the way to PlanetProof", "BETER_LEVEN_1_STER": "Beter Leven 1 ster",
           "BETER_LEVEN_2_STER": "Beter Leven 2 sterren", "BETER_LEVEN_3_STER": "Beter Leven 3 sterren", "EU_BIOLOGISCH": "Biologisch",
           "FAIRTRADE": "Fairtrade", "RAINFOREST_ALLIANCE": "Rainforest Alliance", "MSC": "MSC", "ASC": "ASC", "UTZ": "UTZ"}
    out["labels"] = [acc.get(a, a.replace("_", " ").capitalize()) for a in (props.get("da_accreditation") or [])]
    out["labels"] += [i.get("description") or i.get("name") for i in (card.get("propertyIcons") or []) if isinstance(i, dict) and (i.get("description") or i.get("name"))]
    diets = []
    for k, v in props.items():
        if k.startswith("sp_include_"):
            diets += [x for x in (v or []) if x]
    out["diets"] = diets
    if card.get("mainCategory") or card.get("subCategory"):
        out["extra"].append({"label": "Categorie", "value": " › ".join(x for x in [card.get("mainCategory"), card.get("subCategory")] if x)})
    if card.get("minBestBeforeDays"):
        out["extra"].append({"label": "Minimaal houdbaar", "value": f"{card['minBestBeforeDays']} dagen na levering"})
    serv = ((trade.get("foodAndBeveragePreparationServing") or {}).get("servingQuantityInformation") or {}).get("numberOfServingsPerPackage")
    if serv:
        out["extra"].append({"label": "Porties per verpakking", "value": f"ongeveer {serv:g}" if isinstance(serv, (int, float)) else str(serv)})
    return out


def _jumbo_table(t) -> Optional[dict]:
    # Jumbo: voedingstabel als kolommen en rijen; lege kolommen weglaten
    if not t:
        return None
    cols, rows = [], []
    if isinstance(t, dict):
        cols = [(_texts(c) or [""])[0] for c in (t.get("columns") or t.get("headers") or t.get("header") or [])]
        raw_rows = t.get("rows") or t.get("body") or t.get("values") or []
    else:
        raw_rows = t
    for row in raw_rows or []:
        cells = row.get("cells") or row.get("columns") or row.get("values") if isinstance(row, dict) else row
        if isinstance(cells, list):
            rows.append([(_texts(c) or [""])[0] for c in cells])
        elif isinstance(row, dict):
            rows.append([str(v) for k, v in row.items() if not k.startswith("__") and isinstance(v, (str, int, float))])
    if not rows:
        return None
    width = max(len(r) for r in rows + ([cols] if cols else []))
    rows = [r + [""] * (width - len(r)) for r in rows]
    cols = (cols + [""] * (width - len(cols))) if cols else [""] * width
    keep = [i for i in range(width) if i == 0 or cols[i] or any(r[i] for r in rows)]
    # Een lege eerste rij-cel bij een vervolg (kcal na kJ) laten we leeg; de app toont die als vervolgregel
    return {"columns": [cols[i] for i in keep], "rows": [[r[i] for i in keep] for r in rows]}


async def _jumbo_details(doc: dict) -> dict:
    sku = str(doc["jumbo_id"])
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
        r = await c.get(f"https://www.jumbo.com/producten/x-{sku}", headers=_PAGE_HEADERS)
    data = _nuxt_data(r.text)
    out = _empty_details("Jumbo", str(r.url))
    p = _find_dict(data, "nutritionsTable") or _find_dict(data, "customerAllergies") if data else None
    if not p:
        raise RuntimeError(f"Jumbo-pagina zonder gegevens ({r.status_code})")
    if _detail_logged["Jumbo"] < 2:
        _detail_logged["Jumbo"] += 1
        import json as _json
        logger.info("Jumbo details vorm: nutritionsTable=%s allergens=%s nutriScore=%s",
                    _json.dumps(p.get("nutritionsTable"), default=str)[:700], _json.dumps(p.get("productAllergens"), default=str)[:400],
                    _json.dumps(p.get("nutriScore"), default=str)[:200])
    out["description"] = _strip_html(p.get("description") or "") or None
    ppu = (p.get("price") or {}).get("pricePerUnit") or {}
    unit = {"l": "liter", "kg": "kilo"}.get(str(ppu.get("unit") or "").lower())
    if ppu.get("price") and unit:
        out["unit_price"] = f"{_euro(ppu['price'] / 100)} per {unit}"
    else:
        cents = (p.get("price") or {}).get("promoPrice") or (p.get("price") or {}).get("price") or 0
        out["unit_price"] = _unit_price_from(cents / 100, doc.get("unit") or p.get("subtitle") or "")
    out["ingredients"] = ", ".join(_texts(p.get("ingredients"))) or None
    al = p.get("productAllergens")
    if isinstance(al, dict):
        names = {"contains": "Bevat", "mayContain": "Kan bevatten", "may_contain": "Kan bevatten", "freeFrom": "Vrij van"}
        for k, v in al.items():
            if k.startswith("__"):
                continue
            t = _texts(v)
            if t:
                out["allergens"].append(f"{names.get(k, k)}: {', '.join(t)}")
    else:
        out["allergens"] = _texts(al)
    out["nutrition"] = _jumbo_table(p.get("nutritionsTable"))
    out["storage"] = _join(p.get("storage"))
    out["usage"] = _join(p.get("preparationAndUsage"))
    out["origin"] = _join(p.get("origin"))
    ns = p.get("nutriScore")
    ns_t = _texts(ns.get("value") if isinstance(ns, dict) and "value" in ns else ns)
    out["nutriscore"] = next((x.upper() for x in ns_t if re.fullmatch(r"[A-Ea-e]", x)), None)
    out["labels"] = _texts((p.get("characteristics") or {}).get("thirdPartyLogos"))
    cats = [c.get("name") for c in (p.get("categories") or []) if isinstance(c, dict) and c.get("name")]
    if cats:
        out["extra"].append({"label": "Categorie", "value": " › ".join(cats)})
    for key, label in (("additives", "Toevoegingen"), ("alcoholByVolume", "Alcoholpercentage"), ("drainedWeight", "Uitlekgewicht"),
                       ("safetyWarning", "Waarschuwing"), ("manufacturer", "Fabrikant"), ("regulatedProductName", "Wettelijke naam")):
        v = _join(p.get(key))
        if v and v not in ("0", "0.0"):
            out["extra"].append({"label": label, "value": v})
    return out


@api_router.get("/products/{product_id}/details")
async def product_details(product_id: str, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"product_id": product_id, "deleted_at": None}, {"_id": 0})
    if not doc or (not doc.get("is_global") and doc.get("owner_id") != user["user_id"]):
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    src = product_source(doc)
    if not src:
        return _empty_details("", "")
    hit = _detail_cache.get(product_id)
    now = datetime.now(timezone.utc)
    if hit and (now - hit[0]).total_seconds() < DETAIL_CACHE_SECONDS:
        return hit[1]
    try:
        fn = {"Dirk": _dirk_details, "Albert Heijn": _ah_details, "Jumbo": _jumbo_details}[src]
        out = await fn(doc)
    except Exception as e:
        logger.warning("Productdetails %s (%s) mislukt: %r", product_id, src, e)
        raise HTTPException(status_code=502, detail=f"De productinformatie van {src} is nu niet op te halen")
    out["labels"] = list(dict.fromkeys(x for x in out["labels"] if x))
    out["diets"] = list(dict.fromkeys(x for x in out["diets"] if x))
    if len(_detail_cache) > 800:
        _detail_cache.clear()
    _detail_cache[product_id] = (now, out)
    return out


@api_router.post("/products/{product_id}/favorite")
async def add_favorite(product_id: str, user: dict = Depends(get_current_user)):
    if not await db.products.find_one({"product_id": product_id, "deleted_at": None}):
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    await db.users.update_one({"user_id": user["user_id"]}, {"$addToSet": {"favorite_products": product_id}})
    return {"ok": True, "is_favorite": True}


@api_router.delete("/products/{product_id}/favorite")
async def remove_favorite(product_id: str, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$pull": {"favorite_products": product_id}})
    return {"ok": True, "is_favorite": False}


@api_router.post("/products")
async def create_product(data: ProductInput, user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    can_global = "manage_products" in perms
    make_global = bool(data.is_global and can_global)
    active_stores = await get_active_stores()
    prices = {k: round(float(v), 2) for k, v in (data.prices or {}).items() if k in active_stores and v}
    unavailable = [s for s in (data.unavailable or []) if s in active_stores]
    product_id = f"prod_{uuid.uuid4().hex[:12]}"
    doc = {
        "product_id": product_id,
        "name": data.name.strip(),
        "aisle": data.aisle if data.aisle in AISLES else "Overig",
        "unit": data.unit.strip() or "stuks",
        "brand": (data.brand or "").strip() or None,
        "barcode": (data.barcode or "").strip() or None,
        "prices": prices,
        "unavailable": unavailable,
        "is_global": make_global,
        "owner_id": None if make_global else user["user_id"],
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.products.insert_one(doc)
    _invalidate_products()
    return product_public(doc, user.get("store", DEFAULT_STORE), user["user_id"])


@api_router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductInput, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"product_id": product_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    perms = await user_permissions(user)
    if doc.get("is_global"):
        if "manage_products" not in perms:
            raise HTTPException(status_code=403, detail="Alleen de beheerder kan algemene producten aanpassen")
    elif doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen producten aanpassen")
    active_stores = await get_active_stores()
    prices = {k: round(float(v), 2) for k, v in (data.prices or {}).items() if k in active_stores and v}
    unavailable = [s for s in (data.unavailable or []) if s in active_stores]
    await db.products.update_one(
        {"product_id": product_id},
        {"$set": {
            "name": data.name.strip(),
            "aisle": data.aisle if data.aisle in AISLES else "Overig",
            "unit": data.unit.strip() or "stuks",
            "brand": (data.brand or "").strip() or None,
            "barcode": (data.barcode or "").strip() or None,
            "prices": prices,
            "unavailable": unavailable,
        }},
    )
    _invalidate_products()
    updated = await db.products.find_one({"product_id": product_id}, {"_id": 0})
    return product_public(updated, user.get("store", DEFAULT_STORE), user["user_id"])


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(get_current_user)):
    doc = await db.products.find_one({"product_id": product_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    perms = await user_permissions(user)
    if doc.get("is_global"):
        if "manage_products" not in perms:
            raise HTTPException(status_code=403, detail="Alleen de beheerder kan algemene producten verwijderen")
    elif doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen producten verwijderen")
    await db.products.update_one({"product_id": product_id}, {"$set": {"deleted_at": now_utc()}})
    _invalidate_products()
    return {"ok": True}


# --- Open Food Facts lookup (barcode + search) ---
OFF_HEADERS = {"User-Agent": "SlimBoodschappenlijstje/1.0 (scoutkook app)"}


def _off_normalize(p: dict) -> Optional[dict]:
    name = (p.get("product_name_nl") or p.get("product_name") or "").strip()
    if not name:
        return None
    return {
        "name": name[:80],
        "brand": ((p.get("brands") or "").split(",")[0].strip() or None),
        "barcode": p.get("code") or p.get("_id"),
        "quantity": (p.get("quantity") or "").strip() or None,
    }


@api_router.get("/off/barcode/{code}")
async def off_barcode(code: str, user: dict = Depends(get_current_user)):
    url = f"https://world.openfoodfacts.org/api/v2/product/{code}.json"
    try:
        async with httpx.AsyncClient(timeout=15, headers=OFF_HEADERS) as c:
            r = await c.get(url, params={"fields": "product_name,product_name_nl,brands,code,quantity"})
        data = r.json()
    except Exception:
        raise HTTPException(status_code=502, detail="Kon product niet opzoeken")
    if data.get("status") != 1 or not data.get("product"):
        raise HTTPException(status_code=404, detail="Geen product gevonden voor deze barcode")
    norm = _off_normalize({**data["product"], "code": code})
    if not norm:
        raise HTTPException(status_code=404, detail="Geen productnaam gevonden")
    return norm


OFF_SYNONYMS = {
    "patat": ["friet", "frites", "frieten", "aardappel"],
    "friet": ["patat", "frites", "frieten"],
    "frieten": ["patat", "friet"],
    "chip": ["chips"],
    "chips": ["chips"],
    "fris": ["frisdrank", "limonade", "cola"],
    "frisdrank": ["cola", "limonade"],
    "snoep": ["snoepgoed"],
    "pindakaas": ["pindakaas"],
    "ranja": ["siroop", "limonadesiroop"],
    "ijs": ["roomijs"],
}


def _candidate_terms(q: str) -> list:
    base = q.strip().lower()
    terms = [base]
    for s in OFF_SYNONYMS.get(base, []):
        if s not in terms:
            terms.append(s)
    # simple singular/plural variants
    if base.endswith("s") and base[:-1] not in terms:
        terms.append(base[:-1])
    elif not base.endswith("s") and base + "s" not in terms:
        terms.append(base + "s")
    return terms[:4]


async def _off_query(term: str, nl_only: bool) -> list:
    params = {
        "search_terms": term,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": 20,
        "sort_by": "unique_scans_n",
        "lc": "nl",
        "fields": "product_name,product_name_nl,brands,code,quantity",
    }
    if nl_only:
        params["countries_tags_en"] = "netherlands"
    try:
        async with httpx.AsyncClient(timeout=15, headers=OFF_HEADERS) as c:
            r = await c.get("https://world.openfoodfacts.org/cgi/search.pl", params=params)
        return r.json().get("products", [])
    except Exception:
        return []


@api_router.get("/off/search")
async def off_search(q: str, user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"results": []}
    terms = _candidate_terms(q)
    # NL-first across candidate terms, then a global fallback on the raw query
    batches = await asyncio.gather(*[_off_query(t, True) for t in terms])
    products = [p for batch in batches for p in batch]
    out, seen = [], set()

    def collect(items):
        for p in items:
            norm = _off_normalize(p)
            if norm and norm["name"].lower() not in seen:
                seen.add(norm["name"].lower())
                out.append(norm)

    collect(products)
    if len(out) < 5:
        collect(await _off_query(q.strip(), False))
    return {"results": out[:20]}


# --- Dirk supermarket live product + price search (public web gateway) ---
DIRK_GQL = "https://web-gateway.dirk.nl/graphql"
DIRK_STORE_ID = 66  # webwinkel van dirk.nl; filiaalnummers (bijv. Leiderdorp 1067) geven geen productdata
DIRK_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) Chrome/120 Mobile Safari/537.36",
    "Origin": "https://www.dirk.nl",
}


def _cat_tokens(s: str) -> list:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return [t for t in re.split(r"[^a-z]+", s) if t]


# Afdelingen herkennen aan hele woorden uit de categorie van Dirk/AH (geen stukjes woord,
# anders wordt bijv. "rijst" diepvries door "ijs"). Volgorde = voorrang bij twijfel.
AISLE_RULES = [
    ("Diepvries", {"diepvries", "ijs", "ijsjes"}),
    ("Kind & drogisterij", {"drogisterij", "drogist", "baby", "kind", "kinderen", "verzorging", "gezondheid", "sport", "beauty", "persoonlijke", "hygiene"}),
    ("Huishoud & huisdieren", {"huishoud", "huishouden", "huishoudelijk", "huisdier", "huisdieren", "dier", "dieren", "schoonmaak", "wasmiddel", "wasmiddelen"}),
    ("Non food", {"non", "nonfood", "koken", "tafelen", "vrije", "tijd", "tuin", "speelgoed", "elektronica", "seizoen"}),
    ("Maaltijden, salades & tapas", {"maaltijd", "maaltijden", "salade", "salades", "tapas", "pizza", "pizzas", "kant", "klaar"}),
    ("Aardappelen, groente & fruit", {"aardappel", "aardappelen", "groente", "groenten", "fruit", "aardappelproducten"}),
    ("Vlees & vis", {"vlees", "vis", "kip", "gevogelte", "vega", "vegetarisch", "vegan", "vleesvervangers", "vleeswaren", "slager", "slagerij", "visafdeling"}),
    ("Brood, beleg & koek", {"brood", "bakkerij", "banket", "beleg", "broodbeleg", "ontbijt", "ontbijtgranen", "koek", "koeken", "zoet", "smeerbaar"}),
    ("Zuivel & kaas", {"zuivel", "kaas", "eieren", "ei", "melk", "yoghurt", "boter", "toetjes", "desserts", "kwark", "room"}),
    ("Dranken, sap, koffie & thee", {"drank", "dranken", "frisdrank", "frisdranken", "sap", "sappen", "water", "koffie", "thee", "bier", "wijn", "wijnen", "aperitieven", "siropen", "alcohol", "alcoholvrij", "bubbels", "sterke"}),
    ("Snacks & snoep", {"snoep", "chocolade", "chips", "noten", "snacks", "snack", "tussendoortjes", "popcorn", "toast", "borrel", "zoutjes"}),
    ("Voorraadkast", {"pasta", "rijst", "wereldkeuken", "soep", "soepen", "saus", "sauzen", "kruiden", "specerijen", "olie", "azijn", "conserven", "voorraad", "voorraadkast", "houdbaar", "bakken", "bakproducten", "mix", "mixen"}),
]
_AISLE_EXACT = {" ".join(_cat_tokens(a)).replace(" en ", " "): a for a in AISLES}


def _aisles_in(text: str) -> list:
    toks = set(_cat_tokens(text))
    return [aisle for aisle, words in AISLE_RULES if toks & words]


def _dirk_aisle(department: str, webgroup: str, name: str = "") -> str:
    # 1. Precies een van onze afdelingen (onze lijst volgt de indeling van Dirk)
    key = " ".join(_cat_tokens(department)).replace(" en ", " ")
    if key in _AISLE_EXACT:
        return _AISLE_EXACT[key]
    main = _aisles_in(department)
    sub = _aisles_in(webgroup)
    # 2. Hoofdcategorie is eenduidig
    if len(main) == 1:
        return main[0]
    # 3. Hoofdcategorie is gemengd (bijv. "Kaas, vleeswaren, tapas"): subcategorie beslist
    if sub:
        both = [a for a in sub if a in main] if main else sub
        return (both or sub)[0]
    # 4. Geen subcategorie: de productnaam beslist (bijv. "Jong belegen kaas" bij "Kaas, vleeswaren en tapas")
    if name:
        by_name = _aisles_in(name)
        hit = [a for a in by_name if a in main] if main else by_name
        if hit:
            return hit[0]
    if main:
        return main[0]
    return "Overig"


_NUXT_RE = re.compile(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', re.S)
_NUXT_WRAPPERS = {"Reactive", "ShallowReactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef", "NuxtError", "Island"}


def _nuxt_data(html: str):
    # Nuxt-sites (Dirk, Jumbo) zetten alle paginadata als "devalue"-lijst in de pagina:
    # getallen in objecten en lijsten verwijzen naar een plek in die lijst.
    import json as _json
    m = _NUXT_RE.search(html or "")
    if not m:
        return None
    try:
        arr = _json.loads(m.group(1))
    except Exception:
        return None
    memo: dict = {}

    def rev(i, depth=0):
        if not isinstance(i, int) or i < 0 or i >= len(arr) or depth > 200:
            return None
        if i in memo:
            return memo[i]
        v = arr[i]
        if isinstance(v, list):
            if v and isinstance(v[0], str) and v[0] in _NUXT_WRAPPERS:
                out = rev(v[1], depth + 1) if len(v) > 1 else None
            elif v and v[0] in ("Set",):
                out = [rev(x, depth + 1) for x in v[1:]]
            elif v and v[0] in ("Map", "null"):
                out = {}
                rest = v[1:]
                for k in range(0, len(rest) - 1, 2):
                    out[str(rev(rest[k], depth + 1))] = rev(rest[k + 1], depth + 1)
            elif v and v[0] == "Date":
                out = v[1] if len(v) > 1 else None
            else:
                out = []
                memo[i] = out
                out.extend(rev(x, depth + 1) for x in v)
                return out
        elif isinstance(v, dict):
            out = {}
            memo[i] = out
            for k, x in v.items():
                out[k] = rev(x, depth + 1)
            return out
        else:
            out = v
        memo[i] = out
        return out

    return rev(0)


def _find_dict(obj, key: str, seen=None):
    # Eerste object (diep zoeken) dat dit veld heeft
    seen = seen if seen is not None else set()
    if id(obj) in seen:
        return None
    seen.add(id(obj))
    if isinstance(obj, dict):
        if key in obj:
            return obj
        vals = obj.values()
    elif isinstance(obj, list):
        vals = obj
    else:
        return None
    for v in vals:
        f = _find_dict(v, key, seen)
        if f is not None:
            return f
    return None


# --- Acties en folders (AH bonus, Dirk aanbiedingen, Jumbo acties) ---
FOLDER_REFRESH_SECONDS = 3 * 3600
_folders: dict = {"at": None, "data": {}, "by_id": {}, "task": None}
_DUTCH_DAYS = ["ma", "di", "wo", "do", "vr", "za", "zo"]
_DUTCH_MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]


def _iso_day(v) -> Optional[str]:
    v = str(v or "")
    m = re.match(r"(\d{4}-\d{2}-\d{2})", v)
    return m.group(1) if m else None


def _nice_day(d: Optional[str]) -> str:
    try:
        dt = datetime.strptime(d, "%Y-%m-%d")
        return f"{_DUTCH_DAYS[dt.weekday()]} {dt.day} {_DUTCH_MONTHS[dt.month - 1]}"
    except Exception:
        return d or ""


def _nice_label(t: str) -> str:
    t = re.sub(r"\s+", " ", (t or "").replace("_", " ")).strip()
    if not t:
        return ""
    t = t.lower()
    t = re.sub(r"(\d)\.(\d\d)\b", r"\1,\2", t)
    return t[0].upper() + t[1:]


def _promo_deal(label: str, price: float) -> Optional[dict]:
    # Rekent de actie uit: hoeveel stuks je moet kopen en wat je dan per stuk betaalt
    t = (label or "").lower().replace(",", ".")
    n, total = None, None
    m = re.search(r"(\d+)\s*\+\s*(\d+)\s*(gratis)?", t)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        n, total = a + b, a * price
    elif re.search(r"(\d+)e\s+gratis", t):
        k = int(re.search(r"(\d+)e\s+gratis", t).group(1))
        n, total = k, (k - 1) * price
    elif re.search(r"(\d+)e\s+halve\s+prijs", t):
        k = int(re.search(r"(\d+)e\s+halve\s+prijs", t).group(1))
        n, total = k, (k - 0.5) * price
    elif re.search(r"(\d+)\s+halen\s+(\d+)\s+betalen", t):
        m = re.search(r"(\d+)\s+halen\s+(\d+)\s+betalen", t)
        n, total = int(m.group(1)), int(m.group(2)) * price
    elif re.search(r"(\d+)\s*voor\s*€?\s*(\d+(?:\.\d+)?)", t):
        m = re.search(r"(\d+)\s*voor\s*€?\s*(\d+(?:\.\d+)?)", t)
        n, total = int(m.group(1)), float(m.group(2))
    elif re.search(r"(\d+)\s*%\s*korting", t):
        pct = int(re.search(r"(\d+)\s*%\s*korting", t).group(1))
        if price:
            return {"count": 1, "total": round(price * (100 - pct) / 100, 2), "each": round(price * (100 - pct) / 100, 2)}
        return None
    if not n or total is None or (not price and "voor" not in t):
        return None
    return {"count": n, "total": round(total, 2), "each": round(total / n, 2)}


def _promo_item(store: str, pid: str, title: str, label: str, start, end, image=None, price=None, regular=None,
                ids=None, combinable=False, note=None, quantity=None) -> dict:
    return {"store": store, "id": str(pid), "title": (title or "").strip(), "label": _nice_label(label), "start": _iso_day(start),
            "end": _iso_day(end), "image": image, "price": price, "regular": regular, "ids": [str(i) for i in (ids or [])],
            "combinable": bool(combinable), "note": note, "quantity": quantity}


async def _ah_folder() -> list:
    out = []
    async with httpx.AsyncClient(timeout=20, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
        meta = (await c.get("https://api.ah.nl/mobile-services/bonuspage/v3/metadata", headers=H)).json() or {}
        sem = asyncio.Semaphore(4)
        for per in (meta.get("periods") or [])[:2]:
            tab = next((t for t in per.get("tabs") or [] if t.get("description") == "Alle Bonus"), None)
            urls = [u["url"] for u in (tab or {}).get("urlMetadataList") or [] if u.get("url") and u.get("bonusType") != "SPOTLIGHT"]

            async def get(u):
                async with sem:
                    try:
                        return (await c.get("https://api.ah.nl/mobile-services/" + u, headers=H)).json() or {}
                    except Exception:
                        return {}
            items: dict = {}
            for order, body in enumerate(await asyncio.gather(*(get(u) for u in urls))):
                cat = body.get("sectionDescription") or "Overig"
                for e in body.get("bonusGroupOrProducts") or []:
                    g, pr = e.get("bonusGroup"), e.get("product")
                    src = g or pr or {}
                    labels = src.get("discountLabels") or []
                    label = (labels[0].get("defaultDescription") if labels else None) or src.get("discountDescription") or src.get("bonusMechanism") or "Bonus"
                    imgs = sorted([i for i in src.get("images") or [] if i.get("url")], key=lambda i: abs((i.get("width") or 200) - 300))
                    start = src.get("bonusStartDate") or (src.get("validityPeriod") or {}).get("start") or per.get("bonusStartDate")
                    end = src.get("bonusEndDate") or (src.get("validityPeriod") or {}).get("end") or per.get("bonusEndDate")
                    note = " ".join(src.get("extraDescriptions") or []) or None
                    if src.get("isStapelBonus"):
                        note = ("Stapelkorting: hoe meer je koopt, hoe meer korting. " + (note or "")).strip()
                    if g:
                        key = f"g{g.get('segmentId') or g.get('id')}"
                        items[key] = _promo_item("Albert Heijn", key, g.get("segmentDescription"), label, start, end,
                                                 imgs[0]["url"] if imgs else None, combinable=True, note=note)
                        items[key].update({"category": cat, "order": order * 1000 + len(items)})
                    elif pr:
                        key = f"s{pr.get('segmentId')}" if pr.get("segmentId") else f"p{pr.get('webshopId')}"
                        cur, before = pr.get("currentPrice"), pr.get("priceBeforeBonus")
                        if key in items:
                            items[key]["ids"].append(str(pr.get("webshopId")))
                            continue
                        items[key] = _promo_item("Albert Heijn", key, pr.get("title"), label, start, end, imgs[0]["url"] if imgs else None,
                                                 price=cur, regular=before, ids=[pr.get("webshopId")], note=note, quantity=pr.get("salesUnitSize"))
                        items[key].update({"category": cat, "order": order * 1000 + len(items)})
            # Welke producten vallen onder een groep ("Alle Hak")? Die vraagt AH per groep op.
            async def expand(it):
                async with sem:
                    try:
                        seg = it["id"][1:]
                        body = (await c.get("https://api.ah.nl/mobile-services/bonuspage/v2/segment", headers=H,
                                            params={"application": "AHWEBSHOP", "date": per.get("bonusStartDate"), "segmentId": seg})).json() or {}
                    except Exception:
                        return
                    prices = {}
                    for pr in body.get("products") or []:
                        wid = pr.get("webshopId")
                        if wid:
                            it["ids"].append(str(wid))
                            prices[str(wid)] = [pr.get("currentPrice"), pr.get("priceBeforeBonus")]
                    it["prices"] = prices
                    if not it.get("image"):
                        imgs = sorted([i for i in body.get("images") or [] if i.get("url")], key=lambda i: abs((i.get("width") or 200) - 300))
                        it["image"] = imgs[0]["url"] if imgs else None
            await asyncio.gather(*(expand(it) for k, it in items.items() if k.startswith("g")))
            out.append({"start": per.get("bonusStartDate"), "end": per.get("bonusEndDate"),
                        "folder_url": (per.get("bonusFolderUrl") or "").replace("?publitas_embed=embedded", "") or None,
                        "items": list(items.values())})
    return out


async def _dirk_folder() -> list:
    async with httpx.AsyncClient(timeout=40, follow_redirects=True) as c:
        r = await c.get("https://www.dirk.nl/aanbiedingen", headers=_PAGE_HEADERS)
    data = _nuxt_data(r.text)
    offers: dict = {}

    def walk(x, depth=0):
        if depth > 30:
            return
        if isinstance(x, dict):
            if x.get("offerId") and isinstance(x.get("products"), list):
                offers[x["offerId"]] = x
                return
            for v in x.values():
                walk(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                walk(v, depth + 1)
    walk(data)
    periods: dict = {}
    for o in offers.values():
        ids = [p.get("productId") for p in o.get("products") or [] if isinstance(p, dict) and p.get("productId")]
        sign = str(o.get("textPriceSign") or "")
        label = _nice_label(re.sub(r"(?i)actie", "", sign)) or "Actie"
        if label == "Actie" or not label:
            label = "Actie"
        else:
            label = f"Actie {label.lower()}"
        # De actiefoto's van Dirk laden vaak niet; die van het eerste product wel
        img = next((p["productInformation"].get("image") for p in o.get("products") or []
                    if isinstance(p, dict) and isinstance(p.get("productInformation"), dict) and p["productInformation"].get("image")), "") or o.get("image") or ""
        if img and not img.startswith("http"):
            from urllib.parse import quote
            img = DIRK_IMAGE_BASE + quote(img.lstrip("/"))
        it = _promo_item("Dirk", o["offerId"], o.get("headerText"), label, o.get("startDate"), o.get("endDate"), img or None,
                         price=o.get("offerPrice"), regular=o.get("normalPrice"), ids=ids, combinable=len(ids) > 1, quantity=o.get("packaging"))
        info = next((p.get("productInformation") or {} for p in o.get("products") or [] if isinstance(p, dict) and p.get("productInformation")), {})
        it["category"] = info.get("department") or None
        # Actieprijs en normale prijs per product (op actieniveau staat de normale prijs soms op 0)
        it["prices"] = {str(p["productId"]): (p.get("offerPrice") or o.get("offerPrice"), p.get("normalPrice"))
                        for p in o.get("products") or [] if isinstance(p, dict) and p.get("productId") and p.get("normalPrice")}
        if not it.get("regular") and len(it["prices"]) == 1:
            it["regular"] = next(iter(it["prices"].values()))[1]
        periods.setdefault((it["start"], it["end"]), []).append(it)
    # De meeste acties lopen een week (wo t/m di); dagacties vallen daarbinnen
    out = []
    if periods:
        main = max(periods.items(), key=lambda kv: len(kv[1]))[0]
        cur = [i for k, v in periods.items() if (k[0] or "") <= (main[0] or "") or (k[0] or "") <= _iso_day(datetime.now(timezone.utc).isoformat()) for i in v]
        nxt = [i for k, v in periods.items() if (k[0] or "") > (main[0] or "") and (k[0] or "") > _iso_day(datetime.now(timezone.utc).isoformat()) for i in v]
        out.append({"start": main[0], "end": main[1], "folder_url": "https://www.dirk.nl/folder", "items": cur})
        if nxt:
            out.append({"start": min(i["start"] for i in nxt), "end": max(i["end"] or "" for i in nxt), "folder_url": "https://www.dirk.nl/folder", "items": nxt})
    return out


async def _dirk_extra_folders() -> list:
    # Dirk zet de folder van volgende week, de extra folder en die van Super Dirck3 alleen als bladerfolder online
    # (losse acties pas vanaf woensdag): de pagina's laten we als afbeeldingen zien
    today = _iso_day(datetime.now(timezone.utc).isoformat())
    out = []
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        for path, key, title in (("/folder/volgende-week", "next", "Volgende week"), ("/folder/extra-folder", "extra", "Extra"),
                                 ("/meer/over-dirk/super-dirck-3", "dirck3", "Dirck3")):
            try:
                r = await c.get("https://www.dirk.nl" + path, headers=_PAGE_HEADERS)
                data = _nuxt_data(r.text)
            except Exception as e:
                logger.warning("Dirk %s: %r", path, e)
                continue
            pubs = []

            def walk(x, depth=0):
                if depth > 40:
                    return
                if isinstance(x, dict):
                    pages = x.get("pages")
                    if isinstance(pages, list) and pages and isinstance(pages[0], dict) and pages[0].get("fileName"):
                        if not any(p.get("publicationId") == x.get("publicationId") for p in pubs):
                            pubs.append(x)
                        return
                    for v in x.values():
                        walk(v, depth + 1)
                elif isinstance(x, list):
                    for v in x:
                        walk(v, depth + 1)
            walk(data)
            if key == "next":
                # Alleen wat nog moet komen (de zondagfolder van vandaag hoort bij deze week)
                pubs = [p for p in pubs if (_iso_day(p.get("startDate")) or "") > today]
            pubs = [p for p in pubs if (_iso_day(p.get("endDate")) or "9999") >= today]
            if not pubs:
                continue
            pages = [DIRK_IMAGE_BASE + "publication/images/" + pg["fileName"] + "?width=1280"
                     for p in pubs for pg in sorted(p["pages"], key=lambda g: g.get("pageNumber") or 0) if pg.get("fileName")]
            starts = [d for d in (_iso_day(p.get("startDate")) for p in pubs) if d]
            ends = [d for d in (_iso_day(p.get("endDate")) for p in pubs) if d]
            out.append({"key": key, "title": title, "start": min(starts) if starts else None, "end": max(ends) if ends else None,
                        "pages": pages, "folder_url": "https://www.dirk.nl" + path})
    return out


# Dirk zet de acties van volgende week alleen als folderpagina's online; een AI-model leest die en maakt er losse acties van
DIRK_AI_MODEL = "claude-opus-5-5"
DIRK_AI_BATCH = 4
_DIRK_AI_SCHEMA = {
    "type": "object",
    "properties": {"offers": {"type": "array", "items": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Productnaam zoals in de folder, met merk als dat er staat"},
            "label": {"type": "string", "description": "De actie, bijv. '1+1 gratis', '2e halve prijs', '25% korting', 'Actie' bij alleen een lagere prijs"},
            "price": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "Actieprijs in euro"},
            "regular": {"anyOf": [{"type": "number"}, {"type": "null"}], "description": "Normale prijs in euro als die er staat"},
            "quantity": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "Verpakking, bijv. '500 gram' of 'pak 1 liter'"},
        },
        "required": ["title", "label", "price", "regular", "quantity"],
        "additionalProperties": False,
    }}},
    "required": ["offers"],
    "additionalProperties": False,
}
_dirk_ai_state: dict = {"task": None}


async def _dirk_ai_read(pages: list) -> list:
    from anthropic import AsyncAnthropic
    client = AsyncAnthropic()
    sem = asyncio.Semaphore(3)

    async def batch(urls):
        content = [{"type": "image", "source": {"type": "url", "url": u.replace("width=1280", "width=1600")}} for u in urls]
        content.append({"type": "text", "text": (
            "Dit zijn pagina's uit de folder van supermarkt Dirk voor volgende week. Noem elke actie die erop staat: "
            "het product, de actie en de prijzen. Sla reclame zonder product of prijs over. Gebruik euro's als getal (1.99).")})
        async with sem:
            msg = await client.beta.messages.create(
                model=DIRK_AI_MODEL, max_tokens=16000, betas=["server-side-fallback-2026-07-01"], fallbacks="default",
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": _DIRK_AI_SCHEMA}},
                messages=[{"role": "user", "content": content}])
        if msg.stop_reason in ("refusal", "max_tokens"):
            logger.warning("Dirk-folder lezen: %s", msg.stop_reason)
            return []
        text = next((b.text for b in msg.content if b.type == "text"), "")
        return (json.loads(text) if text else {}).get("offers") or []

    res = await asyncio.gather(*(batch(pages[i:i + DIRK_AI_BATCH]) for i in range(0, len(pages), DIRK_AI_BATCH)), return_exceptions=True)
    offers, seen = [], set()
    for r in res:
        if isinstance(r, Exception):
            logger.warning("Dirk-folder lezen mislukt: %r", r)
            continue
        for o in r:
            k = (_norm_text(o.get("title") or ""), o.get("label"))
            if o.get("title") and k not in seen:
                seen.add(k)
                offers.append(o)
    return offers


async def _dirk_ai_run(nxt: dict, key: str) -> None:
    try:
        offers = await _dirk_ai_read(nxt["pages"])
        docs = await _global_products()
        pool = [d for d in docs if d.get("_src") == "Dirk" and d.get("is_global") and d.get("dirk_id")]

        def build():
            items = []
            for n, o in enumerate(offers):
                hit = (_best_matches(pool, o["title"], 1) or [None])[0]
                it = _promo_item("Dirk", f"ai-{key[:8]}-{n}", o["title"], o.get("label") or "Actie", nxt.get("start"), nxt.get("end"),
                                 (hit or {}).get("image"), price=o.get("price"), regular=o.get("regular"),
                                 ids=[hit["dirk_id"]] if hit else [], quantity=o.get("quantity"))
                it["category"] = (hit or {}).get("aisle")
                items.append(it)
            return items
        items = await asyncio.to_thread(build)
        ok = bool(items)
        await db.dirk_ai.update_one({"key": key}, {"$set": {"key": key, "items": items, "ok": ok, "at": datetime.now(timezone.utc)}}, upsert=True)
        logger.info("Dirk-folder volgende week gelezen: %d acties, %d gekoppeld", len(items), sum(1 for i in items if i["ids"]))
        if ok:
            await _load_folders()
    except Exception as e:
        logger.warning("Dirk-folder lezen mislukt: %r", e)
        await db.dirk_ai.update_one({"key": key}, {"$set": {"key": key, "items": [], "ok": False, "at": datetime.now(timezone.utc)}}, upsert=True)


async def _dirk_ai_period(extra: list) -> Optional[dict]:
    # De gelezen acties van volgende week (één keer per folder); ontbreken ze nog, dan lezen we op de achtergrond
    nxt = next((e for e in extra if e.get("key") == "next" and e.get("pages")), None)
    if not nxt:
        return None
    key = f"{len(nxt['pages'])}-" + nxt["pages"][0].rsplit("/", 1)[-1].split("?")[0]
    doc = await db.dirk_ai.find_one({"key": key}, {"_id": 0})
    if doc and doc.get("ok"):
        return {"start": nxt["start"], "end": nxt["end"], "folder_url": nxt["folder_url"], "items": doc["items"]}
    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.info("Dirk-folder lezen overgeslagen: geen ANTHROPIC_API_KEY")
        return None
    retry = doc and doc.get("at") and (datetime.now(timezone.utc) - doc["at"].replace(tzinfo=timezone.utc)).total_seconds() < 6 * 3600
    t = _dirk_ai_state["task"]
    if not retry and not (t and not t.done()):
        _dirk_ai_state["task"] = asyncio.create_task(_dirk_ai_run(nxt, key))
    return None


JUMBO_PROMO_QUERY = """query($id: String!) { promotionTab(id: $id) { runtimes { id start { iso } title sections { promotions { ...P }
  categories { promotions { ...P } } } } } }
fragment P on Promotion { id title subtitle start { iso } end { iso } tags { text } isKiesAndMix image products { id } }"""


async def _jumbo_folder() -> list:
    # Jumbo: de aanbiedingenpagina van jumbo.com, met deze week en (vanaf zondag) volgende week als losse acties
    try:
        async with httpx.AsyncClient(timeout=30, headers={**JUMBO_HEADERS, "Accept": "*/*"}) as c:
            r = await c.post(JUMBO_GQL, json={"query": JUMBO_PROMO_QUERY, "variables": {"id": "actieprijs"}})
        runtimes = (((r.json() or {}).get("data") or {}).get("promotionTab") or {}).get("runtimes") or []
        out = []
        for rt in runtimes:
            items: dict = {}
            for sc in rt.get("sections") or []:
                for pr in (sc.get("promotions") or []) + [x for cat in sc.get("categories") or [] for x in cat.get("promotions") or []]:
                    if not pr.get("id") or pr["id"] in items:
                        continue
                    ids = [x["id"] for x in pr.get("products") or [] if x.get("id")]
                    tags = [t.get("text") for t in pr.get("tags") or [] if t.get("text")]
                    title = pr.get("title") or ""
                    if pr.get("subtitle"):
                        title = f"{title} ({pr['subtitle']})"
                    items[pr["id"]] = _promo_item("Jumbo", pr["id"], title, tags[0] if tags else "Actie", (pr.get("start") or {}).get("iso"),
                                                  (pr.get("end") or {}).get("iso"), pr.get("image"), ids=ids,
                                                  combinable=bool(pr.get("isKiesAndMix")) or len(ids) > 1)
            its = list(items.values())
            if its:
                ends = sorted(i["end"] or "" for i in its)
                start = _iso_day((rt.get("start") or {}).get("iso")) or min(i["start"] or "" for i in its)
                nxt = "woensdag" in (rt.get("title") or "").lower() or "volgende" in (rt.get("title") or "").lower()
                out.append({"start": start, "end": ends[len(ends) // 2],
                            "folder_url": "https://www.jumbo.com/aanbiedingen/" + ("volgende-week" if nxt else "nu"), "items": its})
        if out:
            return out
    except Exception as e:
        logger.warning("Jumbo aanbiedingenpagina mislukt: %r", e)
    return await _jumbo_folder_products()


async def _jumbo_folder_products() -> list:
    # Reserve: acties die meekomen met de producten (bij import en de dagelijkse update)
    docs = await db.products.find({"jumbo_id": {"$exists": True}, "promo": {"$ne": None}, "deleted_at": None, "is_global": True},
                                  {"_id": 0, "jumbo_id": 1, "promo": 1, "promos": 1, "image": 1, "name": 1, "prices": 1}).to_list(None)
    items: dict = {}
    for d in docs:
        for pr in d.get("promos") or [d.get("promo") or {}]:
            if not pr.get("id"):
                continue
            it = items.get(pr["id"])
            if not it:
                it = items[pr["id"]] = _promo_item("Jumbo", pr["id"], pr.get("title") or d["name"], pr.get("label"), pr.get("start"), pr.get("end"),
                                                   pr.get("image") or d.get("image"), combinable=pr.get("combinable"))
            if str(d["jumbo_id"]) not in it["ids"]:
                it["ids"].append(str(d["jumbo_id"]))
    today = _iso_day(datetime.now(timezone.utc).isoformat())
    cur = [i for i in items.values() if (i["start"] or "") <= today]
    nxt = [i for i in items.values() if (i["start"] or "") > today]
    for i in cur + nxt:
        if len(i["ids"]) == 1:
            i["combinable"] = i["combinable"] and False
        else:
            i["combinable"] = True
    out = []
    if cur:
        ends = sorted(i["end"] or "" for i in cur)
        out.append({"start": min(i["start"] or today for i in cur), "end": ends[len(ends) // 2], "folder_url": "https://www.jumbo.com/aanbiedingen/nu", "items": cur})
    if nxt:
        out.append({"start": min(i["start"] for i in nxt), "end": max(i["end"] or "" for i in nxt), "folder_url": "https://www.jumbo.com/aanbiedingen/volgende-week", "items": nxt})
    return out


async def _load_folders() -> None:
    data, by_id = {}, {}
    failed = False
    for store, fn in (("Albert Heijn", _ah_folder), ("Dirk", _dirk_folder), ("Jumbo", _jumbo_folder)):
        for attempt in range(2):
            try:
                data[store] = await fn()
                break
            except Exception as e:
                logger.warning("Folder %s mislukt: %r", store, e)
                data[store] = (_folders["data"] or {}).get(store) or []
                failed = failed or (attempt == 1 and not data[store])
        for per in data[store]:
            for it in per["items"]:
                for i in it["ids"]:
                    by_id.setdefault((store, i), []).append(it)
    try:
        extra = {"Dirk": await _dirk_extra_folders()}
    except Exception as e:
        logger.warning("Dirk extra folders mislukt: %r", e)
        extra = _folders.get("extra") or {}
    try:
        per = await _dirk_ai_period(extra.get("Dirk") or [])
        if per and not any((p.get("start") or "") >= (per["start"] or "~") for p in data.get("Dirk") or []):
            data.setdefault("Dirk", []).append(per)
            for it in per["items"]:
                for i in it["ids"]:
                    by_id.setdefault(("Dirk", i), []).append(it)
    except Exception as e:
        logger.warning("Dirk volgende week mislukt: %r", e)
    at = datetime.now(timezone.utc)
    if failed:
        at -= timedelta(seconds=max(0, FOLDER_REFRESH_SECONDS - 300))  # een winkel lukte niet: over 5 minuten opnieuw
    _folders.update({"at": at, "data": data, "by_id": by_id, "extra": extra})
    _search_cache.clear()
    try:
        await _learn_folder_lead(data)
    except Exception as e:
        logger.info("Folder volgende week bijhouden: %r", e)
    logger.info("Folders geladen: %s", {k: [len(p["items"]) for p in v] for k, v in data.items()})


# Volgende week: hoeveel dagen voor de start zet een winkel de nieuwe folder online? Dat leren we elke week
# van de site zelf, zodat de app kan zeggen "vanaf vrijdag 30 oktober" (en dan vaker kijkt).
FOLDER_LEAD_DEFAULT = {"Albert Heijn": 3, "Jumbo": 3, "Dirk": 2}
_folder_lead: dict = {}


async def _learn_folder_lead(data: dict) -> None:
    today = _iso_day(now_utc().isoformat())
    doc = await db.meta.find_one({"key": "folder_lead"}, {"_id": 0}) or {}
    seen = doc.get("seen") or {}
    leads = doc.get("leads") or {}
    changed = False
    for store, pers in data.items():
        for per in pers:
            st = per.get("start") or ""
            if st > today and seen.get(store) != st and per.get("items"):
                seen[store] = st
                days = (datetime.fromisoformat(st) - datetime.fromisoformat(today)).days
                if 0 < days <= 7:
                    leads[store] = (leads.get(store) or [])[-5:] + [days]
                changed = True
    if changed:
        await db.meta.update_one({"key": "folder_lead"}, {"$set": {"seen": seen, "leads": leads}}, upsert=True)
    _folder_lead.update({k: max(v) for k, v in leads.items() if v})


def _next_expected(store: str, periods: list) -> Optional[dict]:
    # Geen folder van volgende week: wanneer verwachten we hem?
    today = _iso_day(now_utc().isoformat())
    cur = [p for p in periods if (p.get("start") or "") <= today and p.get("end")]
    if not cur or any((p.get("start") or "") > today for p in periods):
        return None
    start = (datetime.fromisoformat(max(p["end"] for p in cur)[:10]) + timedelta(days=1)).date()
    avail = start - timedelta(days=_folder_lead.get(store) or FOLDER_LEAD_DEFAULT.get(store, 3))
    return {"start": start.isoformat(), "available_from": max(avail.isoformat(), today), "nice": _nice_day(max(avail.isoformat(), today))}


async def _folders_fresh(wait: bool = True) -> dict:
    f = _folders
    every = FOLDER_REFRESH_SECONDS
    if f["at"] is not None:
        # Rond de dag dat de folder van volgende week verschijnt: elk uur kijken
        today = _iso_day(now_utc().isoformat())
        if any((x := _next_expected(st, pers)) and x["available_from"] <= today for st, pers in (f["data"] or {}).items()):
            every = 3600
    old = f["at"] is None or (datetime.now(timezone.utc) - f["at"]).total_seconds() > every
    if old and not (f["task"] and not f["task"].done()):
        f["task"] = asyncio.create_task(_load_folders())
    if wait and f["at"] is None and f["task"]:
        try:
            await asyncio.wait_for(asyncio.shield(f["task"]), 25)
        except Exception:
            pass
    return f


def _promos_for(doc: dict) -> list:
    src = doc.get("_src") or product_source(doc)
    sid = doc.get("dirk_id") or doc.get("ah_id") or doc.get("jumbo_id")
    found = list(_folders["by_id"].get((src, str(sid)), [])) if src and sid else []
    if not found:
        found = [_promo_item(src, pr["id"], pr.get("title"), pr.get("label"), pr.get("start"), pr.get("end"), combinable=pr.get("combinable"))
                 for pr in (doc.get("promos") or [doc.get("promo") or {}]) if pr.get("id")]
    return found


def _promo_on_day(doc: dict, day: str) -> Optional[dict]:
    # De aanbieding die op een bepaalde dag geldt (ook uit de folder van volgende week)
    for it in _promos_for(doc):
        if (it["start"] or "") <= day <= (it["end"] or "9999"):
            return {"label": it["label"], "start": it["start"], "end": it["end"],
                    "period": f"{_nice_day(it['start'])} t/m {_nice_day(it['end'])}" if it["start"] and it["end"] else None}
    return None


def _first_shop_day(camp: dict) -> Optional[str]:
    # Datum van de eerste inkoopdag (of de eerste dag van het lijstje)
    sd = camp.get("start_date")
    if not sd:
        return None
    try:
        start = datetime.fromisoformat(str(sd)[:10])
    except ValueError:
        return None
    k = next((k for k, d in enumerate(camp.get("days") or []) if d.get("is_shopping_day")), 0)
    return (start + timedelta(days=k)).date().isoformat()


def _promo_public(doc: dict, price: float) -> tuple:
    # (actie nu, actie die nog komt) voor één product
    today = _iso_day(datetime.now(timezone.utc).isoformat())
    now_p, next_p = None, None
    for it in _promos_for(doc):
        if it["end"] and it["end"] < today:
            continue
        own = (it.get("prices") or {}).get(str(sid)) if (sid := doc.get("dirk_id") or doc.get("ah_id") or doc.get("jumbo_id")) else None
        if own:
            promo_price, regular = own[0], own[1]
        else:
            promo_price = it.get("price") if len(it["ids"]) <= 1 else None
            regular = it.get("regular") if len(it["ids"]) <= 1 else None
        base = regular or price
        deal = _promo_deal(it["label"], base or 0)
        p = {"label": it["label"], "title": it["title"], "start": it["start"], "end": it["end"],
             "period": f"{_nice_day(it['start'])} t/m {_nice_day(it['end'])}" if it["start"] and it["end"] else None,
             "price": promo_price, "regular": regular,
             "deal": deal, "combinable": it["combinable"], "note": it.get("note")}
        if (it["start"] or "") <= today:
            now_p = now_p or p
        else:
            next_p = next_p or p
    return now_p, next_p


# --- Online recepten van AH (Allerhande), Jumbo en Dirk ---
RECIPE_PAGE = 24
RECIPE_STORE_NAMES = {"ah": "Albert Heijn", "jumbo": "Jumbo", "dirk": "Dirk"}
_recipe_cache: dict = {}
AH_GQL = "https://api.ah.nl/graphql"
# Filters die bij "Alle winkels" voor elke winkel werken
COMMON_COURSES = [("ontbijt", "Ontbijt"), ("lunch", "Lunch"), ("hoofdgerecht", "Hoofdgerecht / avondeten"), ("bijgerecht", "Bijgerecht"),
                  ("soep", "Soep"), ("dessert", "Dessert / toetje"), ("borrel", "Borrel & snack")]
COMMON_TIMES = [("15", "Tot 15 min"), ("30", "Tot 30 min"), ("45", "Tot 45 min"), ("60", "Tot 1 uur")]
_COURSE_MAP = {
    "ah": {"ontbijt": ("menugang", "ontbijt"), "lunch": ("menugang", "lunch"), "hoofdgerecht": ("menugang", "hoofdgerecht"),
           "bijgerecht": ("menugang", "bijgerecht"), "soep": ("soort-gerecht", "soep"), "dessert": ("menugang", "nagerecht"),
           "borrel": ("menugang", "borrelhapje")},
    "jumbo": {"ontbijt": ("menugang", "Ontbijt"), "lunch": ("menugang", "Lunch/brunch gerecht"), "hoofdgerecht": ("menugang", "Hoofdgerecht"),
              "bijgerecht": ("menugang", "Bijgerecht"), "soep": ("menugang", "Soep"), "dessert": ("menugang", "Dessert"),
              "borrel": ("menugang", "Borrel")},
    "dirk": {"ontbijt": ("gang", "Ontbijt"), "lunch": ("gang", "Lunch"), "hoofdgerecht": ("gang", "Avondeten"), "bijgerecht": ("tag", "Bijgerecht"),
             "soep": ("tag", "Soep"), "dessert": ("gang", "Toetjes"), "borrel": ("gang", "Borrel")},
}


def _rc_get(key, ttl):
    hit = _recipe_cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    return None


def _rc_set(key, value):
    if len(_recipe_cache) > 300:
        for k in sorted(_recipe_cache, key=lambda k: _recipe_cache[k][0])[:100]:
            _recipe_cache.pop(k, None)
    _recipe_cache[key] = (time.time(), value)
    return value


def _iso_minutes(v) -> Optional[int]:
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?", str(v or ""))
    if not m or not (m.group(1) or m.group(2)):
        return None
    return int(m.group(1) or 0) * 60 + int(m.group(2) or 0)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def _nice(s: str) -> str:
    s = (s or "").replace("-", " ").strip()
    return s[:1].upper() + s[1:]


async def _ah_schema_probe() -> None:
    # Testsite: welke velden heeft een AH-recept? (zoeken naar de producten die AH zelf bij "Kies producten" kiest)
    try:
        q = """{r:__type(name:"Recipe"){fields{name args{name} type{name kind ofType{name kind ofType{name}}}}}
          q:__schema{queryType{fields{name}}}}"""
        d = await _ah_gql(q)
        logger.info("AH-schema Recipe: %s", [(f["name"], (f["type"].get("name") or (f["type"].get("ofType") or {}).get("name")
                                                        or ((f["type"].get("ofType") or {}).get("ofType") or {}).get("name"))) for f in (d.get("r") or {}).get("fields") or []])
        logger.info("AH-schema queries: %s", [f["name"] for f in (d.get("q") or {}).get("queryType", {}).get("fields") or []
                                              if re.search(r"recipe|shop|basket|list", f["name"], re.I)])
    except Exception as e:
        logger.warning("AH-schema: %r", e)


async def _ah_gql(query: str, variables: Optional[dict] = None) -> dict:
    async with httpx.AsyncClient(timeout=20, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        r = await c.post(AH_GQL, json={"query": query, "variables": variables or {}},
                         headers={"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP", "client-name": "ah-allerhande", "client-version": "6.0"})
        body = r.json() if r.content else {}
        if not body.get("data") and body.get("errors"):
            raise RuntimeError(f"AH: {str(body['errors'])[:200]}")
        return body.get("data") or {}


AH_RECIPE_SEARCH = """query($q:String,$start:Int,$size:PageSize,$filters:[RecipeSearchQueryFilter!]){recipeSearchV2(searchText:$q,start:$start,size:$size,filters:$filters){
 page{total} result{id title slug time{cook} serving{number} images{url width} courses rating{average count}}
 filters{name label filters{name label count}}}}"""


def _ah_image(images, want=440):
    imgs = [i for i in images or [] if isinstance(i, dict) and i.get("url")]
    if not imgs:
        return None
    return min(imgs, key=lambda i: abs((i.get("width") or 0) - want))["url"]


async def _ah_recipes(q: str, filters: dict, page: int, size: int) -> dict:
    flt = [{"group": k, "values": v} for k, v in filters.items() if v]
    d = await _ah_gql(AH_RECIPE_SEARCH, {"q": q or None, "start": page * size, "size": size, "filters": flt or None})
    res = d.get("recipeSearchV2") or {}
    total = int((res.get("page") or {}).get("total") or 0)
    recipes = [{"id": f"ah-{r['id']}", "store": "ah", "title": r.get("title"), "image": _ah_image(r.get("images")),
                "time": (r.get("time") or {}).get("cook"), "servings": (r.get("serving") or {}).get("number"),
                "course": (r.get("courses") or [None])[0], "rating": (r.get("rating") or {}).get("average") or None}
               for r in res.get("result") or [] if r.get("id")]
    facets = [{"key": g["name"], "label": _nice(g.get("label") or g["name"]), "multi": True,
               "values": [{"value": f["name"], "label": _nice(f.get("label") or f["name"]), "count": f.get("count")} for f in g.get("filters") or []]}
              for g in res.get("filters") or [] if g.get("name") and g.get("filters") and g["name"] != "allerhande-magazine"]
    return {"recipes": recipes, "total": total, "facets": facets, "has_more": (page + 1) * size < total}


async def _jumbo_recipes(q: str, filters: dict, page: int, size: int) -> dict:
    from urllib.parse import quote
    parts = [f"{k}:{v}" for k, vals in filters.items() for v in vals]
    url = f"https://www.jumbo.com/recepten/zoeken/?searchTerms={quote(q or '')}&pageSize={size}&offSet={page * size}"
    if parts:
        url += "&filters=" + quote(";".join(parts), safe=":;")
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        r = await c.get(url, headers=_PAGE_HEADERS)
    st = (_find_dict(_nuxt_data(r.text), "recipeStore") or {}).get("recipeStore") or {}
    if not st:
        raise RuntimeError(f"Jumbo gaf geen recepten ({r.status_code})")
    total = int(st.get("count") or 0)
    recipes = []
    for x in st.get("recipes") or []:
        if not isinstance(x, dict) or not x.get("link"):
            continue
        recipes.append({"id": "jumbo-" + x["link"].rstrip("/").split("/")[-1], "store": "jumbo", "title": (x.get("title") or "").strip(),
                        "image": x.get("fullImageUrl"), "time": x.get("time") or x.get("cookingTime"), "servings": x.get("numberOfPersons"),
                        "course": x.get("course"), "rating": ((x.get("rating") or {}).get("value") or None)})
    facets = []
    for g in st.get("facets") or []:
        if not isinstance(g, dict) or not g.get("key"):
            continue
        facets.append({"key": g["key"], "label": g.get("displayName") or _nice(g["key"]), "multi": False,
                       "values": [{"value": v.get("name"), "label": v.get("name"), "count": v.get("count")} for v in g.get("values") or [] if v.get("name")]})
    # Gekozen filters blijven zichtbaar, ook als Jumbo ze niet meer als keuze teruggeeft
    for k, vals in filters.items():
        f = next((f for f in facets if f["key"] == k), None)
        if not f:
            f = {"key": k, "label": _nice(k.replace("_", " ")), "multi": False, "values": []}
            facets.append(f)
        for v in vals:
            if not any(x["value"] == v for x in f["values"]):
                f["values"].insert(0, {"value": v, "label": v, "count": None})
    return {"recipes": recipes, "total": total, "facets": facets, "has_more": (page + 1) * size < total}


DIRK_RECIPE_COURSES = ["avondeten", "lunch", "ontbijt", "brunch", "borrel", "toetjes", "koffietijd"]


async def _dirk_all_recipes() -> list:
    hit = _rc_get("dirk_all", 12 * 3600)
    if hit is not None:
        return hit
    found: dict = {}
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
        for g in DIRK_RECIPE_COURSES:
            try:
                r = await c.get("https://www.dirk.nl/meer/recepten/gang/" + g, headers=_PAGE_HEADERS)
                rc = ((_nuxt_data(r.text) or {}).get("data") or {}).get("recipeCourse")
            except Exception as e:
                logger.warning("Dirk recepten %s: %s", g, e)
                continue
            for x in rc if isinstance(rc, list) else []:
                if isinstance(x, dict) and x.get("recipeId") and x.get("title"):
                    found.setdefault(x["recipeId"], x)
    out = []
    for x in found.values():
        names = lambda k: [t.get("name") for t in x.get(k) or [] if isinstance(t, dict) and t.get("name")]
        img = x.get("filename")
        out.append({"id": "dirk-" + _slug(x["title"]), "store": "dirk", "title": x["title"].strip(),
                    "image": (DIRK_IMAGE_BASE + img.lstrip("/")) if img else None, "time": _iso_minutes(x.get("preparationTime")),
                    "servings": None, "course": (names("courses") or [None])[0], "rating": None,
                    "_courses": names("courses"), "_kitchens": names("kitchens"), "_tags": names("tags"),
                    "_veg": bool(x.get("vegetarian")), "_desc": x.get("metaDescription") or ""})
    diets = {d["id"]: d async for d in db.recipe_diet.find({}, {"_id": 0})}
    for r in out:
        d = diets.get(r["id"]) or {}
        r["_veg"] = r["_veg"] or bool(d.get("veg"))
        r["_vegan"] = bool(d.get("vegan"))
    if any(r["id"] not in diets for r in out):
        asyncio.create_task(_dirk_diet_scan(out))
    out.sort(key=lambda r: r["title"].lower())
    logger.info("Dirk: %d recepten", len(out))
    if out:
        _rc_set("dirk_all", out)
    return out


_DAIRY_RE = re.compile(r"melk|boter|kaas|room|yoghurt|kwark|\bei\b|eieren|eidooier|eiwit|honing|mascarpone|ricotta|feta|mozzarella|"
                       r"parmez|parmigiano|creme fraiche|vla\b|karnemelk|chocolade|mayonaise|ghee")
_VEGAN_OK_RE = re.compile(r"plantaardig|vegan|kokos|amandel|haver|soja|pindakaas|notenboter|cacaoboter|pindaboter|pure chocolade")


def _diet_of(names: list) -> tuple:
    # (vegetarisch, veganistisch) volgens de ingrediënten: geen vlees of vis, en voor vegan ook geen zuivel, ei of honing
    ns = [_norm_text(n) for n in names]
    meat = any((_MEAT_RE.search(n) or "gelatine" in n) and not _VEGA_RE.search(n) and not re.search(r"vleestomaat|speculaas|groentebouillon", n) for n in ns)
    vegan = not meat and not any(_DAIRY_RE.search(n) and not _VEGAN_OK_RE.search(n) for n in ns)
    return not meat, vegan


async def _dirk_diet_scan(recipes: list) -> None:
    # Eén keer per recept de ingrediënten bekijken; Dirk zet niet bij elk vegetarisch recept het vinkje
    known = {d["id"] async for d in db.recipe_diet.find({}, {"_id": 0, "id": 1})}
    todo = [r for r in recipes if r["id"] not in known]
    if not todo:
        return
    sem = asyncio.Semaphore(3)

    async def one(r):
        async with sem:
            try:
                d = await _recipe_detail(r["id"])
            except Exception:
                return
        veg, vegan = _diet_of([i.get("name") or i.get("text") or "" for i in d.get("ingredients") or []])
        await db.recipe_diet.update_one({"id": r["id"]}, {"$set": {"id": r["id"], "veg": veg, "vegan": vegan}}, upsert=True)
        r["_veg"] = r["_veg"] or veg
        r["_vegan"] = vegan
    await asyncio.gather(*(one(r) for r in todo))
    logger.info("Dirk-recepten: dieet bepaald voor %d recepten", len(todo))
    for k in [k for k in _recipe_cache if isinstance(k, tuple) and k[:2] == ("search", "dirk")]:
        _recipe_cache.pop(k, None)


def _dirk_matches(r: dict, filters: dict, skip: Optional[str] = None) -> bool:
    # Meerdere keuzes: het recept moet bij allemaal horen
    for k, vals in filters.items():
        if k == skip or not vals:
            continue
        have = {"gang": r["_courses"], "keuken": r["_kitchens"], "tag": r["_tags"],
                "dieet": (["Vegetarisch"] if r["_veg"] else []) + (["Veganistisch"] if r.get("_vegan") else [])}.get(k)
        if k == "tijd":
            if not r["time"] or r["time"] > max(int(v) for v in vals):
                return False
        elif have is not None and not all(v in have for v in vals):
            return False
    return True


async def _dirk_recipes(q: str, filters: dict, page: int, size: int) -> dict:
    allr = await _dirk_all_recipes()
    terms = _norm_text(q).split() if q else []
    base = [r for r in allr if all(t in _norm_text(r["title"] + " " + r["_desc"] + " " + " ".join(r["_tags"])) for t in terms)]
    hits = [r for r in base if _dirk_matches(r, filters)]
    facets = []
    for key, label, field in (("gang", "Gang", "_courses"), ("keuken", "Keuken", "_kitchens"), ("tag", "Soort & smaak", "_tags")):
        counts: dict = {}
        for r in base:
            if _dirk_matches(r, filters):  # zoveel blijven er over als je deze er ook bij kiest
                for v in r[field]:
                    counts[v] = counts.get(v, 0) + 1
        for v in filters.get(key) or []:
            counts.setdefault(v, 0)
        if counts:
            facets.append({"key": key, "label": label, "multi": True,
                           "values": [{"value": v, "label": v, "count": n} for v, n in sorted(counts.items(), key=lambda kv: -kv[1])]})
    nveg = sum(1 for r in base if r["_veg"] and _dirk_matches(r, filters, skip="dieet"))
    nvegan = sum(1 for r in base if r.get("_vegan") and _dirk_matches(r, filters, skip="dieet"))
    facets.append({"key": "dieet", "label": "Dieet", "multi": False, "values": [{"value": "Vegetarisch", "label": "Vegetarisch", "count": nveg}]
                   + ([{"value": "Veganistisch", "label": "Veganistisch", "count": nvegan}] if nvegan else [])})
    facets.append({"key": "tijd", "label": "Bereidingstijd", "multi": False, "values": [{"value": v, "label": l, "count": None} for v, l in COMMON_TIMES]})
    chunk = hits[page * size:(page + 1) * size]
    return {"recipes": [{k: v for k, v in r.items() if not k.startswith("_")} for r in chunk], "total": len(hits),
            "facets": facets, "has_more": (page + 1) * size < len(hits)}


_RECIPE_SOURCES = {"ah": _ah_recipes, "jumbo": _jumbo_recipes, "dirk": _dirk_recipes}

# --- Vegetarisch en veganistisch volgens de ingrediënten, ook bij AH en Jumbo ---
_DIET_LABELS = ("Vegetarisch", "Veganistisch")
_diet_vals: dict = {}
_diet_running: set = set()


async def _scan_diets(recipes: list, wait: float = 0) -> dict:
    # Per recept één keer de ingrediënten bekijken en onthouden; met wait > 0 wachten we even op de uitkomst
    ids = [r["id"] for r in recipes]
    known = {d["id"]: d async for d in db.recipe_diet.find({"id": {"$in": ids}}, {"_id": 0})}
    todo = [r for r in recipes if r["id"] not in known and r["id"] not in _diet_running]
    sem = asyncio.Semaphore(6)

    async def one(r):
        _diet_running.add(r["id"])
        try:
            async with sem:
                d = await _recipe_detail(r["id"])
            names = [i.get("name") or i.get("text") or "" for i in d.get("ingredients") or []]
            if not names:
                return
            veg, vegan = _diet_of(names)
            await db.recipe_diet.update_one({"id": r["id"]}, {"$set": {"id": r["id"], "veg": veg, "vegan": vegan}}, upsert=True)
            known[r["id"]] = {"id": r["id"], "veg": veg, "vegan": vegan}
        except Exception as e:
            logger.info("Dieet recept %s: %r", r["id"], e)
        finally:
            _diet_running.discard(r["id"])
    if todo:
        tasks = [asyncio.create_task(one(r)) for r in todo]
        if wait:
            await asyncio.wait(tasks, timeout=wait)
    return known


async def _store_diet_values(store: str, facets: Optional[list] = None) -> dict:
    # Welke filterwaarde de winkel zelf gebruikt voor vegetarisch en veganistisch
    if store not in _diet_vals:
        if facets is None:
            facets = (await _store_recipes(store, "", {}, 0, 1))["facets"]
        found: dict = {}
        for f in facets:
            for v in f["values"]:
                n = _norm_text(str(v.get("value") or "") + " " + str(v.get("label") or ""))
                if "vegan" in n:
                    found.setdefault("vegan", (f["key"], v["value"], v.get("count")))
                elif "vegetar" in n or "vega" in n.split():
                    found.setdefault("veg", (f["key"], v["value"], v.get("count")))
        if found:
            _diet_vals[store] = found
        return found
    return _diet_vals[store]


# --- Wat kost een recept ongeveer: totaal en per persoon op de receptkaartjes, voor alle winkels ---
RECIPE_COST_DAYS = 3
_cost_running: set = set()


def _recipe_cost(rec: dict, matches: dict) -> Optional[dict]:
    # Zelfde manier van rekenen als op de receptpagina: wat op je lijst komt, in hele verpakkingen
    by_sid = _product_cache.get("by_sid") or {}
    total, need, priced = 0.0, 0, 0
    for i in rec["ingredients"]:
        if _ing_pantry(rec, i):
            continue
        need += 1
        p = i.get("product")
        doc = (by_sid.get((p["store"], p["sid"])) if p else None) or (matches or {}).get(i["name"])
        if not doc:
            continue
        if i.get("qty") or i.get("site_packs"):
            plan = _pack_plan(doc, i.get("qty") or 1, i.get("unit") or "", site_packs=i.get("site_packs"))
            cost = plan["cost"] if plan else 0
        else:
            cost = resolve_price(doc.get("prices") or {}, doc.get("_src") or product_source(doc), doc.get("unavailable") or [])
        if cost:
            total += cost
            priced += 1
    # Alleen tonen als we het meeste hebben kunnen prijzen, anders is het bedrag misleidend
    if not priced or priced < need * 0.7:
        return None
    servings = rec.get("servings") or 4
    return {"total": round(total, 2), "pp": round(total / servings, 2)}


async def _recipe_matches(rec: dict) -> dict:
    hit = _rc_get(("match", rec["id"]), 6 * 3600)
    if hit is not None:
        return hit
    docs = await _global_products()
    by_sid = _product_cache.get("by_sid") or {}
    missing = [i["name"] for i in rec["ingredients"] if not (i.get("product") and (i["product"]["store"], i["product"]["sid"]) in by_sid)]
    return _rc_set(("match", rec["id"]), await asyncio.to_thread(_store_matches, missing, docs, STORE_LABELS[rec["store"]]) if missing else {})


async def _cost_run(todo: list) -> None:
    # Eén voor één op de achtergrond, zodat de server er niet traag van wordt
    for r in todo:
        try:
            rec = await _recipe_detail(r["id"])
            c = await asyncio.to_thread(_recipe_cost, rec, await _recipe_matches(rec))
            await db.recipe_cost.update_one({"id": r["id"]}, {"$set": {"id": r["id"], "at": now_utc().isoformat(),
                                                                       "total": c and c["total"], "pp": c and c["pp"]}}, upsert=True)
        except Exception as e:
            logger.info("Receptprijs %s: %r", r.get("id"), e)
        finally:
            _cost_running.discard(r["id"])


async def _with_costs(recipes: list) -> list:
    # Bekende prijzen erbij zetten; wat nog niet (of te lang geleden) berekend is, wordt op de achtergrond gedaan
    ids = [r["id"] for r in recipes if r.get("id")]
    if not ids:
        return recipes
    known = {d["id"]: d async for d in db.recipe_cost.find({"id": {"$in": ids}}, {"_id": 0})}
    old = (now_utc() - timedelta(days=RECIPE_COST_DAYS)).isoformat()
    todo = [r for r in recipes if r.get("id") and r["id"] not in _cost_running and (known.get(r["id"]) or {}).get("at", "") < old]
    if todo:
        _cost_running.update(r["id"] for r in todo)
        asyncio.ensure_future(_cost_run(todo))
    return [{**r, "price_total": (known.get(r.get("id")) or {}).get("total"), "price_pp": (known.get(r.get("id")) or {}).get("pp")} for r in recipes]


async def _diet_recipes(store: str, q: str, flt: dict, page: int, size: int) -> dict:
    want = [v for v in flt.get("dieet") or [] if v in _DIET_LABELS]
    sf = {k: list(v) for k, v in flt.items()}
    if "dieet" in sf:
        sf["dieet"] = [v for v in sf["dieet"] if v not in _DIET_LABELS]
        if not sf["dieet"]:
            sf.pop("dieet")
    dv = await _store_diet_values(store)
    vegan = "Veganistisch" in want
    if want:
        # De winkel filtert eerst op zijn eigen vinkje; daarna kijken we zelf naar de ingrediënten
        k, v, _ = dv.get("vegan") if vegan and dv.get("vegan") else dv.get("veg") or (None, None, None)
        if k:
            sf[k] = [v] if store == "jumbo" else list(dict.fromkeys((sf.get(k) or []) + [v]))
    res = dict(await _store_recipes(store, q, sf, page, size))
    known = await _scan_diets(res["recipes"], wait=10 if want else 0)
    recipes = []
    for r in res["recipes"]:
        d = known.get(r["id"])
        r = {**r, "veg": d.get("veg") if d else None, "vegan": d.get("vegan") if d else None}
        if d and want and (not d.get("veg") or (vegan and not d.get("vegan"))):
            continue
        recipes.append(r)
    # Filters: de eigen vinkjes van de winkel worden onze vaste keuze Vegetarisch / Veganistisch
    own = {(x[0], x[1]) for x in dv.values()}
    facets = []
    for f in res["facets"]:
        vals = [v for v in f["values"] if (f["key"], v["value"]) not in own]
        if vals or f["key"] == "dieet":
            facets.append({**f, "values": vals})
    diet = {"key": "dieet", "label": "Dieet", "multi": False,
            "values": [{"value": "Vegetarisch", "label": "Vegetarisch", "count": (dv.get("veg") or (0, 0, None))[2]},
                       {"value": "Veganistisch", "label": "Veganistisch", "count": (dv.get("vegan") or (0, 0, None))[2]}]}
    f = next((f for f in facets if f["key"] == "dieet"), None)
    if f:
        f["values"] = diet["values"] + f["values"]
    else:
        facets.append(diet)
    return {**res, "recipes": recipes, "facets": facets}


async def _store_recipes(store: str, q: str, filters: dict, page: int, size: int) -> dict:
    import json as _json
    key = ("search", store, q, _json.dumps(filters, sort_keys=True), page, size)
    hit = _rc_get(key, 3600)
    if hit is not None:
        return hit
    return _rc_set(key, await _RECIPE_SOURCES[store](q, filters, page, size))


_RECIPE_STOP = {"met", "van", "en", "de", "het", "een", "uit", "voor", "op", "in", "of", "zonder", "recept", "lekker", "snelle", "makkelijke"}


def _recipe_words(r: dict) -> list:
    return [w for w in re.findall(r"[a-z]{4,}", _norm_text(r.get("title") or "")) if w not in _RECIPE_STOP]


async def _track_recipe(user_id: str, rec: dict, weight: int = 1) -> None:
    # Welke recepten iemand bekijkt en kiest: daarmee komen vergelijkbare recepten bovenaan
    inc = {f"rwords.{_ikey(w)}": weight for w in _recipe_words(rec)}
    for t in (rec.get("tags") or [])[:12] + ([rec["course"]] if rec.get("course") else []):
        inc[f"rtags.{_ikey(_norm_text(str(t)))}"] = weight
    if rec.get("store"):
        inc[f"rstores.{_ikey(rec['store'])}"] = weight
    if inc:
        await db.user_interest.update_one({"user_id": user_id}, {"$inc": inc}, upsert=True)


def _personal_recipes(recipes: list, interest: dict, seed: str) -> list:
    # Zonder zoekterm: elke keer een andere volgorde, met wat op jouw smaak lijkt bovenaan
    import random
    rnd = random.Random(seed)
    words, tags = interest.get("rwords") or {}, interest.get("rtags") or {}
    top = max(list(words.values()) + list(tags.values()) + [1])

    def score(r):
        s = sum(words.get(_ikey(w), 0) for w in _recipe_words(r)) + sum(tags.get(_ikey(_norm_text(str(t))), 0) for t in ([r.get("course")] if r.get("course") else []))
        return min(1.0, s / top) * 2 + rnd.random()
    return sorted(recipes, key=lambda r: -score(r))


@api_router.get("/recipes/search")
async def search_recipes(q: str = "", store: str = "all", page: int = 0, filters: str = "{}", user: dict = Depends(get_current_user)):
    q = (q or "").strip()[:80]
    if q:
        res = await _search_recipes(q, store, page, filters)
        return {**res, "recipes": await _with_costs(res["recipes"])}
    interest = {} if user.get("no_personal") else await db.user_interest.find_one({"user_id": user["user_id"]}, {"_id": 0, "rwords": 1, "rtags": 1}) or {}
    now = datetime.now(timezone.utc)
    seed = f"{user['user_id']}-{now.strftime('%Y%m%d%H')}{now.minute // 10}-{store}-{filters}"  # elke 10 minuten anders, gelijk tijdens het scrollen
    if store == "dirk":
        # Dirk hebben we helemaal: de hele lijst husselen, daarna pas in pagina's knippen
        full = await _search_recipes("", "dirk", 0, filters, size=5000)
        rs = _personal_recipes(full["recipes"], interest, seed)
        page = max(0, min(page, 200))
        return {**full, "recipes": await _with_costs(rs[page * RECIPE_PAGE:(page + 1) * RECIPE_PAGE]), "has_more": (page + 1) * RECIPE_PAGE < len(rs)}
    res = await _search_recipes("", store, page, filters)
    return {**res, "recipes": await _with_costs(_personal_recipes(res["recipes"], interest, seed + str(page)))}


async def _search_recipes(q: str, store: str, page: int, filters: str, size: int = RECIPE_PAGE) -> dict:
    import json as _json
    try:
        flt = {str(k): [str(x) for x in v] for k, v in (_json.loads(filters or "{}") or {}).items() if isinstance(v, list) and v}
    except Exception:
        flt = {}
    page = max(0, min(page, 200))
    if store in _RECIPE_SOURCES:
        try:
            if store in ("ah", "jumbo"):
                return await _diet_recipes(store, q, flt, page, size)
            return await _store_recipes(store, q, flt, page, size)
        except Exception as e:
            logger.warning("Recepten %s: %r", store, e)
            raise HTTPException(status_code=502, detail=f"{STORE_LABELS.get(store, store)} is nu niet bereikbaar, probeer het zo nog eens")
    # Alle winkels: per winkel een deel, om en om, met de filters die overal werken
    courses = flt.get("gang") or []
    max_time = min((int(v) for v in flt.get("tijd") or [] if str(v).isdigit()), default=None)
    per = RECIPE_PAGE // 3

    async def one(s):
        sf: dict = {}
        for c in courses:
            k, v = _COURSE_MAP[s].get(c, (None, None))
            if k:
                sf.setdefault(k, []).append(v)
        if s == "dirk" and max_time:
            sf["tijd"] = [str(max_time)]
        if s == "jumbo" and max_time and max_time <= 20:
            sf["klaar_in_20_minuten"] = ["Klaar in 20 minuten"]
        if s == "jumbo":
            sf = {k: v[:1] for k, v in sf.items()}  # Jumbo kent één keuze per filter
        return await _store_recipes(s, q, sf, page, per)

    results = await asyncio.gather(*(one(s) for s in _RECIPE_SOURCES), return_exceptions=True)
    lists, total, more, errors = [], 0, False, []
    for s, res in zip(_RECIPE_SOURCES, results):
        if isinstance(res, Exception):
            logger.warning("Recepten %s: %r", s, res)
            errors.append(STORE_LABELS.get(s, s))
            continue
        rs = [r for r in res["recipes"] if not max_time or not r.get("time") or r["time"] <= max_time]
        lists.append(rs)
        total += res["total"]
        more = more or res["has_more"]
    merged = [r for group in itertools.zip_longest(*lists) for r in group if r] if lists else []
    facets = [{"key": "gang", "label": "Gang", "multi": True, "values": [{"value": v, "label": l, "count": None} for v, l in COMMON_COURSES]},
              {"key": "tijd", "label": "Bereidingstijd", "multi": False, "values": [{"value": v, "label": l, "count": None} for v, l in COMMON_TIMES]}]
    return {"recipes": merged, "total": total, "facets": facets, "has_more": more, "errors": errors}


STORE_LABELS = {"ah": "Albert Heijn", "jumbo": "Jumbo", "dirk": "Dirk"}
_QTY_RE = re.compile(r"^\s*(\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?|½|¼|¾)\s*([a-zA-Zé]+\.?)?\s+(.*)$")
_UNIT_WORDS = {"g": "gram", "gr": "gram", "gram": "gram", "kg": "kg", "kilo": "kg", "ml": "ml", "l": "liter", "liter": "liter", "dl": "dl", "cl": "cl",
               "el": "el", "eetlepel": "el", "eetlepels": "el", "tl": "tl", "theelepel": "tl", "theelepels": "tl", "teen": "teen", "tenen": "teen",
               "snuf": "snuf", "snufje": "snuf", "plak": "plak", "plakken": "plak", "blik": "blik", "blikje": "blik", "pot": "pot", "potje": "pot",
               "zak": "zak", "zakje": "zak", "bos": "bos", "bosje": "bos", "pak": "pak", "pakje": "pak", "takje": "takje", "takjes": "takje",
               "stuk": "stuks", "stuks": "stuks", "st": "stuks", "fles": "fles", "bakje": "bak", "bak": "bak", "scheut": "scheut", "handje": "handje"}


def _parse_amount(text: str) -> tuple:
    # "2 el olijfolie" -> (2.0, "el", "olijfolie"); "1 avocado" -> (1.0, "stuks", "avocado")
    t = (text or "").strip()
    m = _QTY_RE.match(t)
    if not m:
        return None, "stuks", t
    raw = m.group(1).replace(",", ".").replace(" ", "")
    qty = {"½": 0.5, "¼": 0.25, "¾": 0.75}.get(raw)
    if qty is None:
        if "/" in raw:
            a, b = raw.split("/")
            qty = float(a) / float(b) if float(b) else None
        else:
            qty = float(raw)
    unit_word = (m.group(2) or "").lower().rstrip(".")
    unit = _UNIT_WORDS.get(unit_word)
    rest = m.group(3).strip()
    if m.group(2) and not unit:
        rest = f"{m.group(2)} {rest}"  # geen eenheid maar deel van de naam, bijv. "2 middelgrote uien"
        unit = "stuks"
    return qty, unit or "stuks", rest


async def _recipe_detail(rid: str) -> dict:
    hit = _rc_get(("detail", rid), 6 * 3600)
    if hit is not None:
        return hit
    # id = "<winkel>-<sleutel>" (een ":" zou de app als link-schema zien)
    m = re.match(r"(ah|jumbo|dirk)[-:](.+)$", rid or "")
    store, key = (m.group(1), m.group(2)) if m else ("", "")
    rid = f"{store}-{key}"
    if store == "ah" and key.isdigit():
        d = await _ah_gql("""query($id:Int!){recipe(id:$id){id title description cookTime servings{number} images{url width} courses
            tags{key value} nutritions{energy{value unit}} ingredients{text quantity quantityUnit{singular} name{singular}} preparation{steps}}}""",
                          {"id": int(key)})
        r = d.get("recipe") or {}
        if not r:
            raise HTTPException(status_code=404, detail="Recept niet gevonden")
        ings = []
        for i in r.get("ingredients") or []:
            unit = _UNIT_WORDS.get(((i.get("quantityUnit") or {}).get("singular") or "").lower(), (i.get("quantityUnit") or {}).get("singular") or "stuks")
            ings.append({"text": i.get("text") or "", "name": (i.get("name") or {}).get("singular") or i.get("text") or "",
                         "qty": i.get("quantity"), "unit": unit or "stuks", "product": None})
        energy = (r.get("nutritions") or {}).get("energy") or {}
        out = {"id": rid, "store": "ah", "title": r.get("title"), "description": r.get("description"), "image": _ah_image(r.get("images"), 800),
               "time": r.get("cookTime"), "servings": (r.get("servings") or {}).get("number"),
               "tags": sorted({_nice(t["value"]) for t in r.get("tags") or [] if t.get("value")}),
               "kcal": energy.get("value"), "ingredients": ings, "steps": (r.get("preparation") or {}).get("steps") or [],
               "url": f"https://www.ah.nl/allerhande/recept/R-R{key}"}
    elif store == "jumbo":
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
            resp = await c.get(f"https://www.jumbo.com/recepten/{key}", headers=_PAGE_HEADERS)
        r = _find_dict(_nuxt_data(resp.text), "instructions") or {}
        if not r.get("title"):
            raise HTTPException(status_code=404, detail="Recept niet gevonden")
        ings = []
        for i in r.get("ingredients") or []:
            qty, unit, _ = _parse_amount(f"{i.get('amount') or ''} x")
            p = i.get("product") or {}
            ings.append({"text": f"{(i.get('amount') or '').strip()} {(i.get('name') or '').strip()}".strip(), "name": (i.get("name") or "").strip(),
                         "qty": qty, "unit": unit, "product": {"store": "Jumbo", "sid": str(p.get("sku") or p.get("id"))} if (p.get("sku") or p.get("id")) else None})
        tags = [r.get("course")] + [t.get("name") if isinstance(t, dict) else t for t in r.get("tags") or []]
        out = {"id": rid, "store": "jumbo", "title": (r.get("title") or "").strip(), "description": r.get("description"),
               "image": r.get("fullImageUrl") or r.get("imageUrl") or r.get("image"), "time": r.get("time") or r.get("cookingTime"),
               "servings": r.get("numberOfPersons") or r.get("persons"), "tags": sorted({_nice(str(t)) for t in tags if t}),
               "kcal": r.get("calories") or None, "ingredients": ings, "steps": [s for s in r.get("instructions") or [] if isinstance(s, str)],
               "url": f"https://www.jumbo.com/recepten/{key}"}
        if not out["image"] or not out["time"]:
            tile = next((x for x in (await _jumbo_recipes(out["title"], {}, 0, 5))["recipes"] if x["id"] == rid), None) if out["title"] else None
            if tile:
                out["image"] = out["image"] or tile["image"]
                out["time"] = out["time"] or tile["time"]
                out["servings"] = out["servings"] or tile["servings"]
    elif store == "dirk":
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
            resp = await c.get(f"https://www.dirk.nl/meer/recepten/recept/{key}", headers=_PAGE_HEADERS)
        data = (_nuxt_data(resp.text) or {}).get("data") or {}
        r = (_find_dict(data, "steps") or {})
        prods = next((v for k, v in data.items() if str(k).startswith("products-") and isinstance(v, dict)), {})
        if not r.get("title"):
            raise HTTPException(status_code=404, detail="Recept niet gevonden")
        ings = []
        seen = set()
        for i in sorted(r.get("ingredients") or [], key=lambda i: (i.get("rankNumber") or 0, i.get("position") or 0)):
            desc = (i.get("description") or "").strip()
            if not desc or desc in seen:
                continue  # Dirk geeft soms meerdere producten voor hetzelfde ingrediënt
            seen.add(desc)
            qty, unit, name = _parse_amount(desc)
            p = prods.get(str(i.get("productNumber"))) or {}
            ings.append({"text": desc, "name": name, "qty": qty, "unit": unit, "site_linked": bool(i.get("productNumber")),
                         "site_packs": i.get("quantity") if isinstance(i.get("quantity"), (int, float)) and i.get("quantity") > 0 else None,
                         "product": {"store": "Dirk", "sid": str(p["productId"])} if p.get("productId") else None})
        # "Wij gaan er vanuit dat je dit in huis hebt"
        in_stock = []
        for x in r.get("ingredientsInStock") or []:
            t = x if isinstance(x, str) else (x.get("description") or x.get("name") or "") if isinstance(x, dict) else ""
            if t.strip():
                in_stock.append(t.strip())
        steps = []
        for s in r.get("steps") or []:
            steps.append(s if isinstance(s, str) else (s.get("description") or s.get("text") or "") if isinstance(s, dict) else "")
        names = lambda k: [t.get("name") for t in r.get(k) or [] if isinstance(t, dict) and t.get("name")]
        img = r.get("filename")
        out = {"id": rid, "store": "dirk", "title": r["title"].strip(), "description": r.get("metaDescription"),
               "image": (DIRK_IMAGE_BASE + img.lstrip("/")) if img else None, "time": _iso_minutes(r.get("preparationTime")),
               "servings": r.get("persons"), "tags": names("courses") + names("kitchens") + names("tags") + (["Vegetarisch"] if r.get("vegetarian") else []),
               "kcal": None, "ingredients": ings, "steps": [s for s in steps if s], "tip": r.get("tip"), "in_stock": in_stock,
               "url": f"https://www.dirk.nl/meer/recepten/recept/{key}"}
    else:
        raise HTTPException(status_code=404, detail="Recept niet gevonden")
    return _rc_set(("detail", rid), out)


_FILLER = {"middelgrote", "grote", "kleine", "verse", "vers", "milde", "mild", "ongezouten", "gezouten", "friszoete", "zoete", "rijpe",
           "biologische", "bio", "fijne", "grove", "geraspte", "gehakte", "gesneden", "gedroogde", "gedroogd", "diepvries", "naturel",
           "halfvolle", "volle", "magere", "witte", "rode", "gele", "groene", "zwarte", "stevige", "kruimige", "vastkokende", "jonge",
           "oude", "belegen", "extra", "vierge", "koude", "warme", "lauwe", "zachte", "harde", "uitgelekte", "gekookte", "teentje", "tenen"}


def _stems(w: str) -> list:
    return list(_stems_t(w))


@functools.lru_cache(maxsize=20000)
def _stems_t(w: str) -> tuple:
    # appels -> appel, uien -> ui, worstjes -> worst, tomaten -> tomaat (ruw, maar genoeg om te zoeken)
    out = [w]
    for suf, rep in (("jes", ""), ("tjes", ""), ("en", ""), ("s", ""), ("ten", "t"), ("aten", "aat"), ("ien", "i"), ("eren", "eer"), ("ven", "f"), ("zen", "s"), ("aatjes", "at")):
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            out.append(w[: -len(suf)] + rep)
    if len(w) >= 4 and w.endswith("f"):
        out.append(w[:-1] + "v")  # olijf -> olijv(en)
    return tuple(dict.fromkeys(out))


_PREPS = {"zonder", "met", "in", "uit", "van", "voor", "op", "naar", "of", "en", "à", "a", "ca", "circa", "om"}


# Andere namen in de winkel: "lasagnevel" heet daar lasagnebladen, parmezaan vaak Parmigiano
_SYNONYMS = {"lasagnevel": ["lasagnebladen", "lasagne"], "lasagnevellen": ["lasagnebladen", "lasagne"], "maizena": ["maizena", "maiszetmeel", "bindmiddel"],
             "vanille extract": ["vanille extract", "vanillearoma", "vanille"], "vanilleextract": ["vanille extract", "vanillearoma", "vanille"],
             "parmezaanse kaas": ["parmigiano reggiano", "grana padano", "parmezaan"], "parmezaan": ["parmigiano reggiano", "grana padano"],
             "creme fraiche": ["creme fraiche", "zure room"], "zalmfilet": ["zalm"], "kipfilet": ["kipfilet", "kip"],
             "lente ui": ["bosui"], "lenteui": ["bosui"], "sjalot": ["sjalotten", "sjalot"], "rucola": ["rucola", "rucolasla"],
             "kokostoppers": ["kokostoppen", "kokosmakronen"], "kokostopjes": ["kokostoppen", "kokosmakronen"]}


def _best_matches(pool: list, name: str, limit: int = 1, with_pen: bool = False) -> list:
    # Zoek op een paar niveaus (alle woorden, zonder voorzetsel-deel, zonder bijvoeglijke woorden, andere naam, alleen het hoofdwoord)
    # en kies daarna het beste product over alles heen: een losse treffer op "middelgrote ui" is niet beter dan "uien"
    words = _alt_terms(re.sub(r"\([^)]*\)", " ", name), None).split()
    if not words:
        return []
    # "zwarte olijf zonder pit" gaat over olijven, niet over "pit"
    head = words
    for k, w in enumerate(words):
        if k and w in _PREPS:
            head = words[:k]
            break
    head = [w for w in head if w not in _PREPS] or words
    core = [w for w in head if w not in _FILLER] or head
    levels = [(words, 0), (head, 0.4), (core, 0.8)]
    for k, syn in enumerate(_SYNONYMS.get(" ".join(core), []) + _SYNONYMS.get(core[-1], [])):
        levels.append((syn.split(), 1.2 + k * 0.3))
    # Samengestelde woorden: "aardbeienjam" staat in de winkel ook als "aardbeien jam"
    last = core[-1]
    for k in range(3, len(last) - 2):
        levels.append((core[:-1] + [last[:k], last[k:]], 0.5))
    # Vorm van het product zegt weinig: "kaneelpoeder" of "kaneel poeder" heet in de winkel vaak gewoon "kaneel" (gemalen)
    if len(core) > 1 and core[-1] in _FORMS:
        levels.append((core[:-1], 0.6))
    for f in _FORMS:
        if last.endswith(f) and len(last) - len(f) >= 3:
            levels.append((core[:-1] + [last[: -len(f)]], 0.6))
    # "parmezaanse kaas": liever parmezaan dan zomaar kaas
    for w in core[:-1]:
        for suf in ("sche", "se"):
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                levels.append(([w[: -len(suf)]], 1.6))
    levels.append((core[-1:], 1.2 if len(core) == 1 else 2.5))
    best: dict = {}
    seen = set()
    for lv, extra in levels:
        key = " ".join(lv)
        if key in seen or len(key) < 2:
            continue
        seen.add(key)
        hits, ids = [], set()
        for st in _stems(lv[-1]):
            for d in _search_products(pool, " ".join(lv[:-1] + [st])):
                if id(d) not in ids:
                    ids.add(id(d))
                    hits.append(d)
        for rank, d in enumerate(hits[:400]):
            pen = _food_penalty(d, rank, lv) + extra
            if id(d) not in best or pen < best[id(d)][0]:
                best[id(d)] = (pen, d)
    ranked = sorted(best.values(), key=lambda x: x[0])[:limit]
    return ranked if with_pen else [d for _, d in ranked]


def _cheapest_good(pool: list, name: str, store: str) -> Optional[dict]:
    # Het best passende product; zijn er een paar even goede, dan de voordeligste per kilo of liter
    hits = _best_matches(pool, name, 5, with_pen=True)
    if not hits:
        return None
    top = hits[0][0]
    good = [d for pen, d in hits if pen <= top + 1.0]
    if len(good) < 2:
        return hits[0][1]

    def per_unit(d):
        return _unit_value(resolve_price(d.get("prices") or {}, store, d.get("unavailable") or []), d.get("unit") or "")
    vals = [(per_unit(d), k, d) for k, d in enumerate(good)]
    # Alleen vergelijken als ze dezelfde maat hebben (allemaal per kilo of allemaal per liter)
    if not all(v for v, _, _ in vals) or len({v[1] for v, _, _ in vals}) != 1:
        return hits[0][1]
    return min(vals, key=lambda x: (x[0][0], x[1]))[2]


_FORMS = ("poeder", "korrels", "vlokken", "stokjes", "stokje", "snippers", "blaadjes", "zaadjes", "gemalen")
_NONFOOD = {"Huishoud & huisdieren", "Kind & drogisterij", "Non food"}
_NONFOOD_RE = re.compile(r"drogist|huishoud|huisdier|baby|verzorging|cosmetica|non food|shampoo|douche|zeep|tandpasta|wasmiddel|afwas|"
                         r"deodorant|bodylotion|conditioner|wc |toilet|schoonmaak|kattenvoer|hondenvoer|luier|parfum|scheer|haar|navulling|douchegel|handzeep|"
                         r"palmolive|nivea|dove |andrelon|robijn|dreft|ariel|persil|sanex|zwitsal|rexona|glorix|cillit|vanish|lenor|page |zewa")
_CANDY_RE = re.compile(r"\b(snoep|drop|winegum|spekjes|chips|koek|koekjes|chocolade|lolly|kauwgom)\b")
# Bewerkte producten: "ciabatta" is geen ciabatta-cracker, "citroen" geen citroenkoek, "olijf" geen tapenade
_PROCESSED = ("koek", "cracker", "tapenade", "azijn", "saus", "chips", "spread", "sap", "drank", "siroop", "thee", "snoep", "taart", "cake",
              "smaak", "kimchi", "dressing", "soep", "salade", "pasta", "toast", "wafel", "reep", "ijs", "yoghurt", "kwark", "vla", "limonade",
              "frisdrank", "bier", "radler", "likeur", "zeep", "geur", "poeder", "aroma", "pesto", "dip", "smeer", "mix", "kruiden", "biscuit",
              "kroket", "salami", "worst", "honing", "kogel", "zuurkool", "snack", "bonbon", "brandewijn", "jenever", "mayo", "ketchup", "jus",
              "bar", "vloeibaar", "braden", "focaccia", "brood", "margarine", "shake", "drink",
              "olie", "skyr", "muffin", "viennetta", "feta")
# Woorden die alleen iets over het product zeggen ("citroenen verpakt", "kaas plakken")
_DESCRIPTORS = {"verpakt", "los", "geschild", "gesneden", "geraspt", "plakken", "plakjes", "blokjes", "reepjes", "schijfjes", "zwart", "wit",
                "rood", "groen", "geel", "bio", "biologisch", "biologische", "naturel", "kruimig", "vastkokend", "s", "m", "l", "xl", "kanjers",
                "vrije", "uitloop", "scharrel", "per", "kilo", "stuk", "zak", "bak", "pot", "blik", "fles", "flessen", "pak", "pack", "voordeel",
                "voordeelverpakking", "mini", "groot", "klein", "heel", "halve", "stukjes", "diepvries", "vers", "extra", "fijn", "grof"}
_STORE_WORDS = {"ah", "jumbo", "dirk", "1 de beste", "excellent", "biologisch"}


@functools.lru_cache(maxsize=64)
def _penalty_ctx(words: tuple) -> dict:
    # Wat alleen van de zoekwoorden afhangt één keer uitrekenen, niet opnieuw voor elk product
    qstems = {st for q in words for st in _stems(q)}
    rel: dict = {}

    def related(w):
        v = rel.get(w)
        if v is None:
            v = rel[w] = any(w == q or w in _stems(q) or q in _stems(w) or q in w or (q.endswith("e") and w == q[:-1]) for q in words)
        return v
    procs = [x for x in _PROCESSED if not any(x in q for q in qstems)]
    long_re = re.compile("|".join(re.escape(x) for x in procs if len(x) > 4) or r"(?!)")
    short = [x for x in procs if len(x) <= 4]
    short_set, short_t = set(short), tuple(short)
    hits: dict = {}

    def processed(w):
        v = hits.get(w)
        if v is None:
            v = hits[w] = bool(w in short_set or (short_t and w.endswith(short_t)) or long_re.search(w)
                               or any(w.startswith(x) and len(w) <= len(x) + 3 for x in short))
        return v
    ends = tuple(e for x in procs if len(x) > 3 for e in (x, x + "s", x + "en", x + "jes"))
    return {"related": related, "processed": processed, "sub_ends": ends}


def _food_penalty(d: dict, rank: int, words: list) -> float:
    # Een recept vraagt om eten: "citroen" is geen afwasmiddel, "aardbeien" geen snoep, "ui" liever uien dan bosui of gehakt met ui
    pre = d.get("_fp")
    if pre is None or pre[0] != d["_norm"]:
        # Eén keer per product uitrekenen (zoeken loopt over duizenden producten)
        name = d["_norm"]
        brand = _norm_text(d.get("brand") or "")
        if brand and name.startswith(brand + " "):
            name = name[len(brand) + 1:]
        for sw in _STORE_WORDS:
            if name.startswith(sw + " "):
                name = name[len(sw) + 1:]
        words0 = [w for w in name.split() if not re.fullmatch(r"[\d.,%]+|\d+\w{0,3}|x|st|stuks?|kg|g|gram|ml|cl|l|liter", w)] or name.split()
        nonfood = bool(d.get("aisle") in _NONFOOD or _NONFOOD_RE.search(d.get("aisle") or "") or _NONFOOD_RE.search(name))
        pre = (d["_norm"], words0, nonfood, _norm_text(d.get("subcategory") or "").split())
        d["_fp"] = pre
    _, nw, nonfood, subw = pre
    ctx = _penalty_ctx(tuple(words))
    related, proc_hit = ctx["related"], ctx["processed"]
    # Positie telt alleen echte woorden ervoor: "Gele uien" is net zo goed uien als "Uien"
    nw = [w for w in nw if related(w) or w not in _FILLER and w not in _DESCRIPTORS] or nw

    # Positie van het gezochte woord; in het Nederlands zit het hoofdwoord achteraan ("tarwebloem" is bloem, "bloemkool" niet)
    def place(q):
        best = None
        for k, w in enumerate(nw):
            if w == q or w in _stems(q) or q in _stems(w):
                v = k
            elif w.endswith(q) or any(w.endswith(st) for st in _stems(q) if len(st) >= 3):
                v = 3 + k + (1 if len(w) - len(q) > 6 else 0)
            elif w.startswith(q):
                v = 2.5 + k  # kipfilet, appelmoes: vaak precies wat je zoekt
            else:
                continue
            best = v if best is None else min(best, v)
        return best
    # Het laatste zoekwoord is het hoofdwoord ("witte wijn" is wijn, geen wijnazijn)
    head = place(words[-1])
    pos = head if head is not None else min((p for p in map(place, words) if p is not None), default=11) + 3
    if head is None:
        # Soort van de winkel telt ook: "Bakker van der Akker Rond wit heel" is gewoon brood
        if any(w == words[-1] or w in _stems(words[-1]) or words[-1] in _stems(w) for w in subw):
            pos = min(pos, 3.5)
    elif any(words[-1] in w for w in subw):
        pos -= 0.5  # soort past ook: kipfilet bij kip, broden bij brood
    pen = min(rank, 100) * 0.01 + pos
    # Een zelfstandig naamwoord ná het gezochte woord maakt er iets anders van ("bloemen honing", "citroen kogels")
    hq = words[-1]
    hk = next((k for k, w in enumerate(nw) if hq in w or w in _stems(hq) or any(st in w for st in _stems(hq) if len(st) >= 3)), None)
    stop = False
    for k, w in enumerate(nw):
        if hk is not None and k > hk and w in _PREPS:
            stop = True  # "olijven zonder pit": de rest zegt alleen iets over het product
        if related(w):
            continue
        if hk is not None and k > hk and not stop and w not in _DESCRIPTORS and w not in _FILLER and w not in _PREPS:
            pen += 2
        elif hk is not None and k < hk and w not in _DESCRIPTORS and w not in _FILLER:
            pen += 1.2  # "Gyoza kip", "Mozzarella tomaat": het gezochte woord is hier bijzaak
        else:
            pen += 0.7

    # Ook in samenstellingen: "pastasaus" is geen pasta, "appelsap" geen appel
    rests = [w if not related(w) else w.replace(words[-1], " ") for w in nw]
    if any(proc_hit(r) for rest in rests for r in rest.split()):
        pen += 5
    # Soort van de winkel: "Verkade Nizza kaneel" staat bij de theebiscuits, dat is geen kaneel
    elif ctx["sub_ends"] and any(w.endswith(ctx["sub_ends"]) for w in subw):
        pen += 3
    if nonfood:
        pen += 30
    # "witte wijn" is geen rode wijn
    colors = {"wit": ("witte", "wit"), "rood": ("rode", "rood"), "groen": ("groene", "groen"), "zwart": ("zwarte", "zwart")}
    want = {c for c, ws in colors.items() if any(q in ws for q in words)}
    if want and any(w in ws for c, ws in colors.items() if c not in want for w in nw):
        pen += 6
    if d.get("aisle") == "Snacks & snoep" and not any(_CANDY_RE.search(q) for q in words):
        pen += 8
    if d.get("aisle") == "Dranken, sap, koffie & thee" and not any(q in ("sap", "melk", "wijn", "bier", "koffie", "thee", "water") for q in words):
        pen += 6
    full = d["_norm"] + " " + _norm_text(d.get("unit") or "")
    # Een recept vraagt om een scheut wijn, geen doos van 6 flessen
    if re.search(r"\b\d+\s*(flessen|blikjes|blikken|pakken|bekers)\b|\b[2-9]\d?\s*x\s*\d", full) and not any(q in ("flessen", "pack", "doos") for q in words):
        pen += 5
    # "verse peterselie" is geen potje gedroogde kruiden
    if any(q in ("vers", "verse") for q in words) and (re.search(r"gedroogd|gemalen|strooibus", full) or brand_of(d) in _DRIED_BRANDS):
        pen += 4
    # Snoep met de naam van iets anders: Red Band "zoete paddenstoelen" zijn geen paddenstoelen
    if brand_of(d) in _CANDY_BRANDS and not any(_CANDY_RE.search(q) for q in words):
        pen += 8
    return pen


_DRIED_BRANDS = {"verstegen", "euroma", "silvo", "jonnie boer", "santa maria"}
_CANDY_BRANDS = {"red band", "haribo", "katja", "venco", "look o look", "autodrop", "klene", "lonka", "malaco", "tum tum", "fini"}


def brand_of(d: dict) -> str:
    b = _norm_text(d.get("brand") or "")
    if b:
        return b
    n = d["_norm"]
    return next((x for x in _DRIED_BRANDS | _CANDY_BRANDS if n.startswith(x + " ")), "")


def _relevant_products(docs: list, q: str) -> list:
    # Zoeken in Producten: "brood" geeft eerst echte broden (witbrood, volkoren), niet broodbeleg of broodjes kroket;
    # meervoud en enkelvoud vinden elkaar ("broden", "tomaat")
    words = _norm_text(q).split()
    if not words:
        return docs
    hits, ids = [], set()
    last = words[-1]
    # "brood" -> "brod" vindt ook broden, "tomaat" -> "tomat" ook tomaten
    short = re.sub(r"(aa|ee|oo|uu)([^aeiou])$", lambda m: m.group(1)[0] + m.group(2), last)
    for st in _stems(last) + ([short] if short != last and len(short) >= 3 else []):
        for d in _search_products(docs, " ".join(words[:-1] + [st])):
            if id(d) not in ids:
                ids.add(id(d))
                hits.append(d)
    return _rank_food(hits, words)


def _rank_food(hits: list, words: list) -> list:
    return [d for _, d in sorted(enumerate(hits), key=lambda rd: _food_penalty(rd[1], rd[0], words))]


def _store_matches(names: list, docs: list, store: str) -> dict:
    # Ingrediënten zonder gekoppeld product: zoek het best passende product in dezelfde winkel
    pool = [d for d in docs if d.get("_src") == store and d.get("is_global")]
    out = {}
    for n in names:
        if _norm_text(n) in ("water", "kraanwater", "lauw water", "kokend water", "ijsblokjes"):
            continue
        hit = _cheapest_good(pool, n, store)
        if hit:
            out[n] = hit
    return out


# Dingen die de meeste mensen al in huis hebben (kruiden, olie, basis)
_PANTRY_RE = re.compile(r"\b(zout|peper|zeezout|olie|olijfolie|zonnebloemolie|azijn|suiker|bloem|maizena|bakpoeder|water|kraanwater|\w*bouillon\w*|"
                        r"\w*kruiden\w*|specerij\w*|paprikapoeder|komijn\w*|kurkuma|kerrie\w*|currypoeder|kaneel|nootmuskaat|oregano|tijm|rozemarijn|"
                        r"basilicum gedroogd|laurier\w*|chilivlokken|chilipoeder|cayennepeper|knoflookpoeder|uienpoeder|italiaanse kruiden|"
                        r"provencaalse kruiden|mosterd|ketjap|sojasaus|honing|vanille\w*|boter|roomboter|bakboter|margarine|kipkruiden|gehaktkruiden)\b")


_ALWAYS_HOME = {"water", "kraanwater", "lauw water", "kokend water", "zout", "peper", "zout en peper", "peper en zout", "ijsblokjes"}


def _is_pantry(name: str) -> bool:
    return bool(_PANTRY_RE.search(_norm_text(name)))


def _ing_pantry(rec: dict, i: dict) -> bool:
    # Niet door de site gekoppeld (of typisch voorraadkast): waarschijnlijk al in huis
    site_linked = bool(i.get("product")) or bool(i.get("site_linked"))
    return (not site_linked and (rec["store"] != "ah" or _is_pantry(i["name"]))) or _norm_text(i["name"]) in _ALWAYS_HOME


def _recipe_with_products(rec: dict, user: dict, matches: Optional[dict] = None) -> dict:
    by_sid = _product_cache.get("by_sid") or {}
    favs = set(user.get("favorite_products") or [])
    ings = []
    for i in rec["ingredients"]:
        p = i.get("product")
        pantry = _ing_pantry(rec, i)
        doc = by_sid.get((p["store"], p["sid"])) if p else None
        if doc is None and (matches or {}).get(i["name"]) is not None:
            doc = matches[i["name"]]
            p = {"store": doc["_src"]}
        ings.append({**i, "pantry": pantry, "product": product_public(_clean(doc), p["store"], user["user_id"], favs) if doc else None})
    return {**rec, "ingredients": ings}


@api_router.get("/recipes/detail")
async def recipe_detail(id: str, user: dict = Depends(get_current_user)):
    try:
        rec = await _recipe_detail(id)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Recept %s: %r", id, e)
        raise HTTPException(status_code=502, detail="Dit recept is nu niet op te halen, probeer het zo nog eens")
    if not user.get("no_personal"):
        asyncio.create_task(_track_recipe(user["user_id"], rec, 1))
    return await _recipe_products(rec, user)


async def _import_linked(rec: dict) -> None:
    # Producten die de site bij het recept koppelt maar die nog niet in de app staan: meteen inladen
    by_sid = _product_cache.get("by_sid") or {}
    todo = [int(i["product"]["sid"]) for i in rec["ingredients"] if i.get("product") and i["product"]["store"] == "Dirk"
            and ("Dirk", i["product"]["sid"]) not in by_sid and str(i["product"]["sid"]).isdigit()]
    if not todo:
        return
    have = {str(p["dirk_id"]) async for p in db.products.find({"dirk_id": {"$in": todo + [str(t) for t in todo]}}, {"_id": 0, "dirk_id": 1})}
    todo = [t for t in todo if str(t) not in have]
    if not todo:
        return
    try:
        mults = await _store_mults()
        async with httpx.AsyncClient(timeout=20, headers=DIRK_HEADERS) as c:
            prods = await _dirk_fetch_products(c, todo[:25])
        docs = []
        for p in prods:
            nrm = _dirk_normalize(p)
            if nrm:
                nrm["source_id"] = nrm["dirk_id"]
                docs.append(_new_store_product("dirk_id", nrm, "Dirk", mults))
        if docs:
            await db.products.insert_many(docs)
            _invalidate_products()
            logger.info("Recept %s: %d producten van Dirk ingeladen", rec["id"], len(docs))
    except Exception as e:
        logger.warning("Receptproducten inladen mislukt: %r", e)


async def _import_linked_jumbo(rec: dict) -> None:
    by_sid = _product_cache.get("by_sid") or {}
    todo = [i["product"]["sid"] for i in rec["ingredients"] if i.get("product") and i["product"]["store"] == "Jumbo"
            and ("Jumbo", i["product"]["sid"]) not in by_sid]
    if not todo:
        return
    have = {p["jumbo_id"] async for p in db.products.find({"jumbo_id": {"$in": todo}}, {"_id": 0, "jumbo_id": 1})}
    todo = [t for t in todo if t not in have][:15]
    if not todo:
        return
    try:
        mults = await _store_mults()
        found = await asyncio.gather(*(_jumbo_search(t) for t in todo), return_exceptions=True)
        docs = []
        for sid, res in zip(todo, found):
            nrm = next((n for n in res if n["jumbo_id"] == sid), None) if isinstance(res, list) else None
            if nrm:
                nrm["source_id"] = nrm["jumbo_id"]
                docs.append(_new_store_product("jumbo_id", nrm, "Jumbo", mults))
        if docs:
            await db.products.insert_many(docs)
            _invalidate_products()
            logger.info("Recept %s: %d producten van Jumbo ingeladen", rec["id"], len(docs))
    except Exception as e:
        logger.warning("Jumbo-receptproducten inladen mislukt: %r", e)


async def _recipe_products(rec: dict, user: dict, light: bool = False) -> dict:
    await _global_products()
    if not light:
        # Ontbrekende producten van de winkel inladen; dat ververst daarna de hele productlijst (zwaar), dus niet bij veel recepten tegelijk
        await _import_linked(rec)
        await _import_linked_jumbo(rec)
    matches = await _recipe_matches(rec)
    out = _recipe_with_products(rec, user, matches)
    out["is_favorite"] = any(f.get("id") == rec["id"] for f in user.get("recipe_favorites") or [])
    return out


class RecipeFav(BaseModel):
    id: str
    title: str = ""
    image: Optional[str] = None
    store: str = ""
    time: Optional[int] = None
    servings: Optional[int] = None


@api_router.get("/recipes/favorites")
async def recipe_favorites(user: dict = Depends(get_current_user)):
    favs = list(reversed(user.get("recipe_favorites") or []))
    return {"recipes": favs, "total": len(favs), "facets": [], "has_more": False}


@api_router.post("/recipes/favorite")
async def add_recipe_favorite(data: RecipeFav, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$pull": {"recipe_favorites": {"id": data.id}}})
    await db.users.update_one({"user_id": user["user_id"]}, {"$push": {"recipe_favorites": data.model_dump()}})
    return {"ok": True}


@api_router.delete("/recipes/favorite")
async def remove_recipe_favorite(id: str, user: dict = Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$pull": {"recipe_favorites": {"id": id}}})
    return {"ok": True}


async def _import_extra_terms() -> None:
    # Eenmalig de nieuwe zoektermen bij AH ophalen (de volledige import doet ze daarna vanzelf mee)
    await asyncio.sleep(90)
    key = "extra_terms_" + str(len(EXTRA_TERMS))
    if await db.meta.find_one({"key": key}):
        return
    try:
        added = await _import_all_ah(await _store_mults(), EXTRA_TERMS)
        await db.meta.insert_one({"key": key, "at": now_utc(), "added": added})
        logger.info("Extra zoektermen AH: %d producten toegevoegd", added)
    except Exception as e:
        logger.warning("Extra zoektermen AH mislukt: %r", e)


class RecipeImport(BaseModel):
    id: str
    category: str = "avondeten"
    include: List[int] = []
    reuse: bool = False  # al eerder overgenomen? dan dat gerecht teruggeven
    swaps: Dict[str, str] = {}  # ingrediënt (volgnummer) -> ander product, bijv. een voordeligere verpakking


async def _recipe_to_dish(rid: str, category: str, user: dict, reuse: bool = False, include: Optional[List[int]] = None,
                          swaps: Optional[Dict[str, str]] = None, light: bool = False) -> dict:
    if category not in MEAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    rec = await _recipe_products(await _recipe_detail(rid), user, light=light)
    if swaps:
        by_pid = _product_cache.get("by_pid") or {}
        favs = set(user.get("favorite_products") or [])
        for k, pid in swaps.items():
            d = by_pid.get(pid)
            if d and str(k).isdigit() and int(k) < len(rec["ingredients"]):
                rec["ingredients"][int(k)] = {**rec["ingredients"][int(k)], "product": product_public(_clean(d), d["_src"], user["user_id"], favs)}
    if reuse and not swaps:
        # Al eerder overgenomen? Dan dat gerecht gebruiken (met jouw aanpassingen)
        old = await db.dishes.find_one({"owner_id": user["user_id"], "deleted_at": None, "source.recipe_id": rec["id"]}, {"_id": 0})
        if old:
            return old
    persons = rec.get("servings") or 4
    ings, pantry = [], []
    keep = set(include or [])
    for n, i in enumerate(rec["ingredients"]):
        prod = i.get("product")
        per = round((i["qty"] or 1) / persons, 3)
        target = pantry if i.get("pantry") and n not in keep else ings
        target.append(Ingredient(name=(prod or {}).get("name") or i["name"] or i["text"], unit=i["unit"] or "stuks",
                               qty_adult=per, qty_child=round(per / 2, 3),
                               aisle=(prod or {}).get("aisle") or "Overig", price=(prod or {}).get("price") or 0,
                               product_id=(prod or {}).get("id"), store=(prod or {}).get("source") or (STORE_LABELS.get(rec["store"]) if prod else None),
                               recipe_text=i["text"]).model_dump())
    dish_id = f"dish_{uuid.uuid4().hex[:12]}"
    doc = {"dish_id": dish_id, "name": rec["title"][:80], "category": category, "is_standard": False, "owner_id": user["user_id"],
           "ingredients": ings, "pantry": pantry, "source": {"recipe_id": rec["id"], "url": rec.get("url"), "image": rec.get("image"), "store": rec["store"],
                                           "servings": persons},
           "deleted_at": None, "created_at": now_utc(),
           # Vanuit een kamp gekozen: blijft een online gerecht, pas bij aanpassen wordt het een eigen gerecht
           "online": bool(reuse)}
    await db.dishes.insert_one(doc)
    return doc


@api_router.post("/recipes/import")
async def import_recipe(data: RecipeImport, user: dict = Depends(get_current_user)):
    dish = await _recipe_to_dish(data.id, data.category, user, reuse=data.reuse, include=data.include, swaps=data.swaps)
    if not user.get("no_personal"):
        asyncio.create_task(_track_recipe(user["user_id"], await _recipe_detail(data.id), 3))
    return dish_public(dish)


class RecipeToCamp(BaseModel):
    id: str
    camp_id: str
    day_index: int
    category: str
    include: List[int] = []
    swaps: Dict[str, str] = {}


@api_router.post("/recipes/add-to-camp")
async def recipe_to_camp(data: RecipeToCamp, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": data.camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    days = camp.get("days") or []
    if not 0 <= data.day_index < len(days):
        raise HTTPException(status_code=400, detail="Die dag bestaat niet in dit kamp")
    dish = await _recipe_to_dish(data.id, data.category, user, reuse=True, include=data.include, swaps=data.swaps)
    if not user.get("no_personal"):
        asyncio.create_task(_track_recipe(user["user_id"], await _recipe_detail(data.id), 3))
    meals = days[data.day_index].setdefault("meals", {})
    lst = meals.setdefault(data.category, [])
    if dish["dish_id"] not in lst:
        lst.append(dish["dish_id"])
    await db.camps.update_one({"camp_id": data.camp_id}, {"$set": {"days": days}})
    return {"ok": True, "dish": dish_public(dish)}


# --- Home: overzicht met je kamp, acties, recepten en een prijsvergelijking ---
_home_cache: dict = {}
COMPARE_STORES = ["Albert Heijn", "Jumbo", "Dirk"]


_compare_running: set = set()


def _compare_hit(st: str, cands: list, by_ean: dict, name: str, base: Optional[dict]) -> tuple:
    # (product, vervangen?) voor één artikel in één winkel
    if base and base.get("_src") == st:
        return base, False
    # 1. Precies hetzelfde product: zelfde barcode
    if base and base.get("barcode"):
        d = by_ean.get((st, base["barcode"]))
        if d:
            return d, False
    terms = _alt_terms(name, base) or name
    hits = _best_matches(cands, terms, 3)
    if base:
        # liever iets van dezelfde soort, en geen ander soort product (chocolademelk voor melk)
        good = [d for d in hits if _same_kind(base, d, strict=False)]
        same_aisle = [d for d in good if d.get("aisle") == base.get("aisle")]
        hits = same_aisle or good
    if hits:
        return hits[0], True
    # 2. Ruimer: op het hoofdwoord binnen dezelfde afdeling ("verse gnocchi" -> gnocchi)
    words = sorted((w for w in _norm_text(terms).split() if len(w) >= 4), key=len, reverse=True)
    pool = [d for d in cands if not base or d.get("aisle") == base.get("aisle")]
    for w in words:
        hits = [d for d in _best_matches(pool, w, 3) if not base or _same_kind(base, d, strict=False)]
        if hits:
            return hits[0], True
    # 3. Op de naam van het ingrediënt zelf (niet het product), in de hele winkel: "melk" vindt altijd wel melk
    if base and _norm_text(name) != _norm_text(terms):
        hits = [d for d in _best_matches(cands, name, 3) if _same_kind(base, d, strict=False) or d.get("aisle") == base.get("aisle")]
        if hits:
            return hits[0], True
    return None, False


def _line_cost(d: dict, st: str, qty: Optional[float], unit: Optional[str]) -> tuple:
    # (kosten, aantal verpakkingen) voor de hoeveelheid op je lijst; zonder hoeveelheid één verpakking
    price = resolve_price(d.get("prices") or {}, st, d.get("unavailable") or [])
    if not price:
        return 0.0, 0
    if qty:
        plan = _pack_plan(d, qty, unit or "stuks", st)
        if plan:
            return plan["cost"], plan["packs"]
    return price, 1


def _compare_stores(items: list, docs: list) -> list:
    # Per winkel: wat kost één verpakking van het best passende product per artikel op je lijst.
    # Staat het product niet in die winkel, dan eerst hetzelfde product via de barcode, anders een vergelijkbaar
    # alternatief. Wat een winkel echt niet heeft rekenen we mee met de prijs bij de andere winkels (geschat),
    # anders lijkt een winkel goedkoper alleen omdat er minder op het lijstje staat.
    by_pid = {d["product_id"]: d for d in docs}
    by_store: dict = {s: [] for s in COMPARE_STORES}
    by_ean: dict = {}
    for d in docs:
        if d.get("_src") in by_store and d.get("is_global"):
            by_store[d["_src"]].append(d)
            if d.get("barcode"):
                by_ean.setdefault((d["_src"], d["barcode"]), d)
    out = []
    for st, cands in by_store.items():
        total, found, lines = 0.0, 0, []
        for it in items:
            name, pid = it[0], it[1]
            qty, unit = (it[2], it[3]) if len(it) > 3 else (None, None)
            base = by_pid.get(pid) if pid else None
            hit, alt = _compare_hit(st, cands, by_ean, name, base)
            price, packs = _line_cost(hit, st, qty, unit) if hit else (0.0, 0)
            if hit and price:
                total += price
                found += 1
            lines.append({"name": name, "product": hit["name"] if hit and price else None, "product_id": hit["product_id"] if hit and price else None,
                          "image": hit.get("image") if hit and price else None, "price": round(price, 2) if hit and price else None,
                          "packs": packs or None, "qty": qty, "unit": unit,
                          "alternative": bool(hit and price and alt and not (base and _norm_text(base["name"]) == hit["_norm"]))})
        out.append({"store": st, "total": round(total, 2), "found": found, "count": len(items), "items": lines})
    return _finish_compare(out)


def _finish_compare(out: list) -> list:
    # Ontbrekende artikelen: reken met de gemiddelde prijs bij de winkels die het wel hebben
    n = len(out[0]["items"]) if out else 0
    for o in out:
        o["total"] = round(sum(i["price"] or 0 for i in o["items"]), 2)
        o["found"] = sum(1 for i in o["items"] if i["price"])
        for i in o["items"]:
            i.pop("estimate", None)
    for k in range(n):
        known = [o["items"][k]["price"] for o in out if o["items"][k]["price"]]
        guess = round(sum(known) / len(known), 2) if known else 0
        for o in out:
            if not o["items"][k]["price"] and guess:
                o["items"][k]["estimate"] = guess
    for o in out:
        est = sum(i.get("estimate") or 0 for i in o["items"])
        o["estimated"] = round(est, 2)
        o["total_fair"] = round(o["total"] + est, 2)
    return out


def _apply_compare_swaps(compare: list, swaps: dict, by_pid: dict) -> list:
    # Zelf gekozen producten per winkel (bijv. als het vervangende product niet klopt)
    if not swaps or not compare:
        return compare
    import copy
    out = copy.deepcopy(compare)
    for o in out:
        mine = swaps.get(_ikey(o["store"])) or {}
        for i in o["items"]:
            pid = mine.get(_ikey(_norm_text(i["name"])))
            d = by_pid.get(pid) if pid else None
            price, packs = _line_cost(d, o["store"], i.get("qty"), i.get("unit")) if d else (0.0, 0)
            if d and price:
                i.update({"product": d["name"], "product_id": pid, "image": d.get("image"), "price": round(price, 2),
                          "packs": packs, "alternative": True, "chosen": True})
    return _finish_compare(out)


class CompareSwap(BaseModel):
    store: str
    name: str
    product_id: Optional[str] = None  # leeg = terug naar de keuze van de app


@api_router.get("/compare/options")
async def compare_options(store: str, name: str, product_id: str = "", user: dict = Depends(get_current_user)):
    # Andere producten in deze winkel om uit te kiezen
    docs = await _global_products()
    base = (_product_cache.get("by_pid") or {}).get(product_id) if product_id else None

    def work():
        pool = [d for d in docs if d.get("_src") == store and d.get("is_global")]
        terms = _alt_terms(name, base) or name
        hits = _best_matches(pool, terms, 12)
        if len(hits) < 6:
            hits += [d for d in _search_products(pool, terms)[:12] if d not in hits]
        out = []
        for d in hits[:12]:
            price = resolve_price(d.get("prices") or {}, store, d.get("unavailable") or [])
            if price:
                out.append({"product_id": d["product_id"], "name": d["name"], "unit": d.get("unit") or "", "image": d.get("image"), "price": round(price, 2)})
        return out
    return {"options": await asyncio.to_thread(work)}


@api_router.post("/camps/{camp_id}/compare-swap")
async def camp_compare_swap(camp_id: str, data: CompareSwap, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0, "camp_id": 1})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    field = f"compare_swaps.{_ikey(data.store)}.{_ikey(_norm_text(data.name))}"
    if data.product_id:
        if not await db.products.find_one({"product_id": data.product_id, "deleted_at": None}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Product niet gevonden")
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {field: data.product_id}})
    else:
        await db.camps.update_one({"camp_id": camp_id}, {"$unset": {field: ""}})
    return {"ok": True}


def _ikey(x: str) -> str:
    return (x or "").replace(".", "·").replace("$", "")[:60]


async def _track_interest(user_id: str, doc: dict) -> None:
    # Wat bekijkt iemand: winkel, afdeling, merk en soort. Daarmee kiezen we de aanbiedingen op Home
    inc = {}
    for field, val in (("stores", doc.get("_src") or product_source(doc)), ("aisles", doc.get("aisle")),
                       ("brands", _norm_text(doc.get("brand") or "")), ("subs", doc.get("subcategory"))):
        if val:
            inc[f"{field}.{_ikey(val)}"] = 1
    if inc:
        await db.user_interest.update_one({"user_id": user_id}, {"$inc": inc, "$set": {"at": now_utc()}}, upsert=True)


def _pick_promos(cands: list, interest: dict, fav_store: str, fav_ids: set, used_ids: set, used_stores: dict, n: int = 24) -> list:
    import random
    stores = dict(interest.get("stores") or {})
    for st, c in used_stores.items():
        stores[_ikey(st)] = stores.get(_ikey(st), 0) + c
    total = sum(stores.values())
    # Winkelgewicht: je favoriete winkel vol; andere winkels naar hoeveel je ze gebruikt
    def sw(st):
        if st == fav_store:
            return 1.0
        if not total:
            return 0.5
        return min(1.0, 0.08 + stores.get(_ikey(st), 0) / total)

    def norm(group):
        g = interest.get(group) or {}
        top = max(g.values(), default=0)
        return {k: v / top for k, v in g.items()} if top else {}
    aisles, brands, subs = norm("aisles"), norm("brands"), norm("subs")
    scored = []
    for c in cands:
        pids = set(c["product_ids"])
        personal = (3 if pids & fav_ids else 0) + (2 if pids & used_ids else 0) \
            + 1.5 * max([brands.get(_ikey(b), 0) for b in c.get("_brands") or []], default=0) \
            + 1.5 * max([subs.get(_ikey(x), 0) for x in c.get("_subs") or []], default=0) \
            + 1.0 * max([aisles.get(_ikey(a), 0) for a in c.get("_aisles") or []], default=0)
        scored.append((sw(c["store"]) * (1 + personal) * random.uniform(0.75, 1.25), personal, c))
    scored.sort(key=lambda x: -x[0])
    out, others, rest = [], 0, []
    for score, personal, c in scored:
        if c["store"] != fav_store and sw(c["store"]) < 0.3:
            # Een winkel die je bijna niet gebruikt: heel af en toe, en alleen als het echt iets voor jou lijkt
            if others >= max(2, n // 8) or personal < 1.5:
                rest.append(c)
                continue
            others += 1
        out.append(c)
        if len(out) >= n:
            break
    out += rest[:max(0, n - len(out))]  # te weinig van je eigen winkel (bijv. folder nog niet geladen): aanvullen
    return [{k: v for k, v in c.items() if not k.startswith("_")} for c in out]


async def _home_inspiration() -> tuple:
    # Acties uit de folders van deze week, met foto, om en om per winkel
    promos = []
    try:
        f = await _folders_fresh(wait=False)
        await _global_products()
        by_sid = _product_cache.get("by_sid") or {}
        today = _iso_day(datetime.now(timezone.utc).isoformat())
        per_store = []
        for s in COMPARE_STORES:
            items = []
            for per in ((f.get("data") or {}).get(s) or [])[:1]:
                for it in per["items"]:
                    if it["end"] and it["end"] < today:
                        continue
                    docs = [by_sid[(s, x)] for x in it["ids"] if (s, x) in by_sid]
                    img = (docs[0].get("image") if docs and s == "Dirk" else None) or it.get("image") or (docs[0].get("image") if docs else None)
                    if not img or not docs:
                        continue
                    items.append({"store": s, "id": it["id"], "title": it["title"], "label": it["label"], "image": img,
                                  "price": it.get("price"), "regular": it.get("regular"),
                                  "product_ids": [d["product_id"] for d in docs], "end": it.get("end"),
                                  "_aisles": list({d.get("aisle") for d in docs if d.get("aisle")}),
                                  "_brands": list({_norm_text(d.get("brand") or "") for d in docs if d.get("brand")}),
                                  "_subs": list({d.get("subcategory") for d in docs if d.get("subcategory")})})
            per_store.append(items)
        # Alle acties als kandidaten; per gebruiker kiest _pick_promos welke vooraan komen
        promos = [x for group in itertools.zip_longest(*per_store) for x in group if x]
    except Exception as e:
        logger.warning("Home acties: %r", e)
    # Recept-inspiratie: een paar willekeurige recepten van de winkels
    recipes = []
    try:
        import random
        dirk = await _dirk_all_recipes()
        recipes += [{k: v for k, v in r.items() if not k.startswith("_")} for r in random.sample(dirk, min(3, len(dirk)))]
        ah = await _store_recipes("ah", "", {"veel-gebruikt": ["makkelijk"]}, random.randint(0, 20), 12)
        recipes += random.sample(ah["recipes"], min(3, len(ah["recipes"])))
        random.shuffle(recipes)
    except Exception as e:
        logger.warning("Home recepten: %r", e)
    return promos, recipes


async def _camp_compare_items(camp: dict, user: dict) -> list:
    # Wat er echt op de boodschappenlijst staat, met hoeveelheden: zo klopt de vergelijking met je lijst
    sl = await shopping_list(camp["camp_id"], user, _for_compare=True)
    merged: dict = {}
    for b in sl["by_store"]:
        for it in b["flat"]:
            unit = (it.get("unit") or "stuks").split(" + ")[0]  # samengevoegde regel: "3 stuks + 2 takje"
            k = (_norm_text(it["name"]), unit)
            if k in merged:
                merged[k][2] += it.get("qty") or 0
            else:
                merged[k] = [it["name"], it.get("orig_product_id") or it.get("product_id"), it.get("qty") or 0, unit]
    return [tuple(v) for _, v in sorted(merged.items())][:60]


async def _camp_compare(c: dict, user: dict) -> tuple:
    # (vergelijking, nog bezig?) voor één lijstje; uitrekenen gebeurt op de achtergrond
    items = await _camp_compare_items(c, user)
    if not items:
        return None, False
    key = ("compare3", c["camp_id"], tuple(items))
    hit = _home_cache.get(key)
    compare = _apply_compare_swaps(hit[1], c.get("compare_swaps") or {}, _product_cache.get("by_pid") or {}) if hit else None
    if not hit or time.time() - hit[0] > 1800:
        if key not in _compare_running:
            _compare_running.add(key)

            async def run(key=key, items=items):
                try:
                    docs = await _global_products()
                    _home_cache[key] = (time.time(), await asyncio.to_thread(_compare_stores, items, docs))
                    for k in [k for k in _home_cache if isinstance(k, tuple) and k[:2] == ("compare3", c["camp_id"]) and k != key]:
                        _home_cache.pop(k, None)
                except Exception as e:
                    logger.warning("Vergelijken: %r", e)
                finally:
                    _compare_running.discard(key)
            asyncio.create_task(run())
    return compare, not hit


@api_router.get("/camps/{camp_id}/compare")
async def camp_compare(camp_id: str, user: dict = Depends(get_current_user)):
    c = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    compare, pending = await _camp_compare(c, user)
    return {"compare": compare, "compare_pending": pending, "shop_store": c.get("shop_store")}


class ShopStoreInput(BaseModel):
    store: Optional[str] = None  # leeg = terug naar je eigen winkels per product
    split: List[str] = []  # gesplitst: elk product bij de goedkoopste van deze winkels


@api_router.post("/camps/{camp_id}/shop-store")
async def camp_shop_store(camp_id: str, data: ShopStoreInput, user: dict = Depends(get_current_user)):
    # "Alles bij deze winkel": de boodschappenlijst zet alles op die winkel, met de producten uit de vergelijking
    c = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    split = [x for x in dict.fromkeys(data.split) if x in COMPARE_STORES]
    if not data.store and len(split) < 2:
        await db.camps.update_one({"camp_id": camp_id}, {"$unset": {"shop_store": "", "store_products": "", "split_stores": "", "item_stores": ""}})
        return {"shop_store": None}
    if len(split) >= 2:
        compare, pending = await _camp_compare(c, user)
        if not compare:
            raise HTTPException(status_code=409, detail="De vergelijking wordt nog uitgerekend, probeer het zo nog eens")
        per = [x for x in compare if x["store"] in split]
        prods, stores = {}, {}
        for k in range(len(per[0]["items"]) if per else 0):
            opts = [(x["items"][k]["price"], x["store"], x["items"][k]) for x in per if k < len(x["items"]) and x["items"][k].get("price") is not None]
            if not opts:
                continue
            _, st, it = min(opts, key=lambda o: o[0])
            key = _ikey(_norm_text(it["name"]))
            stores[key] = st
            if it.get("product_id"):
                prods[key] = it["product_id"]
        await db.camps.update_one({"camp_id": camp_id}, {"$set": {"shop_store": "split", "split_stores": split, "item_stores": stores,
                                                                   "store_products": prods}})
        return {"shop_store": "split", "split_stores": split}
    if data.store not in COMPARE_STORES:
        raise HTTPException(status_code=400, detail="Onbekende winkel")
    compare, pending = await _camp_compare(c, user)
    if not compare:
        raise HTTPException(status_code=409, detail="De vergelijking wordt nog uitgerekend, probeer het zo nog eens")
    o = next((x for x in compare if x["store"] == data.store), None)
    prods = {_ikey(_norm_text(i["name"])): i["product_id"] for i in (o or {}).get("items") or [] if i.get("product_id")}
    await db.camps.update_one({"camp_id": camp_id}, {"$set": {"shop_store": data.store, "store_products": prods}})
    return {"shop_store": data.store}


@api_router.get("/home")
async def home(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    camps = await db.camps.find(camp_access_filter(user["user_id"]), {"_id": 0}).sort("created_at", -1).to_list(50)
    camp = None
    compare = None
    compare_pending = False
    if camps:
        # Het eerstvolgende lijstje (op datum), anders het laatst aangemaakte
        today = _iso_day(now_utc().isoformat())

        def last_day(x):
            return (datetime.fromisoformat(x["start_date"]) + timedelta(days=max(0, len(x.get("days") or []) - 1))).date().isoformat()
        upcoming = sorted((x for x in camps if x.get("start_date") and last_day(x) >= today), key=lambda x: x["start_date"])
        c = upcoming[0] if upcoming else camps[0]
        dish_ids = {did for day in c.get("days", []) for cat in MEAL_CATEGORIES for did in (day.get("meals") or {}).get(cat, [])}
        dishes = await db.dishes.find({"dish_id": {"$in": list(dish_ids)}}, {"_id": 0, "dish_id": 1, "name": 1, "ingredients": 1}).to_list(500)
        names = {}
        for d in dishes:
            for i in d.get("ingredients") or []:
                if i.get("name"):
                    names.setdefault(_norm_text(i["name"]), (i["name"], i.get("product_id")))
        for day in c.get("days", []):
            for e in day.get("extras") or []:
                if e.get("name"):
                    names.setdefault(_norm_text(e["name"]), (e["name"], e.get("product_id")))
        for e in c.get("general") or []:
            if e.get("name"):
                names.setdefault(_norm_text(e["name"]), (e["name"], e.get("product_id")))
        days = c.get("days", [])
        camp = {"id": c["camp_id"], "name": c["name"], "days": len(days), "start_date": c.get("start_date"),
                "max_people": max((d.get("adults", 0) + d.get("children", 0) for d in days), default=0),
                "shopping_days": sum(1 for d in days if d.get("is_shopping_day")),
                "meals_planned": sum(len((d.get("meals") or {}).get(cat, [])) for d in days for cat in MEAL_CATEGORIES),
                "products": len(names), "other_camps": len(camps) - 1}
        if names:
            compare, pending = await _camp_compare(c, user)
            compare_pending = pending
    hit = _home_cache.get("inspiration")
    promos, recipes = hit[1] if hit else ([], [])
    if not hit or time.time() - hit[0] > 600:
        # Folders en recepten ophalen kan even duren: op de achtergrond, zodat de startpagina meteen verschijnt
        if "inspiration" not in _compare_running:
            _compare_running.add("inspiration")

            async def run_insp():
                try:
                    p, r = await _home_inspiration()
                    if p or r:
                        _home_cache["inspiration"] = (time.time(), (p, r))
                except Exception as e:
                    logger.warning("Inspiratie: %r", e)
                finally:
                    _compare_running.discard("inspiration")
            asyncio.create_task(run_insp())
        compare_pending = compare_pending or not hit
    todo = {}
    if "review_submissions" in perms:
        todo["dishes"] = await db.submissions.count_documents({"status": "pending"})
    if "manage_products" in perms:
        todo["products"] = len(await _pending_product_subs())
    if "manage_settings" in perms:
        todo["stores"] = await db.store_requests.count_documents({"status": "pending"})
    if "manage_users" in perms:
        todo["premium"] = await db.premium_requests.count_documents({"status": "pending"})
    own_dishes = await db.dishes.count_documents({"owner_id": user["user_id"], "deleted_at": None})
    alerts_hit = await db.price_alerts.count_documents({"user_id": user["user_id"], "notified_mark": {"$exists": True}}) if user.get("premium") else 0
    try:
        interest = {} if user.get("no_personal") else await db.user_interest.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
        by_pid = _product_cache.get("by_pid") or {}
        used_ids: set = set()
        async for d in db.dishes.find({"owner_id": user["user_id"], "deleted_at": None}, {"_id": 0, "ingredients.product_id": 1}):
            used_ids |= {i.get("product_id") for i in d.get("ingredients") or [] if i.get("product_id")}
        used_stores: dict = {}
        for pid in used_ids:
            st = (by_pid.get(pid) or {}).get("_src")
            if st:
                used_stores[st] = used_stores.get(st, 0) + 1
        promos = _pick_promos(promos, interest, user.get("store") or DEFAULT_STORE, set(user.get("favorite_products") or []), used_ids, used_stores)
    except Exception as e:
        logger.warning("Persoonlijke acties: %r", e)
        promos = [{k: v for k, v in c.items() if not k.startswith("_")} for c in promos[:24]]
    return {"name": (user.get("name") or "").split(" ")[0], "camp": camp, "compare": compare, "compare_pending": compare_pending, "shop_store": (c or {}).get("shop_store") if camp else None, "promos": promos,
            "recipes": await _with_costs(recipes), "todo": todo, "own_dishes": own_dishes, "alerts_hit": alerts_hit}


# --- Andere producten voor een ingrediënt: logische voorstellen per winkel, goedkoper of in de aanbieding ---
ALT_STORES = ["Albert Heijn", "Jumbo", "Dirk"]


def _doc_price(d: dict) -> float:
    return resolve_price(d.get("prices") or {}, d.get("_src") or DEFAULT_STORE, d.get("unavailable") or [])


def _alt_terms(name: str, base: Optional[dict]) -> str:
    # Merknaam en verpakking eruit: "AH Biologische halfvolle melk 1 l" -> "biologische halfvolle melk"
    n = _norm_text(name)
    if base and base.get("brand"):
        b = _norm_text(base["brand"])
        if b and n.startswith(b + " "):
            n = n[len(b) + 1:]
    n = re.sub(r"\b\d+([.,]\d+)?\s*(x\s*)?\d*\s*(g|gr|gram|kg|ml|cl|l|liter|stuks?|st)\b", " ", n)
    words = [w for w in n.split() if len(w) > 1 and not w.isdigit()]
    return " ".join(words[:4])


def _alternatives(docs: list, name: str, base: Optional[dict], per_store: int = 6) -> dict:
    terms = _alt_terms(name, base)
    pool = [d for d in docs if d.get("is_global") and d.get("_src") in ALT_STORES]
    hits = _search_products(pool, terms) if terms else []
    if len(hits) < 3 and terms:
        hits = hits + [d for d in _best_matches(pool, terms, limit=120) if d not in hits]  # "verse gnocchi" -> "gnocchi"
    sub = (base or {}).get("subcategory")
    base_up = (base or {}).get("_up")
    base_price = _doc_price(base) if base else 0
    out: dict = {}
    for s in ALT_STORES:
        mine = [d for d in hits if d["_src"] == s and (not base or d["product_id"] != base["product_id"])][:40]
        if sub:
            mine.sort(key=lambda d: 0 if d.get("subcategory") == sub else 1)  # zelfde soort eerst
        out[s] = mine[:per_store]
    return {"terms": terms, "by_store": out, "base_up": base_up, "base_price": base_price}


def _alt_note(d: dict, base_up, base_price: float) -> Optional[str]:
    up = d.get("_up")
    if base_up and up and up[1] == base_up[1] and base_up[0] > 0 and up[0] < base_up[0] * 0.95:
        return f"{round((1 - up[0] / base_up[0]) * 100)}% goedkoper per {'kilo' if up[1] == 'kilo' else 'liter'}"
    p = _doc_price(d)
    if not base_up and base_price and p and p < base_price * 0.95:
        return f"{_euro(base_price - p)} goedkoper"
    return None


@api_router.get("/alternatives")
async def product_alternatives(name: str = "", product_id: str = "", user: dict = Depends(get_current_user)):
    docs = await _global_products()
    base = next((d for d in docs if d["product_id"] == product_id), None) if product_id else None
    res = await asyncio.to_thread(_alternatives, docs, name or (base or {}).get("name") or "", base)
    favs = set(user.get("favorite_products") or [])
    groups = []
    for s, items in res["by_store"].items():
        rows = []
        for d in items:
            pub = product_public(_clean(d), s, user["user_id"], favs)
            pub["note"] = _alt_note(d, res["base_up"], res["base_price"])
            pub["offer"] = _has_offer(d)
            rows.append(pub)
        # Goedkoopste per kilo/liter eerst, binnen de goede treffers
        rows.sort(key=lambda r: (0 if r["note"] else 1, (_unit_value(r["price"], r["unit"]) or (r["price"] or 999,))[0]))
        groups.append({"store": s, "same_store": bool(base and base.get("_src") == s), "products": rows})
    groups.sort(key=lambda g: 0 if g["same_store"] else 1)
    return {"terms": res["terms"], "groups": groups,
            "base": product_public(_clean(base), base["_src"], user["user_id"], favs) if base else None}


def _same_kind(base: dict, cand: dict, strict: bool = True) -> bool:
    # Is het andere product echt hetzelfde soort? "Jumbo Kaneel Gemalen" wel voor kaneelpoeder, "Appelmoes Kaneel" niet
    def stem(w):
        for f in _FORMS:
            if w.endswith(f) and len(w) > len(f) + 2:
                return w[:-len(f)]
        return w
    def same(c, b):
        # "melk" = "melk", "halfvol" = "halfvolle", maar "chocolademelk" is iets anders dan "melk"
        c = stem(c)
        if c == b or (c.startswith(b) and len(c) - len(b) <= 3) or (b.startswith(c) and len(b) - len(c) <= 3):
            return True
        return any(c == q + b for q in ("scharrel", "bio", "vrijeuitloop", "uitloop"))  # "scharreleieren" zijn eieren
    bw = [stem(w) for w in re.findall(r"[a-z]{3,}", _alt_terms(base["name"], base))]
    cw = re.findall(r"[a-z]{3,}", _alt_terms(cand["name"], cand))
    if not bw or not cw:
        return False
    if not any(same(c, bw[-1]) for c in cw):
        return False
    if not strict:
        return True  # vergelijken per winkel: "pasta gnocchi" mag voor gnocchi
    for c in cw:
        if c in _FORMS or any(same(c, b) for b in bw):
            continue
        if len(c) >= 6 or any(c.endswith(x) for x in _PROCESSED):
            return False  # een ander product waar het ingrediënt alleen in zit
    return True


class SuggestIn(BaseModel):
    ingredients: List[Dict] = []


@api_router.post("/dishes/suggestions")
async def dish_suggestions(data: SuggestIn, user: dict = Depends(get_current_user)):
    # Per gekoppeld ingrediënt: is hetzelfde soort product bij een andere winkel duidelijk goedkoper?
    docs = await _global_products()
    by_id = {d["product_id"]: d for d in docs}
    favs = set(user.get("favorite_products") or [])

    def work():
        out = []
        for ing in data.ingredients[:60]:
            base = by_id.get(ing.get("product_id") or "")
            if not base:
                out.append(None)
                continue
            res = _alternatives(docs, ing.get("name") or base["name"], base, per_store=3)
            best = None
            for s, items in res["by_store"].items():
                for d in items:
                    if not _same_kind(base, d):
                        continue
                    up, bup = d.get("_up"), res["base_up"]
                    if up and bup and up[1] == bup[1] and up[0] < bup[0] * 0.2:
                        continue  # meer dan 80% goedkoper per kilo is bijna altijd een ander soort product
                    note = _alt_note(d, res["base_up"], res["base_price"])
                    if note and (best is None or (d.get("_up") or (_doc_price(d),))[0] < (best[0].get("_up") or (_doc_price(best[0]),))[0]):
                        best = (d, note)
            out.append(best)
        return out

    found = await asyncio.to_thread(work)
    return {"suggestions": [{**product_public(_clean(b[0]), b[0]["_src"], user["user_id"], favs), "note": b[1]} if b else None for b in found]}


async def _dirk_post(client, query, variables):
    r = await client.post(DIRK_GQL, json={"query": query, "variables": variables})
    if r.status_code >= 500:
        r.raise_for_status()
    return r.json().get("data", {}) or {}


async def _dirk_search_ids(client, term: str, limit: Optional[int] = 15) -> list:
    d = await _dirk_post(client,
        "query($q:NewSearchQueryInput!){newSearchProducts(query:$q){productId ranking}}",
        {"q": {"searchTerm": term}})
    ids = [p["productId"] for p in (d.get("newSearchProducts") or [])]
    return ids[:limit] if limit else ids


DIRK_PRODUCT_FIELDS = "productId normalPrice offerPrice productInformation{headerText subText packaging brand department webgroup%s}"
DIRK_IMAGE_BASE = "https://web-fileserver.dirk.nl/"
_dirk_image_ok = True


async def _dirk_fetch_products(client, ids: list) -> list:
    global _dirk_image_ok
    if not ids:
        return []
    q = "query($ids:[Int!],$sid:Int!){products(productIds:$ids,storeId:$sid){%s}}"
    variables = {"ids": ids, "sid": DIRK_STORE_ID}
    d = None
    if _dirk_image_ok:
        # Met productfoto; kent Dirk het veld niet, dan zonder foto verder
        r = await client.post(DIRK_GQL, json={"query": q % (DIRK_PRODUCT_FIELDS % " image"), "variables": variables})
        if r.status_code >= 500:
            r.raise_for_status()
        body = r.json() or {}
        if body.get("errors") and not (body.get("data") or {}).get("products") and "image" in str(body.get("errors")):
            _dirk_image_ok = False
            logger.warning("Dirk geeft geen productfoto's: %s", str(body.get("errors"))[:300])
        else:
            d = body.get("data") or {}
    if d is None:
        d = await _dirk_post(client, q % (DIRK_PRODUCT_FIELDS % ""), variables)
    order = {pid: i for i, pid in enumerate(ids)}
    prods = [p for p in (d.get("products") or []) if p]
    prods.sort(key=lambda p: order.get(p.get("productId"), 999))
    return prods


_dirk_single_logged = 0


async def _dirk_fetch_single(client, pid) -> Optional[dict]:
    global _dirk_single_logged
    try:
        r = await client.post(DIRK_GQL, json={
            "query": "query($ids:[Int!],$sid:Int!){products(productIds:$ids,storeId:$sid){%s}}" % (DIRK_PRODUCT_FIELDS % (" image" if _dirk_image_ok else "")),
            "variables": {"ids": [pid], "sid": DIRK_STORE_ID},
        })
        body = r.json() or {}
        prods = [p for p in ((body.get("data") or {}).get("products") or []) if p]
        if not prods and _dirk_single_logged < 3:
            _dirk_single_logged += 1
            logger.warning("Dirk product %s niet op te halen (%s): %s", pid, r.status_code, str(body)[:300])
        return prods[0] if prods else None
    except Exception as e:
        if _dirk_single_logged < 3:
            _dirk_single_logged += 1
            logger.warning("Dirk product %s fout: %s", pid, e)
        return None


def _dirk_normalize(p: dict) -> Optional[dict]:
    info = p.get("productInformation") or {}
    name = (info.get("headerText") or "").strip()
    if not name:
        return None
    price = p.get("offerPrice") or 0
    if not price:
        price = p.get("normalPrice") or 0
    img = (info.get("image") or "").strip()
    if img and not img.startswith("http"):
        img = DIRK_IMAGE_BASE + img.lstrip("/")
    return {
        "image": img or None,
        "dirk_id": p.get("productId"),
        "name": name[:80],
        "brand": (info.get("brand") or None),
        "quantity": (info.get("packaging") or None),
        "price": round(float(price), 2) if price else 0,
        "on_offer": bool(p.get("offerPrice")),
        "aisle": _dirk_aisle(info.get("department") or "", info.get("webgroup") or ""),
        "subcategory": (info.get("webgroup") or None),
    }


@api_router.get("/dirk/search")
async def dirk_search(q: str, user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"results": []}
    try:
        async with httpx.AsyncClient(timeout=15, headers=DIRK_HEADERS) as c:
            ids = await _dirk_search_ids(c, q.strip())
            prods = await _dirk_fetch_products(c, ids)
    except Exception as e:
        logger.warning("Dirk search failed: %s", e)
        raise HTTPException(status_code=502, detail="Dirk-zoeken lukt nu niet, probeer het later opnieuw")
    out = [n for n in (_dirk_normalize(p) for p in prods) if n]
    return {"results": out, "store": "Dirk"}


# --- Albert Heijn (public mobile API) ---
AH_HEADERS = {"User-Agent": "Appie/8.22.3", "Content-Type": "application/json"}


async def _ah_token(client) -> str:
    r = await client.post("https://api.ah.nl/mobile-auth/v1/auth/token/anonymous", json={"clientId": "appie"})
    return r.json()["access_token"]


def _ah_normalize(p: dict) -> Optional[dict]:
    name = (p.get("title") or "").strip()
    if not name:
        return None
    price = p.get("currentPrice") or p.get("priceBeforeBonus") or 0
    before = p.get("priceBeforeBonus") or 0
    imgs = [i for i in (p.get("images") or []) if isinstance(i, dict) and i.get("url")]
    # Kies een foto rond de 200px, anders de eerste
    imgs.sort(key=lambda i: abs((i.get("width") or 200) - 200))
    return {
        "image": imgs[0]["url"] if imgs else None,
        "ah_id": p.get("webshopId"),
        "name": name[:80],
        "brand": (p.get("brand") or None),
        "quantity": (p.get("salesUnitSize") or None),
        "price": round(float(price), 2) if price else 0,
        "on_offer": bool(before and price and price < before),
        "aisle": _dirk_aisle(p.get("mainCategory") or "", p.get("subCategory") or ""),
        "subcategory": (p.get("subCategory") or None),
    }


async def _ah_search(term: str) -> list:
    async with httpx.AsyncClient(timeout=15, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        r = await c.get("https://api.ah.nl/mobile-services/product/search/v2",
                        params={"query": term, "size": 15},
                        headers={"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"})
        prods = r.json().get("products", []) or []
    return [n for n in (_ah_normalize(p) for p in prods) if n]


# --- Jumbo (GraphQL van jumbo.com; de oude mobiele API bestaat niet meer) ---
JUMBO_GQL = "https://www.jumbo.com/api/graphql"
JUMBO_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36",
    "apollographql-client-name": "JUMBO_WEB-search",
    "apollographql-client-version": "master-v1",
    "x-source": "JUMBO_WEB-search",
    "Origin": "https://www.jumbo.com",
}
JUMBO_SEARCH_QUERY = """query SearchProducts($input: ProductSearchInput!) { searchProducts(input: $input) {
  count products { id ean title brand category image packSizeDisplay prices: price { price promoPrice }
  promotions { id title tags { text } start { iso } end { iso } isKiesAndMix image } } } }"""


def _jumbo_normalize(p: dict) -> Optional[dict]:
    name = (p.get("title") or "").strip()
    if not name or not p.get("id"):
        return None
    prices = p.get("prices") or {}
    normal = prices.get("price")
    promo = prices.get("promoPrice")
    cents = promo or normal or 0
    return {
        "image": p.get("image") or None,
        "jumbo_id": str(p.get("id")),
        "barcode": (p.get("ean") or None),
        "name": name[:80],
        "brand": p.get("brand") or None,
        "quantity": p.get("packSizeDisplay") or None,
        "price": round(float(cents) / 100, 2) if cents else 0,
        "on_offer": bool(promo and normal and promo < normal) or bool(_jumbo_promo(p)),
        "aisle": _dirk_aisle(p.get("category") or "", "", name),
        "subcategory": (p.get("category") or None),
        "promo": _jumbo_promo(p),
        "promos": _jumbo_promos(p),
    }


def _jumbo_promos(p: dict) -> list:
    # Alle acties van een product: die van nu en, zodra Jumbo ze toont, die van volgende week
    out = []
    for pr in p.get("promotions") or []:
        if not isinstance(pr, dict) or not pr.get("id"):
            continue
        tags = [t.get("text") for t in pr.get("tags") or [] if isinstance(t, dict) and t.get("text")]
        out.append({"id": str(pr["id"]), "title": pr.get("title"), "label": tags[0] if tags else "Actie",
                    "start": _iso_day((pr.get("start") or {}).get("iso")), "end": _iso_day((pr.get("end") or {}).get("iso")),
                    "combinable": bool(pr.get("isKiesAndMix")), "image": pr.get("image")})
    out.sort(key=lambda x: x["start"] or "")
    return out


def _jumbo_promo(p: dict) -> Optional[dict]:
    promos = _jumbo_promos(p)
    return promos[0] if promos else None


async def _jumbo_search_page(client, term: str, offset: int = 0) -> tuple:
    variables = {"input": {"searchType": "keyword", "searchTerms": term, "friendlyUrl": "", "offSet": offset,
                           "currentUrl": f"/producten/?searchType=keyword&searchTerms={term}", "previousUrl": "", "bloomreachCookieId": ""}}
    r = await client.post(JUMBO_GQL, json={"operationName": "SearchProducts", "query": JUMBO_SEARCH_QUERY, "variables": variables})
    if r.status_code >= 400:
        raise httpx.HTTPStatusError(f"Jumbo {r.status_code}: {r.text[:200]}", request=r.request, response=r)
    body = r.json() or {}
    data = (body.get("data") or {}).get("searchProducts") or {}
    if not data and body.get("errors"):
        raise RuntimeError(f"Jumbo: {str(body.get('errors'))[:200]}")
    return data.get("products") or [], int(data.get("count") or 0)


async def _jumbo_sweep(client, term: str, max_items: int = 600):
    offset = 0
    first = None
    while offset < max_items:
        prods, total = await _jumbo_search_page(client, term, offset)
        if not prods or prods[0].get("id") == first:
            break  # leeg, of Jumbo geeft dezelfde pagina terug
        first = prods[0].get("id")
        yield prods
        offset += len(prods)
        if offset >= total:
            break


async def _jumbo_search(term: str) -> list:
    async with httpx.AsyncClient(timeout=15, headers=JUMBO_HEADERS) as c:
        prods, _ = await _jumbo_search_page(c, term, 0)
    return [n for n in (_jumbo_normalize(p) for p in prods[:15]) if n]


@api_router.get("/stores/search")
async def store_search(q: str, store: str = "Dirk", user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"results": [], "store": store}
    try:
        if store == "Albert Heijn":
            out = await _ah_search(q.strip())
            for r in out:
                r["source_id"] = str(r.pop("ah_id"))
        elif store == "Jumbo":
            out = await _jumbo_search(q.strip())
            for r in out:
                r["source_id"] = str(r.pop("jumbo_id"))
        else:
            async with httpx.AsyncClient(timeout=15, headers=DIRK_HEADERS) as c:
                ids = await _dirk_search_ids(c, q.strip())
                prods = await _dirk_fetch_products(c, ids)
            out = [n for n in (_dirk_normalize(p) for p in prods) if n]
            for r in out:
                r["source_id"] = str(r.pop("dirk_id"))
            store = "Dirk"
    except Exception as e:
        logger.warning("Store search failed (%s): %s", store, e)
        raise HTTPException(status_code=502, detail=f"{store}-zoeken lukt nu niet, probeer het later opnieuw")
    return {"results": out, "store": store}


# --- Admin: import supermarket products into the catalog + daily refresh ---
COUPLED_STORES = ["Dirk", "Albert Heijn", "Jumbo"]


class StoreImportItem(BaseModel):
    image: Optional[str] = None
    source_id: str
    name: str
    brand: Optional[str] = None
    quantity: Optional[str] = None
    price: float = 0
    aisle: str = "Overig"


class StoreImportInput(BaseModel):
    store: str = "Dirk"
    items: List[StoreImportItem] = []


def _id_field(store: str) -> str:
    return {"Albert Heijn": "ah_id", "Jumbo": "jumbo_id"}.get(store, "dirk_id")


async def _store_mults() -> dict:
    active = await db.stores.find({"active": True}, {"_id": 0}).to_list(200)
    return {s["name"]: s.get("mult", 1.0) for s in active}


@api_router.post("/admin/products/import-dirk")
async def import_store_products(data: StoreImportInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    store = data.store if data.store in COUPLED_STORES else "Dirk"
    idf = _id_field(store)
    mults = await _store_mults()
    added, skipped = 0, 0
    for it in data.items:
        sid = it.source_id
        if await db.products.find_one({idf: sid, "deleted_at": None}):
            skipped += 1
            continue
        prices = _prices_from(it.price, store, mults)
        unit = (it.quantity or "stuks").strip()[:24] or "stuks"
        await db.products.insert_one({
            "product_id": f"prod_{uuid.uuid4().hex[:12]}",
            idf: sid,
            "name": it.name.strip()[:80],
            "aisle": it.aisle if it.aisle in AISLES else "Overig",
            "unit": unit,
            "brand": (it.brand or "").strip() or None,
            "barcode": None,
            "prices": prices,
            "image": it.image if (it.image or "").startswith("https://") else None,
            "unavailable": [],
            "is_global": True,
            "owner_id": None,
            "deleted_at": None,
            "created_at": now_utc(),
        })
        added += 1
    return {"added": added, "skipped": skipped, "store": store}


# --- Admin: hele Dirk-assortiment importeren (achtergrondtaak) ---
# Dirk heeft geen openbare "alle producten"-lijst, dus we zoeken op veel algemene termen
# Later toegevoegd: kruiden en bakproducten vielen bij AH buiten de algemene zoektermen (geen kaneel of kerrie)
EXTRA_TERMS = ["kaneel", "kerrie", "paprikapoeder", "komijn", "oregano", "basilicum", "tijm", "rozemarijn", "nootmuskaat", "gember",
               "kurkuma", "chilipoeder", "knoflookpoeder", "uienpoeder", "laurier", "peterselie", "dille", "specerijen", "vanille",
               "bakpoeder", "gist", "maizena", "paneermeel", "kokosmelk", "sojasaus", "ketjap", "rijstazijn", "sesam", "garam masala"]
DIRK_ALL_TERMS = [
    "aardappel", "groente", "fruit", "appel", "banaan", "peer", "sinaasappel", "druiven", "aardbei", "citroen",
    "tomaat", "komkommer", "paprika", "ui", "knoflook", "wortel", "sla", "spinazie", "broccoli", "bloemkool",
    "champignon", "courgette", "prei", "kool", "boon", "mais", "erwt", "avocado", "kruiden", "salade",
    "vlees", "gehakt", "kip", "kipfilet", "varken", "rund", "biefstuk", "worst", "rookworst", "spek", "ham",
    "hamburger", "schnitzel", "shoarma", "vis", "zalm", "tonijn", "garnaal", "kibbeling", "vega", "vegetarisch",
    "brood", "broodje", "beschuit", "cracker", "croissant", "pistolet", "wrap", "tortilla", "koek", "ontbijtkoek",
    "beleg", "hagelslag", "pindakaas", "jam", "chocopasta", "honing", "smeerkaas", "salami", "filet",
    "melk", "karnemelk", "yoghurt", "kwark", "vla", "toetje", "pudding", "room", "boter", "margarine", "ei",
    "kaas", "geraspte kaas", "mozzarella", "feta", "roomkaas",
    "water", "frisdrank", "cola", "sinas", "limonade", "siroop", "sap", "jus", "ijsthee", "energy",
    "koffie", "thee", "cacao", "bier", "wijn", "radler",
    "pasta", "spaghetti", "macaroni", "rijst", "noedels", "mie", "couscous", "meel", "bloem", "suiker",
    "zout", "peper", "olie", "azijn", "saus", "pastasaus", "ketchup", "mayonaise", "mosterd", "sambal",
    "soep", "bouillon", "conserven", "blik", "tomatenpuree", "pesto", "kruidenmix", "nasi", "bami",
    "ontbijtgranen", "muesli", "cornflakes", "havermout", "pannenkoek", "poffertjes",
    "maaltijd", "pizza", "lasagne", "stamppot", "ovenschotel", "tapas", "dip", "hummus",
    "diepvries", "friet", "patat", "kroket", "frikandel", "snack", "ijs", "groenten diepvries",
    "chips", "nootjes", "pinda", "snoep", "drop", "chocolade", "reep", "biscuit", "koekjes", "wafel", "popcorn",
    "toiletpapier", "keukenpapier", "afwasmiddel", "wasmiddel", "schoonmaak", "vuilniszak", "folie", "batterij",
    "shampoo", "douchegel", "tandpasta", "deodorant", "zeep", "luier", "babyvoeding", "maandverband",
    "hond", "kat", "kattenvoer", "hondenvoer", "kaars", "servet", "bord", "beker", "aansteker",
] + EXTRA_TERMS

_dirk_import_running = False


def _prices_from(price: float, store: str, mults: dict) -> dict:
    # Alleen de echte prijs van de eigen supermarkt, geen geschatte prijzen
    return {store: round(price, 2)} if price else {}


async def _set_import_status(**fields) -> None:
    await db.settings.update_one({"key": "dirk_import"}, {"$set": fields}, upsert=True)


def _new_store_product(idf: str, nrm: dict, store: str, mults: dict) -> dict:
    return {
        "product_id": f"prod_{uuid.uuid4().hex[:12]}",
        idf: str(nrm["source_id"]),
        "name": nrm["name"],
        "aisle": nrm["aisle"],
        "unit": (nrm.get("quantity") or "stuks").strip()[:24] or "stuks",
        "brand": nrm.get("brand"),
        "barcode": nrm.get("barcode"),
        "subcategory": nrm.get("subcategory"),
        "on_offer": bool(nrm.get("on_offer")),
        "promo": nrm.get("promo"),
        "promos": nrm.get("promos") or [],
        "prices": _prices_from(nrm["price"], store, mults),
        "image": nrm.get("image"),
        "unavailable": [],
        "is_global": True,
        "owner_id": None,
        "deleted_at": None,
        "created_at": now_utc(),
    }


async def _import_all_ah(mults: dict, terms: Optional[list] = None) -> int:
    terms = terms or DIRK_ALL_TERMS
    existing = {str(p["ah_id"]) async for p in db.products.find({"ah_id": {"$exists": True}, "deleted_at": None}, {"_id": 0, "ah_id": 1})}
    added = 0
    async with httpx.AsyncClient(timeout=30, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
        for n, term in enumerate(terms, 1):
            docs = []
            for page in range(3):
                try:
                    r = await c.get("https://api.ah.nl/mobile-services/product/search/v2",
                                    params={"query": term, "size": 100, "page": page}, headers=H)
                    prods = r.json().get("products", []) or []
                except Exception as e:
                    logger.warning("AH zoekterm %s mislukt: %s", term, e)
                    break
                for p in prods:
                    nrm = _ah_normalize(p)
                    if not nrm or not nrm.get("ah_id") or str(nrm["ah_id"]) in existing:
                        continue
                    existing.add(str(nrm["ah_id"]))
                    nrm["source_id"] = nrm["ah_id"]
                    docs.append(_new_store_product("ah_id", nrm, "Albert Heijn", mults))
                if len(prods) < 100:
                    break
            if docs:
                await db.products.insert_many(docs)
                added += len(docs)
                _invalidate_products()
            if n % 5 == 0:
                await _set_import_status(status=f"Albert Heijn ({n}/{len(terms)})", added_ah=added)
    return added


async def _import_all_jumbo(mults: dict) -> int:
    existing = {str(p["jumbo_id"]) async for p in db.products.find({"jumbo_id": {"$exists": True}, "deleted_at": None}, {"_id": 0, "jumbo_id": 1})}
    added = 0
    async with httpx.AsyncClient(timeout=30, headers=JUMBO_HEADERS) as c:
        for n, term in enumerate(DIRK_ALL_TERMS, 1):
            docs = []
            try:
                async for prods in _jumbo_sweep(c, term):
                    for p in prods:
                        nrm = _jumbo_normalize(p)
                        if not nrm or nrm["jumbo_id"] in existing:
                            continue
                        existing.add(nrm["jumbo_id"])
                        nrm["source_id"] = nrm["jumbo_id"]
                        docs.append(_new_store_product("jumbo_id", nrm, "Jumbo", mults))
            except Exception as e:
                logger.warning("Jumbo zoekterm %s mislukt: %s", term, e)
                if n == 1 and not docs:
                    raise
            if docs:
                await db.products.insert_many(docs)
                added += len(docs)
                _invalidate_products()
            if n % 5 == 0:
                await _set_import_status(status=f"Jumbo ({n}/{len(DIRK_ALL_TERMS)})", added_jumbo=added)
    logger.info("Jumbo-import klaar: %d toegevoegd", added)
    return added


async def _dirk_category_ids() -> list:
    # Alle productnummers van de categoriepagina's van dirk.nl; vangt wat zoektermen missen
    found: list = []
    seen: set = set()

    def collect(x, depth=0):
        if depth > 40:
            return
        if isinstance(x, dict):
            if isinstance(x.get("productId"), int) and x["productId"] not in seen:
                seen.add(x["productId"])
                found.append(x["productId"])
            for v in x.values():
                collect(v, depth + 1)
        elif isinstance(x, list):
            for v in x:
                collect(v, depth + 1)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as c:
        r = await c.get("https://www.dirk.nl/boodschappen", headers=_PAGE_HEADERS)
        depts = sorted(set(re.findall(r'href="(/boodschappen/[a-z0-9\-]+)"', r.text)))
        subs: set = set()
        for d in depts:
            try:
                r = await c.get("https://www.dirk.nl" + d, headers=_PAGE_HEADERS)
            except Exception:
                continue
            subs.update(re.findall(r'href="(%s/[a-z0-9\-]+)"' % re.escape(d), r.text))
            collect(_nuxt_data(r.text))
        for sub in sorted(subs):
            try:
                r = await c.get("https://www.dirk.nl" + sub, headers=_PAGE_HEADERS)
                collect(_nuxt_data(r.text))
            except Exception:
                continue
            await asyncio.sleep(0.2)
    logger.info("Dirk-categorieën: %d afdelingen, %d subcategorieën, %d producten", len(depts), len(subs), len(found))
    return found


async def _import_all_dirk(with_others: bool = True) -> None:
    global _dirk_import_running
    _dirk_import_running = True
    try:
        await _set_import_status(status="zoeken", found=0, added=0, added_ah=0, started_at=now_utc(), finished_at=None, error=None, added_jumbo=0)
        mults = await _store_mults()
        ids: list = []
        seen: set = set()
        async with httpx.AsyncClient(timeout=30, headers=DIRK_HEADERS) as c:
            for n, term in enumerate(DIRK_ALL_TERMS, 1):
                try:
                    for pid in await _dirk_search_ids(c, term, limit=None):
                        if pid not in seen:
                            seen.add(pid)
                            ids.append(pid)
                except Exception as e:
                    logger.warning("Dirk zoekterm %s mislukt: %s", term, e)
                if n % 10 == 0:
                    await _set_import_status(found=len(ids))
            try:
                for pid in await _dirk_category_ids():
                    if pid not in seen:
                        seen.add(pid)
                        ids.append(pid)
            except Exception as e:
                logger.warning("Dirk-categorieën doorlopen mislukt: %s", e)
            await _set_import_status(found=len(ids))
            existing = {str(p["dirk_id"]) async for p in db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None}, {"_id": 0, "dirk_id": 1})}
            todo = [pid for pid in ids if str(pid) not in existing]
            await _set_import_status(status="Dirk importeren", found=len(ids), todo=len(todo))
            added = 0
            skipped = 0
            for i in range(0, len(todo), 25):
                prods = None
                for attempt in range(3):
                    try:
                        prods = await _dirk_fetch_products(c, todo[i:i + 25])
                        break
                    except Exception as e:
                        logger.warning("Dirk ophalen mislukt (poging %d): %s", attempt + 1, e)
                        await asyncio.sleep(2 * (attempt + 1))
                batch = todo[i:i + 25]
                prods = prods or []
                got = {p.get("productId") for p in prods}
                missing = [pid for pid in batch if pid not in got]
                if missing:
                    # Eén fout product kan een hele groep laten mislukken; probeer de rest los
                    singles = await asyncio.gather(*[_dirk_fetch_single(c, pid) for pid in missing])
                    prods += [p for p in singles if p]
                    skipped += len([p for p in singles if not p])
                docs = []
                for p in prods:
                    nrm = _dirk_normalize(p)
                    if not nrm:
                        continue
                    nrm["source_id"] = nrm["dirk_id"]
                    docs.append(_new_store_product("dirk_id", nrm, "Dirk", mults))
                if docs:
                    await db.products.insert_many(docs)
                    added += len(docs)
                    _invalidate_products()
                await _set_import_status(added=added)
        logger.info("Dirk-import klaar: %d gevonden, %d toegevoegd, %d niet leverbaar", len(ids), added, skipped)
        await _set_import_status(skipped=skipped)
        added_ah = added_jumbo = 0
        if with_others:
            try:
                added_ah = await _import_all_ah(mults)
            except Exception as e:
                logger.warning("AH-import mislukt: %s", e)
            try:
                added_jumbo = await _import_all_jumbo(mults)
            except Exception as e:
                logger.warning("Jumbo-import mislukt: %s", e)
        await _set_import_status(status="klaar", added=added, added_ah=added_ah, added_jumbo=added_jumbo, finished_at=now_utc())
    except Exception as e:
        logger.error("Dirk-import mislukt: %s", e)
        await _set_import_status(status="mislukt", error=str(e)[:200], finished_at=now_utc())
    finally:
        _dirk_import_running = False


@api_router.post("/admin/products/import-dirk-all")
async def start_import_all_dirk(only: str = "", user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    if not _dirk_import_running:
        if only in ("ah", "jumbo"):
            asyncio.create_task(_import_only(only))
        else:
            asyncio.create_task(_import_all_dirk(with_others=only != "dirk"))
    return {"ok": True}


async def _import_only(which: str) -> None:
    global _dirk_import_running
    _dirk_import_running = True
    name = "Jumbo" if which == "jumbo" else "Albert Heijn"
    try:
        await _set_import_status(status=name, found=0, added=0, added_ah=0, added_jumbo=0, skipped=0, started_at=now_utc(), finished_at=None, error=None)
        mults = await _store_mults()
        if which == "jumbo":
            await _set_import_status(status="klaar", added_jumbo=await _import_all_jumbo(mults), finished_at=now_utc())
        else:
            await _set_import_status(status="klaar", added_ah=await _import_all_ah(mults), finished_at=now_utc())
    except Exception as e:
        logger.warning("%s-import mislukt: %s", name, e)
        await _set_import_status(status="mislukt", error=f"{name} is nu niet bereikbaar: {str(e)[:150]}", finished_at=now_utc())
    finally:
        _dirk_import_running = False


@api_router.get("/admin/products/import-dirk-all")
async def import_all_dirk_status(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    doc = await db.settings.find_one({"key": "dirk_import"}, {"_id": 0, "key": 0}) or {}
    for k in ("started_at", "finished_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = ensure_aware(doc[k]).isoformat()
    if doc.get("status") not in (None, "klaar", "mislukt") and not _dirk_import_running:
        doc["status"] = "onderbroken"
    return {**doc, "running": _dirk_import_running}


# --- Barcodes (EAN) ---
# Jumbo geeft de EAN direct mee. Dirk en AH niet, maar daar kun je wel op EAN zoeken:
# zo koppelen we de Jumbo-barcodes ook aan dezelfde producten bij Dirk en AH.
_barcode_running = False


def _find_key(obj, key: str) -> list:
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key and v is not None:
                out.append(v)
            else:
                out += _find_key(v, key)
    elif isinstance(obj, list):
        for v in obj:
            out += _find_key(v, key)
    return out


async def _dirk_ids_for_ean(client, ean: str) -> list:
    try:
        return [str(i) for i in await _dirk_search_ids(client, ean, limit=3)]
    except Exception:
        return []


_ah_ean_stats: dict = {}


async def _ah_ids_for_ean(client, headers: dict, ean: str) -> list:
    # Bij een lange ronde verloopt de AH-sleutel of remt AH af: dan een nieuwe sleutel halen of even wachten
    for attempt in range(3):
        try:
            r = await client.get(f"https://api.ah.nl/mobile-services/product/search/v1/gtin/{ean}", headers=headers)
        except Exception:
            await asyncio.sleep(2)
            continue
        _ah_ean_stats[r.status_code] = _ah_ean_stats.get(r.status_code, 0) + 1
        if r.status_code == 401:
            try:
                headers["Authorization"] = f"Bearer {await _ah_token(client)}"
            except Exception:
                pass
            continue
        if r.status_code == 429 or r.status_code >= 500:
            await asyncio.sleep(3 * (attempt + 1))
            continue
        if r.status_code != 200 or not r.text.strip():
            return []
        try:
            return [str(i) for i in _find_key(r.json(), "webshopId")][:3]
        except Exception:
            return []
    return []


async def _set_barcode_status(**fields) -> None:
    await db.settings.update_one({"key": "barcode_import"}, {"$set": fields}, upsert=True)


async def _import_barcodes(which: str = "all") -> None:
    global _barcode_running
    _barcode_running = True
    try:
        await _set_barcode_status(status="Jumbo-barcodes ophalen", started_at=now_utc(), finished_at=None, dirk=0, ah=0, done=0, total=0, error=None)
        # 1. Jumbo: zoektermen doorlopen vult de barcode bij elk Jumbo-product
        if which in ("all", "jumbo"):
            await _refresh_jumbo_prices(await _store_mults())
        if which == "jumbo":
            total = await db.products.count_documents({"barcode": {"$nin": [None, ""]}, "deleted_at": None})
            await _set_barcode_status(status="klaar", with_barcode=total, finished_at=now_utc())
            _invalidate_products()
            return
        # 2. Dirk/AH: met de Jumbo-barcodes hetzelfde product opzoeken
        eans = sorted({p["barcode"] async for p in db.products.find({"jumbo_id": {"$exists": True}, "barcode": {"$nin": [None, ""]}, "deleted_at": None}, {"_id": 0, "barcode": 1})})
        dirk_ids = {str(p["dirk_id"]) for p in await db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None, "barcode": {"$in": [None, ""]}}, {"_id": 0, "dirk_id": 1}).to_list(50000)}
        ah_ids = {str(p["ah_id"]) for p in await db.products.find({"ah_id": {"$exists": True}, "deleted_at": None, "barcode": {"$in": [None, ""]}}, {"_id": 0, "ah_id": 1}).to_list(50000)}
        await _set_barcode_status(status="Dirk en AH koppelen", total=len(eans))
        found_dirk = found_ah = 0
        _ah_ean_stats.clear()
        sem = asyncio.Semaphore(5)
        async with httpx.AsyncClient(timeout=20, headers=DIRK_HEADERS) as dc, httpx.AsyncClient(timeout=20, headers=AH_HEADERS) as ac:
            tok = await _ah_token(ac)
            H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}

            async def one(ean: str):
                nonlocal found_dirk, found_ah
                async with sem:
                    d = await _dirk_ids_for_ean(dc, ean) if which in ("all", "dirk") else []
                    a = await _ah_ids_for_ean(ac, H, ean) if which in ("all", "ah") else []
                if len(d) == 1 and d[0] in dirk_ids:
                    await db.products.update_many({"dirk_id": d[0], "barcode": {"$in": [None, ""]}}, {"$set": {"barcode": ean}})
                    dirk_ids.discard(d[0])
                    found_dirk += 1
                for aid in a:
                    if aid in ah_ids:
                        await db.products.update_many({"ah_id": aid, "barcode": {"$in": [None, ""]}}, {"$set": {"barcode": ean}})
                        ah_ids.discard(aid)
                        found_ah += 1

            for i in range(0, len(eans), 100):
                await asyncio.gather(*[one(e) for e in eans[i:i + 100]])
                await _set_barcode_status(done=min(i + 100, len(eans)), dirk=found_dirk, ah=found_ah)
        _invalidate_products()
        total = await db.products.count_documents({"barcode": {"$nin": [None, ""]}, "deleted_at": None})
        logger.info("Barcodes klaar: %d Dirk, %d AH gekoppeld, %d producten met barcode (AH-antwoorden %s)", found_dirk, found_ah, total, _ah_ean_stats)
        await _set_barcode_status(status="klaar", with_barcode=total, finished_at=now_utc())
    except Exception as e:
        logger.warning("Barcodes ophalen mislukt: %s", e)
        await _set_barcode_status(status="mislukt", error=str(e)[:200], finished_at=now_utc())
    finally:
        _barcode_running = False


@api_router.post("/admin/products/barcodes")
async def start_barcode_import(only: str = "all", user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    if not _barcode_running:
        asyncio.create_task(_import_barcodes(only if only in ("dirk", "ah", "jumbo") else "all"))
    return {"ok": True}


@api_router.get("/admin/products/barcodes")
async def barcode_status(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    doc = await db.settings.find_one({"key": "barcode_import"}, {"_id": 0, "key": 0}) or {}
    for k in ("started_at", "finished_at"):
        if isinstance(doc.get(k), datetime):
            doc[k] = ensure_aware(doc[k]).isoformat()
    if doc.get("status") not in (None, "klaar", "mislukt") and not _barcode_running:
        doc["status"] = "onderbroken"
    doc["with_barcode"] = await db.products.count_documents({"barcode": {"$nin": [None, ""]}, "deleted_at": None})
    return {**doc, "running": _barcode_running}


@api_router.get("/admin/products/barcodes.csv")
async def barcode_csv(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    rows = ["barcode;winkel;product;merk;inhoud;afdeling"]
    async for d in db.products.find({"barcode": {"$nin": [None, ""]}, "deleted_at": None}, {"_id": 0}).sort("barcode", 1):
        cells = [d.get("barcode") or "", product_source(d) or "", d.get("name") or "", d.get("brand") or "", d.get("unit") or "", d.get("aisle") or ""]
        rows.append(";".join(str(c).replace(";", ",").replace("\n", " ") for c in cells))
    return Response("\n".join(rows), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="barcodes.csv"'})


@api_router.get("/products/by-barcode/{ean}")
async def product_by_barcode(ean: str, user: dict = Depends(get_current_user)):
    # Voor het scannen in de winkel: welk(e) product(en) hoort bij deze barcode?
    ean = re.sub(r"\D", "", ean)
    if not ean:
        raise HTTPException(status_code=400, detail="Ongeldige barcode")
    docs = await db.products.find({"barcode": ean, "deleted_at": None}, {"_id": 0}).to_list(10)
    if not docs:
        # Nog niet bekend: live opzoeken bij Dirk en AH en de barcode onthouden
        async with httpx.AsyncClient(timeout=15, headers=DIRK_HEADERS) as dc, httpx.AsyncClient(timeout=15, headers=AH_HEADERS) as ac:
            d = await _dirk_ids_for_ean(dc, ean)
            tok = await _ah_token(ac)
            a = await _ah_ids_for_ean(ac, {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}, ean)
        q = []
        if len(d) == 1:
            q.append({"dirk_id": d[0]})
        if a:
            q.append({"ah_id": {"$in": a}})
        if q:
            docs = await db.products.find({"$or": q, "deleted_at": None}, {"_id": 0}).to_list(10)
            if docs:
                await db.products.update_many({"product_id": {"$in": [x["product_id"] for x in docs]}, "barcode": {"$in": [None, ""]}}, {"$set": {"barcode": ean}})
    favs = set(user.get("favorite_products") or [])
    store = user.get("store", DEFAULT_STORE)
    return {"barcode": ean, "products": [product_public(x, store, user["user_id"], favs) for x in docs]}


def _apply_refresh(p: dict, store: str, n: dict, mults: dict) -> dict:
    aisle = n.get("aisle")
    out = {"prices": {store: n["price"]}, "aisle": aisle if aisle in AISLES else p.get("aisle", "Overig"), "on_offer": bool(n.get("on_offer"))}
    for k in ("image", "barcode", "subcategory"):
        if n.get(k):
            out[k] = n[k]
    if "promo" in n:
        out["promo"] = n["promo"]
    if "promos" in n:
        out["promos"] = n["promos"]
    return out


ASSORTMENT_GRACE_DAYS = 2


async def _mark_assortment(seen: list, missing: list) -> None:
    # Producten die de winkel niet meer kent krijgen een datum; na een paar dagen verdwijnen ze uit de app.
    # Komt een product terug, dan staat het er gewoon weer.
    if seen:
        for i in range(0, len(seen), 500):
            await db.products.update_many({"product_id": {"$in": seen[i:i + 500]}, "missing_since": {"$ne": None}}, {"$unset": {"missing_since": ""}})
    if missing:
        for i in range(0, len(missing), 500):
            await db.products.update_many({"product_id": {"$in": missing[i:i + 500]}, "missing_since": None}, {"$set": {"missing_since": now_utc()}})
        logger.info("Niet meer in assortiment (voorlopig): %d producten", len(missing))


async def _refresh_dirk_prices(mults: dict) -> int:
    prods = await db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0, "product_id": 1, "dirk_id": 1, "ah_id": 1, "jumbo_id": 1, "aisle": 1}).to_list(None)
    if not prods:
        return 0
    # dirk_id staat als tekst opgeslagen; Dirk wil getallen
    ids = [int(p["dirk_id"]) for p in prods if str(p["dirk_id"]).isdigit()]
    fetched = {}
    gone: set = set()
    async with httpx.AsyncClient(timeout=30, headers=DIRK_HEADERS) as c:
        for i in range(0, len(ids), 25):
            try:
                batch = await _dirk_fetch_products(c, ids[i:i + 25])
            except Exception as e:
                logger.warning("Dirk-prijzen ophalen mislukt: %s", e)
                continue
            for p in batch:
                n = _dirk_normalize(p)
                if n:
                    fetched[str(n["dirk_id"])] = n
            if batch:
                # Ontbreekt er een product, dan los nakijken voordat we het als verdwenen zien
                for pid in ids[i:i + 25]:
                    if str(pid) not in fetched:
                        one = await _dirk_fetch_single(c, pid)
                        n = _dirk_normalize(one) if one else None
                        if n:
                            fetched[str(pid)] = n
                        else:
                            gone.add(str(pid))
    updated = 0
    seen = []
    for p in prods:
        n = fetched.get(str(p["dirk_id"]))
        if not n or not n["price"]:
            continue
        await db.products.update_one({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Dirk", n, mults)})
        seen.append(p["product_id"])
        updated += 1
    await _mark_assortment(seen, [p["product_id"] for p in prods if str(p["dirk_id"]) in gone])
    return updated


async def _refresh_ah_prices(mults: dict) -> int:
    # Per categorie 1000 producten tegelijk (zo'n 40 verzoeken voor de hele winkel, i.p.v. één per product).
    # Nieuwe producten komen er meteen bij; na een herstart gaan we verder bij de categorie waar we waren.
    from pymongo import UpdateOne
    prods = {str(p["ah_id"]): p async for p in db.products.find({"ah_id": {"$exists": True}, "deleted_at": None, "is_global": True},
                                                               {"_id": 0, "product_id": 1, "ah_id": 1, "aisle": 1})}
    known = {str(p["ah_id"]) async for p in db.products.find({"ah_id": {"$exists": True}}, {"_id": 0, "ah_id": 1})}
    state = await db.meta.find_one({"key": "price_refresh"}) or {}
    start_cat = int(state.get("ah_cat") or 0)
    seen, gone, updated, added = set(), [], 0, 0
    async with httpx.AsyncClient(timeout=60, headers=AH_HEADERS) as c:
        H = {"Authorization": f"Bearer {await _ah_token(c)}", "X-Application": "AHWEBSHOP"}
        cats = (await c.get("https://api.ah.nl/mobile-services/v1/product-shelves/categories", headers=H)).json() or []
        for ci, cat in enumerate(cats):
            if ci < start_cat:
                continue
            page, pages = 0, 1
            while page < pages and page < 20:
                try:
                    r = await c.get("https://api.ah.nl/mobile-services/product/search/v2",
                                    params={"taxonomyId": cat["id"], "size": 1000, "page": page}, headers=H)
                    if r.status_code == 401:
                        H["Authorization"] = f"Bearer {await _ah_token(c)}"
                        continue
                    j = r.json() or {}
                except Exception as e:
                    logger.warning("AH-prijzen %s mislukt: %r", cat.get("name"), e)
                    break
                pages = int((j.get("page") or {}).get("totalPages") or 0)
                ops, new = [], []
                for pr in j.get("products") or []:
                    n = _ah_normalize(pr)
                    if not n or not n.get("ah_id"):
                        continue
                    aid = str(n["ah_id"])
                    if pr.get("orderAvailabilityStatus") in ("OUT_OF_ASSORTMENT", "DELISTED"):
                        if aid in prods:
                            gone.append(prods[aid]["product_id"])
                        continue
                    if not n["price"] or aid in seen:
                        continue
                    seen.add(aid)
                    if aid in prods:
                        ops.append(UpdateOne({"product_id": prods[aid]["product_id"]}, {"$set": _apply_refresh(prods[aid], "Albert Heijn", n, mults)}))
                    elif aid not in known:
                        known.add(aid)
                        n["source_id"] = aid
                        new.append(_new_store_product("ah_id", n, "Albert Heijn", mults))
                if ops:
                    await db.products.bulk_write(ops, ordered=False)
                    updated += len(ops)
                if new:
                    await db.products.insert_many(new)
                    added += len(new)
                page += 1
            await db.meta.update_one({"key": "price_refresh"}, {"$set": {"ah_cat": ci + 1}}, upsert=True)
            await asyncio.sleep(0.5)
    await db.meta.update_one({"key": "price_refresh"}, {"$set": {"ah_cat": 0}}, upsert=True)
    # Alleen bij een volledige ronde weten we wat er niet meer is
    full = start_cat == 0
    await _mark_assortment([prods[a]["product_id"] for a in seen if a in prods],
                           gone + ([p["product_id"] for a, p in prods.items() if a not in seen] if full and len(seen) >= 0.85 * len(prods) else []))
    logger.info("AH-prijzen: %d bijgewerkt, %d nieuw%s", updated, added, "" if full else " (hervat)")
    return updated + added


async def _refresh_jumbo_prices(mults: dict) -> int:
    # Jumbo heeft geen losse productopvraag: zoeken op "*" geeft de hele winkel, 24 per keer. Rustig aan (anders blokkeert
    # Jumbo), nieuwe producten meteen erbij, en na een herstart verder waar we waren.
    from pymongo import UpdateOne
    prods = {str(p["jumbo_id"]): p async for p in db.products.find({"jumbo_id": {"$exists": True}, "deleted_at": None, "is_global": True},
                                                                  {"_id": 0, "product_id": 1, "jumbo_id": 1, "aisle": 1})}
    known = {str(p["jumbo_id"]) async for p in db.products.find({"jumbo_id": {"$exists": True}}, {"_id": 0, "jumbo_id": 1})}
    state = await db.meta.find_one({"key": "price_refresh"}) or {}
    start = off = int(state.get("jumbo_offset") or 0)
    done: set = set()
    added, fails = 0, 0
    async with httpx.AsyncClient(timeout=30, headers=JUMBO_HEADERS) as c:
        _, total = await _jumbo_search_page(c, "*", 0)
        while off < total:
            try:
                page = (await _jumbo_search_page(c, "*", off))[0]
                fails = 0
            except Exception as e:
                fails += 1
                if "403" in repr(e) or fails >= 5:
                    await db.meta.update_one({"key": "price_refresh"}, {"$set": {"jumbo_offset": off}}, upsert=True)
                    raise RuntimeError(f"Jumbo-prijzen gestopt bij {off} van {total}: {e!r}")
                await asyncio.sleep(10)
                continue
            ops, new = [], []
            for raw in page:
                n = _jumbo_normalize(raw)
                if not n or not n["price"] or n["jumbo_id"] in done:
                    continue
                done.add(n["jumbo_id"])
                if n["jumbo_id"] in prods:
                    p = prods[n["jumbo_id"]]
                    ops.append(UpdateOne({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Jumbo", n, mults)}))
                elif n["jumbo_id"] not in known:
                    known.add(n["jumbo_id"])
                    n["source_id"] = n["jumbo_id"]
                    new.append(_new_store_product("jumbo_id", n, "Jumbo", mults))
            if ops:
                await db.products.bulk_write(ops, ordered=False)
            if new:
                await db.products.insert_many(new)
                added += len(new)
            off += 24
            if off % (24 * 25) == 0:
                await db.meta.update_one({"key": "price_refresh"}, {"$set": {"jumbo_offset": off}}, upsert=True)
            await asyncio.sleep(2)
    await db.meta.update_one({"key": "price_refresh"}, {"$set": {"jumbo_offset": 0}}, upsert=True)
    seen = [prods[j]["product_id"] for j in done if j in prods]
    if start == 0 and len(done) >= 0.85 * len(prods):
        await _mark_assortment(seen, [p["product_id"] for j, p in prods.items() if j not in done])
    else:
        await _mark_assortment(seen, [])
    logger.info("Jumbo-prijzen: %d bijgewerkt, %d nieuw (van %d)%s", len(seen), added, total, "" if start == 0 else " (hervat)")
    return len(done)


async def _refresh_dirk_prices_all() -> dict:
    mults = await _store_mults()
    updated = 0
    # Een ronde loopt per winkel; wat al klaar is (bijv. voor een herstart) slaan we over
    state = await db.meta.find_one({"key": "price_refresh"}) or {}
    done = set(state.get("done") or [])
    ok = True
    for fn in (_refresh_dirk_prices, _refresh_jumbo_prices, _refresh_ah_prices):
        if fn.__name__ in done:
            continue
        try:
            updated += await fn(mults)
            done.add(fn.__name__)
            await db.meta.update_one({"key": "price_refresh"}, {"$set": {"done": sorted(done)}}, upsert=True)
        except Exception as e:
            ok = False
            logger.warning("Refresh %s failed: %s", fn.__name__, e)
        if fn is _refresh_jumbo_prices:
            asyncio.create_task(_load_folders())  # Jumbo-acties komen mee met de producten
    _invalidate_products()
    if not ok:
        return {"updated": updated, "partial": True}
    await db.meta.update_one({"key": "price_refresh"}, {"$set": {"done": []}}, upsert=True)
    await db.settings.update_one({"key": "app"}, {"$set": {"dirk_refreshed_at": now_utc()}}, upsert=True)
    try:
        await _snapshot_prices()
    except Exception as e:
        logger.warning("Prijsgeschiedenis: %r", e)
    try:
        await _check_price_alerts()
    except Exception as e:
        logger.warning("Prijsalarm: %r", e)
    return {"updated": updated}


# ---------------------------------------------------------------------------
# Prijsgeschiedenis (Premium): na elke prijsronde noteren we wat er veranderd is
# ---------------------------------------------------------------------------
HIST_MAX_POINTS = 400


def _hist_now(doc: dict) -> tuple:
    # (normale prijs, actieprijs of None). De opgeslagen prijs is bij sommige winkels al de actieprijs.
    store = product_source(doc)
    shelf = float((doc.get("prices") or {}).get(store) or 0) if store else 0.0
    if not shelf:
        return 0.0, None
    now_p, _ = _promo_public(doc, shelf)
    if not now_p and not doc.get("on_offer"):
        return round(shelf, 2), None
    regular = max(shelf, float((now_p or {}).get("regular") or 0))
    pay = min(shelf, float((now_p or {}).get("price") or shelf))
    return round(regular, 2), round(pay, 2)


async def _snapshot_prices() -> int:
    from pymongo import UpdateOne
    today = datetime.now(timezone.utc).date().isoformat()
    hist_ops, prod_ops, changed = [], [], 0

    async def flush():
        if hist_ops:
            await db.price_history.bulk_write(hist_ops, ordered=False)
        if prod_ops:
            await db.products.bulk_write(prod_ops, ordered=False)
        hist_ops.clear()
        prod_ops.clear()

    proj = {"_id": 0, "product_id": 1, "prices": 1, "dirk_id": 1, "ah_id": 1, "jumbo_id": 1, "promo": 1, "promos": 1, "on_offer": 1, "hist_last": 1}
    async for doc in db.products.find({"is_global": True, "deleted_at": None}, proj):
        price, promo = _hist_now(doc)
        if not price:
            continue
        mark = f"{price}|{promo}"
        if doc.get("hist_last") == mark:
            continue
        point = {"d": today, "p": price, "a": promo}
        hist_ops.append(UpdateOne({"product_id": doc["product_id"]},
                                  {"$push": {"points": {"$each": [point], "$slice": -HIST_MAX_POINTS}}, "$set": {"updated": today}}, upsert=True))
        prod_ops.append(UpdateOne({"product_id": doc["product_id"]}, {"$set": {"hist_last": mark}}))
        changed += 1
        if len(hist_ops) >= 500:
            await flush()
    await flush()
    logger.info("Prijsgeschiedenis: %d producten bijgewerkt", changed)
    return changed


def _history_summary(points: list, today: str) -> dict:
    # Wat kostte het, wat is laag en wat is normaal; per dag de prijs die je toen betaalde (actie telt mee)
    if not points:
        return {"points": [], "since": None}
    pay = [{"d": x["d"], "p": x["p"], "a": x.get("a"), "pay": x.get("a") or x["p"]} for x in points]
    cutoff = (datetime.fromisoformat(today) - timedelta(days=365)).date().isoformat()
    recent = [x for x in pay if x["d"] >= cutoff] or pay[-1:]
    lows = [x["pay"] for x in recent]
    now = pay[-1]
    regular = sorted(x["p"] for x in recent)[len(recent) // 2]
    return {
        "points": pay,
        "since": pay[0]["d"],
        "now": now["pay"],
        "regular": regular,
        "lowest": min(lows),
        "highest": max(x["p"] for x in recent),
        "is_lowest": now["pay"] <= min(lows),
    }


# ---------------------------------------------------------------------------
# Prijsalarm (Premium): een seintje bij een aanbieding of als de prijs onder jouw bedrag zakt
# ---------------------------------------------------------------------------
class PriceAlertInput(BaseModel):
    on_promo: bool = True
    target: Optional[float] = None


def _alert_state(alert: dict, prod: Optional[dict]) -> dict:
    price, promo = _hist_now(prod) if prod else (0.0, None)
    pay = promo or price
    target = alert.get("target")
    hit = bool(price) and ((alert.get("on_promo") and promo is not None) or (target is not None and pay <= target))
    return {"price": price, "promo": promo, "pay": pay, "hit": hit, "mark": f"{price}|{promo}"}


def _alert_public(alert: dict, prod: Optional[dict]) -> dict:
    st = _alert_state(alert, prod)
    promo_label = None
    if prod and st["promo"] is not None:
        now_p, _ = _promo_public(prod, st["price"])
        promo_label = (now_p or {}).get("label")
    return {"product_id": alert["product_id"], "on_promo": bool(alert.get("on_promo")), "target": alert.get("target"),
            "name": (prod or {}).get("name"), "image": (prod or {}).get("image"), "store": product_source(prod) if prod else None,
            "unit": (prod or {}).get("unit"), "price": st["price"], "promo": st["promo"], "promo_label": promo_label, "hit": st["hit"],
            "gone": not prod}


@api_router.get("/price-alerts")
async def list_price_alerts(user: dict = Depends(get_current_user)):
    await require_premium(user)
    alerts = await db.price_alerts.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    own = {a["product_id"] for a in alerts}
    auto_on = user.get("auto_alerts", True)
    freq = [pid for pid in await _frequent_products(user["user_id"]) if pid not in own] if auto_on else []
    prods = {p["product_id"]: p async for p in db.products.find(_live({"product_id": {"$in": list(own) + freq}}), {"_id": 0})}
    out = [_alert_public(a, prods.get(a["product_id"])) for a in alerts]
    out.sort(key=lambda x: not x["hit"])
    # Vaak gekocht: automatisch in de gaten gehouden, zonder dat je zelf een alarm hoeft te zetten
    auto = [_alert_public({"product_id": pid, "on_promo": True}, prods[pid]) for pid in freq if pid in prods]
    auto.sort(key=lambda x: not x["hit"])
    return {"alerts": out, "auto": auto, "auto_on": auto_on}


class AutoAlertsInput(BaseModel):
    on: bool


@api_router.put("/price-alerts/auto")
async def set_auto_alerts(data: AutoAlertsInput, user: dict = Depends(get_current_user)):
    await require_premium(user)
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"auto_alerts": data.on}})
    return {"auto_on": data.on}


AUTO_ALERT_DAYS = 120
AUTO_ALERT_MAX = 40


async def _frequent_products(uid: str) -> list:
    # Producten die je vaak koopt: in minstens twee van je lijstjes van de laatste maanden (gerechten en losse producten)
    since = (now_utc() - timedelta(days=AUTO_ALERT_DAYS)).isoformat()
    recent = {"$or": [{"start_date": {"$gte": since[:10]}}, {"created_at": {"$gte": now_utc() - timedelta(days=AUTO_ALERT_DAYS)}}]}
    camps = await db.camps.find({"$and": [camp_access_filter(uid), recent]},
                                {"_id": 0, "days": 1, "general": 1}).to_list(100)
    if not camps:
        return []
    dish_ids = {did for c in camps for d in c.get("days") or [] for ids in (d.get("meals") or {}).values() for did in ids}
    dishes = {d["dish_id"]: d async for d in db.dishes.find({"dish_id": {"$in": list(dish_ids)}}, {"_id": 0, "dish_id": 1, "ingredients": 1})}
    counts: Dict[str, int] = {}
    for c in camps:
        pids = set()
        for d in c.get("days") or []:
            for ids in (d.get("meals") or {}).values():
                for did in ids:
                    pids |= {i["product_id"] for i in (dishes.get(did) or {}).get("ingredients") or [] if i.get("product_id")}
            pids |= {e["product_id"] for e in d.get("extras") or [] if e.get("product_id")}
        pids |= {e["product_id"] for e in c.get("general") or [] if e.get("product_id")}
        for pid in pids:
            counts[pid] = counts.get(pid, 0) + 1
    return [pid for pid, n in sorted(counts.items(), key=lambda kv: -kv[1]) if n >= 2][:AUTO_ALERT_MAX]


@api_router.get("/products/{product_id}/price-alert")
async def get_price_alert(product_id: str, user: dict = Depends(get_current_user)):
    if not user.get("premium"):
        return {"alert": None}
    a = await db.price_alerts.find_one({"user_id": user["user_id"], "product_id": product_id}, {"_id": 0})
    return {"alert": {"on_promo": bool(a.get("on_promo")), "target": a.get("target")} if a else None}


@api_router.put("/products/{product_id}/price-alert")
async def set_price_alert(product_id: str, data: PriceAlertInput, user: dict = Depends(get_current_user)):
    await require_premium(user)
    if not await db.products.find_one({"product_id": product_id, "deleted_at": None}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="Product niet gevonden")
    target = round(float(data.target), 2) if data.target and data.target > 0 else None
    if not data.on_promo and target is None:
        raise HTTPException(status_code=400, detail="Kies een aanbieding of een prijs")
    exists = await db.price_alerts.find_one({"user_id": user["user_id"], "product_id": product_id}, {"_id": 1})
    if not exists and await db.price_alerts.count_documents({"user_id": user["user_id"]}) >= 100:
        raise HTTPException(status_code=400, detail="Je kunt maximaal 100 prijsalarmen hebben")
    await db.price_alerts.update_one(
        {"user_id": user["user_id"], "product_id": product_id},
        {"$set": {"on_promo": data.on_promo, "target": target}, "$unset": {"notified_mark": ""}, "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )
    return {"alert": {"on_promo": data.on_promo, "target": target}}


@api_router.delete("/products/{product_id}/price-alert")
async def delete_price_alert(product_id: str, user: dict = Depends(get_current_user)):
    await db.price_alerts.delete_one({"user_id": user["user_id"], "product_id": product_id})
    return {"ok": True}


async def _check_price_alerts() -> int:
    # Na de prijsronde: per gebruiker één mail met alles wat nu raak is (en nog niet gemeld)
    by_user: Dict[str, list] = {}
    alerts = await db.price_alerts.find({}, {"_id": 0}).to_list(None)
    prods = {p["product_id"]: p async for p in db.products.find(_live({"product_id": {"$in": list({a["product_id"] for a in alerts})}}), {"_id": 0})} if alerts else {}
    for a in alerts:
        prod = prods.get(a["product_id"])
        st = _alert_state(a, prod)
        q = {"user_id": a["user_id"], "product_id": a["product_id"]}
        if not st["hit"]:
            if a.get("notified_mark"):
                await db.price_alerts.update_one(q, {"$unset": {"notified_mark": ""}})
            continue
        if a.get("notified_mark") == st["mark"]:
            continue
        await db.price_alerts.update_one(q, {"$set": {"notified_mark": st["mark"], "hit_at": now_utc()}})
        by_user.setdefault(a["user_id"], []).append((prod, st))
    # Automatisch: wat Premium-gebruikers vaak kopen en nu in de aanbieding is (één keer per aanbieding melden)
    async for u in db.users.find({"premium": True, "deleted_at": None, "auto_alerts": {"$ne": False}}, {"_id": 0, "user_id": 1}):
        uid = u["user_id"]
        try:
            own = {a["product_id"] for a in alerts if a["user_id"] == uid}
            freq = [pid for pid in await _frequent_products(uid) if pid not in own]
            if not freq:
                continue
            marks = {m["product_id"]: m.get("mark") async for m in db.auto_alert_marks.find({"user_id": uid}, {"_id": 0})}
            async for prod in db.products.find(_live({"product_id": {"$in": freq}}), {"_id": 0}):
                st = _alert_state({"on_promo": True}, prod)
                pid = prod["product_id"]
                if not st["hit"] or marks.get(pid) == st["mark"]:
                    continue
                await db.auto_alert_marks.update_one({"user_id": uid, "product_id": pid}, {"$set": {"mark": st["mark"], "at": now_utc()}}, upsert=True)
                by_user.setdefault(uid, []).append((prod, st))
        except Exception as e:
            logger.info("Automatisch prijsalarm %s: %r", uid, e)
    base = (FRONTEND_URL or "").rstrip("/")
    sent = 0
    for uid, hits in by_user.items():
        u = await db.users.find_one({"user_id": uid, "deleted_at": None})
        if not u or not u.get("premium") or not u.get("email") or u.get("email_opt_out"):
            continue
        rows = "".join(
            f'<tr><td style="padding:6px 0;border-bottom:1px solid #eee">{escape(p.get("name") or "")}'
            f'<br/><span style="color:#888;font-size:12px">{escape(product_source(p) or "")}</span></td>'
            f'<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">'
            + (f'<s style="color:#999">{_euro(st["price"])}</s> <b style="color:#C85A32">{_euro(st["promo"])}</b>' if st["promo"] else f'<b>{_euro(st["price"])}</b>')
            + '</td></tr>'
            for p, st in hits
        )
        html = (
            '<div style="font-family:Arial,sans-serif;color:#1C1B1A">'
            f'<h2 style="color:#2E5E38;margin:0 0 12px">&#128276; Prijsalarm</h2>'
            f'<p>Hoi {escape((u.get("name") or "").split(" ")[0])}, deze producten zijn nu in de aanbieding of onder jouw prijs '
            f'(ook producten die je vaak koopt):</p>'
            f'<table style="width:100%;border-collapse:collapse;font-size:14px">{rows}</table>'
            + (f'<p><a href="{escape(base)}/alerts" style="display:inline-block;background:#2E5E38;color:#fff;padding:12px 20px;'
               f'border-radius:10px;text-decoration:none;font-weight:bold">Bekijk je prijsalarmen</a></p>' if base else "")
            + '</div>'
        )
        await send_email(u["email"], f"Prijsalarm: {len(hits)} {'product' if len(hits) == 1 else 'producten'} goedkoper", html)
        sent += 1
    logger.info("Prijsalarm: %d mails", sent)
    return sent


@api_router.get("/products/{product_id}/price-history")
async def price_history(product_id: str, user: dict = Depends(get_current_user)):
    await require_premium(user)
    doc = await db.price_history.find_one({"product_id": product_id}, {"_id": 0})
    return _history_summary((doc or {}).get("points") or [], datetime.now(timezone.utc).date().isoformat())


@api_router.post("/admin/products/refresh-prices")
async def refresh_prices(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    return await _refresh_dirk_prices_all()


@api_router.get("/admin/products/refresh-status")
async def refresh_status(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    doc = await db.settings.find_one({"key": "app"}, {"_id": 0})
    linked = await db.products.count_documents({"$or": [{"dirk_id": {"$exists": True}}, {"ah_id": {"$exists": True}}, {"jumbo_id": {"$exists": True}}], "deleted_at": None, "is_global": True})
    ts = (doc or {}).get("dirk_refreshed_at")
    return {"linked": linked, "refreshed_at": ts.isoformat() if isinstance(ts, datetime) else None}


# --- Product submissions (admin) ---
async def _pending_product_subs():
    subs = await db.product_submissions.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    pids = [s["product_id"] for s in subs]
    prods = await db.products.find({"product_id": {"$in": pids}}, {"_id": 0}).to_list(1000)
    pmap = {p["product_id"]: p for p in prods}
    stale, out = [], []
    for s in subs:
        p = pmap.get(s["product_id"])
        if not p or p.get("deleted_at") or p.get("is_global"):
            stale.append(s["psub_id"])
            continue
        out.append((s, p))
    if stale:
        await db.product_submissions.update_many({"psub_id": {"$in": stale}}, {"$set": {"status": "resolved"}})
    return out


@api_router.get("/admin/product-submissions")
async def list_product_submissions(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    pairs = await _pending_product_subs()
    return {"submissions": [{**s, "product": product_public(p, DEFAULT_STORE, "")} for s, p in pairs]}


@api_router.get("/admin/product-submissions/count")
async def product_submissions_count(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    if "manage_products" not in perms:
        return {"count": 0}
    pairs = await _pending_product_subs()
    return {"count": len(pairs)}


@api_router.post("/admin/product-submissions/{psub_id}/approve")
async def approve_product_submission(psub_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    sub = await db.product_submissions.find_one({"psub_id": psub_id, "status": "pending"})
    if not sub:
        raise HTTPException(status_code=404, detail="Inzending niet gevonden")
    await db.products.update_one({"product_id": sub["product_id"]}, {"$set": {"is_global": True, "owner_id": None}})
    await db.product_submissions.update_one({"psub_id": psub_id}, {"$set": {"status": "approved", "reviewed_at": now_utc()}})
    return {"ok": True}


@api_router.post("/admin/product-submissions/{psub_id}/reject")
async def reject_product_submission(psub_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    await db.product_submissions.update_one(
        {"psub_id": psub_id, "status": "pending"},
        {"$set": {"status": "rejected", "reviewed_at": now_utc()}},
    )
    return {"ok": True}


class SettingsInput(BaseModel):
    app_name: Optional[str] = None
    tagline: Optional[str] = None
    hero_url: Optional[str] = None
    logo_url: Optional[str] = None
    tab_camps: Optional[str] = None
    term_one: Optional[str] = None
    tab_dishes: Optional[str] = None
    tab_products: Optional[str] = None
    tab_account: Optional[str] = None
    sub_camps: Optional[str] = None
    sub_dishes: Optional[str] = None
    sub_products: Optional[str] = None
    sub_account: Optional[str] = None


DEFAULT_SETTINGS = {
    "app_name": "Slim Boodschappenlijstje",
    "tagline": "Plan maaltijden en boodschappen per kampdag",
    "hero_url": "https://images.unsplash.com/photo-1466220549276-aef9ce186540?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
    "logo_url": "",
    "tab_camps": "Kampen",
    "term_one": "",
    "tab_dishes": "Gerechten",
    "tab_products": "Producten",
    "tab_account": "Account",
    "sub_camps": "Jouw maaltijdplanningen",
    "sub_dishes": "Beheer je gerechten",
    "sub_products": "Alle producten en prijzen",
    "sub_account": "Jouw profiel en instellingen",
}


# ---- Object storage (MongoDB GridFS) ----
from motor.motor_asyncio import AsyncIOMotorGridFSBucket

STORAGE_APP = "scoutkook"
fs_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="uploads")


async def _init_storage(force: bool = False) -> None:
    # GridFS needs no initialisation; kept for compatibility with startup()
    return None


async def _put_object(path: str, data: bytes, content_type: str) -> dict:
    await fs_bucket.upload_from_stream(path, data, metadata={"content_type": content_type})
    return {"path": path}


async def _get_object(path: str):
    cursor = fs_bucket.find({"filename": path}).sort("uploadDate", -1).limit(1)
    docs = await cursor.to_list(1)
    if not docs:
        raise FileNotFoundError(path)
    stream = await fs_bucket.open_download_stream(docs[0]._id)
    content = await stream.read()
    ct = (docs[0].metadata or {}).get("content_type", "application/octet-stream")
    return content, ct


# Alleen afbeeldingen; andere typen (zoals HTML) zouden als script op de site kunnen draaien
IMAGE_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Afbeelding is te groot (max 8MB)")
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "jpg"
    if ext not in IMAGE_TYPES:
        ext = "jpg"
    content_type = file.content_type if file.content_type in IMAGE_TYPES.values() else IMAGE_TYPES[ext]
    path = f"{STORAGE_APP}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    await _put_object(path, data, content_type)
    return {"url": f"/api/files/{path}", "path": path}


@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    try:
        content, ct = await _get_object(path)
    except Exception:
        raise HTTPException(status_code=404, detail="Niet gevonden")
    if ct not in IMAGE_TYPES.values():
        ct = "application/octet-stream"
    return Response(content=content, media_type=ct, headers={"Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"})


_HET_WORDS = re.compile(r"(kamp|weekend|evenement|uitje|feest|project|programma|festival|reisje|toernooi|kampement|weekeinde)$")


async def _terms() -> dict:
    # Hoe een kamp in deze app heet (Beheer -> App), voor e-mails; zelfde regels als useTerms in de app
    doc = await db.settings.find_one({"key": "app"}, {"_id": 0, "tab_camps": 1, "term_one": 1}) or {}
    many = (doc.get("tab_camps") or "Kampen").strip()
    one = (doc.get("term_one") or "").strip()
    if not one:
        one = many[:-2] if many.endswith("en") and len(many) > 4 else many[:-1] if many.endswith("s") and len(many) > 3 else many
    one = one.lower()
    return {"one": one, "many": many.lower(), "de": "het" if _HET_WORDS.search(one) else "de"}


@api_router.get("/settings")
async def get_settings():
    doc = await db.settings.find_one({"key": "app"}, {"_id": 0, "key": 0})
    return {**DEFAULT_SETTINGS, **(doc or {})}


@api_router.put("/settings")
async def update_settings(data: SettingsInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if update:
        await db.settings.update_one({"key": "app"}, {"$set": update}, upsert=True)
    doc = await db.settings.find_one({"key": "app"}, {"_id": 0, "key": 0})
    return {**DEFAULT_SETTINGS, **(doc or {})}


# ---------------------------------------------------------------------------
# Email unsubscribe (public)
# ---------------------------------------------------------------------------
@api_router.get("/email/unsubscribe/{token}")
async def email_unsubscribe(token: str):
    pref = await db.email_prefs.find_one({"token": token})
    if pref:
        await db.email_prefs.update_one({"token": token}, {"$set": {"opted_out": True}})
        await db.users.update_one({"email": pref["email"]}, {"$set": {"email_opt_out": True}})
    page = (
        "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<style>body{font-family:Arial,sans-serif;background:#F5F2EC;color:#1C1B1A;text-align:center;padding:48px 20px}"
        ".card{max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:32px}</style></head>"
        "<body><div class='card'><h2 style='color:#2E5E38'>Afgemeld</h2>"
        "<p>Je ontvangt geen e-mails meer van Slim Boodschappenlijstje. Je kunt dit altijd weer aanzetten in de app bij Instellingen.</p>"
        "</div></body></html>"
    )
    return HTMLResponse(content=page)


# ---------------------------------------------------------------------------
# Stores (dynamic) + store requests
# ---------------------------------------------------------------------------
class StoreRequestInput(BaseModel):
    name: str


@api_router.get("/stores")
async def list_stores(user: dict = Depends(get_current_user)):
    return {"stores": await get_active_stores()}


class StoreInput(BaseModel):
    name: str


@api_router.post("/store-requests")
async def request_store(data: StoreRequestInput, user: dict = Depends(get_current_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Geef een winkelnaam op")
    active = await get_active_stores()
    if name in active:
        raise HTTPException(status_code=400, detail="Deze winkel bestaat al")
    existing = await db.store_requests.find_one({"name": name, "status": "pending"})
    if existing:
        return {"ok": True, "already": True}
    await db.store_requests.insert_one({
        "req_id": f"sreq_{uuid.uuid4().hex[:12]}",
        "name": name,
        "requested_by": user["user_id"],
        "requested_by_name": user.get("name") or user.get("email"),
        "status": "pending",
        "created_at": now_utc(),
    })
    return {"ok": True}


@api_router.get("/admin/store-requests")
async def list_store_requests(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    reqs = await db.store_requests.find({"status": "pending"}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"requests": reqs}


@api_router.get("/admin/store-requests/count")
async def store_requests_count(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    if "manage_settings" not in perms:
        return {"count": 0}
    return {"count": await db.store_requests.count_documents({"status": "pending"})}


@api_router.post("/admin/store-requests/{req_id}/approve")
async def approve_store_request(req_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    req = await db.store_requests.find_one({"req_id": req_id, "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Aanvraag niet gevonden")
    # Alleen noteren: een nieuwe supermarkt wordt door ons gekoppeld (geprogrammeerd)
    await db.store_requests.update_one({"req_id": req_id}, {"$set": {"status": "approved", "reviewed_at": now_utc()}})
    return {"ok": True}


@api_router.post("/admin/store-requests/{req_id}/reject")
async def reject_store_request(req_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    await db.store_requests.update_one(
        {"req_id": req_id, "status": "pending"},
        {"$set": {"status": "rejected", "reviewed_at": now_utc()}},
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Feedback / verbeteringen
# ---------------------------------------------------------------------------
class FeedbackInput(BaseModel):
    message: str


@api_router.post("/feedback")
async def submit_feedback(data: FeedbackInput, user: dict = Depends(get_current_user)):
    msg = data.message.strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Schrijf eerst je feedback")
    await db.feedback.insert_one({
        "feedback_id": f"fb_{uuid.uuid4().hex[:12]}",
        "message": msg[:2000],
        "user_id": user["user_id"],
        "user_name": user.get("name") or user.get("email"),
        "status": "new",
        "created_at": now_utc(),
    })
    return {"ok": True}


@api_router.get("/admin/feedback")
async def list_feedback(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    docs = await db.feedback.find({"status": {"$ne": "deleted"}}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        for k in ("created_at", "replied_at"):
            if isinstance(d.get(k), datetime):
                d[k] = d[k].isoformat()
    return {"feedback": docs, "folders": FEEDBACK_FOLDERS}


@api_router.get("/admin/feedback/count")
async def feedback_count(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    if "manage_settings" not in perms:
        return {"count": 0}
    return {"count": await db.feedback.count_documents({"status": "new"})}


@api_router.post("/admin/feedback/{feedback_id}/read")
async def mark_feedback_read(feedback_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    await db.feedback.update_one({"feedback_id": feedback_id}, {"$set": {"status": "read"}})
    return {"ok": True}


FEEDBACK_FOLDERS = {"gebruikt": "Gebruikt", "niet_gebruikt": "Niet gebruikt", "later": "Voor later"}


class FeedbackReply(BaseModel):
    reply: str = ""
    folder: Optional[str] = None  # gebruikt, niet_gebruikt, later


@api_router.post("/admin/feedback/{feedback_id}/reply")
async def reply_feedback(feedback_id: str, data: FeedbackReply, user: dict = Depends(get_current_user)):
    # Reageren op feedback en het in een map zetten; de gebruiker ziet de reactie in de app en krijgt een mail
    await require_perm(user, "manage_settings")
    fb = await db.feedback.find_one({"feedback_id": feedback_id}, {"_id": 0})
    if not fb:
        raise HTTPException(status_code=404, detail="Feedback niet gevonden")
    if data.folder and data.folder not in FEEDBACK_FOLDERS:
        raise HTTPException(status_code=400, detail="Onbekende map")
    reply = data.reply.strip()[:2000]
    upd: dict = {"status": "done" if data.folder else "read"}
    if data.folder:
        upd["folder"] = data.folder
    if reply:
        upd.update({"reply": reply, "replied_at": now_utc(), "reply_by": (user.get("name") or "").split(" ")[0] or "De beheerder", "reply_seen": False})
    await db.feedback.update_one({"feedback_id": feedback_id}, {"$set": upd})
    if reply:
        u = await db.users.find_one({"user_id": fb["user_id"], "deleted_at": None}, {"_id": 0})
        if u and u.get("email") and not u.get("email_opt_out"):
            base = (FRONTEND_URL or "").rstrip("/")
            html = (
                '<div style="font-family:Arial,sans-serif;color:#1C1B1A">'
                '<h2 style="color:#2E5E38;margin:0 0 12px">Reactie op je feedback</h2>'
                f'<p>Hoi {escape((u.get("name") or "").split(" ")[0])}, bedankt voor je bericht:</p>'
                f'<p style="color:#666;border-left:3px solid #ddd;padding-left:10px">{escape(fb["message"][:500])}</p>'
                f'<p>{escape(reply).replace(chr(10), "<br/>")}</p>'
                + (f'<p><a href="{escape(base)}/feedback" style="color:#2E5E38">Bekijk het in de app</a></p>' if base else "")
                + '</div>'
            )
            try:
                await send_email(u["email"], "Reactie op je feedback", html)
            except Exception as e:
                logger.warning("Feedbackmail: %r", e)
    return {"ok": True}


@api_router.get("/feedback/mine")
async def my_feedback(user: dict = Depends(get_current_user)):
    docs = await db.feedback.find({"user_id": user["user_id"], "status": {"$ne": "deleted"}}, {"_id": 0}).sort("created_at", -1).to_list(50)
    out = [{"feedback_id": d["feedback_id"], "message": d["message"], "reply": d.get("reply"), "reply_by": d.get("reply_by"),
            "folder": FEEDBACK_FOLDERS.get(d.get("folder") or ""), "new_reply": bool(d.get("reply")) and not d.get("reply_seen"),
            "created_at": d["created_at"].isoformat() if isinstance(d.get("created_at"), datetime) else d.get("created_at"),
            "replied_at": d["replied_at"].isoformat() if isinstance(d.get("replied_at"), datetime) else None} for d in docs]
    if any(x["new_reply"] for x in out):
        await db.feedback.update_many({"user_id": user["user_id"], "reply_seen": False}, {"$set": {"reply_seen": True}})
    return {"feedback": out}


@api_router.get("/feedback/unread")
async def my_feedback_unread(user: dict = Depends(get_current_user)):
    return {"count": await db.feedback.count_documents({"user_id": user["user_id"], "reply_seen": False, "status": {"$ne": "deleted"}})}


@api_router.delete("/admin/feedback/{feedback_id}")
async def delete_feedback(feedback_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    await db.feedback.update_one({"feedback_id": feedback_id}, {"$set": {"status": "deleted"}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Recent verwijderd (prullenbak, 30 dagen)
# ---------------------------------------------------------------------------
TRASH_DAYS = 30
TRASH = {
    "user": ("users", "user_id"),
    "camp": ("camps", "camp_id"),
    "dish": ("dishes", "dish_id"),
    "product": ("products", "product_id"),
}


def _days_left(deleted_at) -> int:
    if not isinstance(deleted_at, datetime):
        return TRASH_DAYS
    gone = ensure_aware(deleted_at) + timedelta(days=TRASH_DAYS)
    return max(0, (gone - now_utc()).days)


async def _trash_queries(user: dict) -> dict:
    # Wat deze gebruiker in Recent verwijderd ziet: eigen spullen, plus wat bij zijn beheerrechten hoort
    perms = await user_permissions(user)
    uid = user["user_id"]
    own = {"deleted_at": {"$ne": None}, "deleted_with_user": {"$exists": False}, "owner_id": uid}
    q = {"camp": [own], "dish": [own], "product": [own], "user": []}
    if "manage_standard_dishes" in perms:
        q["dish"].append({"deleted_at": {"$ne": None}, "is_standard": True})
    if "manage_products" in perms:
        q["product"].append({"deleted_at": {"$ne": None}, "is_global": True})
    if "manage_users" in perms:
        q["user"].append({"deleted_at": {"$ne": None}})
    return {k: ({"$or": v} if v else None) for k, v in q.items()}


async def _trash_docs(user: dict) -> list:
    out = []
    for kind, query in (await _trash_queries(user)).items():
        if query is None:
            continue
        coll, _ = TRASH[kind]
        async for d in db[coll].find(query, {"_id": 0}):
            out.append((kind, d))
    return out


async def _find_trash_item(user: dict, kind: str, item_id: str) -> dict:
    if kind not in TRASH:
        raise HTTPException(status_code=404, detail="Onbekend type")
    query = (await _trash_queries(user)).get(kind)
    coll, idf = TRASH[kind]
    doc = await db[coll].find_one({"$and": [query, {idf: item_id}]}) if query else None
    if not doc:
        raise HTTPException(status_code=404, detail="Niet gevonden in Recent verwijderd")
    return doc


@api_router.get("/trash")
async def list_trash(user: dict = Depends(get_current_user)):
    items = []
    for kind, d in await _trash_docs(user):
        idf = TRASH[kind][1]
        extra = ""
        if kind == "user":
            extra = d.get("email") or ""
            n = sum([await db[c].count_documents({"deleted_with_user": d[idf]}) for c in ("camps", "dishes", "products")])
            if n:
                extra += f" · met {n} kampen, gerechten en producten"
        items.append({
            "kind": kind,
            "id": d[idf],
            "name": d.get("name") or d.get("email") or "",
            "extra": extra,
            "deleted_at": ensure_aware(d["deleted_at"]).isoformat() if isinstance(d.get("deleted_at"), datetime) else None,
            "days_left": _days_left(d.get("deleted_at")),
        })
    items.sort(key=lambda i: i["deleted_at"] or "", reverse=True)
    return {"items": items, "days": TRASH_DAYS}


@api_router.post("/trash/{kind}/{item_id}/restore")
async def restore_trash(kind: str, item_id: str, user: dict = Depends(get_current_user)):
    doc = await _find_trash_item(user, kind, item_id)
    _invalidate_products()
    coll, idf = TRASH[kind]
    if kind == "user":
        await db.users.update_one({idf: item_id}, {"$set": {"deleted_at": None}})
        for c in ("camps", "dishes", "products"):
            await db[c].update_many({"deleted_with_user": item_id}, {"$set": {"deleted_at": None}, "$unset": {"deleted_with_user": ""}})
        return {"ok": True}
    owner = doc.get("owner_id")
    if owner and not await db.users.find_one({"user_id": owner, "deleted_at": None}):
        raise HTTPException(status_code=400, detail="De eigenaar is verwijderd. Zet eerst de gebruiker terug")
    await db[coll].update_one({idf: item_id}, {"$set": {"deleted_at": None}, "$unset": {"deleted_with_user": ""}})
    return {"ok": True}


@api_router.delete("/trash/{kind}/{item_id}")
async def purge_trash_item(kind: str, item_id: str, user: dict = Depends(get_current_user)):
    doc = await _find_trash_item(user, kind, item_id)
    await _purge_docs(kind, [doc])
    return {"ok": True}


@api_router.delete("/trash")
async def purge_all_trash(user: dict = Depends(get_current_user)):
    by_kind: Dict[str, list] = {}
    for kind, d in await _trash_docs(user):
        by_kind.setdefault(kind, []).append(d)
    # Gebruikers als laatste: hun spullen hangen eraan
    for kind in ("camp", "dish", "product", "user"):
        await _purge_docs(kind, by_kind.get(kind, []))
    return {"ok": True, "deleted": sum(len(v) for v in by_kind.values())}


async def _purge_docs(kind: str, docs: list) -> None:
    coll, idf = TRASH[kind]
    ids = [d[idf] for d in docs]
    if not ids:
        return
    if kind == "user":
        for c in ("camps", "dishes", "products"):
            owned = await db[c].find({"owner_id": {"$in": ids}}, {"_id": 0}).to_list(100000)
            await _purge_docs({"camps": "camp", "dishes": "dish", "products": "product"}[c], owned)
        await db.user_sessions.delete_many({"user_id": {"$in": ids}})
        await db.camps.update_many({}, {"$pull": {"member_ids": {"$in": ids}, "left_ids": {"$in": ids}}})
    elif kind == "camp":
        await db.invitations.delete_many({"camp_id": {"$in": ids}})
    elif kind == "product":
        await db.product_submissions.delete_many({"product_id": {"$in": ids}})
    elif kind == "dish":
        await db.submissions.delete_many({"dish_id": {"$in": ids}, "status": "pending"})
    await db[coll].delete_many({idf: {"$in": ids}})


async def _purge_expired_trash() -> None:
    cutoff = now_utc() - timedelta(days=TRASH_DAYS)
    # Eerst gebruikers (nemen hun spullen mee), daarna losse items
    for kind in ("user", "camp", "dish", "product"):
        coll, _ = TRASH[kind]
        docs = await db[coll].find({"deleted_at": {"$ne": None, "$lt": cutoff}}, {"_id": 0}).to_list(100000)
        await _purge_docs(kind, docs)
        if docs:
            logger.info("Definitief verwijderd: %d %s", len(docs), coll)


async def _trash_orphans() -> None:
    # Spullen waarvan de eigenaar niet meer bestaat, gaan naar Recent verwijderd
    user_ids = {u["user_id"] async for u in db.users.find({}, {"_id": 0, "user_id": 1})}
    ts = now_utc()
    for coll in (db.camps, db.dishes, db.products):
        res = await coll.update_many(
            {"owner_id": {"$nin": list(user_ids) + [None]}, "deleted_at": None},
            {"$set": {"deleted_at": ts}},
        )
        if res.modified_count:
            logger.info("Wees-items naar Recent verwijderd: %d", res.modified_count)


# ---------------------------------------------------------------------------
# Dish sharing
# ---------------------------------------------------------------------------
@api_router.post("/dishes/{dish_id}/share")
async def share_dish(dish_id: str, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"dish_id": dish_id, "deleted_at": None})
    if not doc:
        raise HTTPException(status_code=404, detail="Gerecht niet gevonden")
    if not doc.get("is_standard") and doc.get("owner_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Je kunt alleen je eigen gerechten delen")
    token = doc.get("share_token")
    if not token:
        token = uuid.uuid4().hex[:16]
        await db.dishes.update_one({"dish_id": dish_id}, {"$set": {"share_token": token}})
    return {"token": token}


@api_router.get("/shared/dish/{token}")
async def get_shared_dish(token: str):
    doc = await db.dishes.find_one({"share_token": token, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Dit gedeelde gerecht bestaat niet (meer)")
    return {
        "name": doc["name"],
        "category": doc["category"],
        "ingredients": [
            {"name": i.get("name"), "unit": i.get("unit"), "qty_adult": i.get("qty_adult", 0),
             "qty_child": i.get("qty_child", 0), "aisle": i.get("aisle", "Overig")}
            for i in doc.get("ingredients", [])
        ],
    }


@api_router.post("/shared/dish/{token}/import")
async def import_shared_dish(token: str, user: dict = Depends(get_current_user)):
    doc = await db.dishes.find_one({"share_token": token, "deleted_at": None}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Dit gedeelde gerecht bestaat niet (meer)")
    new_id = f"dish_{uuid.uuid4().hex[:12]}"
    ingredients = []
    for i in doc.get("ingredients", []):
        ingredients.append({
            "name": i.get("name"), "unit": i.get("unit", "stuks"),
            "qty_adult": i.get("qty_adult", 0), "qty_child": i.get("qty_child", 0),
            "aisle": i.get("aisle", "Overig"), "price": i.get("price", 0), "product_id": None,
        })
    new_doc = {
        "dish_id": new_id,
        "name": doc["name"],
        "category": doc["category"],
        "is_standard": False,
        "owner_id": user["user_id"],
        "ingredients": ingredients,
        "deleted_at": None,
        "created_at": now_utc(),
    }
    await db.dishes.insert_one(new_doc)
    return dish_public(new_doc)


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)  # js-bundel en icoon-lettertype sneller binnen


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    h = response.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    h.setdefault("X-Frame-Options", "DENY")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


@app.middleware("http")
async def to_own_domain(request, call_next):
    # Het oude onrender.com-adres stuurt door naar het eigen domein (daar werkt ook Google-inlog)
    host = (request.headers.get("host") or "").split(":")[0].lower()
    if FRONTEND_URL and host.endswith(".onrender.com") and request.url.path != "/healthz":
        target = FRONTEND_URL.rstrip("/") + request.url.path + (f"?{request.url.query}" if request.url.query else "")
        if urlparse(target).hostname != host:
            return RedirectResponse(target, status_code=301 if request.method in ("GET", "HEAD") else 308)
    return await call_next(request)


# ---------------------------------------------------------------------------
# Startup: indexes + seed standard dishes
# ---------------------------------------------------------------------------
# Gewone maaltijden zoals de meeste mensen thuis eten: (naam, maaltijd, [(ingrediënt, eenheid, per volwassene, per kind, afdeling)])
_AF, _AV, _AB, _AZ, _AM, _AD = "Aardappelen, groente & fruit", "Voorraadkast", "Brood, beleg & koek", "Zuivel & kaas", "Vlees & vis", "Diepvries"
_BROOD = ("Volkoren brood", "gram", 105, 70, _AB)  # 3 of 2 boterhammen
_BOTER = ("Roomboter", "gram", 10, 7, _AZ)
BASIC_DISHES = [
    ("Boterham met kaas", "ontbijt", [_BROOD, _BOTER, ("Jong belegen kaas plakken", "plak", 2, 1, _AZ)]),
    ("Boterham met hagelslag", "ontbijt", [_BROOD, _BOTER, ("Hagelslag melk", "gram", 25, 20, _AB)]),
    ("Boterham met chocoladepasta", "ontbijt", [_BROOD, ("Chocoladepasta", "gram", 25, 20, _AB)]),
    ("Boterham met pindakaas", "ontbijt", [_BROOD, ("Pindakaas", "gram", 20, 15, _AB)]),
    ("Boterham met jam", "ontbijt", [_BROOD, _BOTER, ("Aardbeienjam", "gram", 25, 20, _AB)]),
    ("Yoghurt met muesli", "ontbijt", [("Halfvolle yoghurt", "ml", 200, 150, _AZ), ("Muesli", "gram", 50, 35, _AV)]),
    ("Havermout met banaan", "ontbijt", [("Havermout", "gram", 50, 35, _AV), ("Halfvolle melk", "ml", 250, 200, _AZ), ("Bananen", "stuks", 0.5, 0.5, _AF)]),
    ("Krentenbollen met boter", "ontbijt", [("Krentenbollen", "stuks", 2, 1, _AB), _BOTER]),
    ("Cornflakes met melk", "ontbijt", [("Cornflakes", "gram", 40, 30, _AV), ("Halfvolle melk", "ml", 200, 150, _AZ)]),
    ("Broodje ham-kaas", "lunch", [("Bruine bolletjes", "stuks", 2, 1, _AB), _BOTER, ("Achterham", "plak", 2, 1, _AM),
                                   ("Jong belegen kaas plakken", "plak", 2, 1, _AZ)]),
    ("Boterham met kipfilet", "lunch", [_BROOD, _BOTER, ("Gerookte kipfilet", "plak", 3, 2, _AM)]),
    ("Tosti ham-kaas", "lunch", [("Volkoren brood", "gram", 70, 70, _AB), ("Achterham", "plak", 1, 1, _AM),
                                 ("Jong belegen kaas plakken", "plak", 2, 1, _AZ)]),
    ("Broodje gezond", "lunch", [("Bruine bolletjes", "stuks", 2, 1, _AB), ("Jong belegen kaas plakken", "plak", 2, 1, _AZ),
                                 ("Achterham", "plak", 1, 1, _AM), ("Komkommer", "stuks", 0.15, 0.1, _AF), ("Tomaten", "stuks", 0.5, 0.5, _AF),
                                 ("IJsbergsla", "gram", 15, 10, _AF)]),
    ("Boterham met ei", "lunch", [_BROOD, _BOTER, ("Eieren", "stuks", 1, 1, _AZ)]),
    ("Crackers met smeerkaas", "lunch", [("Volkoren crackers", "gram", 40, 25, _AB), ("Smeerkaas", "gram", 30, 20, _AZ)]),
    ("Tomatensoep met stokbrood", "lunch", [("Tomatensoep", "ml", 300, 200, _AV), ("Afbakstokbrood", "stuks", 0.25, 0.15, _AB)]),
    ("Pannenkoeken met stroop", "lunch", [("Pannenkoekenmix", "gram", 100, 75, _AV), ("Halfvolle melk", "ml", 200, 150, _AZ),
                                          ("Eieren", "stuks", 1, 0.5, _AZ), ("Schenkstroop", "gram", 20, 20, _AV)]),
    ("Spaghetti bolognese", "avondeten", [("Spaghetti", "gram", 100, 70, _AV), ("Rundergehakt", "gram", 100, 60, _AM),
                                          ("Pastasaus", "ml", 125, 80, _AV), ("Uien", "stuks", 0.25, 0.15, _AF)]),
    ("Macaroni met ham en kaas", "avondeten", [("Macaroni", "gram", 100, 70, _AV), ("Hamblokjes", "gram", 75, 50, _AM),
                                               ("Pastasaus", "ml", 125, 80, _AV), ("Geraspte kaas", "gram", 30, 20, _AZ)]),
    ("Boerenkoolstamppot met rookworst", "avondeten", [("Kruimige aardappelen", "gram", 250, 150, _AF), ("Boerenkool", "gram", 200, 120, _AF),
                                                       ("Rookworst", "gram", 100, 60, _AM), ("Halfvolle melk", "ml", 50, 30, _AZ)]),
    ("Hutspot met gehaktbal", "avondeten", [("Kruimige aardappelen", "gram", 250, 150, _AF), ("Hutspotgroente", "gram", 200, 120, _AF),
                                            ("Gehaktballen", "stuks", 1, 1, _AM)]),
    ("Aardappelen, sperziebonen en kipfilet", "avondeten", [("Vastkokende aardappelen", "gram", 250, 150, _AF),
                                                             ("Sperziebonen", "gram", 150, 100, _AF), ("Kipfilet", "gram", 125, 75, _AM)]),
    ("Nasi goreng", "avondeten", [("Rijst", "gram", 75, 50, _AV), ("Nasi bami groente", "gram", 150, 100, _AF),
                                  ("Kipreepjes", "gram", 100, 60, _AM), ("Nasi kruiden", "gram", 10, 7, _AV)]),
    ("Bami goreng", "avondeten", [("Mie", "gram", 75, 50, _AV), ("Nasi bami groente", "gram", 150, 100, _AF),
                                  ("Kipreepjes", "gram", 100, 60, _AM), ("Ketjap manis", "ml", 15, 10, _AV)]),
    ("Wraps met gehakt", "avondeten", [("Wraps", "stuks", 2, 1, _AB), ("Rundergehakt", "gram", 100, 60, _AM), ("Taco kruiden", "gram", 10, 7, _AV),
                                       ("IJsbergsla", "gram", 30, 20, _AF), ("Geraspte kaas", "gram", 30, 20, _AZ)]),
    ("Pizza uit de oven", "avondeten", [("Diepvriespizza", "stuks", 0.5, 0.33, _AD)]),
    ("Hamburgers met sla", "avondeten", [("Hamburgers", "stuks", 1, 1, _AM), ("Hamburgerbroodjes", "stuks", 1, 1, _AB),
                                         ("IJsbergsla", "gram", 20, 10, _AF), ("Ketchup", "ml", 20, 15, _AV)]),
    ("Patat met frikandel", "avondeten", [("Friet", "gram", 200, 125, _AD), ("Frikandellen", "stuks", 2, 1, _AD),
                                          ("Mayonaise", "ml", 25, 15, _AV), ("Appelmoes", "gram", 100, 75, _AV)]),
    ("Kip met rijst en broccoli", "avondeten", [("Rijst", "gram", 75, 50, _AV), ("Broccoli", "gram", 150, 100, _AF),
                                                ("Kipfilet", "gram", 125, 75, _AM)]),
    ("Vissticks met puree en doperwten", "avondeten", [("Vissticks", "stuks", 4, 3, _AD), ("Kruimige aardappelen", "gram", 250, 150, _AF),
                                                        ("Doperwten", "gram", 100, 75, _AD)]),
    ("Erwtensoep met roggebrood", "avondeten", [("Erwtensoep", "ml", 400, 250, _AV), ("Roggebrood", "gram", 40, 20, _AB)]),
    ("Pasta pesto met groente", "avondeten", [("Penne", "gram", 100, 70, _AV), ("Groene pesto", "gram", 40, 25, _AV),
                                              ("Cherrytomaten", "gram", 75, 50, _AF), ("Spinazie", "gram", 75, 50, _AF)]),
    ("Appel of mandarijn", "snacks", [("Appels", "stuks", 1, 1, _AF)]),
    ("Plak ontbijtkoek", "snacks", [("Ontbijtkoek", "gram", 30, 25, _AB)]),
    ("Biscuitjes", "snacks", [("Biscuits", "gram", 20, 15, _AB)]),
    ("Chips", "snacks", [("Chips naturel", "gram", 30, 20, "Snacks & snoep")]),
    ("Groentelasagne", "avondeten", [("Lasagnebladen", "gram", 75, 50, _AV), ("Pastasaus", "ml", 150, 100, _AV),
                                     ("Courgette", "stuks", 0.3, 0.2, _AF), ("Geraspte kaas", "gram", 40, 25, _AZ)]),
]


STANDARD_DISHES = [
    ("Brood met beleg", "ontbijt", [
        ("Boterhammen", "stuks", 3, 2, "Brood & Banket"),
        ("Boter", "gram", 15, 10, "Zuivel & Eieren"),
        ("Hagelslag", "gram", 20, 25, "Snacks & Snoep"),
        ("Kaas", "plak", 2, 1, "Zuivel & Eieren"),
    ]),
    ("Yoghurt met muesli", "ontbijt", [
        ("Yoghurt", "ml", 200, 150, "Zuivel & Eieren"),
        ("Muesli", "gram", 50, 40, "Houdbaar"),
    ]),
    ("Krentenbollen", "ontbijt", [
        ("Krentenbollen", "stuks", 2, 1, "Brood & Banket"),
        ("Roomboter", "gram", 15, 10, "Zuivel & Eieren"),
    ]),
    ("Broodje gezond", "lunch", [
        ("Broodjes", "stuks", 2, 1, "Brood & Banket"),
        ("Kaas", "plak", 2, 1, "Zuivel & Eieren"),
        ("Komkommer", "stuks", 0.2, 0.1, "Groente & Fruit"),
        ("Tomaat", "stuks", 1, 0.5, "Groente & Fruit"),
    ]),
    ("Soep met stokbrood", "lunch", [
        ("Soep", "ml", 300, 200, "Houdbaar"),
        ("Stokbrood", "stuks", 0.3, 0.2, "Brood & Banket"),
    ]),
    ("Pannenkoeken", "lunch", [
        ("Pannenkoekenmix", "gram", 100, 75, "Houdbaar"),
        ("Melk", "ml", 150, 100, "Zuivel & Eieren"),
        ("Eieren", "stuks", 1, 0.5, "Zuivel & Eieren"),
    ]),
    ("Spaghetti Bolognese", "avondeten", [
        ("Spaghetti", "gram", 125, 75, "Houdbaar"),
        ("Gehakt", "gram", 125, 75, "Vlees & Vis"),
        ("Pastasaus", "ml", 150, 100, "Houdbaar"),
        ("Ui", "stuks", 0.25, 0.15, "Groente & Fruit"),
    ]),
    ("Macaroni", "avondeten", [
        ("Macaroni", "gram", 125, 75, "Houdbaar"),
        ("Gehakt", "gram", 100, 60, "Vlees & Vis"),
        ("Groentemix", "gram", 100, 75, "Groente & Fruit"),
        ("Tomatensaus", "ml", 150, 100, "Houdbaar"),
    ]),
    ("Nasi", "avondeten", [
        ("Rijst", "gram", 100, 70, "Houdbaar"),
        ("Nasikruiden", "gram", 10, 7, "Houdbaar"),
        ("Kipreepjes", "gram", 100, 60, "Vlees & Vis"),
        ("Roerbakgroente", "gram", 100, 75, "Groente & Fruit"),
    ]),
    ("Hamburgers", "avondeten", [
        ("Hamburgers", "stuks", 2, 1, "Vlees & Vis"),
        ("Hamburgerbroodjes", "stuks", 2, 1, "Brood & Banket"),
        ("Sla", "gram", 20, 15, "Groente & Fruit"),
        ("Ketchup", "ml", 20, 20, "Houdbaar"),
    ]),
    ("Patat met snack", "avondeten", [
        ("Patat", "gram", 250, 150, "Groente & Fruit"),
        ("Frikandel of kroket", "stuks", 2, 1, "Vlees & Vis"),
        ("Mayonaise", "ml", 25, 20, "Houdbaar"),
    ]),
    ("Chips", "snacks", [
        ("Chips", "gram", 50, 50, "Snacks & Snoep"),
    ]),
    ("Frisdrank", "snacks", [
        ("Frisdrank", "ml", 500, 400, "Dranken"),
    ]),
    ("Koekjes", "snacks", [
        ("Koekjes", "stuks", 2, 2, "Snacks & Snoep"),
    ]),
    ("Vers fruit", "snacks", [
        ("Appel of banaan", "stuks", 1, 1, "Groente & Fruit"),
    ]),
    ("Ranja", "snacks", [
        ("Ranja", "ml", 100, 150, "Dranken"),
    ]),
]


# Starter catalog: (name, aisle, unit, base_price in EUR for a typical pack/unit)
STARTER_PRODUCTS = [
    ("Brood (heel)", "Brood & Banket", "stuks", 1.49),
    ("Volkorenbrood", "Brood & Banket", "stuks", 1.69),
    ("Croissant", "Brood & Banket", "stuks", 0.60),
    ("Beschuit", "Brood & Banket", "pak", 1.15),
    ("Crackers", "Brood & Banket", "pak", 1.29),
    ("Melk (halfvol)", "Zuivel & Eieren", "liter", 1.19),
    ("Volle melk", "Zuivel & Eieren", "liter", 1.25),
    ("Yoghurt", "Zuivel & Eieren", "liter", 1.09),
    ("Vla", "Zuivel & Eieren", "liter", 1.39),
    ("Kaas (plakken)", "Zuivel & Eieren", "pak", 2.99),
    ("Roomboter", "Zuivel & Eieren", "pak", 2.19),
    ("Margarine", "Zuivel & Eieren", "pak", 1.49),
    ("Eieren", "Zuivel & Eieren", "stuks", 0.28),
    ("Hagelslag", "Houdbaar", "pak", 1.89),
    ("Pindakaas", "Houdbaar", "pot", 1.99),
    ("Jam", "Houdbaar", "pot", 1.59),
    ("Chocopasta", "Houdbaar", "pot", 2.49),
    ("Appel", "Groente & Fruit", "stuks", 0.45),
    ("Banaan", "Groente & Fruit", "stuks", 0.30),
    ("Sinaasappel", "Groente & Fruit", "stuks", 0.50),
    ("Tomaat", "Groente & Fruit", "stuks", 0.40),
    ("Komkommer", "Groente & Fruit", "stuks", 0.89),
    ("Sla (krop)", "Groente & Fruit", "stuks", 1.09),
    ("Ui", "Groente & Fruit", "stuks", 0.25),
    ("Paprika", "Groente & Fruit", "stuks", 0.75),
    ("Wortel", "Groente & Fruit", "kg", 1.19),
    ("Aardappel", "Groente & Fruit", "kg", 1.29),
    ("Gehakt", "Vlees & Vis", "kg", 7.49),
    ("Kipfilet", "Vlees & Vis", "kg", 8.99),
    ("Knakworst", "Vlees & Vis", "blik", 1.69),
    ("Hamburger", "Vlees & Vis", "stuks", 1.20),
    ("Spekreepjes", "Vlees & Vis", "pak", 1.99),
    ("Vissticks", "Vlees & Vis", "pak", 2.49),
    ("Pasta (spaghetti)", "Houdbaar", "pak", 1.29),
    ("Macaroni", "Houdbaar", "pak", 1.19),
    ("Rijst", "Houdbaar", "pak", 1.79),
    ("Pastasaus", "Houdbaar", "pot", 1.49),
    ("Tomatenblokjes", "Houdbaar", "blik", 0.79),
    ("Bruine bonen", "Houdbaar", "blik", 0.99),
    ("Mais", "Houdbaar", "blik", 0.89),
    ("Soep", "Houdbaar", "blik", 1.39),
    ("Bami/nasi groenten", "Houdbaar", "pak", 1.59),
    ("Ketchup", "Houdbaar", "fles", 1.79),
    ("Mayonaise", "Houdbaar", "fles", 1.99),
    ("Olie", "Houdbaar", "fles", 2.49),
    ("Suiker", "Houdbaar", "pak", 1.09),
    ("Thee", "Houdbaar", "pak", 1.69),
    ("Koffie", "Houdbaar", "pak", 3.99),
    ("Chips", "Snacks & Snoep", "zak", 1.49),
    ("Koekjes", "Snacks & Snoep", "pak", 1.39),
    ("Snoep (zak)", "Snacks & Snoep", "zak", 1.59),
    ("Chocolade (reep)", "Snacks & Snoep", "stuks", 1.19),
    ("Mueslireep", "Snacks & Snoep", "stuks", 0.45),
    ("Water (fles)", "Dranken", "liter", 0.45),
    ("Frisdrank (cola)", "Dranken", "liter", 1.09),
    ("Sinas", "Dranken", "liter", 1.09),
    ("Ranja (siroop)", "Dranken", "fles", 1.99),
    ("Appelsap", "Dranken", "liter", 1.19),
    ("Bier (krat)", "Dranken (alcohol)", "krat", 14.99),
    ("Wijn (fles)", "Dranken (alcohol)", "fles", 5.49),
    ("Borrelnootjes", "Borrelhapjes", "zak", 1.49),
    ("Kaasblokjes", "Borrelhapjes", "bak", 2.99),
    ("Worstjes (borrel)", "Borrelhapjes", "pak", 2.49),
    ("Toastjes", "Borrelhapjes", "pak", 1.29),
    ("Zoutjes", "Borrelhapjes", "zak", 1.19),
]



@app.on_event("startup")
async def startup():
    try:
        await _init_storage()
        logger.info("Object storage initialised")
    except Exception as e:
        logger.warning("Object storage init failed: %s", e)
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("ref_code", sparse=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.dishes.create_index("dish_id", unique=True)
    await db.camps.create_index("camp_id", unique=True)
    await db.invitations.create_index([("email", 1), ("camp_id", 1)], unique=True)
    await db.google_logins.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)
    # Accounts van voor het bijhouden van "laatst gezien": de twee jaar tellen vanaf nu
    await db.users.update_many({"last_seen_at": {"$exists": False}}, {"$set": {"last_seen_at": now_utc()}})

    # Rollen: dubbele opruimen (ontstonden doordat twee servers tegelijk opstartten)
    seen_names, seen_labels = {}, {}
    for r in await db.roles.find({}).sort("_id", 1).to_list(1000):
        label_key = _norm_text(r.get("label") or r["name"])
        keep = seen_names.get(r["name"]) or seen_labels.get(label_key)
        if keep:
            if keep["name"] != r["name"]:
                await db.users.update_many({"role": r["name"]}, {"$set": {"role": keep["name"]}})
            await db.roles.delete_one({"_id": r["_id"]})
            logger.info("Dubbele rol verwijderd: %s (%s), blijft: %s", r["name"], r.get("label"), keep["name"])
            continue
        seen_names[r["name"]] = r
        seen_labels[label_key] = r
    try:
        await db.roles.create_index("name", unique=True)
    except Exception as e:
        logger.warning("Index op rollen mislukt: %s", e)
    # Standaardrollen alleen de allereerste keer; daarna mag de beheerder ze aanpassen of verwijderen
    if not await db.settings.find_one({"key": "roles_seeded"}):
        for r in DEFAULT_ROLES:
            await db.roles.update_one({"name": r["name"]}, {"$setOnInsert": r}, upsert=True)
        await db.settings.update_one({"key": "roles_seeded"}, {"$set": {"value": True}}, upsert=True)
    await db.roles.update_one({"name": "beheerder"}, {"$setOnInsert": DEFAULT_ROLES[0]}, upsert=True)
    # Ensure beheerder keeps all permissions
    await db.roles.update_one({"name": "beheerder"}, {"$set": {"permissions": list(ALL_PERMISSIONS), "is_system": True}})
    # Backfill role on existing users, and seed the admin account
    # Eenmalig (okt 2026): alleen nog beheerder, medebeheerder en standaard gebruiker; alle anderen worden standaard gebruiker
    if not await db.settings.find_one({"key": "roles_v2"}):
        for r in DEFAULT_ROLES[1:]:
            await db.roles.update_one({"name": r["name"]}, {"$set": r}, upsert=True)
        keep = [r["name"] for r in DEFAULT_ROLES]
        moved = await db.users.update_many({"role": {"$nin": keep}}, {"$set": {"role": DEFAULT_ROLE}})
        gone = await db.roles.delete_many({"name": {"$nin": keep}})
        await db.settings.update_one({"key": "roles_v2"}, {"$set": {"value": True, "at": now_utc()}}, upsert=True)
        logger.info("Rollen opgeschoond: %d gebruikers naar standaard, %d rollen weg", moved.modified_count, gone.deleted_count)
    await db.users.update_many({"role": {"$exists": False}}, {"$set": {"role": DEFAULT_ROLE}})
    await db.users.update_many({"email": {"$in": ADMIN_SEED_EMAILS}}, {"$set": {"role": "beheerder"}})

    # Eenmalig: alle bestaande gerechten naar de prullenbak; daarna geen standaardgerechten meer aanmaken
    if not await db.settings.find_one({"key": "dishes_cleared"}):
        res = await db.dishes.update_many({"deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
        await db.settings.update_one({"key": "dishes_cleared"}, {"$set": {"value": True}}, upsert=True)
        logger.info("Alle %d bestaande gerechten verwijderd", res.modified_count)
    count = await db.dishes.count_documents({"is_standard": True})
    if count == 0 and not await db.settings.find_one({"key": "dishes_cleared"}):
        docs = []
        for name, category, ings in STANDARD_DISHES:
            docs.append({
                "dish_id": f"dish_{uuid.uuid4().hex[:12]}",
                "name": name,
                "category": category,
                "is_standard": True,
                "owner_id": None,
                "ingredients": [
                    {"name": n, "unit": u, "qty_adult": a, "qty_child": c, "aisle": ai}
                    for (n, u, a, c, ai) in ings
                ],
                "deleted_at": None,
                "created_at": now_utc(),
            })
        await db.dishes.insert_many(docs)
        logger.info("Seeded %d standard dishes", len(docs))

    # Gewone, betaalbare gerechten voor iedereen (eenmalig; producten zoekt de boodschappenlijst per winkel op naam)
    if not await db.settings.find_one({"key": "basic_dishes_v1"}):
        have = {d["name"] async for d in db.dishes.find({"basic": True}, {"_id": 0, "name": 1})}
        docs = [{"dish_id": f"dish_{uuid.uuid4().hex[:12]}", "name": name, "category": category, "is_standard": True, "basic": True,
                 "owner_id": None, "ingredients": [{"name": n, "unit": u, "qty_adult": a, "qty_child": c, "aisle": ai} for (n, u, a, c, ai) in ings],
                 "deleted_at": None, "created_at": now_utc()} for name, category, ings in BASIC_DISHES if name not in have]
        if docs:
            await db.dishes.insert_many(docs)
        await db.settings.update_one({"key": "basic_dishes_v1"}, {"$set": {"value": True, "at": now_utc()}}, upsert=True)
        logger.info("%d gewone gerechten toegevoegd", len(docs))

    await db.products.create_index("product_id", unique=True)
    await db.products.create_index("barcode")
    await db.product_submissions.create_index("psub_id", unique=True)
    pcount = await db.products.count_documents({"is_global": True})
    if pcount == 0:
        pdocs = []
        for name, aisle, unit, base in STARTER_PRODUCTS:
            prices = {s: round(base * STORE_MULT[s], 2) for s in STORES}
            pdocs.append({
                "product_id": f"prod_{uuid.uuid4().hex[:12]}",
                "name": name,
                "aisle": aisle,
                "unit": unit,
                "brand": None,
                "barcode": None,
                "prices": prices,
                "is_global": True,
                "owner_id": None,
                "deleted_at": None,
                "created_at": now_utc(),
            })
        await db.products.insert_many(pdocs)
        logger.info("Seeded %d starter products", len(pdocs))

    # Seed dynamic stores collection (incl. Dirk) + backfill any missing prices
    await db.store_requests.create_index("req_id", unique=True)
    await db.premium_requests.create_index("req_id", unique=True)
    await db.pantry.create_index([("user_id", 1), ("name_l", 1)])
    await db.price_history.create_index("product_id", unique=True)
    await db.price_alerts.create_index([("user_id", 1), ("product_id", 1)], unique=True)
    await db.premium_requests.create_index([("user_id", 1), ("created_at", -1)])
    for i, s in enumerate(STORES):
        await db.stores.update_one(
            {"name": s},
            {"$setOnInsert": {"name": s, "mult": STORE_MULT.get(s, 1.0), "active": True, "order": i}},
            upsert=True,
        )
    # Dubbele winkels (zelfde naam) opruimen: één document per naam
    seen_stores: set = set()
    all_stores = await db.stores.find({}, {"_id": 1, "name": 1, "order": 1}).to_list(500)
    all_stores.sort(key=lambda d: (d.get("name") not in COUPLED_STORES, d.get("order") or 0))
    for st in all_stores:
        key = (st.get("name") or "").strip().lower()
        if key in seen_stores:
            await db.stores.delete_one({"_id": st["_id"]})
        else:
            seen_stores.add(key)
    # Eenmalig: alleen Dirk en Albert Heijn blijven over
    if not await db.settings.find_one({"key": "stores_only_dirk_ah"}):
        await db.stores.update_many({"name": {"$nin": COUPLED_STORES}}, {"$set": {"active": False}})
        await db.users.update_many({"store": {"$nin": COUPLED_STORES}}, {"$set": {"store": "Dirk"}})
        await db.settings.insert_one({"key": "stores_only_dirk_ah", "done_at": now_utc()})
    # Gekoppelde winkels altijd actief (Jumbo is later toegevoegd)
    await db.stores.update_many({"name": {"$in": COUPLED_STORES}}, {"$set": {"active": True}})
    # Eenmalig: geschatte prijzen (via prijsfactor) weghalen, alleen echte winkelprijs bewaren
    if not await db.settings.find_one({"key": "prices_own_store_only"}):
        for idf, store in (("dirk_id", "Dirk"), ("ah_id", "Albert Heijn")):
            async for p in db.products.find({idf: {"$exists": True}}, {"_id": 0, "product_id": 1, "prices": 1}):
                own = (p.get("prices") or {}).get(store)
                await db.products.update_one({"product_id": p["product_id"]}, {"$set": {"prices": {store: own} if own else {}}})
        await db.settings.insert_one({"key": "prices_own_store_only", "done_at": now_utc()})
    active_stores = await db.stores.find({"active": True}, {"_id": 0}).to_list(200)
    logger.info("Stores ready: %d", len(active_stores))

    # De app heet nu Slim Boodschappenlijstje (zoals de website); een opgeslagen oude naam meenemen
    await db.settings.update_one({"key": "app", "app_name": "Boodschappenlijstje"}, {"$set": {"app_name": "Slim Boodschappenlijstje"}})
    # Migrate legacy department names -> new Dirk-style departments
    for old, new in OLD_AISLE_MAP.items():
        await db.products.update_many({"aisle": old}, {"$set": {"aisle": new}})
    async for d in db.dishes.find({"ingredients.aisle": {"$in": list(OLD_AISLE_MAP.keys())}}, {"_id": 0, "dish_id": 1, "ingredients": 1}):
        changed = False
        for ing in d.get("ingredients", []):
            if ing.get("aisle") in OLD_AISLE_MAP:
                ing["aisle"] = OLD_AISLE_MAP[ing["aisle"]]
                changed = True
        if changed:
            await db.dishes.update_one({"dish_id": d["dish_id"]}, {"$set": {"ingredients": d["ingredients"]}})
    logger.info("Department migration done")

    await _trash_orphans()
    await _purge_expired_trash()

    # Testsite (BACKGROUND_JOBS=0): zelfde database, maar prijsrondes en imports alleen op de echte site
    if os.environ.get("BACKGROUND_JOBS", "1") != "0":
        asyncio.create_task(_daily_refresh_loop())
        asyncio.create_task(_import_extra_terms())
    else:
        logger.info("Testsite: achtergrondtaken staan uit")
    asyncio.create_task(_global_products())  # productlijst alvast in het geheugen
    asyncio.create_task(_basic_dish_info_loop())
    if os.environ.get("BACKGROUND_JOBS", "1") == "0":
        asyncio.create_task(_ah_schema_probe())
    asyncio.create_task(_folders_fresh(wait=False))  # acties en folders ophalen
    asyncio.create_task(_log_product_counts())


async def _log_product_counts(wait: int = 15):
    await asyncio.sleep(wait)
    counts = {st: await db.products.count_documents({_id_field(st): {"$exists": True}, "deleted_at": None}) for st in COUPLED_STORES}
    logger.info("Producten per winkel: %s", counts)


# De volledige catalogus van AH en Jumbo komt nu mee met de dagelijkse prijsronde (die voegt nieuwe producten toe)
_heavy_lock = asyncio.Lock()  # nooit twee grote ophaalrondes tegelijk: scheelt geheugen en blokkades


async def _daily_refresh_loop():
    # Eens per dag alle prijzen bijwerken. Niet bij elke herstart opnieuw: dat kost veel geheugen en verzoeken,
    # dus we kijken wanneer de laatste ronde was.
    await asyncio.sleep(60)
    while True:
        try:
            doc = await db.settings.find_one({"key": "app"}, {"_id": 0, "dirk_refreshed_at": 1}) or {}
            last = doc.get("dirk_refreshed_at")
            if not last or (datetime.now(timezone.utc) - ensure_aware(last)).total_seconds() > 22 * 3600:
                async with _heavy_lock:
                    res = await _refresh_dirk_prices_all()
                logger.info("Daily Dirk refresh: %s", res)
                _invalidate_products()
                await _purge_expired_trash()
        except Exception as e:
            logger.warning("Daily Dirk refresh error: %s", e)
        try:
            # Eerste keer na de update: meteen een beginstand van de prijzen vastleggen
            if not await db.meta.find_one({"key": "hist_seeded"}):
                await db.meta.update_one({"key": "hist_seeded"}, {"$set": {"at": now_utc()}}, upsert=True)
                await _snapshot_prices()
        except Exception as e:
            logger.warning("Prijsgeschiedenis begin: %r", e)
        try:
            doc = await db.meta.find_one({"key": "inactive_check"}) or {}
            if not doc.get("at") or ensure_aware(doc["at"]) < now_utc() - timedelta(hours=22):
                await db.meta.update_one({"key": "inactive_check"}, {"$set": {"at": now_utc()}}, upsert=True)
                await _cleanup_inactive_users()
        except Exception as e:
            logger.warning("Inactieve accounts: %r", e)
        await asyncio.sleep(3600)


# ---------------------------------------------------------------------------
# Web frontend (Expo web export) served from the same address
# ---------------------------------------------------------------------------
from fastapi.responses import FileResponse

WEB_DIR = Path(os.environ.get("WEB_DIR", ROOT_DIR / "web")).resolve()


@app.get("/api/version", include_in_schema=False)
async def web_version():
    # Welke versie van de website er nu staat: verandert bij elke update (de app ziet dan "nieuwe versie")
    try:
        import hashlib
        return {"version": hashlib.sha1((WEB_DIR / "index.html").read_bytes()).hexdigest()[:12]}
    except OSError:
        return {"version": None}


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"ok": True}


_SCAN_RE = re.compile(r"(^|/)\.|\.(php\d?|env|bak|old|orig|save|swp|sql|sqlite|db|ini|cfg|conf|config|ya?ml|xml|json|log|asp|aspx|jsp|cgi|pl|sh|zip|tar|gz|rar|7z)(~)?$", re.I)


# Service worker: de website opent ook zonder internet (de app zelf bewaart de lijst op het toestel).
# Plaatjes en code met een vaste naam uit de cache, de pagina zelf eerst van internet en anders de bewaarde versie.
_SW_JS = """
const C = "slim-app-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.startsWith("/api/")) return;
  if (u.pathname.startsWith("/_expo/static/") || u.pathname.startsWith("/assets/")) {
    e.respondWith(caches.open(C).then((c) => c.match(r).then((hit) => hit || fetch(r).then((res) => {
      if (res.ok) c.put(r, res.clone());
      return res;
    }))));
  } else if (r.mode === "navigate") {
    e.respondWith(fetch(r).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(C).then((c) => c.put("/", copy)); }
      return res;
    }).catch(() => caches.match("/")));
  }
});
"""


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    return Response(_SW_JS, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_web(full_path: str):
    if full_path.startswith("api/") or not WEB_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Niet gevonden")
    target = (WEB_DIR / full_path).resolve()
    if not (full_path and target.is_file() and WEB_DIR in target.parents) and _SCAN_RE.search(full_path):
        # Bots zoeken naar .env, phpinfo.php e.d.: echte 404 in plaats van de app
        raise HTTPException(status_code=404, detail="Niet gevonden")
    if full_path and target.is_file() and WEB_DIR in target.parents:
        # Bestanden met een hash in de naam veranderen nooit: laat de browser ze bewaren, dan start de app een stuk sneller
        if full_path.startswith(("_expo/static/", "assets/")) or re.search(r"\.[0-9a-f]{16,}\.", full_path):
            return FileResponse(target, headers={"Cache-Control": "public, max-age=31536000, immutable"})
        return FileResponse(target)
    return HTMLResponse(_index_html(), headers={"Cache-Control": "no-cache"})


@functools.lru_cache(maxsize=1)
def _index_html() -> str:
    # Het icoon-lettertype meteen laten ophalen, anders zie je even lege vakjes in plaats van icoontjes
    html = (WEB_DIR / "index.html").read_text()
    links = "".join(f'<link rel="preload" href="/{f.relative_to(WEB_DIR).as_posix()}" as="font" type="font/ttf" crossorigin>'
                    for f in WEB_DIR.glob("assets/**/MaterialDesignIcons*.ttf"))
    sw = '<script>if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js"))</script>'
    return html.replace("</head>", links + sw + "</head>", 1)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
