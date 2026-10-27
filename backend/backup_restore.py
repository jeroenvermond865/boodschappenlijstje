"""Een back-up (zip uit de mail of van Beheer) terugzetten in de database.

Gebruik:
    MONGO_URL=... DB_NAME=... python backup_restore.py backup-2026-10-27.zip           # alleen kijken wat erin zit
    MONGO_URL=... DB_NAME=... python backup_restore.py backup-2026-10-27.zip --echt    # echt terugzetten

Bestaande documenten met hetzelfde _id worden vervangen; de rest blijft staan.
Winkelproducten zitten niet in de back-up: die haalt de app na het opstarten zelf weer op.
"""
import json
import os
import sys
import zipfile

from bson import json_util
from pymongo import MongoClient, ReplaceOne


def restore(path: str, really: bool) -> dict:
    counts = {}
    with zipfile.ZipFile(path) as z:
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
                    db[coll].bulk_write([ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in docs[i:i + 1000]], ordered=False)
    print("Teruggezet." if really else "Niets veranderd. Voeg --echt toe om terug te zetten.")
    return counts


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    restore(sys.argv[1], "--echt" in sys.argv)
