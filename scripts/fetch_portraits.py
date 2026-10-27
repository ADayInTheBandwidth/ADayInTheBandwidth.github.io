#!/usr/bin/env python3
"""Fetch openly licensed portraits for the delay-line ancestors.

Source: Wikidata (image property P18) + Wikimedia Commons only. Nothing else
is scraped. For each person in _data/delay_line.json the script

  1. uses the manual override if present ("commonsFile" or "wikidataId"),
     otherwise searches Wikidata by name and keeps a candidate only if it is a
     human (P31 = Q5) and agrees with the "hints" (birth year, keywords);
  2. reads P18, asks Commons for a ~240 px thumbnail plus license/author
     metadata (imageinfo + extmetadata);
  3. saves the thumbnail to assets/images/genealogy/<id>.jpg (the live page
     never hotlinks Commons);
  4. writes everything to _data/genealogy_photos.json for the Jekyll include.

No confident match or no P18 image -> no photo; the person is listed in the
report so you can add a "wikidataId" / "commonsFile" override by hand.

Re-running only fetches people whose inputs changed (or whose image file is
missing). Use --force to refetch everything.

Usage:
    pip install -r requirements.txt
    python scripts/fetch_portraits.py [--force] [--only D11 D12]
"""

import argparse
import datetime as dt
import html
import io
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "_data" / "delay_line.json"
OUT_JSON = ROOT / "_data" / "genealogy_photos.json"
IMG_DIR = ROOT / "assets" / "images" / "genealogy"
IMG_URL = "/assets/images/genealogy"

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia API policy: identify the tool and give a contact URL.
USER_AGENT = ("ADayInTheBandwidth-genealogy-portraits/1.0 "
              "(https://adayinthebandwidth.github.io/genealogy/; "
              "https://github.com/ADayInTheBandwidth/ADayInTheBandwidth.github.io) "
              "python-requests")

THUMB_WIDTH = 240
MIN_INTERVAL = 0.6          # seconds between API requests (polite rate limit)
BORN_TOLERANCE = 2          # years
HUMAN = "Q5"


# --------------------------------------------------------------------------
# HTTP: one session, rate limited, retries on transient errors
# --------------------------------------------------------------------------
class Http:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = USER_AGENT
        self.last = 0.0

    def get(self, url, params=None, binary=False, tries=5):
        for attempt in range(tries):
            wait = MIN_INTERVAL - (time.monotonic() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.monotonic()
            try:
                r = self.s.get(url, params=params, timeout=30)
            except requests.RequestException as e:
                err = str(e)
            else:
                if r.status_code == 200:
                    if binary:
                        return r.content
                    data = r.json()
                    # Wikidata asks bots to back off when replication lags
                    if isinstance(data, dict) and data.get("error", {}).get("code") == "maxlag":
                        err = "maxlag"
                    else:
                        return data
                elif r.status_code in (429, 500, 502, 503, 504):
                    err = "HTTP %d" % r.status_code
                    ra = r.headers.get("Retry-After")
                    if ra and ra.isdigit():
                        time.sleep(min(int(ra), 60))
                else:
                    r.raise_for_status()
            time.sleep(min(2 ** attempt, 30))
        raise RuntimeError("giving up on %s (%s)" % (url, err))


http = Http()


def wd(params):
    params = dict(params, format="json", formatversion=2, maxlag=5)
    return http.get(WIKIDATA_API, params)


# --------------------------------------------------------------------------
# Wikidata helpers
# --------------------------------------------------------------------------
def norm(s):
    """lower-case, strip accents and punctuation, drop single-letter initials"""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    words = re.findall(r"[a-z0-9]+", s)
    return " ".join(w for w in words if len(w) > 1)


def get_entities(ids, props="claims|labels|descriptions|aliases"):
    out = {}
    ids = [i for i in ids if i]
    for k in range(0, len(ids), 50):
        data = wd({"action": "wbgetentities", "ids": "|".join(ids[k:k + 50]),
                   "props": props, "languages": "en|de"})
        out.update(data.get("entities", {}))
    return out


def claim_ids(entity, prop):
    vals = []
    for c in entity.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v:
            vals.append(v["id"])
    return vals


def claim_string(entity, prop):
    for c in entity.get("claims", {}).get(prop, []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, str):
            return v
    return None


def birth_year(entity):
    for c in entity.get("claims", {}).get("P569", []):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict):
            m = re.match(r"([+-]\d+)-", v.get("time", ""))
            if m:
                return int(m.group(1))
    return None


def text_of(entity, field):
    d = entity.get(field, {})
    return " ".join(x.get("value", "") for x in d.values()) if isinstance(d, dict) else ""


def score_candidate(person, entity, labels):
    """Return (score, reasons, rejected)."""
    hints = person.get("hints") or {}
    reasons = []
    if HUMAN not in claim_ids(entity, "P31"):
        return 0, ["not human"], True

    score = 0
    born = hints.get("born")
    by = birth_year(entity)
    if born and by is not None:
        if abs(by - born) <= BORN_TOLERANCE:
            score += 3
            reasons.append("born %d" % by)
        else:
            return 0, ["born %d, expected %d" % (by, born)], True

    # keywords vs description + occupation / employer / education labels
    related = []
    for prop in ("P106", "P108", "P69", "P463"):
        related += [labels.get(q, "") for q in claim_ids(entity, prop)]
    haystack = norm(" ".join([text_of(entity, "descriptions")] + related))
    hits = [k for k in hints.get("keywords", []) if norm(k) and norm(k) in haystack]
    if hits:
        score += min(len(hits), 3)
        reasons.append("keywords: " + ", ".join(hits))

    names = {norm(v.get("value", "")) for v in entity.get("labels", {}).values()}
    for lang in entity.get("aliases", {}).values():
        names.update(norm(a.get("value", "")) for a in lang)
    if norm(person["name"]) in names:
        score += 1
        reasons.append("name match")
    return score, reasons, False


def find_wikidata(person):
    """Search by name; return (qid, entity, confidence, reasons, runner_up)."""
    found = wd({"action": "wbsearchentities", "search": person["name"],
                "language": "en", "type": "item", "limit": 8})
    qids = [r["id"] for r in found.get("search", [])]
    if not qids:
        return None, None, "none", ["no search results"], None
    ents = get_entities(qids)
    related = set()
    for e in ents.values():
        for prop in ("P106", "P108", "P69", "P463"):
            related.update(claim_ids(e, prop))
    lab_ents = get_entities(sorted(related), props="labels")
    labels = {q: text_of(e, "labels") for q, e in lab_ents.items()}

    scored = []
    for q in qids:
        e = ents.get(q)
        if not e:
            continue
        s, why, rejected = score_candidate(person, e, labels)
        if not rejected:
            scored.append((s, q, e, why))
    if not scored:
        return None, None, "none", ["no human candidate matched the hints"], None
    scored.sort(key=lambda t: -t[0])
    best = scored[0]
    runner = scored[1] if len(scored) > 1 else None
    strong = any(r.startswith("born") for r in best[3]) or any(r.startswith("keywords") for r in best[3])
    confident = best[0] >= 3 and strong and not (runner and runner[0] >= best[0] - 1 and runner[0] >= 3)
    conf = "high" if confident else "low"
    return best[1], best[2], conf, best[3], (runner[1] if runner else None)


# --------------------------------------------------------------------------
# Commons
# --------------------------------------------------------------------------
def strip_html(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def first_href(s):
    m = re.search(r'href="([^"]+)"', s or "")
    if not m:
        return None
    url = html.unescape(m.group(1))
    return "https:" + url if url.startswith("//") else url


def commons_info(filename):
    title = filename if filename.startswith("File:") else "File:" + filename
    data = http.get(COMMONS_API, {
        "action": "query", "titles": title, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": THUMB_WIDTH,
        "iiextmetadatafilter": "LicenseShortName|Artist|Credit|LicenseUrl|UsageTerms",
        "format": "json", "formatversion": 2,
    })
    pages = data.get("query", {}).get("pages", [])
    if not pages or "imageinfo" not in pages[0]:
        return None
    ii = pages[0]["imageinfo"][0]
    md = ii.get("extmetadata", {})
    val = lambda k: (md.get(k) or {}).get("value", "")
    return {
        "title": pages[0]["title"],
        "thumb": ii.get("thumburl") or ii.get("url"),
        "sourcePage": ii.get("descriptionurl"),
        "author": strip_html(val("Artist")) or "Unknown author",
        "authorUrl": first_href(val("Artist")),
        "credit": strip_html(val("Credit")),
        "license": strip_html(val("LicenseShortName")) or strip_html(val("UsageTerms")),
        "licenseUrl": val("LicenseUrl") or None,
    }


def save_thumb(url, dest):
    raw = http.get(url, binary=True)
    im = Image.open(io.BytesIO(raw))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    if im.width > THUMB_WIDTH:
        im = im.resize((THUMB_WIDTH, round(im.height * THUMB_WIDTH / im.width)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=85, optimize=True, progressive=True)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def signature(p):
    return json.dumps({k: p.get(k) for k in ("name", "hints", "wikidataId", "commonsFile")},
                      sort_keys=True, ensure_ascii=False)


def process(person):
    """Return an output record for one person."""
    pid = person["id"]
    rec = {"id": pid, "name": person["name"], "signature": signature(person)}
    qid = person.get("wikidataId")
    file = person.get("commonsFile")
    if file or qid:
        rec["status"] = "overridden"
        rec["confidence"] = "manual"
        if qid and not file:
            ent = get_entities([qid]).get(qid, {})
            file = claim_string(ent, "P18")
    else:
        qid, ent, conf, why, runner = find_wikidata(person)
        rec.update(confidence=conf, reasons=why, candidate=qid, runnerUp=runner)
        if not qid or conf != "high":
            rec["status"] = "low_confidence" if qid else "missing"
            return rec
        file = claim_string(ent, "P18")
        rec["status"] = "matched"
    rec["wikidataId"] = qid
    if not file:
        rec["status"] = "missing"
        rec["reasons"] = (rec.get("reasons") or []) + ["no P18 image on Wikidata"]
        return rec
    info = commons_info(file)
    if not info or not info.get("thumb"):
        rec["status"] = "missing"
        rec["reasons"] = (rec.get("reasons") or []) + ["Commons file not found: " + file]
        return rec
    dest = IMG_DIR / ("%s.jpg" % pid)
    save_thumb(info["thumb"], dest)
    rec.update(
        path="%s/%s.jpg" % (IMG_URL, pid),
        commonsFile=info["title"],
        sourcePage=info["sourcePage"],
        author=info["author"], authorUrl=info["authorUrl"], credit=info["credit"],
        license=info["license"], licenseUrl=info["licenseUrl"],
    )
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--force", action="store_true", help="refetch everything, ignore the cache")
    ap.add_argument("--only", nargs="*", metavar="ID", help="only these ids (e.g. D11 D12)")
    args = ap.parse_args()

    people = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    old = {}
    if OUT_JSON.exists():
        old = json.loads(OUT_JSON.read_text(encoding="utf-8")).get("photos", {})

    out = {}
    for p in people:
        pid = p["id"]
        prev = old.get(pid)
        cached = (prev and not args.force and prev.get("signature") == signature(p) and
                  (not prev.get("path") or (ROOT / prev["path"].lstrip("/")).exists()))
        if (args.only and pid not in args.only) or cached:
            if prev:
                out[pid] = prev
            continue
        print("· %-4s %s" % (pid, p["name"]), flush=True)
        try:
            out[pid] = process(p)
        except Exception as e:                       # keep going; report it
            out[pid] = {"id": pid, "name": p["name"], "status": "error",
                        "reasons": [str(e)], "signature": ""}

    # drop images of people who no longer have a photo
    keep = {r.get("path") for r in out.values() if r.get("path")}
    for f in IMG_DIR.glob("*.jpg") if IMG_DIR.exists() else []:
        if "%s/%s" % (IMG_URL, f.name) not in keep:
            f.unlink()

    OUT_JSON.write_text(json.dumps({
        "generated": dt.date.today().isoformat(),
        "source": "Wikidata P18 + Wikimedia Commons (scripts/fetch_portraits.py)",
        "photos": out,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    groups = {}
    for p in people:
        r = out.get(p["id"], {"status": "missing"})
        groups.setdefault(r.get("status", "missing"), []).append(r)
    print("\nSummary")
    for status in ("matched", "overridden", "low_confidence", "missing", "error"):
        rows = groups.get(status, [])
        print("  %-15s %d" % (status, len(rows)))
        for r in rows:
            extra = ""
            if status in ("matched", "overridden"):
                extra = "%s · %s" % (r.get("wikidataId") or "-", r.get("license") or "?")
            elif r.get("candidate"):
                extra = "candidate %s (%s)" % (r["candidate"], "; ".join(r.get("reasons", [])))
            else:
                extra = "; ".join(r.get("reasons", []))
            print("    %-4s %-34s %s" % (r.get("id", ""), r.get("name", ""), extra))
    if groups.get("low_confidence") or groups.get("missing"):
        print("\nTo fix a row, add \"wikidataId\" (e.g. \"Q6722\") or \"commonsFile\" "
              "to that person in _data/delay_line.json and re-run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
