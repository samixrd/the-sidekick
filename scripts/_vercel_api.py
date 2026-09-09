import json, re, subprocess, urllib.request

import json, re, os, urllib.request
token = json.load(open(os.path.expandvars(r"%APPDATA%/com.vercel.cli/Data/auth.json")))["token"]
team = "samixrd"
print("token len:", len(token), "| team:", team[:30])

# whoami may print account name; need teamId: use /v2/user to get teams
req = urllib.request.Request("https://api.vercel.com/v2/user", headers={"Authorization": f"Bearer {token}"})
u = json.load(urllib.request.urlopen(req))
teams = u.get("user", {}).get("teams", [])
print("teams:", [(t.get("slug"), t.get("id")) for t in teams])

# find the-sidekick project
req = urllib.request.Request(f"https://api.vercel.com/v9/projects/the-sidekick?limit=1",
                             headers={"Authorization": f"Bearer {token}"})
try:
    proj = json.load(urllib.request.urlopen(req))
except Exception as e:
    print("project fetch failed:", e)
    raise SystemExit
pid = proj["id"]; tid = proj.get("teamId") or teams[0]["id"]
print("project:", pid, "team:", tid)

env = {}
for line in open("D:/The Sidekick/.env", encoding="utf-8"):
    mm = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$', line)
    if mm: env[mm.group(1)] = mm.group(2).strip()
env["NEXT_PUBLIC_APP_URL"] = "https://the-sidekick.vercel.app"

existing = json.load(urllib.request.urlopen(urllib.request.Request(
    f"https://api.vercel.com/v10/projects/{pid}/env?teamId={tid}&decrypt=false",
    headers={"Authorization": f"Bearer {token}"})))["env"]
have = {e["key"] for e in existing if "production" in e.get("target", [])}

for k in ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_APP_URL"]:
    if k in have:
        print(k, "already set"); continue
    body = json.dumps({"key": k, "value": env[k], "target": ["production"], "type": "plain"}).encode()
    req = urllib.request.Request(f"https://api.vercel.com/v10/projects/{pid}/env?teamId={tid}",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req))
        print(k, "-> created", r.get("created", {}).get("id", "?"))
    except Exception as e:
        print(k, "-> FAIL:", getattr(e, "read", lambda: b"")().decode()[:200])
