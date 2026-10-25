from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, UploadFile, File
from fastapi.responses import Response, HTMLResponse, RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import itertools
import time
import uuid
import re
import secrets
import base64
import unicodedata
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from urllib.parse import urlencode
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
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "Boodschappenlijstje")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
EMAIL_FROM_ADDRESS = os.environ.get("EMAIL_FROM_ADDRESS", "onboarding@resend.dev")

ADMIN_SEED_EMAILS = ["jeroenvermond865@gmail.com"]
DEFAULT_ROLE = "leidingslid"
ALL_PERMISSIONS = ["manage_standard_dishes", "review_submissions", "manage_users", "manage_roles", "view_budget", "manage_budget", "manage_settings", "manage_products"]
DEFAULT_ROLES = [
    {"name": "beheerder", "label": "Beheerder", "permissions": list(ALL_PERMISSIONS), "is_system": True},
    {"name": "hoofdleiding", "label": "Hoofdleiding", "permissions": [], "is_system": True},
    {"name": "penningmeester", "label": "Penningmeester", "permissions": ["view_budget", "manage_budget"], "is_system": True},
    {"name": "leidingslid", "label": "Leidingslid", "permissions": [], "is_system": True},
    {"name": "kind", "label": "Kind", "permissions": [], "is_system": True},
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


async def create_session(user_id: str) -> str:
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
    return user


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str
    name: str


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


class DayInput(BaseModel):
    adults: int = 0
    children: int = 0
    is_shopping_day: bool = True
    meals: Dict[str, List[str]] = Field(default_factory=dict)
    extras: List[ExtraItem] = Field(default_factory=list)


class CampCreate(BaseModel):
    name: str
    days: List[DayInput]
    vega_adults: int = 0
    vega_children: int = 0
    general: List[ExtraItem] = Field(default_factory=list)
    budget_target: float = 0


class CampUpdate(BaseModel):
    name: Optional[str] = None
    days: Optional[List[DayInput]] = None
    vega_adults: Optional[int] = None
    vega_children: Optional[int] = None
    general: Optional[List[ExtraItem]] = None
    budget_target: Optional[float] = None


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api_router.post("/auth/register")
async def register(data: RegisterInput):
    if len(data.password) < 6:
        raise HTTPException(status_code=400, detail="Wachtwoord moet minstens 6 tekens zijn")
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
    }
    await db.users.insert_one(doc)
    await accept_invitations(doc)
    token = await create_session(user_id)
    return {"session_token": token, "user": public_user(doc)}


@api_router.post("/auth/login")
async def login(data: LoginInput):
    ident = data.identifier.lower().strip()
    user = await db.users.find_one({"$or": [{"email": ident}, {"username": ident}]})
    if not user or user.get("deleted_at") or not user.get("password_hash") or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Onjuiste inloggegevens")
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
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Wachtwoord moet minstens 6 tekens zijn")
    if user.get("password_hash"):
        if not data.current_password or not verify_password(data.current_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="Huidig wachtwoord is onjuist")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"password_hash": hash_password(data.new_password)}})
    return {"ok": True}


@api_router.post("/auth/forgot-password")
async def forgot_password(data: ForgotPassword):
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if user and user.get("password_hash"):
        code = str(uuid.uuid4().int)[:6]
        await db.password_resets.delete_many({"email": email})
        await db.password_resets.insert_one({"email": email, "code": code, "expires_at": now_utc() + timedelta(hours=1)})
        html = (
            '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
            f'<h2 style="color:#2E5E38;margin:0 0 12px">Wachtwoord opnieuw instellen</h2>'
            f'<p>Gebruik deze code in de Boodschappenlijstje-app om een nieuw wachtwoord in te stellen:</p>'
            f'<p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#2E5E38">{escape(code)}</p>'
            f'<p>De code is 1 uur geldig. Heb je dit niet aangevraagd? Negeer deze e-mail.</p>'
            f'<p style="font-size:12px;color:#888">Verstuurd door Boodschappenlijstje. We vragen nooit je wachtwoord via e-mail.</p>'
            '</td></tr></table>'
        )
        await send_email(email, "Je Boodschappenlijstje wachtwoord-resetcode", html)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(data: ResetPassword):
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Wachtwoord moet minstens 6 tekens zijn")
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
    return "://" in url


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
async def auth_session(data: SessionInput):
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


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Dishes
# ---------------------------------------------------------------------------
def dish_public(doc: dict) -> dict:
    return {
        "id": doc["dish_id"],
        "name": doc["name"],
        "category": doc["category"],
        "is_standard": doc.get("is_standard", False),
        "ingredients": doc.get("ingredients", []),
        "source": doc.get("source"),
        "pantry": doc.get("pantry") or [],
    }


@api_router.get("/dishes")
async def list_dishes(user: dict = Depends(get_current_user)):
    cursor = db.dishes.find(
        {
            "deleted_at": None,
            "$or": [{"is_standard": True}, {"owner_id": user["user_id"]}],
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
        }},
    )
    updated = await db.dishes.find_one({"dish_id": dish_id}, {"_id": 0})
    return dish_public(updated)


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
        })
    return days


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
    html = (
        '<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#1C1B1A">'
        f'<h2 style="color:#2E5E38;margin:0 0 12px">Uitnodiging voor Boodschappenlijstje</h2>'
        f'<p>{escape(user.get("name") or "Een leider")} nodigt je uit om samen te plannen in het kamp '
        f'<strong>{escape(camp["name"])}</strong>.</p>'
        f'<p>Maak een account aan met dit e-mailadres ({escape(email)}) en je wordt automatisch aan het kamp toegevoegd.</p>'
        f'<p style="margin:20px 0"><a href="{escape(link)}" style="background:#2E5E38;color:#fff;'
        f'padding:12px 20px;border-radius:10px;text-decoration:none;display:inline-block">Open Boodschappenlijstje</a></p>'
        f'<p style="font-size:12px;color:#888">Verstuurd door Boodschappenlijstje. We vragen nooit je wachtwoord via e-mail.</p>'
        '</td></tr></table>'
    )
    await send_email(email, "Je bent uitgenodigd voor een kamp in Boodschappenlijstje", html)
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


def _add_item(store_map: dict, store: str, name: str, unit: str, aisle: str, qty: float):
    if qty <= 0:
        return
    smap = store_map.setdefault(store, {})
    key = (name.lower(), unit)
    if key not in smap:
        smap[key] = {"name": name, "unit": unit, "aisle": aisle if aisle in AISLES else "Overig", "qty": 0}
    smap[key]["qty"] += qty


def _diet_counts(day: dict, camp: dict) -> dict:
    adults = day.get("adults", 0)
    children = day.get("children", 0)
    va = min(camp.get("vega_adults", 0) or 0, adults)
    vc = min(camp.get("vega_children", 0) or 0, children)
    return {"all": (adults, children), "vega": (va, vc), "meat": (adults - va, children - vc)}


@api_router.get("/camps/{camp_id}/shopping-list")
async def shopping_list(camp_id: str, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")

    active = await get_active_stores()
    primary_store = user.get("store", DEFAULT_STORE)
    if primary_store not in active:
        primary_store = active[0]

    def store_of(item: dict) -> str:
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

    for day in camp.get("days", []):
        if not day.get("is_shopping_day"):
            continue
        counts = _diet_counts(day, camp)
        day_store_map: Dict[str, dict] = {}
        for cat in MEAL_CATEGORIES:
            for did in day.get("meals", {}).get(cat, []):
                dish = dishes_by_id.get(did)
                if not dish:
                    continue
                for ing in dish.get("ingredients", []):
                    a, c = counts.get(ing.get("diet", "all"), counts["all"])
                    qty = ing.get("qty_adult", 0) * a + ing.get("qty_child", 0) * c
                    store = store_of(ing)
                    for tgt in (total_store_map, day_store_map):
                        _add_item(tgt, store, ing["name"], ing.get("unit", "stuks"), ing.get("aisle", "Overig"), qty)
        for ex in day.get("extras", []):
            store = store_of(ex)
            for tgt in (total_store_map, day_store_map):
                _add_item(tgt, store, ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), ex.get("qty", 0))
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
            _add_item(tgt, store, ex["name"], ex.get("unit", "stuks"), ex.get("aisle", "Overig"), ex.get("qty", 0))

    def pack(store_map: dict) -> list:
        out = []
        for store in sorted(store_map.keys()):
            flat, grouped = _group_items(store_map[store])
            out.append({"store": store, "grouped": grouped, "flat": flat})
        return out

    by_store = pack(total_store_map)
    general = pack(general_store_map)
    stores = sorted(total_store_map.keys())
    return {
        "by_store": by_store,
        "general": general,
        "per_day": per_day,
        "stores": stores,
        "multi_store": len(stores) > 1,
    }


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
    prod_docs = await db.products.find({"product_id": {"$in": list(prod_ids)}}, {"_id": 0}).to_list(5000)
    products_by_id = {p["product_id"]: p for p in prod_docs}

    def unit_price(item: dict, store: str) -> float:
        pid = item.get("product_id")
        if pid and pid in products_by_id:
            p = products_by_id[pid]
            return resolve_price(p.get("prices", {}), store, p.get("unavailable", []))
        return item.get("price", 0) or 0

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
                    a, c = counts.get(ing.get("diet", "all"), counts["all"])
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
    if len(data.new_password) < 6:
        raise HTTPException(status_code=400, detail="Wachtwoord moet minstens 6 tekens zijn")
    target = await db.users.find_one({"user_id": target_id})
    if not target:
        raise HTTPException(status_code=404, detail="Gebruiker niet gevonden")
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
PRODUCT_CACHE_SECONDS = 1800
_product_cache: dict = {"at": None, "docs": [], "stale": True, "task": None}
_search_cache: dict = {}


def _invalidate_products() -> None:
    _product_cache["stale"] = True
    _search_cache.clear()
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


async def _load_products() -> None:
    try:
        cutoff = now_utc() - timedelta(days=ASSORTMENT_GRACE_DAYS)
        docs = await db.products.find({"deleted_at": None, "is_global": True,
                                       "$or": [{"missing_since": None}, {"missing_since": {"$gt": cutoff}}]}, {"_id": 0}).to_list(None)
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
        _product_cache["by_sid"] = {(d["_src"], str(d.get("dirk_id") or d.get("ah_id") or d.get("jumbo_id"))): d
                                    for d in docs if d.get("_src")}
        _product_cache["at"] = datetime.now(timezone.utc)
        _search_cache.clear()
        missing: Dict[str, list] = {}
        for d in docs:
            if not d.get("brand"):
                missing.setdefault(d.get("_src") or "-", []).append(d["name"])
        logger.info("Productlijst geladen: %d producten; zonder merk: %s", len(docs),
                    {k: (len(v), v[:12]) for k, v in missing.items()})
    except Exception as e:
        logger.warning("Productlijst laden mislukt: %s", e)


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


def _facet(docs: list, field: str, top: int = 60) -> list:
    counts: Dict[str, int] = {}
    for d in docs:
        v = (d.get(field) or "").strip()
        if v:
            counts[v] = counts.get(v, 0) + 1
    items = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))[:top]
    return [{"value": k, "count": n} for k, n in items]


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
        docs = _search_products(docs, q)

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
        {"key": "sub", "label": "Soort", "options": _facet([d for d in docs if keep(d, "sub")], "subcategory")},
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
    key = (source, aisle, _norm_text(q), sub, brand, offer, bio, sort,
           tuple(sorted(favs)) if favorites else None, user["user_id"] if own else None)
    hit = _search_cache.get(key)
    if hit is None:
        hit = _run_search(own + (await _global_products()) if own else await _global_products(),
                          q, source, aisle, favs if favorites else None, sub, brand, offer, bio, sort, store)
        if len(_search_cache) > 60:
            _search_cache.pop(next(iter(_search_cache)))
        _search_cache[key] = hit
    docs, aisle_counts, facets = hit

    offset = max(0, offset)
    limit = max(1, min(limit, 200))
    page = docs[offset:offset + limit]
    return {
        "products": [product_public(_clean(d), store, user["user_id"], favs) for d in page],
        "total": len(docs),
        "next_offset": offset + limit if offset + limit < len(docs) else None,
        "aisle_counts": aisle_counts,
        "facets": facets,
    }


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
                          "image": it.get("image") or (first or {}).get("image"),
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
    return {"store": store, "stores": list(COUPLED_STORES), "periods": periods, "loading": f["at"] is None,
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
    return product_public(doc, user.get("store", DEFAULT_STORE), user["user_id"], favs)


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
OFF_HEADERS = {"User-Agent": "Boodschappenlijstje/1.0 (scoutkook app)"}


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
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
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
        img = o.get("image") or ""
        if not img:
            # Niet elke actie heeft een eigen foto; neem dan die van het eerste product
            img = next((p["productInformation"].get("image") for p in o.get("products") or []
                        if isinstance(p, dict) and isinstance(p.get("productInformation"), dict) and p["productInformation"].get("image")), "") or ""
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


async def _jumbo_folder() -> list:
    # Jumbo: acties komen mee met de producten (bij import en de dagelijkse update)
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
    for store, fn in (("Albert Heijn", _ah_folder), ("Dirk", _dirk_folder), ("Jumbo", _jumbo_folder)):
        try:
            data[store] = await fn()
        except Exception as e:
            logger.warning("Folder %s mislukt: %r", store, e)
            data[store] = (_folders["data"] or {}).get(store) or []
        for per in data[store]:
            for it in per["items"]:
                for i in it["ids"]:
                    by_id.setdefault((store, i), []).append(it)
    _folders.update({"at": datetime.now(timezone.utc), "data": data, "by_id": by_id})
    _search_cache.clear()
    logger.info("Folders geladen: %s", {k: [len(p["items"]) for p in v] for k, v in data.items()})


async def _folders_fresh(wait: bool = True) -> dict:
    f = _folders
    old = f["at"] is None or (datetime.now(timezone.utc) - f["at"]).total_seconds() > FOLDER_REFRESH_SECONDS
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
    out.sort(key=lambda r: r["title"].lower())
    logger.info("Dirk: %d recepten", len(out))
    if out:
        _rc_set("dirk_all", out)
    return out


def _dirk_matches(r: dict, filters: dict, skip: Optional[str] = None) -> bool:
    for k, vals in filters.items():
        if k == skip or not vals:
            continue
        have = {"gang": r["_courses"], "keuken": r["_kitchens"], "tag": r["_tags"],
                "dieet": ["Vegetarisch"] if r["_veg"] else []}.get(k)
        if k == "tijd":
            if not r["time"] or r["time"] > max(int(v) for v in vals):
                return False
        elif have is not None and not any(v in have for v in vals):
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
            if _dirk_matches(r, filters, skip=key):
                for v in r[field]:
                    counts[v] = counts.get(v, 0) + 1
        for v in filters.get(key) or []:
            counts.setdefault(v, 0)
        if counts:
            facets.append({"key": key, "label": label, "multi": True,
                           "values": [{"value": v, "label": v, "count": n} for v, n in sorted(counts.items(), key=lambda kv: -kv[1])]})
    nveg = sum(1 for r in base if r["_veg"] and _dirk_matches(r, filters, skip="dieet"))
    facets.append({"key": "dieet", "label": "Dieet", "multi": False, "values": [{"value": "Vegetarisch", "label": "Vegetarisch", "count": nveg}]})
    facets.append({"key": "tijd", "label": "Bereidingstijd", "multi": False, "values": [{"value": v, "label": l, "count": None} for v, l in COMMON_TIMES]})
    chunk = hits[page * size:(page + 1) * size]
    return {"recipes": [{k: v for k, v in r.items() if not k.startswith("_")} for r in chunk], "total": len(hits),
            "facets": facets, "has_more": (page + 1) * size < len(hits)}


_RECIPE_SOURCES = {"ah": _ah_recipes, "jumbo": _jumbo_recipes, "dirk": _dirk_recipes}


async def _store_recipes(store: str, q: str, filters: dict, page: int, size: int) -> dict:
    import json as _json
    key = ("search", store, q, _json.dumps(filters, sort_keys=True), page, size)
    hit = _rc_get(key, 3600)
    if hit is not None:
        return hit
    return _rc_set(key, await _RECIPE_SOURCES[store](q, filters, page, size))


@api_router.get("/recipes/search")
async def search_recipes(q: str = "", store: str = "all", page: int = 0, filters: str = "{}", user: dict = Depends(get_current_user)):
    import json as _json
    try:
        flt = {str(k): [str(x) for x in v] for k, v in (_json.loads(filters or "{}") or {}).items() if isinstance(v, list) and v}
    except Exception:
        flt = {}
    q = (q or "").strip()[:80]
    page = max(0, min(page, 200))
    if store in _RECIPE_SOURCES:
        try:
            return await _store_recipes(store, q, flt, page, RECIPE_PAGE)
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
                         "product": {"store": "Dirk", "sid": str(p["productId"])} if p.get("productId") else None})
        steps = []
        for s in r.get("steps") or []:
            steps.append(s if isinstance(s, str) else (s.get("description") or s.get("text") or "") if isinstance(s, dict) else "")
        names = lambda k: [t.get("name") for t in r.get(k) or [] if isinstance(t, dict) and t.get("name")]
        img = r.get("filename")
        out = {"id": rid, "store": "dirk", "title": r["title"].strip(), "description": r.get("metaDescription"),
               "image": (DIRK_IMAGE_BASE + img.lstrip("/")) if img else None, "time": _iso_minutes(r.get("preparationTime")),
               "servings": r.get("persons"), "tags": names("courses") + names("kitchens") + names("tags") + (["Vegetarisch"] if r.get("vegetarian") else []),
               "kcal": None, "ingredients": ings, "steps": [s for s in steps if s], "tip": r.get("tip"),
               "url": f"https://www.dirk.nl/meer/recepten/recept/{key}"}
    else:
        raise HTTPException(status_code=404, detail="Recept niet gevonden")
    return _rc_set(("detail", rid), out)


_FILLER = {"middelgrote", "grote", "kleine", "verse", "vers", "milde", "mild", "ongezouten", "gezouten", "friszoete", "zoete", "rijpe",
           "biologische", "bio", "fijne", "grove", "geraspte", "gehakte", "gesneden", "gedroogde", "gedroogd", "diepvries", "naturel",
           "halfvolle", "volle", "magere", "witte", "rode", "gele", "groene", "zwarte", "stevige", "kruimige", "vastkokende", "jonge",
           "oude", "belegen", "extra", "vierge", "koude", "warme", "lauwe", "zachte", "harde", "uitgelekte", "gekookte", "teentje", "tenen"}


def _stems(w: str) -> list:
    # appels -> appel, uien -> ui, worstjes -> worst, tomaten -> tomaat (ruw, maar genoeg om te zoeken)
    out = [w]
    for suf, rep in (("jes", ""), ("tjes", ""), ("en", ""), ("s", ""), ("ten", "t"), ("aten", "aat"), ("ien", "i"), ("eren", "eer"), ("ven", "f"), ("zen", "s"), ("aatjes", "at")):
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            out.append(w[: -len(suf)] + rep)
    if len(w) >= 4 and w.endswith("f"):
        out.append(w[:-1] + "v")  # olijf -> olijv(en)
    return list(dict.fromkeys(out))


_PREPS = {"zonder", "met", "in", "uit", "van", "voor", "op", "naar", "of", "en", "à", "a", "ca", "circa", "om"}


# Andere namen in de winkel: "lasagnevel" heet daar lasagnebladen, parmezaan vaak Parmigiano
_SYNONYMS = {"lasagnevel": ["lasagnebladen", "lasagne"], "lasagnevellen": ["lasagnebladen", "lasagne"],
             "parmezaanse kaas": ["parmigiano reggiano", "grana padano", "parmezaan"], "parmezaan": ["parmigiano reggiano", "grana padano"],
             "creme fraiche": ["creme fraiche", "zure room"], "zalmfilet": ["zalm"], "kipfilet": ["kipfilet", "kip"],
             "lente ui": ["bosui"], "lenteui": ["bosui"], "sjalot": ["sjalotten", "sjalot"], "rucola": ["rucola", "rucolasla"]}


def _best_matches(pool: list, name: str, limit: int = 1) -> list:
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
    for syn in _SYNONYMS.get(" ".join(core), []) + _SYNONYMS.get(core[-1], []):
        levels.append((syn.split(), 1.2))
    # "parmezaanse kaas": liever parmezaan dan zomaar kaas
    for w in core[:-1]:
        for suf in ("sche", "se"):
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                levels.append(([w[: -len(suf)]], 1.6))
    levels.append((core[-1:], 1.2 if len(core) == 1 else 4))
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
    return [d for _, d in sorted(best.values(), key=lambda x: x[0])][:limit]


_NONFOOD = {"Huishoud & huisdieren", "Kind & drogisterij", "Non food"}
_CANDY_RE = re.compile(r"\b(snoep|drop|winegum|spekjes|chips|koek|koekjes|chocolade|lolly|kauwgom)\b")
# Bewerkte producten: "ciabatta" is geen ciabatta-cracker, "citroen" geen citroenkoek, "olijf" geen tapenade
_PROCESSED = ("koek", "cracker", "tapenade", "azijn", "saus", "chips", "spread", "sap", "drank", "siroop", "thee", "snoep", "taart", "cake",
              "smaak", "kimchi", "dressing", "soep", "salade", "pasta", "toast", "wafel", "reep", "ijs", "yoghurt", "kwark", "vla", "limonade",
              "frisdrank", "bier", "radler", "likeur", "zeep", "geur", "poeder", "aroma", "pesto", "dip", "smeer", "mix", "kruiden", "biscuit",
              "kroket", "salami", "worst", "honing", "kogel", "zuurkool", "snack", "bonbon", "brandewijn", "jenever", "mayo", "ketchup")
# Woorden die alleen iets over het product zeggen ("citroenen verpakt", "kaas plakken")
_DESCRIPTORS = {"verpakt", "los", "geschild", "gesneden", "geraspt", "plakken", "plakjes", "blokjes", "reepjes", "schijfjes", "zwart", "wit",
                "rood", "groen", "geel", "bio", "biologisch", "biologische", "naturel", "kruimig", "vastkokend", "s", "m", "l", "xl", "kanjers",
                "vrije", "uitloop", "scharrel", "per", "kilo", "stuk", "zak", "bak", "pot", "blik", "fles", "flessen", "pak", "pack", "voordeel",
                "voordeelverpakking", "mini", "groot", "klein", "heel", "halve", "stukjes", "diepvries", "vers", "extra", "fijn", "grof"}
_STORE_WORDS = {"ah", "jumbo", "dirk", "1 de beste", "excellent", "biologisch"}


def _food_penalty(d: dict, rank: int, words: list) -> float:
    # Een recept vraagt om eten: "citroen" is geen afwasmiddel, "aardbeien" geen snoep, "ui" liever uien dan bosui of gehakt met ui
    name = d["_norm"]
    brand = _norm_text(d.get("brand") or "")
    if brand and name.startswith(brand + " "):
        name = name[len(brand) + 1:]
    for sw in _STORE_WORDS:
        if name.startswith(sw + " "):
            name = name[len(sw) + 1:]
    nw = [w for w in name.split() if not re.fullmatch(r"[\d.,%]+|\d+\w{0,3}|x|st|stuks?|kg|g|gram|ml|cl|l|liter", w)] or name.split()
    qstems = {st for q in words for st in _stems(q)}

    def related(w):
        return any(w == q or w in _stems(q) or q in _stems(w) or q in w or (q.endswith("e") and w == q[:-1]) for q in words)

    # Positie van het gezochte woord; in het Nederlands zit het hoofdwoord achteraan ("tarwebloem" is bloem, "bloemkool" niet)
    def place(q):
        best = None
        for k, w in enumerate(nw):
            if w == q or w in _stems(q) or q in _stems(w):
                v = k
            elif w.endswith(q) or any(w.endswith(st) for st in _stems(q) if len(st) >= 3):
                v = 3 + k + (1 if len(w) - len(q) > 6 else 0)
            elif w.startswith(q):
                v = 8 + k
            else:
                continue
            best = v if best is None else min(best, v)
        return best
    # Het laatste zoekwoord is het hoofdwoord ("witte wijn" is wijn, geen wijnazijn)
    head = place(words[-1])
    pos = head if head is not None else min((p for p in map(place, words) if p is not None), default=11) + 3
    pen = rank * 0.01 + pos
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
        else:
            pen += 0.7
    if any(x in w and not related(w) and not any(x in q for q in qstems) for w in nw for x in _PROCESSED):
        pen += 5
    if d.get("aisle") in _NONFOOD:
        pen += 30
    if d.get("aisle") == "Snacks & snoep" and not any(_CANDY_RE.search(q) for q in words):
        pen += 8
    if d.get("aisle") == "Dranken, sap, koffie & thee" and not any(q in ("sap", "melk", "wijn", "bier", "koffie", "thee", "water") for q in words):
        pen += 6
    return pen


def _rank_food(hits: list, words: list) -> list:
    return [d for _, d in sorted(enumerate(hits), key=lambda rd: _food_penalty(rd[1], rd[0], words))]


def _store_matches(names: list, docs: list, store: str) -> dict:
    # Ingrediënten zonder gekoppeld product: zoek het best passende product in dezelfde winkel
    pool = [d for d in docs if d.get("_src") == store and d.get("is_global")]
    out = {}
    for n in names:
        if _norm_text(n) in ("water", "kraanwater", "lauw water", "kokend water", "ijsblokjes"):
            continue
        hits = _best_matches(pool, n)
        if hits:
            out[n] = hits[0]
    return out


# Dingen die de meeste mensen al in huis hebben (kruiden, olie, basis)
_PANTRY_RE = re.compile(r"\b(zout|peper|zeezout|olie|olijfolie|zonnebloemolie|azijn|suiker|bloem|maizena|bakpoeder|water|kraanwater|\w*bouillon\w*|"
                        r"\w*kruiden\w*|specerij\w*|paprikapoeder|komijn\w*|kurkuma|kerrie\w*|currypoeder|kaneel|nootmuskaat|oregano|tijm|rozemarijn|"
                        r"basilicum gedroogd|laurier\w*|chilivlokken|chilipoeder|cayennepeper|knoflookpoeder|uienpoeder|italiaanse kruiden|"
                        r"provencaalse kruiden|mosterd|ketjap|sojasaus|honing|vanille\w*|boter|roomboter|bakboter|margarine|kipkruiden|gehaktkruiden)\b")


_ALWAYS_HOME = {"water", "kraanwater", "lauw water", "kokend water", "zout", "peper", "zout en peper", "peper en zout", "ijsblokjes"}


def _is_pantry(name: str) -> bool:
    return bool(_PANTRY_RE.search(_norm_text(name)))


def _recipe_with_products(rec: dict, user: dict, matches: Optional[dict] = None) -> dict:
    by_sid = _product_cache.get("by_sid") or {}
    favs = set(user.get("favorite_products") or [])
    ings = []
    for i in rec["ingredients"]:
        p = i.get("product")
        site_linked = bool(p) or bool(i.get("site_linked"))
        doc = by_sid.get((p["store"], p["sid"])) if p else None
        if doc is None and (matches or {}).get(i["name"]) is not None:
            doc = matches[i["name"]]
            p = {"store": doc["_src"]}
        # Niet door de site gekoppeld (of typisch voorraadkast): waarschijnlijk al in huis
        pantry = (not site_linked and (rec["store"] != "ah" or _is_pantry(i["name"]))) or _norm_text(i["name"]) in _ALWAYS_HOME
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
    return await _recipe_products(rec, user)


async def _recipe_products(rec: dict, user: dict) -> dict:
    docs = await _global_products()
    matches = _rc_get(("match", rec["id"]), 6 * 3600)
    if matches is None:
        by_sid = _product_cache.get("by_sid") or {}
        missing = [i["name"] for i in rec["ingredients"] if not (i.get("product") and (i["product"]["store"], i["product"]["sid"]) in by_sid)]
        matches = _rc_set(("match", rec["id"]), await asyncio.to_thread(_store_matches, missing, docs, STORE_LABELS[rec["store"]]) if missing else {})
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


async def _selftest2() -> None:
    # Tijdelijk: alternatieven, voorraadkast en Dirk-actieprijzen controleren
    await asyncio.sleep(45)
    try:
        docs = await _global_products()
        for st in ("Albert Heijn", "Jumbo", "Dirk"):
            pool = [d for d in docs if d.get("_src") == st and d.get("is_global")]
            for q in ("middelgrote ui", "citroen", "parmezaanse kaas", "witte wijn", "ciabatta", "zwarte olijf zonder pit", "bloem", "eieren", "lasagnevel", "knoflook"):
                logger.info("Stest match %s %r: %s", st, q, [d["name"] for d in _best_matches(pool, q, 3)])
        for rid in ("ah-1302917", "dirk-aardbeien-caprese", "dirk-aspergesoep", "ah-1302830"):
            rec = await _recipe_products(await _recipe_detail(rid), {"user_id": "x"})
            logger.info("Stest recept %s: %s", rid, [(i["name"], i["pantry"], (i["product"] or {}).get("name")) for i in rec["ingredients"]])
    except Exception as e:
        logger.warning("Stest: %r", e)


class RecipeImport(BaseModel):
    id: str
    category: str = "avondeten"
    include: List[int] = []


async def _recipe_to_dish(rid: str, category: str, user: dict, reuse: bool = False, include: Optional[List[int]] = None) -> dict:
    if category not in MEAL_CATEGORIES:
        raise HTTPException(status_code=400, detail="Ongeldige categorie")
    rec = await _recipe_products(await _recipe_detail(rid), user)
    if reuse:
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
           "deleted_at": None, "created_at": now_utc()}
    await db.dishes.insert_one(doc)
    return doc


@api_router.post("/recipes/import")
async def import_recipe(data: RecipeImport, user: dict = Depends(get_current_user)):
    return dish_public(await _recipe_to_dish(data.id, data.category, user, include=data.include))


class RecipeToCamp(BaseModel):
    id: str
    camp_id: str
    day_index: int
    category: str
    include: List[int] = []


@api_router.post("/recipes/add-to-camp")
async def recipe_to_camp(data: RecipeToCamp, user: dict = Depends(get_current_user)):
    camp = await db.camps.find_one({"camp_id": data.camp_id, **camp_access_filter(user["user_id"])}, {"_id": 0})
    if not camp:
        raise HTTPException(status_code=404, detail="Kamp niet gevonden")
    days = camp.get("days") or []
    if not 0 <= data.day_index < len(days):
        raise HTTPException(status_code=400, detail="Die dag bestaat niet in dit kamp")
    dish = await _recipe_to_dish(data.id, data.category, user, reuse=True, include=data.include)
    meals = days[data.day_index].setdefault("meals", {})
    lst = meals.setdefault(data.category, [])
    if dish["dish_id"] not in lst:
        lst.append(dish["dish_id"])
    await db.camps.update_one({"camp_id": data.camp_id}, {"$set": {"days": days}})
    return {"ok": True, "dish": dish_public(dish)}


# --- Home: overzicht met je kamp, acties, recepten en een prijsvergelijking ---
_home_cache: dict = {}
COMPARE_STORES = ["Albert Heijn", "Jumbo", "Dirk"]


def _compare_stores(names: list, docs: list) -> list:
    # Per winkel: wat kost één verpakking van de best passende product per ingrediënt
    by_store: dict = {s: [] for s in COMPARE_STORES}
    for d in docs:
        if d.get("_src") in by_store and d.get("is_global"):
            by_store[d["_src"]].append(d)
    out = []
    for s, cands in by_store.items():
        total, found = 0.0, 0
        for n in names:
            hits = _search_products(cands, n)[:1]
            if hits:
                price = resolve_price(hits[0].get("prices") or {}, s, hits[0].get("unavailable") or [])
                if price:
                    total += price
                    found += 1
        out.append({"store": s, "total": round(total, 2), "found": found, "count": len(names)})
    return out


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
                    img = it.get("image") or (docs[0].get("image") if docs else None)
                    if not img or not docs:
                        continue
                    items.append({"store": s, "title": it["title"], "label": it["label"], "image": img,
                                  "price": it.get("price"), "regular": it.get("regular"),
                                  "product_ids": [d["product_id"] for d in docs], "end": it.get("end")})
            import random
            random.shuffle(items)
            per_store.append(items[:6])
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
    return promos[:12], recipes


@api_router.get("/home")
async def home(user: dict = Depends(get_current_user)):
    perms = await user_permissions(user)
    camps = await db.camps.find(camp_access_filter(user["user_id"]), {"_id": 0}).sort("created_at", -1).to_list(50)
    camp = None
    compare = None
    if camps:
        c = camps[0]
        dish_ids = {did for day in c.get("days", []) for cat in MEAL_CATEGORIES for did in (day.get("meals") or {}).get(cat, [])}
        dishes = await db.dishes.find({"dish_id": {"$in": list(dish_ids)}}, {"_id": 0, "dish_id": 1, "name": 1, "ingredients": 1}).to_list(500)
        names = {}
        for d in dishes:
            for i in d.get("ingredients") or []:
                if i.get("name"):
                    names.setdefault(_norm_text(i["name"]), i["name"])
        for day in c.get("days", []):
            for e in day.get("extras") or []:
                if e.get("name"):
                    names.setdefault(_norm_text(e["name"]), e["name"])
        for e in c.get("general") or []:
            if e.get("name"):
                names.setdefault(_norm_text(e["name"]), e["name"])
        days = c.get("days", [])
        camp = {"id": c["camp_id"], "name": c["name"], "days": len(days),
                "max_people": max((d.get("adults", 0) + d.get("children", 0) for d in days), default=0),
                "shopping_days": sum(1 for d in days if d.get("is_shopping_day")),
                "meals_planned": sum(len((d.get("meals") or {}).get(cat, [])) for d in days for cat in MEAL_CATEGORIES),
                "products": len(names), "other_camps": len(camps) - 1}
        if names:
            key = ("compare", tuple(sorted(names))[:40])
            hit = _home_cache.get(key)
            if hit and time.time() - hit[0] < 1800:
                compare = hit[1]
            else:
                docs = await _global_products()
                compare = await asyncio.to_thread(_compare_stores, [names[k] for k in sorted(names)][:40], docs)
                _home_cache[key] = (time.time(), compare)
    hit = _home_cache.get("inspiration")
    if hit and time.time() - hit[0] < 600:
        promos, recipes = hit[1]
    else:
        promos, recipes = await _home_inspiration()
        if promos or recipes:
            _home_cache["inspiration"] = (time.time(), (promos, recipes))
    todo = {}
    if "review_submissions" in perms:
        todo["dishes"] = await db.submissions.count_documents({"status": "pending"})
    if "manage_products" in perms:
        todo["products"] = len(await _pending_product_subs())
    if "manage_settings" in perms:
        todo["stores"] = await db.store_requests.count_documents({"status": "pending"})
    own_dishes = await db.dishes.count_documents({"owner_id": user["user_id"], "deleted_at": None})
    return {"name": (user.get("name") or "").split(" ")[0], "camp": camp, "compare": compare, "promos": promos,
            "recipes": recipes, "todo": todo, "own_dishes": own_dishes}


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
]

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


async def _import_all_ah(mults: dict) -> int:
    existing = {str(p["ah_id"]) async for p in db.products.find({"ah_id": {"$exists": True}, "deleted_at": None}, {"_id": 0, "ah_id": 1})}
    added = 0
    async with httpx.AsyncClient(timeout=30, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
        for n, term in enumerate(DIRK_ALL_TERMS, 1):
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
                await _set_import_status(status=f"Albert Heijn ({n}/{len(DIRK_ALL_TERMS)})", added_ah=added)
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


async def _ah_ids_for_ean(client, headers: dict, ean: str) -> list:
    try:
        r = await client.get(f"https://api.ah.nl/mobile-services/product/search/v1/gtin/{ean}", headers=headers)
        if r.status_code != 200 or not r.text.strip():
            return []
        return [str(i) for i in _find_key(r.json(), "webshopId")][:3]
    except Exception:
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
        logger.info("Barcodes klaar: %d Dirk, %d AH gekoppeld, %d producten met barcode", found_dirk, found_ah, total)
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
    prods = await db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0}).to_list(None)
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
    prods = await db.products.find({"ah_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0}).to_list(None)
    if not prods:
        return 0
    updated = 0
    seen, gone = [], []
    async with httpx.AsyncClient(timeout=30, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
        for p in prods:
            try:
                r = await c.get(f"https://api.ah.nl/mobile-services/product/detail/v4/fir/{p['ah_id']}", headers=H)
                if r.status_code == 401:
                    tok = await _ah_token(c)
                    H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
                    r = await c.get(f"https://api.ah.nl/mobile-services/product/detail/v4/fir/{p['ah_id']}", headers=H)
                if r.status_code == 404:
                    gone.append(p["product_id"])
                    continue
                card = (r.json() or {}).get("productCard") or {}
            except Exception:
                continue
            n = _ah_normalize(card)
            if card and card.get("orderAvailabilityStatus") in ("OUT_OF_ASSORTMENT", "DELISTED"):
                gone.append(p["product_id"])
                continue
            if not n or not n["price"]:
                continue
            await db.products.update_one({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Albert Heijn", n, mults)})
            seen.append(p["product_id"])
            updated += 1
    await _mark_assortment(seen, gone)
    return updated


async def _refresh_jumbo_prices(mults: dict) -> int:
    # Jumbo heeft geen losse productopvraag meer: dezelfde zoektermen opnieuw doorlopen
    prods = {str(p["jumbo_id"]): p for p in await db.products.find({"jumbo_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0}).to_list(None)}
    if not prods:
        return 0
    done: set = set()
    async with httpx.AsyncClient(timeout=30, headers=JUMBO_HEADERS) as c:
        for term in DIRK_ALL_TERMS:
            try:
                async for page in _jumbo_sweep(c, term):
                    for raw in page:
                        n = _jumbo_normalize(raw)
                        if not n or not n["price"] or n["jumbo_id"] in done or n["jumbo_id"] not in prods:
                            continue
                        done.add(n["jumbo_id"])
                        p = prods[n["jumbo_id"]]
                        await db.products.update_one({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Jumbo", n, mults)})
            except Exception as e:
                logger.warning("Jumbo-prijzen %s mislukt: %s", term, e)
    # Jumbo zoeken we via zoektermen; alleen als bijna alles gevonden is, mag de rest als verdwenen gelden
    seen = [prods[j]["product_id"] for j in done]
    if len(done) >= 0.85 * len(prods):
        await _mark_assortment(seen, [p["product_id"] for j, p in prods.items() if j not in done])
    else:
        await _mark_assortment(seen, [])
        logger.info("Jumbo: %d van %d gevonden, assortiment niet bijgewerkt", len(done), len(prods))
    return len(done)


async def _refresh_dirk_prices_all() -> dict:
    mults = await _store_mults()
    updated = 0
    for fn in (_refresh_dirk_prices, _refresh_jumbo_prices, _refresh_ah_prices):
        try:
            updated += await fn(mults)
        except Exception as e:
            logger.warning("Refresh %s failed: %s", fn.__name__, e)
        _invalidate_products()
        if fn is _refresh_jumbo_prices:
            asyncio.create_task(_load_folders())  # Jumbo-acties komen mee met de producten
    await db.settings.update_one({"key": "app"}, {"$set": {"dirk_refreshed_at": now_utc()}}, upsert=True)
    return {"updated": updated}


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
    tab_dishes: Optional[str] = None
    tab_products: Optional[str] = None
    tab_account: Optional[str] = None
    sub_camps: Optional[str] = None
    sub_dishes: Optional[str] = None
    sub_products: Optional[str] = None
    sub_account: Optional[str] = None


DEFAULT_SETTINGS = {
    "app_name": "Boodschappenlijstje",
    "tagline": "Plan maaltijden en boodschappen per kampdag",
    "hero_url": "https://images.unsplash.com/photo-1466220549276-aef9ce186540?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
    "logo_url": "",
    "tab_camps": "Kampen",
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
        "<p>Je ontvangt geen e-mails meer van Boodschappenlijstje. Je kunt dit altijd weer aanzetten in de app bij Instellingen.</p>"
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
        if isinstance(d.get("created_at"), datetime):
            d["created_at"] = d["created_at"].isoformat()
    return {"feedback": docs}


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


# ---------------------------------------------------------------------------
# Startup: indexes + seed standard dishes
# ---------------------------------------------------------------------------
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
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.dishes.create_index("dish_id", unique=True)
    await db.camps.create_index("camp_id", unique=True)
    await db.invitations.create_index([("email", 1), ("camp_id", 1)], unique=True)
    await db.google_logins.create_index("expires_at", expireAfterSeconds=0)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)

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
    pm = await db.roles.find_one({"name": "penningmeester"})
    if pm is not None and pm.get("permissions", []) in ([], ["view_budget"]):
        await db.roles.update_one({"name": "penningmeester"}, {"$set": {"permissions": ["view_budget", "manage_budget"]}})
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

    # Start the daily Dirk price/category refresh loop (runs while server is up)
    asyncio.create_task(_daily_refresh_loop())
    asyncio.create_task(_global_products())  # productlijst alvast in het geheugen
    asyncio.create_task(_folders_fresh(wait=False))  # acties en folders ophalen
    asyncio.create_task(_selftest2())


async def _daily_refresh_loop():
    # Run shortly after boot, then every 24h
    await asyncio.sleep(60)
    while True:
        try:
            res = await _refresh_dirk_prices_all()
            logger.info("Daily Dirk refresh: %s", res)
            _invalidate_products()
            await _purge_expired_trash()
        except Exception as e:
            logger.warning("Daily Dirk refresh error: %s", e)
        await asyncio.sleep(24 * 60 * 60)


# ---------------------------------------------------------------------------
# Web frontend (Expo web export) served from the same address
# ---------------------------------------------------------------------------
from fastapi.responses import FileResponse

WEB_DIR = Path(os.environ.get("WEB_DIR", ROOT_DIR / "web")).resolve()


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"ok": True}


@app.get("/{full_path:path}", include_in_schema=False)
async def serve_web(full_path: str):
    if full_path.startswith("api/") or not WEB_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Niet gevonden")
    target = (WEB_DIR / full_path).resolve()
    if full_path and target.is_file() and WEB_DIR in target.parents:
        return FileResponse(target)
    return FileResponse(WEB_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
