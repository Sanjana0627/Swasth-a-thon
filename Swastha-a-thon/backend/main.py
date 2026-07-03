"""
IronQuest — FastAPI Backend v3.2
Added:
  - Progress Tracking Storage (JSON file-based)
  - /api/progress/snapshot   POST  — save a student snapshot
  - /api/progress/<name>     GET   — get full history for a student
  - /api/progress/all        GET   — all students summary (for monitoring)
  - /progress                GET   — admin dashboard HTML page
Run:
  cd backend && pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
  Open: http://localhost:8000
"""

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import httpx, numpy as np, io, os, random, json, threading
from datetime import datetime, date
from pathlib import Path
from typing import Optional

# ── PROGRESS STORAGE ────────────────────────────────────────
DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)
PROGRESS_FILE = DATA_DIR / "progress.json"
_lock = threading.Lock()

def load_progress() -> dict:
    """Load all progress data from disk."""
    with _lock:
        if not PROGRESS_FILE.exists():
            return {}
        try:
            return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}

def save_progress(data: dict):
    """Save all progress data to disk atomically."""
    with _lock:
        tmp = PROGRESS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(PROGRESS_FILE)
        print(f"✅ Progress saved → {PROGRESS_FILE}  ({len(data)} students)")
# ────────────────────────────────────────────────────────────

# ── CONFIG ──────────────────────────────────────────────────
MODEL_PATH  = "../models/model.h5"
INPUT_SIZE  = (224, 224)
CLASS_NAMES = ["Healthy", "Mild Anemia", "Moderate Anemia", "Severe Anemia"]
SCORE_MAP   = {0: 95, 1: 65, 2: 40, 3: 15}
XP_MAP      = {0: 100, 1: 60, 2: 35, 3: 15}
RECS = {
    0: "Great iron levels! Keep eating spinach, lentils, pomegranate and jaggery. 💪",
    1: "Mild anemia detected. Increase iron-rich foods and visit a doctor. 🟡",
    2: "Moderate anemia. Please consult a doctor for proper supplementation. 🟠",
    3: "Severe anemia detected. Seek medical attention immediately! 🔴",
}

OLLAMA_BASE  = "http://localhost:11434"
OLLAMA_GEN   = f"{OLLAMA_BASE}/api/generate"
OLLAMA_TAGS  = f"{OLLAMA_BASE}/api/tags"

# Priority list – we try these in order and pick the first one that's installed
PREFERRED_MODELS = ["gemma2:2b", "gemma:2b", "tinyllama", "phi3:mini",
                    "mistral:7b-instruct-q4_0", "llama3", "llama2"]

SYSTEM_PROMPT = (
    "You are IronBot, the friendly AI health assistant inside IronQuest — "
    "a gamified anemia-management app for Indian teenagers aged 10-18. "
    "Answer questions about anemia, iron-rich Indian foods, game mechanics (XP, avatar stats, battles), "
    "and healthy habits. Keep answers SHORT (2-4 sentences), friendly, and use occasional emojis. "
    "Never give a clinical diagnosis — always recommend consulting a doctor for medical concerns. "
    "CRITICAL: You are ONLY IronBot. Never write dialogue for the user. Never repeat these instructions. "
    "Respond with plain helpful text only."
)
# ────────────────────────────────────────────────────────────

app = FastAPI(title="IronQuest API", version="3.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

FRONTEND_DIR = Path(__file__).parent.parent

# ── ML Model ────────────────────────────────────────────────
model, model_loaded = None, False
try:
    mp = FRONTEND_DIR / "models" / "model.h5"
    if mp.exists():
        from tensorflow.keras.models import load_model
        from PIL import Image
        model = load_model(str(mp))
        model_loaded = True
        print(f"✅ ML Model loaded: {mp}")
    else:
        print(f"⚠️  No model at {mp} — simulation mode")
        try: from PIL import Image
        except: pass
except Exception as e:
    print(f"⚠️  Model load error: {e}")
    try: from PIL import Image
    except: pass

# ── Detect which Ollama model is available ──────────────────
active_model: str = PREFERRED_MODELS[-1]   # fallback

async def detect_ollama_model() -> str:
    global active_model
    try:
        async with httpx.AsyncClient(timeout=4.0) as c:
            r = await c.get(OLLAMA_TAGS)
            if r.status_code == 200:
                names = [m["name"].split(":")[0]+":"+m["name"].split(":")[1]
                         if ":" in m["name"] else m["name"]
                         for m in r.json().get("models", [])]
                full  = [m["name"] for m in r.json().get("models", [])]
                for pref in PREFERRED_MODELS:
                    base = pref.split(":")[0]
                    for fn in full:
                        if fn.startswith(base):
                            active_model = fn
                            print(f"🤖 Ollama model selected: {active_model}")
                            return active_model
    except Exception as e:
        print(f"⚠️  Ollama not reachable: {e}")
    return active_model

@app.on_event("startup")
async def startup():
    await detect_ollama_model()

# ══════════════════════════════════════════════════════════
# FRONTEND ROUTES
# ══════════════════════════════════════════════════════════
@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    p = FRONTEND_DIR / "index.html"
    return HTMLResponse(p.read_text(encoding="utf-8") if p.exists()
                        else "<h1>index.html not found in project root</h1>")

@app.get("/game.js")
async def serve_game_js():
    p = FRONTEND_DIR / "game.js"
    if p.exists():
        return FileResponse(str(p), media_type="application/javascript")
    raise HTTPException(404, "game.js not found")

# ══════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════
@app.get("/api/status")
async def status():
    model_name = await detect_ollama_model()
    return {"app": "IronQuest API v3.1", "model_loaded": model_loaded,
            "ollama_model": model_name, "classes": CLASS_NAMES}

@app.get("/api/health")
def health(): return {"status": "ok", "model_ready": model_loaded}

# ── ML Predict ──────────────────────────────────────────────
def preprocess(image_bytes: bytes):
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB").resize(INPUT_SIZE)
    return np.expand_dims(np.array(img, dtype=np.float32) / 255.0, 0)

@app.post("/api/predict")
async def predict(file: UploadFile = File(...)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(400, "Only image files accepted.")
    data = await file.read()
    if model_loaded and model:
        try:
            raw = model.predict(preprocess(data), verbose=0)[0]
            cls, conf = int(np.argmax(raw)), int(round(float(raw.max()) * 100))
            return {"status": CLASS_NAMES[cls], "confidence": conf,
                    "iron_score": SCORE_MAP[cls], "xp_gain": XP_MAP[cls],
                    "recommendation": RECS[cls], "model_used": "real",
                    "class_probabilities": [round(float(p)*100,2) for p in raw]}
        except Exception as e:
            raise HTTPException(500, f"Inference error: {e}")
    cls  = random.choices([0,1,2,3], weights=[50,30,15,5])[0]
    conf = random.randint(78, 97)
    return {"status": CLASS_NAMES[cls], "confidence": conf,
            "iron_score": SCORE_MAP[cls], "xp_gain": XP_MAP[cls],
            "recommendation": RECS[cls], "model_used": "simulation"}

# ── Chatbot (Ollama streaming) ───────────────────────────────
class ChatReq(BaseModel):
    message: str
    history: list = []

@app.post("/api/chat")
async def chat(req: ChatReq):
    """
    Streams token-by-token from Ollama so the UI shows text as it arrives.
    Falls back to a friendly error if Ollama isn't running.
    """
    # Build the prompt using a universal format compatible with all Ollama models
    prompt = f"### System\n{SYSTEM_PROMPT}\n\n"
    for turn in req.history[-6:]:
        role = "User" if turn.get("role") == "user" else "IronBot"
        prompt += f"### {role}\n{turn.get('content','')}\n\n"
    prompt += f"### User\n{req.message}\n\n### IronBot\n"

    payload = {
        "model":  active_model,
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": 0.7,
            "top_p": 0.9,
            "num_predict": 200,
            "stop": ["### User", "### System", "\nUser:", "\nHuman:",
                     "[STUDENT]", "[SYS]", "<</SYS>>", "<<SYS>>"]
        }
    }

    async def stream_tokens():
        full = ""
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=5.0)) as client:
                async with client.stream("POST", OLLAMA_GEN, json=payload) as resp:
                    if resp.status_code != 200:
                        yield json.dumps({"token": "", "done": True,
                            "reply": f"Ollama returned HTTP {resp.status_code}. "
                                     "Run `ollama serve` and try again.",
                            "error": "ollama_error"}) + "\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                            token = chunk.get("response", "")
                            full += token
                            done  = chunk.get("done", False)
                            yield json.dumps({"token": token, "done": done,
                                              "reply": full if done else ""}) + "\n"
                            if done:
                                break
                        except json.JSONDecodeError:
                            pass
        except httpx.ConnectError:
            yield json.dumps({
                "token": "", "done": True,
                "reply": ("⚠️ Ollama is not running!\n"
                          "Fix: open a terminal and run:\n"
                          "  ollama serve\n"
                          "Then install a lightweight model:\n"
                          "  ollama pull gemma2:2b"),
                "error": "ollama_offline"
            }) + "\n"
        except httpx.ReadTimeout:
            yield json.dumps({
                "token": "", "done": True,
                "reply": ("⏱️ Model timed out (too slow on your CPU).\n"
                          "Install a smaller model:\n"
                          "  ollama pull gemma2:2b\n"
                          "  ollama pull tinyllama"),
                "error": "timeout"
            }) + "\n"

    return StreamingResponse(stream_tokens(), media_type="text/plain")

# ── Game Data ────────────────────────────────────────────────
@app.get("/api/leaderboard")
def leaderboard():
    return {"leaderboard": [
        {"rank":1,"name":"Phoenix Warriors","school":"DPS Mumbai",   "score":15240,"level":15},
        {"rank":2,"name":"Iron Titans",      "school":"KV Bangalore","score":14890,"level":14},
        {"rank":3,"name":"Health Heroes",    "school":"DAV Pune",    "score":14120,"level":13},
        {"rank":4,"name":"Wellness Wizards", "school":"Ryan Delhi",  "score":13450,"level":12},
        {"rank":5,"name":"Vitality Squad",   "school":"St. Xavier's","score":12980,"level":11},
        {"rank":6,"name":"Iron Champions",   "school":"KV Hyderabad","score":11200,"level":10},
        {"rank":7,"name":"Anemia Slayers",   "school":"DAV Chennai", "score":10500,"level": 9},
    ], "last_updated": date.today().isoformat()}

@app.get("/api/daily-challenge")
def daily_challenge():
    c = [
        {"id":1,"title":"Iron Feast!",     "desc":"Eat 3 iron-rich foods today",            "xp":80, "icon":"🥗"},
        {"id":2,"title":"Supplement Hero", "desc":"Take your iron supplement on time",      "xp":60, "icon":"💊"},
        {"id":3,"title":"Spinach Warrior", "desc":"Include spinach in any meal",            "xp":50, "icon":"🥬"},
        {"id":4,"title":"Hydration Quest", "desc":"Drink 8 full glasses of water",          "xp":40, "icon":"💧"},
        {"id":5,"title":"Morning Scan",    "desc":"Upload image for AI health analysis",    "xp":100,"icon":"📸"},
        {"id":6,"title":"Recipe Explorer", "desc":"Try a new iron-rich recipe today",       "xp":70, "icon":"🍳"},
        {"id":7,"title":"Vitamin C Boost", "desc":"Pair iron food with a citrus fruit",     "xp":45, "icon":"🍊"},
    ]
    return {"challenge": c[datetime.now().timetuple().tm_yday % len(c)],
            "date": date.today().isoformat()}

@app.get("/api/badges")
def badges():
    return {"badges": [
        {"id":"first_scan", "name":"First Scan",      "icon":"📸","xp":50},
        {"id":"iron_hero",  "name":"Iron Hero",       "icon":"🦸","xp":200},
        {"id":"week_streak","name":"7-Day Streak",    "icon":"🔥","xp":150},
        {"id":"food_champ", "name":"Food Champion",   "icon":"🍎","xp":300},
        {"id":"level_10",   "name":"Level 10 Legend", "icon":"⭐","xp":500},
        {"id":"battle_win", "name":"Battle Winner",   "icon":"⚔️","xp":250},
    ]}


# ════════════════════════════════════════════════════════
# PROGRESS TRACKING  (start-to-end monitoring)
# ════════════════════════════════════════════════════════

class ProgressSnapshot(BaseModel):
    """Sent by the frontend every time a student's state changes meaningfully."""
    student_id:  str          # localStorage key / warrior name + timestamp on first run
    name:        str
    iron_score:  int
    level:       int
    xp:          int
    coins:       int
    streak:      int
    battle_wins: int
    badges:      list
    energy:      Optional[int] = None   # from the slider (0-10)
    scan_status: Optional[str] = None   # e.g. "Mild Anemia"
    note:        Optional[str] = None   # free-text, e.g. "after scan", "daily login"

@app.post("/api/progress/snapshot")
def save_snapshot(snap: ProgressSnapshot):
    """
    Called by the frontend to persist a progress snapshot.
    Each student gets a list of timestamped entries.
    The very first entry is automatically tagged as the baseline.
    """
    all_data = load_progress()
    sid = snap.student_id

    entry = {
        "ts":          datetime.now().isoformat(timespec="seconds"),
        "date":        date.today().isoformat(),
        "iron_score":  snap.iron_score,
        "level":       snap.level,
        "xp":          snap.xp,
        "coins":       snap.coins,
        "streak":      snap.streak,
        "battle_wins": snap.battle_wins,
        "badges":      snap.badges,
        "energy":      snap.energy,
        "scan_status": snap.scan_status,
        "note":        snap.note or "auto",
    }

    if sid not in all_data:
        # Very first snapshot → create student record with baseline
        all_data[sid] = {
            "name":     snap.name,
            "baseline": entry,          # frozen – never overwritten
            "history":  [entry],
        }
    else:
        # Keep name up-to-date, append to history (max 500 entries)
        all_data[sid]["name"] = snap.name
        all_data[sid]["history"].append(entry)
        if len(all_data[sid]["history"]) > 500:
            all_data[sid]["history"] = all_data[sid]["history"][-500:]

    save_progress(all_data)
    total = len(all_data[sid]["history"])
    return {"ok": True, "snapshots": total,
            "is_baseline": total == 1,
            "student": snap.name}


@app.get("/api/progress/{student_id}")
def get_student_progress(student_id: str):
    """
    Returns the full history + computed diff (latest vs baseline) for one student.
    """
    all_data = load_progress()
    if student_id not in all_data:
        raise HTTPException(404, f"No data for student '{student_id}'")

    rec = all_data[student_id]
    base    = rec["baseline"]
    latest  = rec["history"][-1]
    history = rec["history"]

    def diff(key):
        b, l = base.get(key, 0) or 0, latest.get(key, 0) or 0
        return {"baseline": b, "latest": l, "change": l - b,
                "improved": l > b}

    return {
        "student_id":  student_id,
        "name":        rec["name"],
        "total_snapshots": len(history),
        "first_seen":  history[0]["ts"],
        "last_seen":   history[-1]["ts"],
        "baseline":    base,
        "latest":      latest,
        "diff": {
            "iron_score":  diff("iron_score"),
            "level":       diff("level"),
            "xp":          diff("xp"),
            "battle_wins": diff("battle_wins"),
            "streak":      diff("streak"),
            "coins":       diff("coins"),
        },
        "badges_gained": [
            b for b in (latest.get("badges") or [])
            if b not in (base.get("badges") or [])
        ],
        "history": history,
    }


@app.get("/api/progress/all")
def get_all_progress():
    """
    Summary view of every student — for the monitoring dashboard.
    """
    all_data = load_progress()
    rows = []
    for sid, rec in all_data.items():
        base   = rec["baseline"]
        latest = rec["history"][-1] if rec["history"] else base
        rows.append({
            "student_id":         sid,
            "name":               rec["name"],
            "total_snapshots":    len(rec["history"]),
            "first_seen":         rec["history"][0]["ts"]  if rec["history"] else "",
            "last_seen":          rec["history"][-1]["ts"] if rec["history"] else "",
            "baseline_iron":      base.get("iron_score", 0),
            "latest_iron":        latest.get("iron_score", 0),
            "iron_change":        (latest.get("iron_score",0) or 0) - (base.get("iron_score",0) or 0),
            "baseline_level":     base.get("level", 1),
            "latest_level":       latest.get("level", 1),
            "latest_streak":      latest.get("streak", 0),
            "latest_battle_wins": latest.get("battle_wins", 0),
            "badges_gained":      len([
                b for b in (latest.get("badges") or [])
                if b not in (base.get("badges") or [])
            ]),
        })
    # Sort: biggest iron improvement first
    rows.sort(key=lambda r: r["iron_change"], reverse=True)
    return {"total_students": len(rows), "students": rows,
            "generated": datetime.now().isoformat(timespec="seconds")}


# ══ PROGRESS DASHBOARD (admin HTML page) ═════════════════════════
@app.get("/progress", response_class=HTMLResponse)
async def progress_dashboard():
    return HTMLResponse(content="""
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>IronQuest — Progress Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet"/>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Nunito',sans-serif;background:#080812;color:#f1f5f9;min-height:100vh;}
h1,h2,h3{font-family:'Fredoka One',cursive;}
.header{background:linear-gradient(135deg,#7c3aed,#ec4899);padding:20px 32px;display:flex;align-items:center;gap:16px;box-shadow:0 4px 20px rgba(124,58,237,.4);}
.header h1{font-size:26px;letter-spacing:.02em;}
.header .sub{font-size:13px;opacity:.8;margin-top:3px;}
.badge{background:rgba(255,255,255,.2);border-radius:20px;padding:3px 12px;font-size:12px;font-weight:700;}
.container{max-width:1200px;margin:0 auto;padding:28px 20px;}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;}
.stat-card{background:#13131f;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px 20px;}
.stat-card .num{font-family:'Fredoka One',cursive;font-size:34px;background:linear-gradient(135deg,#a78bfa,#ec4899);-webkit-background-clip:text;-webkit-text-fill-color:transparent;}
.stat-card .lbl{font-size:12px;color:#64748b;margin-top:4px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
.table-wrap{background:#13131f;border:1px solid rgba(255,255,255,.07);border-radius:16px;overflow:hidden;margin-bottom:28px;}
.table-header{display:grid;grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;padding:12px 20px;background:rgba(124,58,237,.15);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;}
.table-row{display:grid;grid-template-columns:2fr 1.2fr 1.2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;padding:13px 20px;border-top:1px solid rgba(255,255,255,.05);font-size:13px;transition:background .15s;cursor:pointer;}
.table-row:hover{background:rgba(124,58,237,.08);}
.name-cell{font-weight:700;}
.iron-pill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700;}
.up{color:#10b981;} .down{color:#ef4444;} .same{color:#64748b;}
.arrow-up::before{content:'▲ ';font-size:10px;} .arrow-down::before{content:'▼ ';font-size:10px;}
.detail-panel{display:none;background:#0f0f1a;border:1px solid rgba(124,58,237,.3);border-radius:14px;padding:22px;margin-bottom:20px;}
.detail-panel.open{display:block;}
.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-top:14px;}
.detail-card{background:#13131f;border-radius:10px;padding:12px 14px;text-align:center;}
.detail-card .dc-num{font-family:'Fredoka One',cursive;font-size:22px;}
.detail-card .dc-lbl{font-size:11px;color:#64748b;margin-top:2px;}
.history-table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px;}
.history-table th{background:rgba(255,255,255,.06);padding:7px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;}
.history-table td{padding:7px 10px;border-top:1px solid rgba(255,255,255,.05);color:#cbd5e1;}
.history-table tr:hover td{background:rgba(124,58,237,.06);}
.refresh-btn{background:linear-gradient(135deg,#7c3aed,#ec4899);border:none;color:white;padding:10px 22px;border-radius:20px;font-family:'Nunito',sans-serif;font-weight:800;font-size:13px;cursor:pointer;transition:all .2s;}
.refresh-btn:hover{transform:translateY(-2px);box-shadow:0 5px 16px rgba(124,58,237,.5);}
.empty{text-align:center;padding:60px 20px;color:#64748b;}
.empty .emo{font-size:48px;margin-bottom:14px;}
.search{background:#13131f;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:9px 14px;color:#f1f5f9;font-family:'Nunito',sans-serif;font-size:13px;width:100%;max-width:320px;outline:none;margin-bottom:20px;}
.search:focus{border-color:#7c3aed;}
.tag-pos{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3);border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;}
.tag-neg{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;}
.tag-neu{background:rgba(100,116,139,.15);color:#94a3b8;border:1px solid rgba(100,116,139,.2);border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;}
.scan-healthy{color:#10b981;font-weight:700;} .scan-mild{color:#f59e0b;font-weight:700;}
.scan-moderate{color:#ef4444;font-weight:700;} .scan-severe{color:#dc2626;font-weight:700;}
@media(max-width:700px){.table-header,.table-row{grid-template-columns:1fr 1fr 1fr;}.c-hide{display:none;}}
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>&#9878; IronQuest Progress Dashboard</h1>
    <div class="sub">Real-time start-to-end monitoring for every student • <span class="badge">Admin View</span></div>
  </div>
  <div style="margin-left:auto;display:flex;gap:10px;align-items:center;">
    <button class="refresh-btn" onclick="loadAll()">&#8635; Refresh</button>
  </div>
</div>

<div class="container">
  <div class="stats-row" id="statsRow">
    <div class="stat-card"><div class="num" id="totalStudents">-</div><div class="lbl">Students Tracked</div></div>
    <div class="stat-card"><div class="num" id="avgImprove">-</div><div class="lbl">Avg Iron Improvement</div></div>
    <div class="stat-card"><div class="num" id="improvedCount">-</div><div class="lbl">Improved Iron Score</div></div>
    <div class="stat-card"><div class="num" id="totalSnaps">-</div><div class="lbl">Total Snapshots</div></div>
  </div>

  <input class="search" id="searchBox" placeholder="&#128269; Search by student name..." oninput="filterRows()"/>

  <div class="table-wrap">
    <div class="table-header">
      <span>Student</span>
      <span>Iron: Start &rarr; Now</span>
      <span>Change</span>
      <span class="c-hide">Level</span>
      <span class="c-hide">Streak</span>
      <span class="c-hide">Wins</span>
      <span class="c-hide">Badges</span>
      <span>Snapshots</span>
    </div>
    <div id="tableBody"><div class="empty"><div class="emo">⏳</div>Loading data…</div></div>
  </div>

  <div id="detailSection"></div>
</div>

<script>
let allStudents = [];

async function loadAll() {
  document.getElementById('tableBody').innerHTML = '<div class="empty"><div class="emo">⏳</div>Loading…</div>';
  try {
    const r = await fetch('/api/progress/all');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    allStudents = d.students || [];
    renderSummary(d);
    renderTable(allStudents);
  } catch(e) {
    document.getElementById('tableBody').innerHTML =
      `<div class="empty"><div class="emo">⚠️</div>Error: ${e.message}</div>`;
  }
}

function renderSummary(d) {
  const ss = d.students || [];
  document.getElementById('totalStudents').textContent = ss.length;
  document.getElementById('totalSnaps').textContent = ss.reduce((a,s)=>a+s.total_snapshots,0);
  const improved = ss.filter(s=>s.iron_change>0);
  document.getElementById('improvedCount').textContent = improved.length;
  const avg = improved.length ? Math.round(improved.reduce((a,s)=>a+s.iron_change,0)/improved.length) : 0;
  document.getElementById('avgImprove').textContent = (avg>=0?'+':'')+avg;
}

function renderTable(students) {
  const tb = document.getElementById('tableBody');
  if (!students.length) {
    tb.innerHTML = `<div class="empty">
      <div class="emo">🟣</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:8px;">No student data yet</div>
      <div style="font-size:13px;color:#94a3b8;">Play IronQuest to start generating progress records.<br>Data is saved automatically on each action.</div></div>`;
    return;
  }
  tb.innerHTML = students.map(s => {
    const chg = s.iron_change;
    const chgClass = chg>0?'up':chg<0?'down':'same';
    const arrow = chg>0?'arrow-up':chg<0?'arrow-down':'';
    const tag = chg>0?`<span class="tag-pos">+${chg}</span>`
                    :chg<0?`<span class="tag-neg">${chg}</span>`
                    :`<span class="tag-neu">0</span>`;
    return `<div class="table-row" onclick="toggleDetail('${s.student_id}')">
      <span class="name-cell">📍 ${s.name}</span>
      <span>${s.baseline_iron} &rarr; <b>${s.latest_iron}</b></span>
      <span>${tag}</span>
      <span class="c-hide">${s.baseline_level} &rarr; ${s.latest_level}</span>
      <span class="c-hide">${s.latest_streak} 🔥</span>
      <span class="c-hide">${s.latest_battle_wins} ⚔️</span>
      <span class="c-hide">+${s.badges_gained} 🏅</span>
      <span>${s.total_snapshots}</span>
    </div>`;
  }).join('');
}

function filterRows() {
  const q = document.getElementById('searchBox').value.toLowerCase();
  renderTable(allStudents.filter(s=>s.name.toLowerCase().includes(q)));
}

async function toggleDetail(sid) {
  const sec = document.getElementById('detailSection');
  // close if same
  if (sec.dataset.open === sid) { sec.innerHTML=''; sec.dataset.open=''; return; }
  sec.dataset.open = sid;
  sec.innerHTML = '<div class="detail-panel open" style="text-align:center;padding:28px;"><span style="color:#a78bfa;">Loading details…</span></div>';
  try {
    const r = await fetch(`/api/progress/${encodeURIComponent(sid)}`);
    const d = await r.json();
    const diff = d.diff;
    const scanColor = (s) => {
      if (!s) return '';
      if (s.includes('Healthy')) return 'scan-healthy';
      if (s.includes('Mild')) return 'scan-mild';
      if (s.includes('Moderate')) return 'scan-moderate';
      return 'scan-severe';
    };
    const histRows = [...d.history].reverse().slice(0,20).map(h => `
      <tr>
        <td>${h.date} ${h.ts.split('T')[1]}</td>
        <td><b>${h.iron_score}</b></td>
        <td>${h.level}</td>
        <td>${h.xp}</td>
        <td>${h.streak} 🔥</td>
        <td>${h.battle_wins} ⚔️</td>
        <td class="${scanColor(h.scan_status)}">${h.scan_status||'—'}</td>
        <td>${h.note}</td>
      </tr>`).join('');

    sec.innerHTML = `<div class="detail-panel open">
      <h2 style="font-size:19px;margin-bottom:4px;">🗒 ${d.name} &mdash; Full Progress Report</h2>
      <div style="font-size:12px;color:#64748b;">First seen: ${d.first_seen} &bull; Last seen: ${d.last_seen} &bull; ${d.total_snapshots} snapshots</div>

      <div class="detail-grid">
        <div class="detail-card">
          <div class="dc-num" style="color:${diff.iron_score.improved?'#10b981':'#ef4444'}">
            ${diff.iron_score.baseline}&rarr;${diff.iron_score.latest}
          </div>
          <div class="dc-lbl">🦠 Iron Score</div>
          <div style="font-size:11px;margin-top:3px;color:${diff.iron_score.change>=0?'#10b981':'#ef4444'}">
            ${diff.iron_score.change>=0?'+':''}${diff.iron_score.change}
          </div>
        </div>
        <div class="detail-card">
          <div class="dc-num" style="color:#a78bfa">${diff.level.baseline}&rarr;${diff.level.latest}</div>
          <div class="dc-lbl">⭐ Level</div>
          <div style="font-size:11px;margin-top:3px;color:#10b981">+${diff.level.change}</div>
        </div>
        <div class="detail-card">
          <div class="dc-num" style="color:#f59e0b">${diff.xp.baseline}&rarr;${diff.xp.latest}</div>
          <div class="dc-lbl">⚡ XP Earned</div>
          <div style="font-size:11px;margin-top:3px;color:#10b981">+${diff.xp.change}</div>
        </div>
        <div class="detail-card">
          <div class="dc-num" style="color:#ec4899">${diff.battle_wins.latest}</div>
          <div class="dc-lbl">⚔️ Battle Wins</div>
          <div style="font-size:11px;margin-top:3px;color:#10b981">+${diff.battle_wins.change} from start</div>
        </div>
        <div class="detail-card">
          <div class="dc-num" style="color:#f59e0b">${diff.streak.latest}</div>
          <div class="dc-lbl">🔥 Current Streak</div>
        </div>
        <div class="detail-card">
          <div class="dc-num" style="color:#10b981">${d.badges_gained.length}</div>
          <div class="dc-lbl">🏅 Badges Earned</div>
          <div style="font-size:11px;margin-top:3px;color:#94a3b8">${d.badges_gained.join(', ')||'none yet'}</div>
        </div>
      </div>

      <h3 style="font-size:14px;margin:20px 0 8px;color:#a78bfa;">&#128202; Recent Snapshots (latest 20)</h3>
      <div style="overflow-x:auto;">
        <table class="history-table">
          <thead><tr><th>Time</th><th>Iron</th><th>Lvl</th><th>XP</th><th>Streak</th><th>Wins</th><th>Scan</th><th>Note</th></tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>
    </div>`;
  } catch(e) {
    sec.innerHTML = `<div class="detail-panel open" style="color:#ef4444;">Error: ${e.message}</div>`;
  }
}

loadAll();
setInterval(loadAll, 30000); // auto-refresh every 30s
</script>
</body>
</html>
""")
