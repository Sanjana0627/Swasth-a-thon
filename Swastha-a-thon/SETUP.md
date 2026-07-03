# IronQuest — Complete Setup Guide

## Project Structure

Swastha-a-thon/
├── index.html          ← Main frontend (open in browser)
├── game.js             ← All game logic (avatar, quests, XP, battle)
├── backend/
│   ├── main.py         ← FastAPI server + ML model loader
│   └── requirements.txt
├── models/             ← PUT YOUR .h5 MODEL FILE HERE
│   └── (your_model.h5)
└── assets/             ← (existing CSS/JS assets)

---

## STEP 1 — Connect Your ML Model

1. Copy your trained `.h5` file into the `models/` folder:
   models/your_model.h5

2. Open `backend/main.py` and update line 11:
   MODEL_PATH = "../models/your_model.h5"   ← exact filename

3. Check your model's input image size (default is 224×224):
   INPUT_SIZE = (224, 224)   ← change if your model uses different size

4. Update CLASS_NAMES to match your model's output classes:
   CLASS_NAMES = ["Healthy", "Mild Anemia", "Moderate Anemia", "Severe Anemia"]
   (Keep the order the same as your training labels)

---

## STEP 2 — Run the Backend (FastAPI)

Open a terminal inside the Swastha-a-thon folder:

cd backend

# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate       # Linux/Mac
# OR: venv\Scripts\activate    # Windows

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000

You should see:
  INFO:     Uvicorn running on http://0.0.0.0:8000

Test it by visiting: http://localhost:8000
And the predict endpoint: http://localhost:8000/docs (Swagger UI)

---

## STEP 3 — Open the Frontend

Simply open index.html in your browser.

For best results, serve it locally:
  cd ..  (back to Swastha-a-thon root)
  python3 -m http.server 3000
  # Then visit: http://localhost:3000

---

## STEP 4 — How It All Works Together

User uploads image → game.js calls http://localhost:8000/predict
     ↓
FastAPI loads your .h5 model, runs prediction
     ↓
Returns: { status, confidence, iron_score, xp_gain, recommendation }
     ↓
Frontend updates avatar stats + awards XP

---

## API Endpoints

| Endpoint           | Method | Description                          |
|--------------------|--------|--------------------------------------|
| /                  | GET    | API status + model info              |
| /health            | GET    | Health check                         |
| /predict           | POST   | Upload image → get prediction        |
| /leaderboard       | GET    | Top 5 teams                          |
| /daily-challenge   | GET    | Today's health challenge             |
| /badges            | GET    | Full badge catalogue                 |
| /docs              | GET    | Auto-generated Swagger UI            |

---

## Game Features Explained

AVATAR SYSTEM
- Avatar has 3 stats: Health, Energy, Strength
- Stats are calculated from iron_score (from AI scan) + player level
- Higher iron_score → stronger avatar
- Customise avatar color and style from the HUD

QUEST SYSTEM
- 8 daily quests (reset every day)
- Click to mark complete and earn XP + coins
- Completing 10 total quests unlocks the "Food Champion" badge

BATTLE ARENA
- Simple HP-based battle against the Iron Goblin
- Your attack strength depends on your avatar's Strength stat
- Winning earns XP

XP & LEVELLING
- Every action earns XP (scans, quests, battles, daily challenges, login streak)
- Level up when XP bar fills — xpToNext grows by 40% each level
- Coins earned = XP / 2

STREAK SYSTEM
- Log in daily to grow your streak counter
- Each streak day multiplies your bonus XP by streak count

BADGES (5 total)
- First Scan:     Complete your first AI scan
- Iron Hero:      Get an iron_score >= 85
- 7-Day Streak:   Log in 7 consecutive days
- Food Champion:  Complete 10 quests total
- Level 10:       Reach Level 10

CHATBOT
- Keyword-based instant replies about anemia, foods, game mechanics
- Available from the floating chat button (bottom right)

---

## Troubleshooting

PROBLEM: "Cannot reach backend server" in scan result
SOLUTION: Make sure uvicorn is running on port 8000

PROBLEM: Model loads but prediction is wrong
SOLUTION: Check INPUT_SIZE and CLASS_NAMES match your training config

PROBLEM: TensorFlow import error
SOLUTION: pip install tensorflow  (or tensorflow-cpu for lighter install)

PROBLEM: CORS error in browser console
SOLUTION: Backend already has CORS enabled for all origins. Ensure you're
          calling http://localhost:8000 not https://

---

## Deploying for Others to Use

1. Backend: Deploy main.py to Render, Railway, or a VPS
2. Frontend: Update API_BASE in game.js to your deployed backend URL
   const API_BASE = "https://your-backend.onrender.com";
3. Push index.html + game.js to GitHub and enable GitHub Pages

---

Built with ❤️ for the Swastha-a-thon hackathon.
