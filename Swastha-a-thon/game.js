// ============================================================
//  IronQuest — game.js  v3.1
//  Fixes: Three.js r128 avatar (no CapsuleGeometry),
//         streaming Ollama chatbot, robust init
// ============================================================

const API = "";  // same-origin: FastAPI serves both HTML and API

// ──────────────────────────────────────────────────────────
//  GAME STATE  (loaded from localStorage on startup)
// ──────────────────────────────────────────────────────────
let gameState = {
  player: {
    name:        localStorage.getItem("iq_name")         || "Warrior",
    level:       parseInt(localStorage.getItem("iq_level")     || "1"),
    xp:          parseInt(localStorage.getItem("iq_xp")        || "0"),
    xpToNext:    parseInt(localStorage.getItem("iq_xpToNext")  || "200"),
    coins:       parseInt(localStorage.getItem("iq_coins")     || "0"),
    streak:      parseInt(localStorage.getItem("iq_streak")    || "0"),
    lastLogin:   localStorage.getItem("iq_lastLogin")    || "",
    ironScore:   parseInt(localStorage.getItem("iq_ironScore") || "50"),
    skinColor:   localStorage.getItem("iq_skinColor")    || "#f5c5a3",
    shirtColor:  localStorage.getItem("iq_shirtColor")   || "#7c3aed",
    pantsColor:  localStorage.getItem("iq_pantsColor")   || "#1e3a5f",
    hairColor:   localStorage.getItem("iq_hairColor")    || "#1a1a1a",
    hairStyle:   localStorage.getItem("iq_hairStyle")    || "short",
    avatarStyle: localStorage.getItem("iq_avatarStyle")  || "warrior",
    accessory:   localStorage.getItem("iq_accessory")    || "sword",
    badges:      JSON.parse(localStorage.getItem("iq_badges")      || "[]"),
    questsDone:  JSON.parse(localStorage.getItem("iq_questsDone")  || "[]"),
    battleWins:  parseInt(localStorage.getItem("iq_battleWins")    || "0"),
  },
  dailyChallenge: null,
  chatHistory: [],
};

function computeStats(ironScore, level) {
  return {
    health:   Math.min(100, Math.round(ironScore * 0.7 + level * 3)),
    energy:   Math.min(100, Math.round(ironScore * 0.5 + level * 4)),
    strength: Math.min(100, Math.round(ironScore * 0.8 + level * 2)),
  };
}

// ──────────────────────────────────────────────────────────
//  3D AVATAR ENGINE  (Three.js r128 — no CapsuleGeometry)
// ──────────────────────────────────────────────────────────
let threeScene, threeCamera, threeRenderer, avatarGroup, threeClock;
let avatarRotating = true;

function capsuleGeometry(radius, length, segs) {
  // Build a capsule from a cylinder + two half-spheres (r128 compatible)
  const merge  = THREE.BufferGeometryUtils
                 ? THREE.BufferGeometryUtils.mergeBufferGeometries
                 : null;
  const cyl    = new THREE.CylinderGeometry(radius, radius, length, segs, 1);
  const top    = new THREE.SphereGeometry(radius, segs, Math.ceil(segs/2), 0, Math.PI*2, 0, Math.PI/2);
  const bot    = new THREE.SphereGeometry(radius, segs, Math.ceil(segs/2), 0, Math.PI*2, Math.PI/2, Math.PI/2);
  // translate half-spheres
  top.translate(0,  length/2, 0);
  bot.translate(0, -length/2, 0);
  if (merge) return merge([cyl, top, bot]);
  // fallback: just return cylinder (still looks fine)
  return cyl;
}

function initAvatar3D(containerId) {
  const container = document.getElementById(containerId);
  if (!container || !window.THREE) {
    console.warn("Three.js not ready or container missing");
    return;
  }

  const W = container.offsetWidth  || 400;
  const H = container.offsetHeight || 420;

  // Scene
  threeScene = new THREE.Scene();
  threeScene.background = new THREE.Color(0x0d0d1a);
  threeScene.fog = new THREE.FogExp2(0x0d0d1a, 0.06);

  // Camera
  threeCamera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
  threeCamera.position.set(0, 1.7, 5.2);
  threeCamera.lookAt(0, 1.2, 0);

  // Renderer
  threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  threeRenderer.setSize(W, H);
  threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  threeRenderer.shadowMap.enabled = true;
  threeRenderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  container.innerHTML = "";
  container.appendChild(threeRenderer.domElement);

  // Lights
  threeScene.add(new THREE.AmbientLight(0xaaaaff, 0.5));

  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  threeScene.add(sun);

  threeScene.add(Object.assign(new THREE.PointLight(0x7c3aed, 3, 8), {position: new THREE.Vector3(-2, 2.5, 1)}));
  threeScene.add(Object.assign(new THREE.PointLight(0xec4899, 2, 8), {position: new THREE.Vector3(2, 1.5, 2)}));
  threeScene.add(Object.assign(new THREE.PointLight(0x06b6d4, 1.5, 6), {position: new THREE.Vector3(0, 4, -2)}));

  // Platform
  const platMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 0.1, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1a3e, roughness: 0.2, metalness: 0.9 })
  );
  platMesh.position.y = 0; platMesh.receiveShadow = true;
  threeScene.add(platMesh);

  // Glow ring
  const ringMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.25, 48),
    new THREE.MeshBasicMaterial({ color: 0x7c3aed, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
  );
  ringMesh.rotation.x = -Math.PI / 2; ringMesh.position.y = 0.06;
  threeScene.add(ringMesh);

  // Particles
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(180 * 3);
  for (let i = 0; i < pPos.length; i++) pPos[i] = (Math.random() - 0.5) * 7;
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  threeScene.add(new THREE.Points(pGeo,
    new THREE.PointsMaterial({ color: 0x7c3aed, size: 0.05, transparent: true, opacity: 0.55 })));

  // Avatar group
  avatarGroup = new THREE.Group();
  avatarGroup.position.y = 0.1;
  threeScene.add(avatarGroup);
  buildAvatarMesh();

  // Drag rotate
  let drag = false, px = 0;
  const el = threeRenderer.domElement;
  const onDown = x => { drag = true; px = x; avatarRotating = false; };
  const onUp   = () => { drag = false; avatarRotating = true; };
  const onMove = x => { if (drag) { avatarGroup.rotation.y += (x - px) * 0.013; px = x; } };
  el.addEventListener("mousedown",  e => onDown(e.clientX));
  el.addEventListener("touchstart", e => onDown(e.touches[0].clientX), {passive:true});
  window.addEventListener("mouseup",   onUp);
  window.addEventListener("touchend",  onUp);
  window.addEventListener("mousemove", e => onMove(e.clientX));
  window.addEventListener("touchmove", e => onMove(e.touches[0].clientX), {passive:true});

  window.addEventListener("resize", () => {
    const nW = container.offsetWidth, nH = container.offsetHeight;
    if (!nW || !nH) return;
    threeCamera.aspect = nW / nH;
    threeCamera.updateProjectionMatrix();
    threeRenderer.setSize(nW, nH);
  });

  threeClock = new THREE.Clock();
  renderLoop();
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  const t = threeClock ? threeClock.getElapsedTime() : 0;
  if (avatarGroup) {
    if (avatarRotating) avatarGroup.rotation.y += 0.006;
    avatarGroup.position.y = 0.1 + Math.sin(t * 1.3) * 0.05;
  }
  if (threeRenderer && threeScene && threeCamera) {
    threeRenderer.render(threeScene, threeCamera);
  }
}

function mat(color, rough=0.6, metal=0.0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function mesh(geo, material, x, y, z, rx=0, ry=0, rz=0, sx=1, sy=1, sz=1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  avatarGroup.add(m);
  return m;
}

function buildAvatarMesh() {
  if (!avatarGroup) return;
  while (avatarGroup.children.length) avatarGroup.remove(avatarGroup.children[0]);

  const p       = gameState.player;
  const stats   = computeStats(p.ironScore, p.level);
  const bScale  = 0.85 + (stats.strength / 100) * 0.28; // body grows with strength

  const skin  = mat(parseInt(p.skinColor.replace("#",""), 16), 0.75, 0.0);
  const shirt = mat(parseInt(p.shirtColor.replace("#",""), 16), 0.5,  0.1);
  const pants = mat(parseInt(p.pantsColor.replace("#",""), 16), 0.65, 0.0);
  const hair  = mat(parseInt(p.hairColor.replace("#",""), 16),  0.45, 0.15);
  const eyeM  = mat(0x111122, 0.1, 0.5);
  const white = mat(0xffffff, 0.5, 0.0);
  const shoe  = mat(0x111122, 0.4, 0.3);

  // ── HEAD ──
  mesh(new THREE.SphereGeometry(0.33, 28, 28), skin, 0, 2.88, 0);
  // Eyes white
  mesh(new THREE.SphereGeometry(0.06, 10, 10), white, -0.11, 2.92, 0.29);
  mesh(new THREE.SphereGeometry(0.06, 10, 10), white,  0.11, 2.92, 0.29);
  // Pupils
  mesh(new THREE.SphereGeometry(0.038, 8, 8), eyeM, -0.11, 2.92, 0.33);
  mesh(new THREE.SphereGeometry(0.038, 8, 8), eyeM,  0.11, 2.92, 0.33);
  // Nose
  mesh(new THREE.SphereGeometry(0.033, 8, 8), skin, 0, 2.80, 0.32);
  // Smile
  mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 12, Math.PI), skin, 0, 2.70, 0.30, Math.PI, 0, 0);
  // Ears
  mesh(new THREE.SphereGeometry(0.09, 10, 8), skin, -0.34, 2.88, 0, 0,0,0, 1, 0.85, 0.65);
  mesh(new THREE.SphereGeometry(0.09, 10, 8), skin,  0.34, 2.88, 0, 0,0,0, 1, 0.85, 0.65);

  // ── HAIR ──
  buildHair(hair, p.hairStyle);

  // ── NECK ──
  mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.22, 14), skin, 0, 2.50, 0);

  // ── TORSO (box) ──
  mesh(new THREE.BoxGeometry(0.72 * bScale, 0.92, 0.44), shirt, 0, 1.93, 0);

  // ── UPPER ARMS (cylinders) ──
  const armGeo = new THREE.CylinderGeometry(0.10, 0.10, 0.60, 12);
  mesh(armGeo, shirt, -0.47 * bScale, 2.02, 0, 0, 0, 0.15);
  mesh(armGeo, shirt,  0.47 * bScale, 2.02, 0, 0, 0,-0.15);

  // ── LOWER ARMS ──
  const foreGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 12);
  mesh(foreGeo, skin, -0.49 * bScale, 1.55, 0.05, 0.1, 0, 0.05);
  mesh(foreGeo, skin,  0.49 * bScale, 1.55, 0.05,-0.1, 0,-0.05);

  // ── HANDS ──
  mesh(new THREE.SphereGeometry(0.11, 10, 10), skin, -0.48 * bScale, 1.26, 0.08);
  mesh(new THREE.SphereGeometry(0.11, 10, 10), skin,  0.48 * bScale, 1.26, 0.08);

  // ── LEGS (cylinders for r128) ──
  const thighGeo = new THREE.CylinderGeometry(0.14, 0.13, 0.60, 12);
  mesh(thighGeo, pants, -0.19, 1.12, 0);
  mesh(thighGeo, pants,  0.19, 1.12, 0);

  const shinGeo = new THREE.CylinderGeometry(0.11, 0.10, 0.55, 12);
  mesh(shinGeo, pants, -0.19, 0.63, 0);
  mesh(shinGeo, pants,  0.19, 0.63, 0);

  // ── SHOES ──
  mesh(new THREE.BoxGeometry(0.22, 0.13, 0.36), shoe, -0.19, 0.29, 0.05);
  mesh(new THREE.BoxGeometry(0.22, 0.13, 0.36), shoe,  0.19, 0.29, 0.05);

  // ── ACCESSORY / WEAPON ──
  buildAccessory(p.accessory);

  // Update viewport stat bars
  renderHUD();
}

function buildHair(hairMat, style) {
  switch (style) {
    case "long":
      mesh(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI*2, 0, Math.PI*0.58), hairMat, 0, 3.10, 0);
      mesh(new THREE.CylinderGeometry(0.30, 0.22, 0.55, 14), hairMat, 0, 3.04, -0.08);
      break;
    case "curly":
      mesh(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI*2, 0, Math.PI*0.48), hairMat, 0, 3.05, 0);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        mesh(new THREE.SphereGeometry(0.08, 7, 7), hairMat,
             Math.cos(a)*0.26, 3.16 + Math.random()*0.06, Math.sin(a)*0.26);
      }
      break;
    case "mohawk":
      mesh(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI*2, 0, Math.PI*0.48), hairMat, 0, 3.05, 0);
      mesh(new THREE.BoxGeometry(0.10, 0.40, 0.60), hairMat, 0, 3.26, 0);
      break;
    default: // short
      mesh(new THREE.SphereGeometry(0.33, 18, 9, 0, Math.PI*2, 0, Math.PI*0.50), hairMat, 0, 3.06, 0);
      mesh(new THREE.BoxGeometry(0.67, 0.10, 0.48), hairMat, 0, 3.18, -0.04);
  }
}

function buildAccessory(type) {
  const gold  = mat(0xf59e0b, 0.2, 0.9);
  const blade = mat(0xd0d8e0, 0.1, 1.0);
  const wood  = mat(0x7c4a1e, 0.7, 0.0);
  const magic = mat(0x7c3aed, 0.2, 0.3);
  const blue  = mat(0x1e40af, 0.3, 0.5);
  switch (type) {
    case "sword":
      mesh(new THREE.BoxGeometry(0.065, 0.90, 0.038), blade, 0.70, 1.85, 0, 0, 0, -0.28);
      mesh(new THREE.BoxGeometry(0.32, 0.06, 0.04), gold, 0.63, 1.49, 0);
      mesh(new THREE.SphereGeometry(0.065, 8, 8), gold, 0.57, 1.38, 0);
      break;
    case "staff":
      mesh(new THREE.CylinderGeometry(0.028, 0.028, 1.25, 8), wood, 0.70, 2.05, 0);
      mesh(new THREE.SphereGeometry(0.095, 12, 12), magic, 0.70, 2.72, 0);
      // glow halo
      mesh(new THREE.RingGeometry(0.11, 0.15, 18), mat(0xec4899, 0.1, 0.1),
           0.70, 2.72, 0.05, Math.PI/2, 0, 0);
      break;
    case "shield":
      mesh(new THREE.BoxGeometry(0.38, 0.50, 0.055), blue, -0.70, 1.90, 0.08);
      mesh(new THREE.BoxGeometry(0.14, 0.14, 0.07), gold, -0.70, 1.90, 0.11);
      break;
    case "bow":
      mesh(new THREE.TorusGeometry(0.30, 0.022, 8, 26, Math.PI * 1.25),
           wood, 0.72, 1.90, 0, 0, 0, 0.28);
      break;
    default: break;
  }
}

function refreshAvatar3D() {
  buildCSSAvatar();
  const nd = document.getElementById("avatarNameDisplay");
  if (nd) nd.textContent = gameState.player.name + " — Level " + gameState.player.level;
}

// ──────────────────────────────────────────────────────────
//  XP & LEVELLING
// ──────────────────────────────────────────────────────────
function addXP(amount, reason) {
  gameState.player.xp    += amount;
  gameState.player.coins += Math.floor(amount / 2);
  showXPPopup("+" + amount + " XP", reason);
  while (gameState.player.xp >= gameState.player.xpToNext) {
    gameState.player.xp     -= gameState.player.xpToNext;
    gameState.player.level  += 1;
    gameState.player.xpToNext = Math.floor(gameState.player.xpToNext * 1.4);
    showLevelUp(gameState.player.level);
    checkBadges();
    refreshAvatar3D();
    pushSnapshot('level up → ' + gameState.player.level);
  }
  saveState(); renderHUD();
}

function showXPPopup(text, reason) {
  const p = document.createElement("div");
  p.className = "xp-popup";
  p.innerHTML = `<span>${text}</span><small>${reason || ""}</small>`;
  document.body.appendChild(p);
  setTimeout(() => p.remove(), 2200);
}

function showLevelUp(level) {
  const el = document.getElementById("levelUpBanner"); if (!el) return;
  el.innerHTML = `🎉 LEVEL UP! You are now <b>Level ${level}</b>!`;
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), 3500);
}

// ──────────────────────────────────────────────────────────
//  STREAK
// ──────────────────────────────────────────────────────────
function checkStreak() {
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const last      = gameState.player.lastLogin;
  if (last === today) return;
  gameState.player.streak = (last === yesterday) ? gameState.player.streak + 1 : 1;
  if (last === yesterday) addXP(20 * gameState.player.streak, gameState.player.streak + "-day streak! 🔥");
  gameState.player.lastLogin = today;
  saveState();
}

// ──────────────────────────────────────────────────────────
//  BADGES
// ──────────────────────────────────────────────────────────
const BADGE_RULES = [
  { id:"first_scan",  icon:"📸", name:"First Scan",      check: p => p.ironScore !== 50 },
  { id:"iron_hero",   icon:"🦸", name:"Iron Hero",        check: p => p.ironScore >= 85 },
  { id:"week_streak", icon:"🔥", name:"7-Day Streak",     check: p => p.streak >= 7 },
  { id:"food_champ",  icon:"🍎", name:"Food Champion",    check: p => p.questsDone.length >= 10 },
  { id:"level_10",    icon:"⭐", name:"Level 10 Legend",  check: p => p.level >= 10 },
  { id:"battle_win",  icon:"⚔️", name:"Battle Winner",    check: p => p.battleWins >= 5 },
];

function checkBadges() {
  BADGE_RULES.forEach(rule => {
    if (!gameState.player.badges.includes(rule.id) && rule.check(gameState.player)) {
      gameState.player.badges.push(rule.id);
      showBadgeToast(rule.name);
    }
  });
  saveState(); renderBadges();
}

function showBadgeToast(name) {
  const t = document.getElementById("badgeToast"); if (!t) return;
  t.textContent = "🏅 Badge Unlocked: " + name;
  t.classList.add("active");
  setTimeout(() => t.classList.remove("active"), 3500);
}

function renderBadges() {
  const c = document.getElementById("badgeContainer"); if (!c) return;
  c.innerHTML = BADGE_RULES.map(r => {
    const earned = gameState.player.badges.includes(r.id);
    return `<div class="badge-item ${earned?"earned":"locked"}" title="${earned?"Earned!":"Keep going!"}">
      <span class="badge-icon">${r.icon}</span>
      <span class="badge-label">${r.name}</span>
    </div>`;
  }).join("");
}

// ──────────────────────────────────────────────────────────
//  QUESTS
// ──────────────────────────────────────────────────────────
const QUESTS = [
  { id:"q1", text:"Eat spinach or another leafy green today",     xp:40, coin:20 },
  { id:"q2", text:"Drink 8 glasses of water",                      xp:30, coin:15 },
  { id:"q3", text:"Take your iron supplement (if prescribed)",      xp:50, coin:25 },
  { id:"q4", text:"Include a vitamin-C food with your meal",        xp:35, coin:18 },
  { id:"q5", text:"Eat lentils, chickpeas or iron-rich dal",        xp:45, coin:22 },
  { id:"q6", text:"Upload an image for AI health scan",             xp:80, coin:40 },
  { id:"q7", text:"Avoid tea/coffee 1 hour after a meal",           xp:25, coin:12 },
  { id:"q8", text:"Sleep at least 7–8 hours tonight",               xp:40, coin:20 },
];

function renderQuests() {
  const c = document.getElementById("questContainer"); if (!c) return;
  const key  = new Date().toDateString();
  const done = JSON.parse(localStorage.getItem("iq_doneToday_" + key) || "[]");
  c.innerHTML = QUESTS.map(q => {
    const isDone = done.includes(q.id);
    return `<div class="quest-item ${isDone?"completed":""}"
                 onclick="${isDone?"":"completeQuest('"+q.id+"',"+q.xp+","+q.coin+")"}">
      <div class="quest-info">
        <div class="quest-text">${q.text}</div>
        <div class="quest-reward">+${q.xp} XP &nbsp;|&nbsp; +${q.coin} 🪙</div>
      </div>
      <div class="quest-checkbox">${isDone?"✓":""}</div>
    </div>`;
  }).join("");
}

function completeQuest(id, xp, coin) {
  const key  = new Date().toDateString();
  const done = JSON.parse(localStorage.getItem("iq_doneToday_" + key) || "[]");
  if (done.includes(id)) return;
  done.push(id);
  localStorage.setItem("iq_doneToday_" + key, JSON.stringify(done));
  gameState.player.questsDone.push(id);
  addXP(xp, "Quest completed!");
  checkBadges(); renderQuests();
  pushSnapshot('quest: ' + id);
}

// ──────────────────────────────────────────────────────────
//  HUD
// ──────────────────────────────────────────────────────────
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function setWidth(id, pct) { const el = document.getElementById(id); if (el) el.style.width = Math.max(0,pct) + "%"; }

function renderHUD() {
  const p    = gameState.player;
  const pct  = Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
  const stats = computeStats(p.ironScore, p.level);
  setText("hudLevel",  "Lv " + p.level);
  setText("hudXP",     p.xp + " / " + p.xpToNext + " XP");
  setText("hudCoins",  p.coins + " 🪙");
  setText("streakDisplay", p.streak + "-day streak 🔥");
  setText("ironScoreDisplay", p.ironScore + "/100");
  document.querySelectorAll(".xp-progress-bar").forEach(b => b.style.width = pct + "%");
  // viewport stat bars
  setWidth("vbar-health",   stats.health);
  setWidth("vbar-energy",   stats.energy);
  setWidth("vbar-strength", stats.strength);
  setText("statHealthVal",   stats.health);
  setText("statEnergyVal",   stats.energy);
  setText("statStrengthVal", stats.strength);
}

// ──────────────────────────────────────────────────────────
//  AVATAR CUSTOMISE PANEL
// ──────────────────────────────────────────────────────────
const SKIN_COLORS  = ["#fddbb4","#f5c5a3","#e8b887","#c68642","#8d5524","#4a2912"];
const SHIRT_COLORS = ["#7c3aed","#ec4899","#10b981","#ef4444","#f59e0b","#06b6d4","#1e40af","#111827"];
const PANTS_COLORS = ["#1e3a5f","#111827","#1a1a2e","#374151","#7c3aed","#065f46","#78350f","#1e40af"];
const HAIR_COLORS  = ["#1a1a1a","#3b1f0a","#d4a017","#ff6b6b","#7c3aed","#ec4899","#06b6d4","#f1f5f9"];
const HAIR_STYLES  = [{id:"short",label:"Short",icon:"💇"},{id:"long",label:"Long",icon:"💁"},{id:"curly",label:"Curly",icon:"🌀"},{id:"mohawk",label:"Mohawk",icon:"🦩"}];
const ACCESSORIES  = [{id:"none",label:"None",icon:"✋"},{id:"sword",label:"Sword",icon:"⚔️"},{id:"staff",label:"Staff",icon:"🪄"},{id:"shield",label:"Shield",icon:"🛡️"},{id:"bow",label:"Bow",icon:"🏹"}];

function renderCustomisePanel() {
  const p = gameState.player;
  const ni = document.getElementById("customName"); if (ni) ni.value = p.name;
  const swatches = (cid, colors, cur, field) => {
    const c = document.getElementById(cid); if (!c) return;
    c.innerHTML = colors.map(col =>
      `<div class="swatch ${col===cur?"selected":""}" style="background:${col}" onclick="selectOpt('${field}','${col}')"></div>`
    ).join("");
  };
  swatches("skinSwatches",  SKIN_COLORS,  p.skinColor,  "skinColor");
  swatches("shirtSwatches", SHIRT_COLORS, p.shirtColor, "shirtColor");
  swatches("pantsSwatches", PANTS_COLORS, p.pantsColor, "pantsColor");
  swatches("hairSwatches",  HAIR_COLORS,  p.hairColor,  "hairColor");
  const chips = (cid, items, cur, field) => {
    const c = document.getElementById(cid); if (!c) return;
    c.innerHTML = items.map(it =>
      `<div class="chip ${it.id===cur?"selected":""}" onclick="selectOpt('${field}','${it.id}')">${it.icon} ${it.label}</div>`
    ).join("");
  };
  chips("hairStyleChips", HAIR_STYLES, p.hairStyle,  "hairStyle");
  chips("accessoryChips", ACCESSORIES, p.accessory,  "accessory");
}

function selectOpt(field, val) {
  gameState.player[field] = val;
  buildCSSAvatar();
  renderCustomisePanel();
}

function saveCustomise() {
  const n = document.getElementById("customName");
  if (n && n.value.trim()) gameState.player.name = n.value.trim();
  saveState(); renderHUD(); buildCSSAvatar();
}

// ──────────────────────────────────────────────────────────
//  ML SCAN
// ──────────────────────────────────────────────────────────
async function handleScan(event) {
  const file = event.target.files[0]; if (!file) return;
  const preview = document.getElementById("scanPreview");
  const reader  = new FileReader();
  reader.onload = e => { if (preview) { preview.src = e.target.result; preview.style.display = "block"; } };
  reader.readAsDataURL(file);
  const rb = document.getElementById("scanResult");
  if (rb) rb.innerHTML = '<div class="scanning-loader"><div class="scan-spinner"></div>Analysing with AI…</div>';
  try {
    const fd = new FormData(); fd.append("file", file);
    const resp = await fetch(API + "/api/predict", { method:"POST", body:fd });
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    gameState.player.ironScore = data.iron_score;
    addXP(data.xp_gain, "AI Scan completed! 📸");
    checkBadges(); saveState(); renderHUD(); buildCSSAvatar();
    pushSnapshot('ai scan', data.status);
    displayScanResult(data);
  } catch(err) {
    if (rb) rb.innerHTML = `<div class="scan-error">
      <b>⚠️ Backend unreachable</b><br>
      Make sure FastAPI is running:<br>
      <code>uvicorn main:app --port 8000</code><br><br>
      <small>${err.message}</small></div>`;
  }
}

function displayScanResult(data) {
  const rb = document.getElementById("scanResult"); if (!rb) return;
  const cm = {"Healthy":"#10b981","Mild Anemia":"#f59e0b","Moderate Anemia":"#ef4444","Severe Anemia":"#dc2626"};
  const c  = cm[data.status] || "#7c3aed";
  rb.innerHTML = `<div class="scan-result-card" style="border-left:5px solid ${c}">
    <h3 style="color:${c}">${data.status}</h3>
    <div class="scan-row">Confidence: <b>${data.confidence}%</b></div>
    <div class="scan-row">Iron Score: <b>${data.iron_score}/100</b></div>
    <div class="xp-gain">+${data.xp_gain} XP earned! 🎉</div>
    <p class="scan-rec">${data.recommendation}</p>
    <div class="scan-badge">${data.model_used==="real"?"🤖 Real ML Model":"🎲 Simulation Mode"}</div>
  </div>`;
}

// ──────────────────────────────────────────────────────────
//  DAILY CHALLENGE & LEADERBOARD
// ──────────────────────────────────────────────────────────
async function loadDailyChallenge() {
  const el = document.getElementById("dailyChallengeCard");
  try {
    const data = await (await fetch(API + "/api/daily-challenge")).json();
    const c = data.challenge;
    gameState.dailyChallenge = c;
    if (el) el.innerHTML = `
      <div class="dc-icon">${c.icon}</div>
      <div class="dc-info">
        <div class="dc-title">${c.title}</div>
        <div class="dc-desc">${c.desc}</div>
        <div class="dc-xp">+${c.xp} XP reward</div>
      </div>
      <button class="dc-btn" onclick="completeDailyChallenge()">Mark Done ✓</button>`;
  } catch {
    if (el) el.innerHTML = '<div class="dc-offline">⚠️ Backend offline — start FastAPI to load challenge</div>';
  }
}

function completeDailyChallenge() {
  if (!gameState.dailyChallenge) return;
  const key = "dc_done_" + new Date().toDateString();
  if (localStorage.getItem(key)) { alert("Already completed today! Come back tomorrow 🌟"); return; }
  localStorage.setItem(key, "1");
  addXP(gameState.dailyChallenge.xp, "Daily: " + gameState.dailyChallenge.title);
  loadDailyChallenge();
}

async function loadLeaderboard() {
  const c = document.getElementById("lbContainer"); if (!c) return;
  try {
    const data = await (await fetch(API + "/api/leaderboard")).json();
    const m = ["🥇","🥈","🥉","4","5","6","7"];
    c.innerHTML = data.leaderboard.map((e,i) => `
      <div class="lb-row">
        <span class="lb-rank">${m[i]||e.rank}</span>
        <div class="lb-name-wrap"><span class="lb-name">${e.name}</span><span class="lb-school">${e.school}</span></div>
        <span class="lb-level">Lv ${e.level}</span>
        <span class="lb-score">${e.score.toLocaleString()}</span>
      </div>`).join("");
  } catch {
    if (c) c.innerHTML = '<div class="lb-offline">⚠️ Start the backend to see live rankings!</div>';
  }
}

// ──────────────────────────────────────────────────────────
//  BATTLE SYSTEM
// ──────────────────────────────────────────────────────────
const ENEMIES = [
  { name:"Iron Goblin 👺",   hp:80  },
  { name:"Anemia Shade 👻",  hp:120 },
  { name:"Fatigue Fiend 😈", hp:170 },
  { name:"Iron Lich 💀",     hp:230 },
];
let battle = { playerHP:100, enemyHP:80, maxP:100, maxE:80, active:false, enemy:ENEMIES[0] };

function startBattle() {
  const stats = computeStats(gameState.player.ironScore, gameState.player.level);
  const enemy = ENEMIES[Math.min(Math.floor(gameState.player.level/3), ENEMIES.length-1)];
  battle = { playerHP:stats.health, maxP:stats.health,
             enemyHP:enemy.hp + gameState.player.level*8, maxE:enemy.hp + gameState.player.level*8,
             active:true, enemy };
  setText("enemyName", enemy.name);
  updateEnemyLabel(enemy.name);
  renderBattle(); logBattle(`⚔️ Battle vs ${enemy.name}!`);
  logBattle(`💡 Your strength: ${stats.strength} — scan first to boost stats!`);
}

function battleAttack() {
  if (!battle.active) return;
  const s = computeStats(gameState.player.ironScore, gameState.player.level);
  const dmg = Math.floor(s.strength*0.35 + Math.random()*18 + 5);
  const edm = Math.floor(Math.random()*22 + 8);
  battle.enemyHP  = Math.max(0, battle.enemyHP  - dmg);
  battle.playerHP = Math.max(0, battle.playerHP - edm);
  showClash('⚔️');
  logBattle(`⚔️ You dealt <b style="color:#10b981">${dmg}</b> dmg! Enemy hit <b style="color:#ef4444">${edm}</b>.`);
  renderBattle(); checkBattleEnd();
}

function battleHeal() {
  if (!battle.active) return;
  const h = Math.floor(22 + Math.random()*18);
  const e = Math.floor(Math.random()*12 + 4);
  battle.playerHP = Math.min(battle.maxP, battle.playerHP + h);
  battle.enemyHP  = Math.max(0, battle.enemyHP - e);
  showClash('💚');
  logBattle(`💚 Healed <b style="color:#10b981">${h}</b> HP! Counter: <b style="color:#ef4444">${e}</b>.`);
  renderBattle(); checkBattleEnd();
}

function battleSkill() {
  if (!battle.active) return;
  const s = computeStats(gameState.player.ironScore, gameState.player.level);
  const dmg = Math.floor(s.strength*0.6 + s.energy*0.2 + Math.random()*20);
  battle.enemyHP = Math.max(0, battle.enemyHP - dmg);
  showClash('✨');
  logBattle(`✨ Iron Surge! Massive <b style="color:#f59e0b">${dmg}</b> damage!`);
  renderBattle(); checkBattleEnd();
}

function checkBattleEnd() {
  if (battle.enemyHP <= 0) {
    battle.active = false;
    gameState.player.battleWins++;
    const xp = 60 + gameState.player.level*12;
    addXP(xp, "Battle Victory! 🏆");
    logBattle(`🏆 <b>Victory!</b> +${xp} XP! Wins: ${gameState.player.battleWins}`);
    checkBadges(); saveState();
    pushSnapshot('battle win');
  } else if (battle.playerHP <= 0) {
    battle.active = false;
    logBattle(`💀 <b>Defeated!</b> Scan your health and eat iron-rich foods to grow stronger!`);
  }
  renderBattle();
}

function renderBattle() {
  const pp = battle.maxP ? Math.round((battle.playerHP/battle.maxP)*100) : 100;
  const ep = battle.maxE ? Math.round((battle.enemyHP /battle.maxE)*100) : 100;
  setWidth("playerHPBar", Math.max(0,pp));
  setWidth("enemyHPBar",  Math.max(0,ep));
  setText("playerHPText", Math.max(0,battle.playerHP) + " HP");
  setText("enemyHPText",  Math.max(0,battle.enemyHP)  + " HP");
  document.querySelectorAll(".battle-btn").forEach(b => b.disabled = !battle.active);
  const sb = document.getElementById("startBattleBtn"); if(sb) sb.disabled = battle.active;
}

function logBattle(html) {
  const log = document.getElementById("battleLog"); if (!log) return;
  const d = document.createElement("div"); d.className="battle-log-item"; d.innerHTML = html;
  log.prepend(d);
  while (log.children.length > 8) log.removeChild(log.lastChild);
}

function updateEnemyLabel(name) {
  const el = document.getElementById('enemyLabel');
  if (el) el.textContent = name.split(' ').slice(0,2).join(' ');
}

// ──────────────────────────────────────────────────────────
//  STREAMING OLLAMA CHATBOT
// ──────────────────────────────────────────────────────────
let chatBusy = false;

function toggleChat() {
  document.getElementById("chatWindow").classList.toggle("open");
}
function handleChatKey(e) { if (e.key === "Enter") sendChatMessage(); }

async function sendChatMessage() {
  if (chatBusy) return;
  const inp = document.getElementById("chatInput");
  const msg = inp.value.trim(); if (!msg) return;
  inp.value = "";
  appendChat(msg, "user");
  gameState.chatHistory.push({ role:"user", content:msg });
  chatBusy = true;

  // Create bot bubble that we'll stream into
  const bubbleId = "bot-bubble-" + Date.now();
  const msgs = document.getElementById("chatMessages");
  const bubble = document.createElement("div");
  bubble.id = bubbleId; bubble.className = "chat-msg bot-msg";
  bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
  msgs.appendChild(bubble); msgs.scrollTop = msgs.scrollHeight;

  let fullReply = "";
  try {
    const resp = await fetch(API + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history: gameState.chatHistory.slice(-8) }),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const reader = resp.body.getReader();
    const dec    = new TextDecoder();
    bubble.innerHTML = ""; // clear typing indicator

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = dec.decode(value).split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.token) {
            fullReply += chunk.token;
            bubble.textContent = fullReply;
            msgs.scrollTop = msgs.scrollHeight;
          }
          if (chunk.done && chunk.reply && !fullReply) {
            fullReply = chunk.reply;
            bubble.innerHTML = fullReply.replace(/\n/g,"<br>");
          }
        } catch {}
      }
    }
    if (!fullReply) fullReply = "Sorry, I didn't get a response. Try again!";
    // Strip any echoed role prefixes or prompt leakage the model may produce
    fullReply = fullReply
      // Remove leading role labels
      .replace(/^\s*(###\s*)?(IronBot|\[IRONBOT\]|AI|Bot|Assistant)[:>]?\s*/i, '')
      // Cut off everything from the first echoed user turn onward
      .replace(/(###\s*)?(\[STUDENT\]|\[SYS\]|User|Human|Student)[:>][\s\S]*/i, '')
      // Remove any <<SYS>> / <</SYS>> leakage
      .replace(/<<\/?SYS>>[\s\S]*/gi, '')
      .trim();
    if (!fullReply) fullReply = "I'm not sure — try asking in a different way! 😊";
    bubble.innerHTML = fullReply.replace(/\n/g,"<br>");
    gameState.chatHistory.push({ role:"assistant", content:fullReply });

  } catch(err) {
    bubble.innerHTML = `⚠️ Cannot reach backend.<br>Make sure FastAPI is running on port 8000.<br><small>${err.message}</small>`;
  }
  chatBusy = false;
}

function appendChat(text, role) {
  const msgs = document.getElementById("chatMessages"); if (!msgs) return;
  const d = document.createElement("div");
  d.className = "chat-msg " + (role==="user"?"user-msg":"bot-msg");
  d.textContent = text;
  msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
}

// ──────────────────────────────────────────────────────────
//  QUIZ
// ──────────────────────────────────────────────────────────
function calculateRisk() {
  const yes = document.getElementById("anemiaQuiz").querySelectorAll("input:checked").length;
  const [riskLevel, color, advice] =
    yes <= 3 ? ["Low Risk 👍","#10b981","Your symptoms suggest low risk. Keep eating iron-rich foods like spinach, lentils, and pomegranate!"]
  : yes <= 6 ? ["Moderate Risk ⚠️","#f59e0b","Some symptoms indicate possible anemia. Increase iron intake and see a doctor for a blood test."]
             : ["High Risk 🚨","#ef4444","High risk of anemia. Please consult a healthcare professional immediately."];
  const rb = document.getElementById("quizResult");
  rb.style.display = "block";
  rb.innerHTML = `<h3 style="color:${color};font-size:22px;margin-bottom:10px;">${riskLevel}</h3>
    <p>You answered "Yes" to <b>${yes}</b> out of 10 questions.</p>
    <p style="margin-top:10px;color:#94a3b8;line-height:1.7;">${advice}</p>
    <button onclick="document.getElementById('remedies-section').scrollIntoView({behavior:'smooth'});"
      style="margin-top:16px;padding:10px 22px;background:${color};color:white;border:none;border-radius:12px;font-family:inherit;font-weight:700;cursor:pointer;">
      View Remedies 🌿</button>`;
  if (yes >= 7) addXP(30, "Completed risk quiz");
}

// ──────────────────────────────────────────────────────────
//  PERSIST STATE
// ──────────────────────────────────────────────────────────
function saveState() {
  const p = gameState.player;
  ["name","level","xp","xpToNext","coins","streak","lastLogin","ironScore",
   "skinColor","shirtColor","pantsColor","hairColor","hairStyle","avatarStyle","accessory","battleWins"]
  .forEach(k => localStorage.setItem("iq_"+k, p[k]));
  localStorage.setItem("iq_badges",     JSON.stringify(p.badges));
  localStorage.setItem("iq_questsDone", JSON.stringify(p.questsDone));
}

// ──────────────────────────────────────────────────────────
//  PROGRESS STORAGE — push snapshot to backend
// ──────────────────────────────────────────────────────────
function getOrCreateStudentId() {
  let sid = localStorage.getItem('iq_student_id');
  if (!sid) {
    // Create a stable ID from name + random suffix (set once, never changes)
    sid = (gameState.player.name || 'student').toLowerCase().replace(/\s+/g,'_')
          + '_' + Math.random().toString(36).slice(2,8);
    localStorage.setItem('iq_student_id', sid);
  }
  return sid;
}

async function pushSnapshot(note = 'auto', scanStatus = null) {
  const p = gameState.player;
  const payload = {
    student_id:  getOrCreateStudentId(),
    name:        p.name,
    iron_score:  p.ironScore,
    level:       p.level,
    xp:          p.xp,
    coins:       p.coins,
    streak:      p.streak,
    battle_wins: p.battleWins,
    badges:      p.badges,
    energy:      null,
    scan_status: scanStatus,
    note:        note,
  };
  try {
    await fetch(API + '/api/progress/snapshot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch(e) {
    // Silent fail — backend might not be running
  }
}

// ──────────────────────────────────────────────────────────
//  INIT  — called after DOM + Three.js are both ready
// ──────────────────────────────────────────────────────────
function initGame() {
  checkStreak();
  renderHUD();
  renderQuests();
  renderBadges();
  renderBattle();
  renderCustomisePanel();
  loadDailyChallenge();
  loadLeaderboard();
  const si = document.getElementById("scanFileInput");
  if (si) si.addEventListener("change", handleScan);
  // Sync avatar name
  const nd = document.getElementById("avatarNameDisplay");
  if (nd) nd.textContent = gameState.player.name + " — Level " + gameState.player.level;
  // Energy slider
  const slider = document.getElementById("energySlider");
  const out    = document.getElementById("energyOutput");
  if (slider && out) {
    slider.oninput = function() {
      const v = parseInt(this.value);
      if (v < 4) { out.textContent="😴 Low Energy — you may need more iron!"; out.style.color="#ef4444"; }
      else if (v<7){ out.textContent="🙂 Moderate — keep eating well!"; out.style.color="#f59e0b"; }
      else          { out.textContent="💪 Great Energy — stay consistent! 🔥"; out.style.color="#10b981"; }
    };
  }
}

// ──────────────────────────────────────────────────────────
//  CSS AVATAR RENDERER
// ──────────────────────────────────────────────────────────
function buildCSSAvatar() {
  const el = document.getElementById('cssWarriorEl');
  if (!el) return;
  const p = gameState.player;
  const sc  = p.skinColor  || '#f5c5a3';
  const shc = p.shirtColor || '#7c3aed';
  const pac = p.pantsColor || '#1e3a5f';
  const hc  = p.hairColor  || '#1a1a1a';
  // Derive lighter/darker shades
  const shcDark = shadeHex(shc, -40);
  const shcLight = shadeHex(shc, 60);
  const pacDark  = shadeHex(pac, -30);
  const weaponSVG = buildWeaponSVG(p.accessory || 'sword');

  el.innerHTML = `
  <svg width="180" height="320" viewBox="0 0 180 320" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="skinGrad" cx="50%" cy="40%" r="60%">
        <stop offset="0%" stop-color="${shadeHex(sc,30)}"/>
        <stop offset="100%" stop-color="${shadeHex(sc,-20)}"/>
      </radialGradient>
      <radialGradient id="armorGrad" cx="30%" cy="20%" r="80%">
        <stop offset="0%" stop-color="#3d5166"/>
        <stop offset="100%" stop-color="#1a2530"/>
      </radialGradient>
      <radialGradient id="helmetGrad" cx="35%" cy="25%" r="70%">
        <stop offset="0%" stop-color="#4a6275"/>
        <stop offset="100%" stop-color="#1a2a36"/>
      </radialGradient>
      <linearGradient id="shirtGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${shcLight}"/>
        <stop offset="100%" stop-color="${shcDark}"/>
      </linearGradient>
      <linearGradient id="pantsGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${pac}"/>
        <stop offset="100%" stop-color="${pacDark}"/>
      </linearGradient>
      <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>

    ${weaponSVG}

    <!-- ── CAPE ── -->
    <path d="M68 118 Q30 160 38 260 L70 255 Q72 190 90 175 Q108 190 110 255 L142 260 Q150 160 112 118 Z"
      fill="${shcDark}" opacity=".75"/>
    <path d="M75 118 Q48 155 52 240 L70 235 Q74 175 90 162 Q106 175 110 235 L128 240 Q132 155 105 118 Z"
      fill="${shc}" opacity=".4"/>

    <!-- ── LEGS ── -->
    <!-- Left thigh -->
    <rect x="58" y="210" width="30" height="55" rx="10" fill="url(#pantsGrad)" stroke="${pacDark}" stroke-width="1.5"/>
    <!-- Right thigh -->
    <rect x="92" y="210" width="30" height="55" rx="10" fill="url(#pantsGrad)" stroke="${pacDark}" stroke-width="1.5"/>
    <!-- Knee guards -->
    <ellipse cx="73" cy="235" rx="12" ry="8" fill="#2c3e50" stroke="#95a5a6" stroke-width="1"/>
    <ellipse cx="107" cy="235" rx="12" ry="8" fill="#2c3e50" stroke="#95a5a6" stroke-width="1"/>
    <!-- Shins -->
    <rect x="60" y="258" width="26" height="38" rx="8" fill="url(#pantsGrad)" stroke="${pacDark}" stroke-width="1"/>
    <rect x="94" y="258" width="26" height="38" rx="8" fill="url(#pantsGrad)" stroke="${pacDark}" stroke-width="1"/>
    <!-- Boots -->
    <rect x="54" y="285" width="36" height="26" rx="7" fill="#111820" stroke="#2c3e50" stroke-width="1.5"/>
    <rect x="90" y="285" width="36" height="26" rx="7" fill="#111820" stroke="#2c3e50" stroke-width="1.5"/>
    <!-- Boot highlight -->
    <rect x="57" y="287" width="30" height="5" rx="3" fill="rgba(255,255,255,.08)"/>
    <rect x="93" y="287" width="30" height="5" rx="3" fill="rgba(255,255,255,.08)"/>

    <!-- ── BODY / CHEST PLATE ── -->
    <!-- Torso base -->
    <rect x="52" y="115" width="76" height="100" rx="14" fill="url(#armorGrad)" stroke="#4a5e6d" stroke-width="2"/>
    <!-- Chest plate front -->
    <path d="M62 120 Q90 112 118 120 L118 185 Q90 194 62 185 Z" fill="url(#shirtGrad)" opacity=".55"/>
    <!-- Chest plate details -->
    <path d="M90 122 L90 190" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
    <path d="M62 152 Q90 158 118 152" stroke="rgba(255,255,255,.12)" stroke-width="1.5" fill="none"/>
    <path d="M68 136 Q90 141 112 136" stroke="rgba(255,255,255,.1)" stroke-width="1" fill="none"/>
    <!-- Rivets -->
    <circle cx="67" cy="128" r="3" fill="#95a5a6"/><circle cx="113" cy="128" r="3" fill="#95a5a6"/>
    <circle cx="67" cy="178" r="3" fill="#95a5a6"/><circle cx="113" cy="178" r="3" fill="#95a5a6"/>
    <!-- Glowing chest gem -->
    <ellipse cx="90" cy="145" rx="9" ry="9" fill="${shc}" opacity=".25" filter="url(#softglow)"/>
    <ellipse cx="90" cy="145" rx="6" ry="6" fill="${shc}" opacity=".8" filter="url(#glow)"/>
    <ellipse cx="87" cy="142" rx="2" ry="2" fill="white" opacity=".6"/>

    <!-- ── BELT ── -->
    <rect x="52" y="208" width="76" height="14" rx="5" fill="#5c3a12" stroke="#7c4a1e" stroke-width="1.5"/>
    <!-- Belt buckle -->
    <rect x="81" y="210" width="18" height="10" rx="3" fill="#f59e0b" opacity=".9"/>
    <rect x="84" y="212" width="12" height="6" rx="2" fill="#fcd34d"/>

    <!-- ── SHOULDER PADS ── -->
    <!-- Left shoulder -->
    <ellipse cx="52" cy="122" rx="18" ry="13" fill="url(#armorGrad)" stroke="#95a5a6" stroke-width="1.5"/>
    <ellipse cx="48" cy="118" rx="8" ry="5" fill="rgba(255,255,255,.15)"/>
    <!-- Right shoulder -->
    <ellipse cx="128" cy="122" rx="18" ry="13" fill="url(#armorGrad)" stroke="#95a5a6" stroke-width="1.5"/>
    <ellipse cx="132" cy="118" rx="8" ry="5" fill="rgba(255,255,255,.15)"/>
    <!-- Shoulder spikes -->
    <polygon points="43,109 48,100 53,109" fill="#95a5a6"/>
    <polygon points="117,109 122,100 127,109" fill="#95a5a6"/>

    <!-- ── ARMS ── -->
    <!-- Left arm upper -->
    <rect x="28" y="122" width="22" height="44" rx="10" fill="url(#armorGrad)" stroke="#4a5e6d" stroke-width="1.5"/>
    <!-- Left forearm (skin) -->
    <rect x="26" y="162" width="20" height="38" rx="9" fill="url(#skinGrad)"/>
    <!-- Left hand -->
    <ellipse cx="36" cy="204" rx="12" ry="11" fill="url(#skinGrad)"/>
    <!-- Right arm upper -->
    <rect x="130" y="122" width="22" height="44" rx="10" fill="url(#armorGrad)" stroke="#4a5e6d" stroke-width="1.5"/>
    <!-- Right forearm -->
    <rect x="134" y="162" width="20" height="38" rx="9" fill="url(#skinGrad)"/>
    <!-- Right hand -->
    <ellipse cx="144" cy="204" rx="12" ry="11" fill="url(#skinGrad)"/>

    <!-- ── NECK ── -->
    <rect x="78" y="100" width="24" height="22" rx="8" fill="url(#skinGrad)"/>

    <!-- ── HEAD ── -->
    <!-- Helmet back -->
    <ellipse cx="90" cy="60" rx="36" ry="40" fill="url(#helmetGrad)" stroke="#4a6275" stroke-width="2"/>
    <!-- Helmet highlight -->
    <ellipse cx="76" cy="42" rx="14" ry="8" fill="rgba(255,255,255,.1)" transform="rotate(-20,76,42)"/>
    <!-- Hair peek (back) -->
    <path d="M${p.hairStyle==='long'?'58 70 Q54 95 58 115 Q68 125 78 115 Q82 95 90 90':'58 68 Q56 80 62 88'}"
      fill="${hc}" opacity=".9"/>
    <!-- Face opening -->
    <rect x="66" y="58" width="48" height="32" rx="8" fill="url(#skinGrad)"/>
    <!-- Face shading -->
    <rect x="66" y="58" width="48" height="32" rx="8" fill="rgba(0,0,0,.06)"/>
    <!-- Eyes -->
    <ellipse cx="78" cy="69" rx="6" ry="6" fill="white"/>
    <ellipse cx="102" cy="69" rx="6" ry="6" fill="white"/>
    <ellipse cx="79" cy="70" rx="4" ry="4" fill="#1e3a5f"/>
    <ellipse cx="103" cy="70" rx="4" ry="4" fill="#1e3a5f"/>
    <ellipse cx="80" cy="69" rx="2" ry="2" fill="#000"/>
    <ellipse cx="104" cy="69" rx="2" ry="2" fill="#000"/>
    <!-- Eye shine -->
    <circle cx="81" cy="68" r="1" fill="white" opacity=".9"/>
    <circle cx="105" cy="68" r="1" fill="white" opacity=".9"/>
    <!-- Eyebrows -->
    <path d="M73 63 Q79 61 84 63" stroke="${hc}" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M97 63 Q103 61 109 63" stroke="${hc}" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- Nose -->
    <path d="M89 73 Q87 79 90 81 Q93 79 91 73" fill="none" stroke="${shadeHex(sc,-25)}" stroke-width="1.5" stroke-linecap="round"/>
    <!-- Mouth / smile -->
    <path d="M84 85 Q90 90 96 85" fill="none" stroke="${shadeHex(sc,-30)}" stroke-width="1.8" stroke-linecap="round"/>
    <!-- Cheek blush -->
    <ellipse cx="75" cy="80" rx="6" ry="4" fill="#ff9999" opacity=".2"/>
    <ellipse cx="105" cy="80" rx="6" ry="4" fill="#ff9999" opacity=".2"/>
    <!-- Helmet visor bar (glowing) -->
    <rect x="64" y="56" width="52" height="7" rx="3" fill="${shc}" opacity=".85" filter="url(#glow)"/>
    <rect x="64" y="87" width="52" height="5" rx="2" fill="${shc}" opacity=".6"/>
    <!-- Helmet ear flaps -->
    <rect x="54" y="60" width="14" height="28" rx="7" fill="url(#helmetGrad)" stroke="#4a6275" stroke-width="1.5"/>
    <rect x="112" y="60" width="14" height="28" rx="7" fill="url(#helmetGrad)" stroke="#4a6275" stroke-width="1.5"/>
    <!-- Helmet crest (plume) -->
    <rect x="86" y="20" width="8" height="28" rx="4" fill="#ef4444"/>
    <path d="M84 20 Q90 8 96 20" fill="#ef4444"/>
    <rect x="87" y="22" width="4" height="24" rx="2" fill="#fca5a5" opacity=".5"/>
  </svg>`;

  spawnAvatarParticles();
}

function shadeHex(hex, amt) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

function buildWeaponSVG(type) {
  switch(type) {
    case 'staff':
      return `<rect x="150" y="30" width="9" height="140" rx="4" fill="#7c4a1e"/>
              <ellipse cx="154" cy="28" rx="16" ry="16" fill="#7c3aed" opacity=".3" filter="url(#softglow)"/>
              <circle cx="154" cy="28" r="14" fill="#7c3aed" opacity=".9"/>
              <circle cx="154" cy="28" r="9" fill="#ec4899" opacity=".9"/>
              <circle cx="150" cy="24" r="3" fill="white" opacity=".7"/>`;
    case 'shield':
      return `<path d="M16 110 Q10 135 20 165 Q28 185 36 190 Q44 185 52 165 Q62 135 56 110 Z" fill="#1e40af" stroke="#3b82f6" stroke-width="2"/>
              <path d="M36 112 L36 186" stroke="#f59e0b" stroke-width="2"/>
              <path d="M18 148 L54 148" stroke="#f59e0b" stroke-width="2"/>
              <circle cx="36" cy="148" r="6" fill="#f59e0b"/>`;
    case 'bow':
      return `<path d="M152 40 Q175 110 152 200" stroke="#7c4a1e" stroke-width="7" fill="none" stroke-linecap="round"/>
              <line x1="152" y1="40" x2="152" y2="200" stroke="#bdc3c7" stroke-width="1.5" stroke-dasharray="5,3"/>
              <line x1="155" y1="115" x2="125" y2="105" stroke="#bdc3c7" stroke-width="1.5"/>
              <polygon points="125,105 133,98 133,112" fill="#bdc3c7"/>`;
    default: // sword
      return `<rect x="146" y="60" width="11" height="100" rx="4" fill="#c8d6e5" stroke="#95a5a6" stroke-width="1"/>
              <rect x="144" y="60" width="15" height="3" rx="1" fill="rgba(255,255,255,.4)"/>
              <rect x="138" y="55" width="27" height="11" rx="4" fill="#f59e0b" stroke="#d97706" stroke-width="1"/>
              <polygon points="151,20 146,57 157,57" fill="#ecf0f1" stroke="#bdc3c7" stroke-width="1"/>
              <rect x="149" y="22" width="4" height="35" rx="1" fill="rgba(255,255,255,.35)"/>`;
  }
}

function spawnAvatarParticles() {
  const c = document.getElementById('avatarParticles');
  if (!c) return;
  c.innerHTML = '';
  const colors = ['#a78bfa','#ec4899','#06b6d4','#f59e0b'];
  for (let i = 0; i < 14; i++) {
    const d = document.createElement('div');
    d.className = 'apar';
    d.style.left = (20 + Math.random() * 60) + '%';
    d.style.bottom = (5 + Math.random() * 30) + '%';
    d.style.background = colors[Math.floor(Math.random()*colors.length)];
    d.style.animationDelay = (Math.random() * 4) + 's';
    d.style.animationDuration = (3 + Math.random() * 2) + 's';
    d.style.setProperty('--dx', (Math.random()*60-30) + 'px');
    c.appendChild(d);
  }
}

// ──────────────────────────────────────────────────────────
//  ARENA CLASH ANIMATION
// ──────────────────────────────────────────────────────────
function showClash(emoji) {
  const el = document.getElementById('arenaClash');
  if (!el) return;
  el.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'clash-anim';
  d.textContent = emoji;
  el.appendChild(d);
  setTimeout(() => { el.innerHTML = ''; }, 600);
}

document.addEventListener("DOMContentLoaded", () => {
  initGame();
  buildCSSAvatar();
  // Push baseline / daily-login snapshot
  setTimeout(() => pushSnapshot('daily login'), 1500);
});
