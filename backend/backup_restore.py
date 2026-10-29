"""Een back-up (zip uit de mail of van Beheer) terugzetten in de database.

Gebruik:
    MONGO_URL=... DB_NAME=... python backup_restore.py backup-2026-10-27.zip           # alleen kijken wat erin zit
    MONGO_URL=... DB_NAME=... python backup_restore.py backup-2026-10-27.zip --echt    # echt terugzetten
Versleuteld (back-ups sinds 29-10-2026)? Zet dan ook BACKUP_PASSWORD=... (hetzelfde als bij Render).

Bestaande documenten met hetzelfde _id worden vervangen; de rest blijft staan. Bij gebruikers en instellingen worden alleen
de velden uit de back-up bijgewerkt: wachtwoorden en de Gmail-koppeling (die niet in de mail-back-up zitten) blijven staan.
Winkelproducten zitten niet in de back-up: die haalt de app na het opstarten zelf weer op.
"""
import json
import os
import sys
import pyzipper
from bson import json_util
from pymongo import MongoClient, ReplaceOne, UpdateOne

KEEP_FIELDS = ("users", "settings")  # hier ontbreken bewust geheime velden: niet overschrijven, alleen bijwerken


def restore(path: str, really: bool) -> dict:
    counts = {}
    with pyzipper.AESZipFile(path) as z:
        if os.environ.get("BACKUP_PASSWORD"):
            z.setpassword(os.environ["BACKUP_PASSWORD"].encode())
        info = json.loads(z.read("info.json")) if "info.json" in z.namelist() else {}
        print("Back-up van", info.get("gemaakt", "onbekend"))
        db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "boodschappenlijstje")] if really else None
        for name in sorted(n for n in z.namelist() if n.endswith(".jsonl")):
            coll = name[:-len(".jsonl")]
            docs = [json_util.loads(line) for line in z.read(name).decode().splitlines() if line.strip()]
            counts[coll] = len(docs)
            print(f"  {coll}: {len(docs)}")
            if really and docs:
                for i in range(0, len(docs), 1000):
                    part = docs[i:i + 1000]
                    ops = ([UpdateOne({"_id": d["_id"]}, {"$set": {k: v for k, v in d.items() if k != "_id"}}, upsert=True) for d in part]
                           if coll in KEEP_FIELDS else [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in part])
                    db[coll].bulk_write(ops, ordered=False)
    print("Teruggezet." if really else "Niets veranderd. Voeg --echt toe om terug te zetten.")
    return counts


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    restore(sys.argv[1], "--echt" in sys.argv)
