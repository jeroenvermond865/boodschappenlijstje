from fastapi import FastAPI, APIRouter, Depends, HTTPException, Header, UploadFile, File
from fastapi.responses import Response, HTMLResponse, RedirectResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import uuid
import re
import secrets
import base64
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
    return [d["name"] for d in docs]


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


class DishInput(BaseModel):
    name: str
    category: str
    ingredients: List[Ingredient] = []
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
        "role": "beheerder" if is_admin else DEFAULT_ROLE,
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
            "role": "beheerder" if email in ADMIN_SEED_EMAILS else DEFAULT_ROLE,
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
        "is_system": doc.get("is_system", False),
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
    if doc.get("is_system"):
        raise HTTPException(status_code=400, detail="Systeemrollen kunnen niet worden verwijderd")
    await db.users.update_many({"role": name}, {"$set": {"role": DEFAULT_ROLE}})
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


def product_public(doc: dict, store: str, user_id: str) -> dict:
    prices = doc.get("prices", {}) or {}
    unavailable = doc.get("unavailable", []) or []
    return {
        "id": doc["product_id"],
        "name": doc["name"],
        "aisle": doc.get("aisle", "Overig"),
        "unit": doc.get("unit", "stuks"),
        "brand": doc.get("brand"),
        "barcode": doc.get("barcode"),
        "prices": prices,
        "unavailable": unavailable,
        "price": resolve_price(prices, store, unavailable),
        "unavailable_here": store in unavailable,
        "is_global": doc.get("is_global", False),
        "is_own": doc.get("owner_id") == user_id,
    }


@api_router.get("/products")
async def list_products(user: dict = Depends(get_current_user)):
    store = user.get("store", DEFAULT_STORE)
    cursor = db.products.find(
        {"deleted_at": None, "$or": [{"is_global": True}, {"owner_id": user["user_id"]}]},
        {"_id": 0},
    )
    docs = await cursor.to_list(30000)
    docs.sort(key=lambda d: (AISLES.index(d["aisle"]) if d.get("aisle") in AISLES else 99, d["name"].lower()))
    return {"products": [product_public(d, store, user["user_id"]) for d in docs], "stores": await get_active_stores()}


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
    # Non-admin personal product -> notify admins so they can promote it
    if not make_global:
        sub = {
            "psub_id": f"psub_{uuid.uuid4().hex[:12]}",
            "product_id": product_id,
            "name": doc["name"],
            "submitted_by": user["user_id"],
            "submitted_by_name": user.get("name") or user.get("email"),
            "status": "pending",
            "created_at": now_utc(),
        }
        await db.product_submissions.insert_one(sub)
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
DIRK_STORE_ID = 66
DIRK_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Linux; Android 10) Chrome/120 Mobile Safari/537.36",
    "Origin": "https://www.dirk.nl",
}


def _dirk_aisle(department: str, webgroup: str) -> str:
    t = f"{department} {webgroup}".lower()
    if any(w in t for w in ["groente", "fruit", "aardappel"]):
        return "Aardappelen, groente & fruit"
    if any(w in t for w in ["vlees", "vis", "kip", "gevogelte", "vega"]):
        return "Vlees & vis"
    if any(w in t for w in ["brood", "gebak", "banket", "bakkerij", "beleg", "koek"]):
        return "Brood, beleg & koek"
    if any(w in t for w in ["zuivel", "kaas", "ei", "melk", "boter", "yoghurt"]):
        return "Zuivel & kaas"
    if any(w in t for w in ["drank", "fris", "sap", "water", "koffie", "thee", "bier", "wijn", "alcohol"]):
        return "Dranken, sap, koffie & thee"
    if any(w in t for w in ["maaltijd", "salade", "tapas", "vers"]):
        return "Maaltijden, salades & tapas"
    if any(w in t for w in ["diepvries", "vries", "ijs"]):
        return "Diepvries"
    if any(w in t for w in ["huishoud", "huisdier", "schoonmaak", "wasmiddel"]):
        return "Huishoud & huisdieren"
    if any(w in t for w in ["baby", "kind", "drogist", "verzorging", "gezondheid"]):
        return "Kind & drogisterij"
    if any(w in t for w in ["chips", "snoep", "snack", "chocolade", "noot", "borrel"]):
        return "Snacks & snoep"
    if any(w in t for w in ["non food", "non-food", "huis", "tuin"]):
        return "Non food"
    return "Voorraadkast"


async def _dirk_post(client, query, variables):
    r = await client.post(DIRK_GQL, json={"query": query, "variables": variables})
    return r.json().get("data", {}) or {}


async def _dirk_search_ids(client, term: str, limit: Optional[int] = 15) -> list:
    d = await _dirk_post(client,
        "query($q:NewSearchQueryInput!){newSearchProducts(query:$q){productId ranking}}",
        {"q": {"searchTerm": term}})
    ids = [p["productId"] for p in (d.get("newSearchProducts") or [])]
    return ids[:limit] if limit else ids


async def _dirk_fetch_products(client, ids: list) -> list:
    if not ids:
        return []
    d = await _dirk_post(client,
        "query($ids:[Int!],$sid:Int!){products(productIds:$ids,storeId:$sid){productId normalPrice offerPrice productInformation{headerText subText packaging brand department webgroup}}}",
        {"ids": ids, "sid": DIRK_STORE_ID})
    order = {pid: i for i, pid in enumerate(ids)}
    prods = [p for p in (d.get("products") or []) if p]
    prods.sort(key=lambda p: order.get(p.get("productId"), 999))
    return prods


def _dirk_normalize(p: dict) -> Optional[dict]:
    info = p.get("productInformation") or {}
    name = (info.get("headerText") or "").strip()
    if not name:
        return None
    price = p.get("offerPrice") or 0
    if not price:
        price = p.get("normalPrice") or 0
    return {
        "dirk_id": p.get("productId"),
        "name": name[:80],
        "brand": (info.get("brand") or None),
        "quantity": (info.get("packaging") or None),
        "price": round(float(price), 2) if price else 0,
        "on_offer": bool(p.get("offerPrice")),
        "aisle": _dirk_aisle(info.get("department") or "", info.get("webgroup") or ""),
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
    return {
        "ah_id": p.get("webshopId"),
        "name": name[:80],
        "brand": (p.get("brand") or None),
        "quantity": (p.get("salesUnitSize") or None),
        "price": round(float(price), 2) if price else 0,
        "on_offer": bool(before and price and price < before),
        "aisle": _dirk_aisle(p.get("mainCategory") or "", p.get("subCategory") or ""),
    }


async def _ah_search(term: str) -> list:
    async with httpx.AsyncClient(timeout=15, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        r = await c.get("https://api.ah.nl/mobile-services/product/search/v2",
                        params={"query": term, "size": 15},
                        headers={"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"})
        prods = r.json().get("products", []) or []
    return [n for n in (_ah_normalize(p) for p in prods) if n]


@api_router.get("/stores/search")
async def store_search(q: str, store: str = "Dirk", user: dict = Depends(get_current_user)):
    if not q.strip():
        return {"results": [], "store": store}
    try:
        if store == "Albert Heijn":
            out = await _ah_search(q.strip())
            for r in out:
                r["source_id"] = str(r.pop("ah_id"))
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
COUPLED_STORES = ["Dirk", "Albert Heijn"]


class StoreImportItem(BaseModel):
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
    return "ah_id" if store == "Albert Heijn" else "dirk_id"


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
        base = it.price / mults.get(store, 1.0) if it.price else 0
        prices = {}
        if it.price:
            for sn, m in mults.items():
                prices[sn] = round((it.price if sn == store else base * m), 2)
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
    if not price:
        return {}
    base = price / mults.get(store, 1.0)
    return {sn: round(price if sn == store else base * m, 2) for sn, m in mults.items()}


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
        "barcode": None,
        "prices": _prices_from(nrm["price"], store, mults),
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
            if n % 5 == 0:
                await _set_import_status(status=f"Albert Heijn ({n}/{len(DIRK_ALL_TERMS)})", added_ah=added)
    return added


async def _import_all_dirk() -> None:
    global _dirk_import_running
    _dirk_import_running = True
    try:
        await _set_import_status(status="zoeken", found=0, added=0, added_ah=0, started_at=now_utc(), finished_at=None, error=None)
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
            existing = {str(p["dirk_id"]) async for p in db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None}, {"_id": 0, "dirk_id": 1})}
            todo = [pid for pid in ids if str(pid) not in existing]
            await _set_import_status(status="Dirk importeren", found=len(ids), todo=len(todo))
            added = 0
            for i in range(0, len(todo), 25):
                try:
                    prods = await _dirk_fetch_products(c, todo[i:i + 25])
                except Exception as e:
                    logger.warning("Dirk ophalen mislukt: %s", e)
                    continue
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
                await _set_import_status(added=added)
        logger.info("Dirk-import klaar: %d gevonden, %d toegevoegd", len(ids), added)
        try:
            added_ah = await _import_all_ah(mults)
        except Exception as e:
            logger.warning("AH-import mislukt: %s", e)
            added_ah = 0
        await _set_import_status(status="klaar", added=added, added_ah=added_ah, finished_at=now_utc())
    except Exception as e:
        logger.error("Dirk-import mislukt: %s", e)
        await _set_import_status(status="mislukt", error=str(e)[:200], finished_at=now_utc())
    finally:
        _dirk_import_running = False


@api_router.post("/admin/products/import-dirk-all")
async def start_import_all_dirk(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_products")
    if not _dirk_import_running:
        asyncio.create_task(_import_all_dirk())
    return {"ok": True}


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


def _apply_refresh(p: dict, store: str, price: float, aisle: str, mults: dict) -> dict:
    base = price / mults.get(store, 1.0) if price else 0
    prices = dict(p.get("prices", {}) or {})
    prices[store] = price
    for sn, m in mults.items():
        if sn != store and not prices.get(sn):
            prices[sn] = round(base * m, 2)
    return {"prices": prices, "aisle": aisle if aisle in AISLES else p.get("aisle", "Overig")}


async def _refresh_dirk_prices(mults: dict) -> int:
    prods = await db.products.find({"dirk_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0}).to_list(10000)
    if not prods:
        return 0
    ids = [p["dirk_id"] for p in prods]
    fetched = {}
    async with httpx.AsyncClient(timeout=30, headers=DIRK_HEADERS) as c:
        for i in range(0, len(ids), 25):
            for p in await _dirk_fetch_products(c, ids[i:i + 25]):
                n = _dirk_normalize(p)
                if n:
                    fetched[n["dirk_id"]] = n
    updated = 0
    for p in prods:
        n = fetched.get(p["dirk_id"])
        if not n or not n["price"]:
            continue
        await db.products.update_one({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Dirk", n["price"], n["aisle"], mults)})
        updated += 1
    return updated


async def _refresh_ah_prices(mults: dict) -> int:
    prods = await db.products.find({"ah_id": {"$exists": True}, "deleted_at": None, "is_global": True}, {"_id": 0}).to_list(10000)
    if not prods:
        return 0
    updated = 0
    async with httpx.AsyncClient(timeout=30, headers=AH_HEADERS) as c:
        tok = await _ah_token(c)
        H = {"Authorization": f"Bearer {tok}", "X-Application": "AHWEBSHOP"}
        for p in prods:
            try:
                r = await c.get(f"https://api.ah.nl/mobile-services/product/detail/v4/fir/{p['ah_id']}", headers=H)
                card = (r.json() or {}).get("productCard") or {}
            except Exception:
                continue
            n = _ah_normalize(card)
            if not n or not n["price"]:
                continue
            await db.products.update_one({"product_id": p["product_id"]}, {"$set": _apply_refresh(p, "Albert Heijn", n["price"], n["aisle"], mults)})
            updated += 1
    return updated


async def _refresh_dirk_prices_all() -> dict:
    mults = await _store_mults()
    updated = 0
    for fn in (_refresh_dirk_prices, _refresh_ah_prices):
        try:
            updated += await fn(mults)
        except Exception as e:
            logger.warning("Refresh %s failed: %s", fn.__name__, e)
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
    linked = await db.products.count_documents({"$or": [{"dirk_id": {"$exists": True}}, {"ah_id": {"$exists": True}}], "deleted_at": None, "is_global": True})
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
    mult: Optional[float] = 1.0


@api_router.get("/admin/stores")
async def admin_list_stores(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    docs = await db.stores.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(200)
    return {"stores": docs}


@api_router.post("/admin/stores")
async def admin_add_store(data: StoreInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Geef een winkelnaam op")
    existing = await db.stores.find_one({"name": name})
    if existing and existing.get("active"):
        raise HTTPException(status_code=400, detail="Deze winkel bestaat al")
    mult = float(data.mult or 1.0)
    if mult <= 0:
        raise HTTPException(status_code=400, detail="De prijsfactor moet groter dan 0 zijn")
    last = await db.stores.find({}, {"_id": 0}).sort("order", -1).to_list(1)
    order = (last[0]["order"] + 1) if last else 1
    await db.stores.update_one(
        {"name": name},
        {"$set": {"name": name, "mult": mult, "active": True, "order": order}},
        upsert=True,
    )
    await _backfill_store_prices(name, mult)
    return {"ok": True}


@api_router.put("/admin/stores/{name}")
async def admin_update_store(name: str, data: StoreInput, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    store = await db.stores.find_one({"name": name})
    if not store:
        raise HTTPException(status_code=404, detail="Winkel niet gevonden")
    new_name = data.name.strip()
    mult = float(data.mult if data.mult is not None else store.get("mult", 1.0))
    if mult <= 0:
        raise HTTPException(status_code=400, detail="De prijsfactor moet groter dan 0 zijn")
    update = {"mult": mult}
    if new_name and new_name != name:
        if await db.stores.find_one({"name": new_name, "active": True}):
            raise HTTPException(status_code=400, detail="Er bestaat al een winkel met die naam")
        update["name"] = new_name
        # migrate product prices + user store choices to the new name
        async for p in db.products.find({f"prices.{name}": {"$exists": True}}, {"_id": 0, "product_id": 1, "prices": 1}):
            val = p["prices"].get(name)
            await db.products.update_one({"product_id": p["product_id"]}, {"$set": {f"prices.{new_name}": val}, "$unset": {f"prices.{name}": ""}})
        await db.users.update_many({"store": name}, {"$set": {"store": new_name}})
    await db.stores.update_one({"name": name}, {"$set": update})
    return {"ok": True}


@api_router.delete("/admin/stores/{name}")
async def admin_delete_store(name: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    store = await db.stores.find_one({"name": name})
    if not store:
        raise HTTPException(status_code=404, detail="Winkel niet gevonden")
    remaining = await db.stores.count_documents({"active": True})
    if remaining <= 1:
        raise HTTPException(status_code=400, detail="Er moet minstens één winkel blijven")
    await db.stores.update_one({"name": name}, {"$set": {"active": False}})
    # move users on this store to a default
    fallback = await db.stores.find_one({"active": True})
    if fallback:
        await db.users.update_many({"store": name}, {"$set": {"store": fallback["name"]}})
    return {"ok": True}


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


async def _backfill_store_prices(store_name: str, mult: float):
    prods = await db.products.find({"is_global": True, "deleted_at": None}, {"_id": 0}).to_list(10000)
    active = await db.stores.find({"active": True}, {"_id": 0}).to_list(200)
    mults = {s["name"]: s.get("mult", 1.0) for s in active}
    for p in prods:
        prices = p.get("prices", {}) or {}
        if prices.get(store_name):
            continue
        base = None
        for sn, pv in prices.items():
            if pv and mults.get(sn):
                base = pv / mults[sn]
                break
        if base is None:
            continue
        await db.products.update_one(
            {"product_id": p["product_id"]},
            {"$set": {f"prices.{store_name}": round(base * mult, 2)}},
        )


@api_router.post("/admin/store-requests/{req_id}/approve")
async def approve_store_request(req_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_settings")
    req = await db.store_requests.find_one({"req_id": req_id, "status": "pending"})
    if not req:
        raise HTTPException(status_code=404, detail="Aanvraag niet gevonden")
    name = req["name"]
    exists = await db.stores.find_one({"name": name})
    if not exists:
        last = await db.stores.find({}, {"_id": 0}).sort("order", -1).to_list(1)
        order = (last[0]["order"] + 1) if last else 1
        await db.stores.insert_one({"name": name, "mult": 1.0, "active": True, "order": order})
        await _backfill_store_prices(name, 1.0)
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


@api_router.get("/admin/trash")
async def list_trash(user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    names = {u["user_id"]: u.get("name") or u.get("email") async for u in db.users.find({}, {"_id": 0, "user_id": 1, "name": 1, "email": 1})}
    items = []
    for kind, (coll, idf) in TRASH.items():
        query = {"deleted_at": {"$ne": None}}
        if kind != "user":
            # Spullen van een verwijderde gebruiker staan onder die gebruiker
            query["deleted_with_user"] = {"$exists": False}
        async for d in db[coll].find(query, {"_id": 0}):
            extra = ""
            if kind == "user":
                extra = d.get("email") or ""
                n = sum([await db[c].count_documents({"deleted_with_user": d[idf]}) for c in ("camps", "dishes", "products")])
                if n:
                    extra += f" · met {n} kampen, gerechten en producten"
            elif d.get("owner_id"):
                extra = f"van {names.get(d['owner_id'], 'onbekend')}"
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


@api_router.post("/admin/trash/{kind}/{item_id}/restore")
async def restore_trash(kind: str, item_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    if kind not in TRASH:
        raise HTTPException(status_code=404, detail="Onbekend type")
    coll, idf = TRASH[kind]
    doc = await db[coll].find_one({idf: item_id, "deleted_at": {"$ne": None}})
    if not doc:
        raise HTTPException(status_code=404, detail="Niet gevonden in Recent verwijderd")
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


@api_router.delete("/admin/trash/{kind}/{item_id}")
async def purge_trash_item(kind: str, item_id: str, user: dict = Depends(get_current_user)):
    await require_perm(user, "manage_users")
    if kind not in TRASH:
        raise HTTPException(status_code=404, detail="Onbekend type")
    coll, idf = TRASH[kind]
    doc = await db[coll].find_one({idf: item_id, "deleted_at": {"$ne": None}})
    if not doc:
        raise HTTPException(status_code=404, detail="Niet gevonden in Recent verwijderd")
    await _purge_docs(kind, [doc])
    return {"ok": True}


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

    # Seed roles
    for r in DEFAULT_ROLES:
        await db.roles.update_one(
            {"name": r["name"]},
            {"$setOnInsert": r},
            upsert=True,
        )
    # Ensure beheerder keeps all permissions
    await db.roles.update_one({"name": "beheerder"}, {"$set": {"permissions": list(ALL_PERMISSIONS), "is_system": True}})
    # Backfill role on existing users, and seed the admin account
    pm = await db.roles.find_one({"name": "penningmeester"})
    if pm is not None and pm.get("permissions", []) in ([], ["view_budget"]):
        await db.roles.update_one({"name": "penningmeester"}, {"$set": {"permissions": ["view_budget", "manage_budget"]}})
    await db.users.update_many({"role": {"$exists": False}}, {"$set": {"role": DEFAULT_ROLE}})
    await db.users.update_many({"email": {"$in": ADMIN_SEED_EMAILS}}, {"$set": {"role": "beheerder"}})

    count = await db.dishes.count_documents({"is_standard": True})
    if count == 0:
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
    # Eenmalig: alleen Dirk en Albert Heijn blijven over
    if not await db.settings.find_one({"key": "stores_only_dirk_ah"}):
        await db.stores.update_many({"name": {"$nin": COUPLED_STORES}}, {"$set": {"active": False}})
        await db.users.update_many({"store": {"$nin": COUPLED_STORES}}, {"$set": {"store": "Dirk"}})
        await db.settings.insert_one({"key": "stores_only_dirk_ah", "done_at": now_utc()})
    active_stores = await db.stores.find({"active": True}, {"_id": 0}).to_list(200)
    for s in active_stores:
        await _backfill_store_prices(s["name"], s.get("mult", 1.0))
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


async def _daily_refresh_loop():
    # Run shortly after boot, then every 24h
    await asyncio.sleep(60)
    while True:
        try:
            res = await _refresh_dirk_prices_all()
            logger.info("Daily Dirk refresh: %s", res)
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
