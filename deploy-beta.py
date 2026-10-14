#!/usr/bin/env python3
"""Deploy the BETA colony (ziggy-colony-beta) to GitHub Pages.

Creates the repo if missing, pushes the beta working tree (source + docs/
static build) via the Git Data API, and enables Pages from main:/docs.
Idempotent — re-run to publish beta updates.

HARD SEPARATION: this script only ever touches the BETA repo
(Icyunvbankai/ziggy-colony-beta). It never reads or writes the live repo
(ziggy-colony) or the live sync pipeline.

Uses the proven surrogate pattern (see ~/workspace/build-shop-redesign.py).
"""
import base64, hashlib, json, os, sys, time, urllib.error, urllib.request
from http.client import RemoteDisconnected

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

OWNER = "Icyunvbankai"
REPO = "ziggy-colony-beta"
LOCAL = os.path.dirname(os.path.abspath(__file__))
EXCLUDE_DIRS = {".git", "node_modules", "data", "dist", "__pycache__"}
EXCLUDE_FILES = {".DS_Store"}

def ghapi(method, path, data=None, ok404=False, ok_statuses=(), tries=3, raise_http=False):
    url = "https://api.github.com" + path
    body = json.dumps(data).encode() if data is not None else None
    for attempt in range(tries):
        req = urllib.request.Request(url, data=body, method=method,
            headers={"Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28",
                     "User-Agent": "muse-github-skill",
                     "Content-Type": "application/json"})
        add_surrogate_to_request(req, "custom.github", entry_name="access_token",
                                 allowed_hosts=["api.github.com"])
        try:
            return read_json_response(urllib.request.urlopen(req, timeout=180))
        except urllib.error.HTTPError as e:
            if (e.code == 404 and ok404) or e.code in ok_statuses:
                return None
            if raise_http:
                raise
            if e.code in (429, 500, 502, 503, 504) and attempt + 1 < tries:
                time.sleep(2 ** attempt * 5)
                continue
            print("GHAPI HTTP FAIL", method, path, e.code, e.read()[:400])
            sys.exit(1)
        except (RemoteDisconnected, urllib.error.URLError, TimeoutError) as e:
            if attempt + 1 < tries:
                print(f"transient network error ({e}), retry {attempt + 2}/{tries}")
                time.sleep(2 ** attempt * 5)
                continue
            print("GHAPI NETWORK FAIL", method, path, e)
            sys.exit(1)

def post_blob(raw, rel):
    for attempt in range(2):
        try:
            return ghapi("POST", f"/repos/{OWNER}/{REPO}/git/blobs",
                         {"content": base64.b64encode(raw).decode(), "encoding": "base64"},
                         raise_http=True)
        except urllib.error.HTTPError as e:
            if e.code == 400 and attempt == 0:
                print(f"400 on {rel} — retrying once after backoff")
                time.sleep(10)
                continue
            print(f"Blob upload failed twice for {rel} (HTTP {e.code}) — investigate this file")
            sys.exit(1)

def main():
    repo = ghapi("GET", f"/repos/{OWNER}/{REPO}", ok404=True)
    if repo is None:
        repo = ghapi("POST", "/user/repos", {
            "name": REPO,
            "description": "Ziggy's Colony — BETA test build (separate from live). Real topography, claim markers, distress beacons, home desks. Reads live public data at runtime; never touches live.",
            "private": False, "auto_init": False,
        })
        print("created repo:", repo["html_url"])
    else:
        print("repo exists:", repo["html_url"])

    ref = ghapi("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main", ok404=True, ok_statuses=(409,))
    base_sha = ref["object"]["sha"] if ref else None
    if base_sha is None:
        with open(os.path.join(LOCAL, "WHATS-NEW.md"), "rb") as fh:
            seed = base64.b64encode(fh.read()).decode()
        ghapi("PUT", f"/repos/{OWNER}/{REPO}/contents/WHATS-NEW.md",
              {"message": "Seed initial commit", "content": seed})
        ref = ghapi("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main")
        base_sha = ref["object"]["sha"]
        print("seeded initial commit:", base_sha[:12])
    print("base:", base_sha)

    files = []
    for root, dirs, fs in os.walk(LOCAL):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS)
        for f in sorted(fs):
            if f in EXCLUDE_FILES:
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, LOCAL)
            with open(full, "rb") as fh:
                files.append((rel, fh.read()))
    assert not any(rel.startswith("data/") for rel, _ in files), "data/ leaked into push set!"
    assert not any(rel.startswith("dist/") for rel, _ in files), "dist/ leaked into push set!"
    print(f"push set: {len(files)} files, {sum(len(b) for _, b in files)/1e6:.1f} MB")

    entries = []
    for rel, raw in files:
        blob = post_blob(raw, rel)
        entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print(f"blobs uploaded: {len(entries)}")

    tree = ghapi("POST", f"/repos/{OWNER}/{REPO}/git/trees", {"tree": entries})
    print("tree:", tree["sha"][:12])

    commit_sha = None
    for attempt in range(8):
        ref = ghapi("GET", f"/repos/{OWNER}/{REPO}/git/ref/heads/main")
        base = ref["object"]["sha"]
        commit = ghapi("POST", f"/repos/{OWNER}/{REPO}/git/commits", {
            "message": "Beta colony: real topography + claim markers + distress beacons + home desks",
            "tree": tree["sha"], "parents": [base]})
        commit_sha = commit["sha"]
        try:
            ghapi("PATCH", f"/repos/{OWNER}/{REPO}/git/refs/heads/main",
                  {"sha": commit_sha, "force": False}, raise_http=True)
            print(f"ref updated: {base[:12]} -> {commit_sha[:12]} (attempt {attempt + 1})")
            break
        except urllib.error.HTTPError as e:
            if e.code == 422 and attempt + 1 < 8:
                print(f"PATCH 422 (HEAD moved mid-push) — retry {attempt + 2}/8")
                time.sleep(2)
                continue
            raise
    else:
        print("FAILED: ref PATCH lost the race 8 times")
        sys.exit(1)
    print("commit:", commit_sha[:12])

    pages = ghapi("GET", f"/repos/{OWNER}/{REPO}/pages", ok404=True)
    source = {"branch": "main", "path": "/docs"}
    if pages is None:
        ghapi("POST", f"/repos/{OWNER}/{REPO}/pages",
              {"source": source, "build_type": "legacy"})
        print("Pages enabled")
    else:
        ghapi("PUT", f"/repos/{OWNER}/{REPO}/pages",
              {"source": source, "build_type": "legacy"})
        print("Pages source confirmed main:/docs")
    print("BETA (after Pages build, a few minutes): https://icyunvbankai.github.io/ziggy-colony-beta/")
    print("Check build: GET /repos/{OWNER}/{REPO}/pages/builds/latest")

if __name__ == "__main__":
    main()
