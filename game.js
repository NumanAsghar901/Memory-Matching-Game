/* ============================================================
   MEMORY MATCHING GAME
   Emoji Cards | Easy 3×4 | Medium 4×4 | Hard 5×5
   Fast card flip | Relaxing piano music via Web Audio API
   Firebase Firestore Leaderboard (localStorage fallback)
   ============================================================ */
"use strict";

/* ============================================================
   FIREBASE — replace with your own config
   https://console.firebase.google.com
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs,
  query, orderBy, limit, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

let db = null, firebaseReady = false;
try {
  if (FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
    firebaseReady = true;
  }
} catch (e) { console.warn("Firebase unavailable — using localStorage.", e); }

/* ============================================================
   EMOJI POOL  (25 unique)
   ============================================================ */
const EMOJI_POOL = [
  "😂","🤣","😜","🤪","😎","🥳","🤩","😏","🙃","😤",
  "🤯","🥴","😵","🤠","👻","💀","🎃","🤡","👾","🎭",
  "🦄","🐸","🦊","🐼","🐨",
];

/* ============================================================
   DIFFICULTY
   ============================================================ */
const DIFFICULTY = {
  easy:   { cols:3, totalCells:12, pairs:6,  label:"Easy"   },
  medium: { cols:4, totalCells:16, pairs:8,  label:"Medium" },
  hard:   { cols:5, totalCells:25, pairs:12, label:"Hard"   },
};

/* ============================================================
   WEB AUDIO — AudioContext (singleton, lazy)
   ============================================================ */
let audioCtx = null;
function getAC() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/* Generic oscillator beep — used for SFX only */
function beep(freq, dur, type, vol, delay = 0) {
  try {
    const ac = getAC();
    const o  = ac.createOscillator();
    const g  = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.type = type; o.frequency.value = freq;
    const t = ac.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}

/* ── Sound Effects ─────────────────────────────────────────── */
function playFlipSound()  { beep(900, 0.055, "sine",     0.12); }
function playWrongSound() { beep(160, 0.10,  "sawtooth", 0.22); beep(120, 0.14, "sawtooth", 0.20, 0.11); }
function playMatchSound() { beep(523, 0.10,  "sine", 0.26); beep(659, 0.10, "sine", 0.26, 0.11); beep(784, 0.16, "sine", 0.26, 0.22); }
function playWinSound()   { beep(523, 0.12,  "sine", 0.30, 0.00); beep(659, 0.12, "sine", 0.30, 0.14); beep(784, 0.12, "sine", 0.30, 0.28); beep(1047, 0.34, "sine", 0.30, 0.42); }

/* ============================================================
   PIANO MUSIC — relaxing, procedural, no external files
   Plays a gentle repeating arpeggio in C-major pentatonic.
   Each note is a piano-like tone: sine + triangle mix with
   fast attack and long exponential decay (hammer + resonance).
   ============================================================ */
let pianoLoop   = null;   // { intervalId, masterGain }
let musicOn     = false;

/* Frequencies for C-major pentatonic: C4 E4 G4 A4 C5 E5 G5 */
const PIANO_NOTES = [261.63, 329.63, 392.00, 440.00, 523.25, 659.25, 783.99];

/* Gentle arpeggio pattern (indices into PIANO_NOTES) */
const PATTERN = [0,1,2,3,4,3,2,1, 0,2,4,2,0,1,3,5, 1,3,5,3,1,2,4,6, 0,4,2,6,4,2,0,1];

/**
 * Play a single piano-like note.
 * Simulates a piano by layering:
 *   • A short bright "attack" oscillator (triangle, fast decay)
 *   • A sustained "body" oscillator (sine, longer decay)
 * Both are routed through a shared gain envelope.
 */
function playPianoNote(freq, masterGain, startTime) {
  try {
    const ac = getAC();

    /* Shared amplitude envelope */
    const env = ac.createGain();
    env.connect(masterGain);
    env.gain.setValueAtTime(0, startTime);
    env.gain.linearRampToValueAtTime(0.55, startTime + 0.008);   // fast attack
    env.gain.exponentialRampToValueAtTime(0.18, startTime + 0.12); // decay
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.4); // long release

    /* Body — sine for warmth */
    const body = ac.createOscillator();
    body.type = "sine";
    body.frequency.value = freq;
    body.connect(env);
    body.start(startTime);
    body.stop(startTime + 1.5);

    /* Attack "ping" — triangle one octave up, very brief */
    const ping = ac.createOscillator();
    ping.type = "triangle";
    ping.frequency.value = freq * 2;
    const pingGain = ac.createGain();
    pingGain.gain.setValueAtTime(0.25, startTime);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.08);
    ping.connect(pingGain);
    pingGain.connect(masterGain);
    ping.start(startTime);
    ping.stop(startTime + 0.1);

    /* Subtle reverb-like tail — detune a sine slightly */
    const tail = ac.createOscillator();
    tail.type = "sine";
    tail.frequency.value = freq * 1.002;   // 2-cent detune
    const tailGain = ac.createGain();
    tailGain.gain.setValueAtTime(0, startTime + 0.01);
    tailGain.gain.linearRampToValueAtTime(0.08, startTime + 0.05);
    tailGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.8);
    tail.connect(tailGain);
    tailGain.connect(masterGain);
    tail.start(startTime);
    tail.stop(startTime + 2.0);

  } catch (_) {}
}

function startPianoMusic() {
  if (pianoLoop) return;           // already playing
  try {
    const ac     = getAC();
    const master = ac.createGain();
    master.gain.setValueAtTime(0.38, ac.currentTime);

    /* Soft low-pass filter — takes the harsh edge off */
    const lpf = ac.createBiquadFilter();
    lpf.type            = "lowpass";
    lpf.frequency.value = 3800;
    lpf.Q.value         = 0.5;

    master.connect(lpf);
    lpf.connect(ac.destination);

    let step      = 0;
    const BPM     = 76;              // relaxing tempo
    const BEAT    = 60 / BPM;        // seconds per beat
    const NOTE_GAP = BEAT * 0.52;   // note every half-beat

    /* Schedule notes slightly ahead — avoids audio glitches */
    let nextNoteTime = ac.currentTime + 0.05;

    function scheduleAhead() {
      const LOOKAHEAD = 0.25;        // seconds to schedule ahead
      while (nextNoteTime < ac.currentTime + LOOKAHEAD) {
        const freq = PIANO_NOTES[PATTERN[step % PATTERN.length]];

        /* Occasionally add a bass note (root one octave down) */
        if (step % 8 === 0) {
          playPianoNote(PIANO_NOTES[0] / 2, master, nextNoteTime);
        }
        playPianoNote(freq, master, nextNoteTime);
        nextNoteTime += NOTE_GAP;
        step++;
      }
    }

    /* Poll every 50ms — tight enough for gap-free playback */
    const intervalId = setInterval(scheduleAhead, 50);
    scheduleAhead();   // kick off immediately

    pianoLoop = { intervalId, master, lpf };
  } catch (_) {}
}

function stopPianoMusic() {
  if (!pianoLoop) return;
  try {
    clearInterval(pianoLoop.intervalId);
    /* Fade out smoothly over 0.4s before disconnecting */
    const ac = getAC();
    pianoLoop.master.gain.setValueAtTime(pianoLoop.master.gain.value, ac.currentTime);
    pianoLoop.master.gain.linearRampToValueAtTime(0, ac.currentTime + 0.4);
    setTimeout(() => {
      try { pianoLoop.lpf.disconnect(); pianoLoop.master.disconnect(); } catch (_) {}
      pianoLoop = null;
    }, 450);
  } catch (_) { pianoLoop = null; }
}

/* ============================================================
   GAME STATE
   ============================================================ */
let state = {
  difficulty: "easy",
  cards:[], flipped:[], matched:[],
  moves:0, timerInterval:null, seconds:0,
  timerStarted:false, locked:false, winData:null,
};

/* ============================================================
   DOM
   ============================================================ */
const DOM = {
  board:              document.getElementById("gameBoard"),
  timer:              document.getElementById("timer"),
  moveCounter:        document.getElementById("moveCounter"),
  pairsFound:         document.getElementById("pairsFound"),
  totalPairs:         document.getElementById("totalPairs"),
  accuracy:           document.getElementById("accuracy"),
  newGameBtn:         document.getElementById("newGameBtn"),
  leaderboardBtn:     document.getElementById("leaderboardBtn"),
  musicToggle:        document.getElementById("musicToggle"),
  themeToggle:        document.getElementById("themeToggle"),
  diffBtns:           document.querySelectorAll(".btn-diff"),
  winModal:           document.getElementById("winModal"),
  finalTime:          document.getElementById("finalTime"),
  finalMoves:         document.getElementById("finalMoves"),
  finalScore:         document.getElementById("finalScore"),
  modalRating:        document.getElementById("modalRating"),
  playerName:         document.getElementById("playerName"),
  saveScoreBtn:       document.getElementById("saveScoreBtn"),
  playAgainBtn:       document.getElementById("playAgainBtn"),
  viewLeaderboard:    document.getElementById("viewLeaderboardBtn"),
  leaderboardModal:   document.getElementById("leaderboardModal"),
  leaderboardContent: document.getElementById("leaderboardContent"),
  closeLeaderboard:   document.getElementById("closeLeaderboard"),
  lbTabs:             document.querySelectorAll(".lb-tab"),
  lbSourceLabel:      document.getElementById("lbSourceLabel"),
  confettiContainer:  document.getElementById("confettiContainer"),
};

/* ============================================================
   INIT
   ============================================================ */
function init() {
  generateParticles();
  bindEvents();
  updateSourceBadge();
  startNewGame();
}

function updateSourceBadge() {
  if (DOM.lbSourceLabel) {
    DOM.lbSourceLabel.innerHTML = firebaseReady
      ? '<i class="fas fa-cloud"></i> Firebase'
      : '<i class="fas fa-database"></i> Local Storage';
  }
}

/* ============================================================
   EVENTS
   ============================================================ */
function bindEvents() {
  DOM.newGameBtn.addEventListener("click", startNewGame);
  DOM.playAgainBtn.addEventListener("click", () => { closeModal(DOM.winModal); startNewGame(); });

  DOM.diffBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.diff === state.difficulty && btn.classList.contains("active")) return;
      DOM.diffBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.difficulty = btn.dataset.diff;
      startNewGame();
      showToast("Difficulty: " + DIFFICULTY[state.difficulty].label);
    });
  });

  /* ── MUSIC BUTTON — only place that controls music ── */
  DOM.musicToggle.addEventListener("click", () => {
    getAC();          // unlock AudioContext on first user gesture
    musicOn = !musicOn;
    const icon = DOM.musicToggle.querySelector("i");
    if (musicOn) {
      DOM.musicToggle.classList.add("music-on");
      icon.className = "fas fa-volume-up";
      startPianoMusic();
      showToast("🎹 Piano Music ON");
    } else {
      DOM.musicToggle.classList.remove("music-on");
      icon.className = "fas fa-music";
      stopPianoMusic();
      showToast("🔇 Music OFF");
    }
  });

  DOM.themeToggle.addEventListener("click", toggleTheme);
  DOM.leaderboardBtn.addEventListener("click", openLeaderboard);
  DOM.viewLeaderboard.addEventListener("click", () => { closeModal(DOM.winModal); openLeaderboard(); });
  DOM.closeLeaderboard.addEventListener("click", () => closeModal(DOM.leaderboardModal));

  /* Save score */
  DOM.saveScoreBtn.addEventListener("click", async () => {
    const name = (DOM.playerName.value || "").trim() || "Anonymous";
    if (!state.winData) return;
    DOM.saveScoreBtn.disabled = true;
    DOM.saveScoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    await saveScore(state.difficulty, { name, ...state.winData });
    DOM.saveScoreBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
    showToast("🏆 Score saved!");
    setTimeout(() => { closeModal(DOM.winModal); openLeaderboard(); }, 800);
  });

  DOM.lbTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      DOM.lbTabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      loadAndRender(tab.dataset.diff);
    });
  });

  [DOM.winModal, DOM.leaderboardModal].forEach(m => {
    m.addEventListener("click", e => { if (e.target === m) closeModal(m); });
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closeModal(DOM.winModal); closeModal(DOM.leaderboardModal); }
  });
}

/* ============================================================
   NEW GAME — NEVER touches music state
   ============================================================ */
function startNewGame() {
  clearTimer();
  state.flipped=[]; state.matched=[]; state.moves=0;
  state.seconds=0; state.timerStarted=false; state.locked=false; state.winData=null;

  DOM.moveCounter.textContent = "0";
  DOM.timer.textContent       = "00:00";
  DOM.accuracy.textContent    = "100%";

  const diff = DIFFICULTY[state.difficulty];
  DOM.totalPairs.textContent = diff.pairs;
  DOM.pairsFound.firstChild.textContent = "0/";

  state.cards = buildCards(diff.pairs);
  renderBoard();
}

/* ============================================================
   CARDS
   ============================================================ */
function buildCards(pairs) {
  const emojis  = shuffle([...EMOJI_POOL]).slice(0, pairs);
  const doubled = [];
  emojis.forEach(e => { doubled.push(e); doubled.push(e); });
  return shuffle(doubled).map((emoji, idx) => ({
    uid:idx, emoji, id:emoji, flipped:false, matched:false,
  }));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ============================================================
   RENDER — Hard: 25 cells, 24 real + 1 centred spacer
   ============================================================ */
function renderBoard() {
  DOM.board.className = "game-board " + state.difficulty;
  DOM.board.innerHTML = "";

  state.cards.forEach((card, i) => {
    const el = createCard(card);
    el.style.animationDelay = (i * 28) + "ms";
    DOM.board.appendChild(el);
  });

  if (state.difficulty === "hard") {
    const spacer = document.createElement("div");
    spacer.className = "card spacer";
    DOM.board.appendChild(spacer);
  }
}

function createCard(card) {
  const el = document.createElement("div");
  el.className   = "card";
  el.dataset.uid = card.uid;
  el.innerHTML   = `
    <div class="card-inner">
      <div class="card-face card-back">
        <div class="card-back-inner">❓</div>
      </div>
      <div class="card-face card-front">
        <div class="card-emoji">${card.emoji}</div>
      </div>
    </div>`;
  el.addEventListener("click", () => onCardClick(card.uid, el));
  return el;
}

/* ============================================================
   CARD CLICK
   ============================================================ */
function onCardClick(uid, cardEl) {
  const card = state.cards.find(c => c.uid === uid);
  if (!card || state.locked || card.flipped || card.matched) return;
  if (state.flipped.length >= 2) return;

  if (!state.timerStarted) { startTimer(); state.timerStarted = true; }

  card.flipped = true;
  cardEl.classList.add("flipped");
  playFlipSound();
  state.flipped.push({ uid, el:cardEl, card });

  if (state.flipped.length === 2) {
    state.moves++;
    DOM.moveCounter.textContent = state.moves;
    updateAccuracy();
    checkMatch();
  }
}

/* ============================================================
   MATCH CHECK — reduced delays to match faster flip
   ============================================================ */
function checkMatch() {
  const [a, b] = state.flipped;
  state.locked  = true;

  if (a.card.id === b.card.id) {
    /* ✅ MATCH — wait just long enough for flip to complete (280ms) */
    setTimeout(() => {
      a.el.classList.add("matched","no-hover");
      b.el.classList.add("matched","no-hover");
      a.card.matched = b.card.matched = true;
      state.matched.push(a.card.id);
      state.flipped=[]; state.locked=false;
      playMatchSound();
      updatePairsUI();
      if (state.matched.length === DIFFICULTY[state.difficulty].pairs) setTimeout(onWin, 500);
    }, 300);                          // ← was 350 → now 300ms
  } else {
    /* ❌ NO MATCH — show face briefly then flip back */
    setTimeout(() => {
      a.el.classList.add("wrong"); b.el.classList.add("wrong");
      setTimeout(() => { a.el.classList.remove("wrong"); b.el.classList.remove("wrong"); }, 360);
      a.el.classList.remove("flipped"); b.el.classList.remove("flipped");
      a.card.flipped = b.card.flipped = false;
      state.flipped=[]; state.locked=false;
      playWrongSound(); updateAccuracy();
    }, 700);                          // ← was 850 → now 700ms
  }
}

/* ============================================================
   STATS
   ============================================================ */
function updatePairsUI() { DOM.pairsFound.firstChild.textContent = state.matched.length + "/"; }
function updateAccuracy() {
  if (!state.moves) { DOM.accuracy.textContent = "100%"; return; }
  DOM.accuracy.textContent = Math.min(Math.round(state.matched.length/state.moves*100),100)+"%";
}

/* ============================================================
   TIMER
   ============================================================ */
function startTimer() {
  clearTimer();
  state.timerInterval = setInterval(() => { state.seconds++; DOM.timer.textContent=fmt(state.seconds); }, 1000);
}
function clearTimer() { if(state.timerInterval){clearInterval(state.timerInterval);state.timerInterval=null;} }
function fmt(s) { return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }

/* ============================================================
   WIN
   ============================================================ */
function onWin() {
  clearTimer();
  playWinSound();
  const time  = fmt(state.seconds);
  const score = calcScore(state.seconds, state.moves, state.difficulty);
  state.winData = { time, moves:state.moves, score, seconds:state.seconds, date:new Date().toLocaleDateString() };
  DOM.finalTime.textContent   = time;
  DOM.finalMoves.textContent  = state.moves;
  DOM.finalScore.textContent  = score.toLocaleString();
  DOM.modalRating.textContent = getRating(score);
  DOM.playerName.value        = "";
  DOM.saveScoreBtn.disabled   = false;
  DOM.saveScoreBtn.innerHTML  = '<i class="fas fa-save"></i> Save Score';
  launchConfetti();
  openModal(DOM.winModal);
}

function calcScore(s,m,d) {
  const {pairs}=DIFFICULTY[d];
  return Math.max(0, pairs*1000 + Math.max(0,3000-s*5) - Math.max(0,(m-pairs)*50));
}
function getRating(score) {
  if(score>=9000)return"⭐⭐⭐⭐⭐ Legendary!";
  if(score>=7000)return"⭐⭐⭐⭐ Excellent!";
  if(score>=5000)return"⭐⭐⭐ Great Job!";
  if(score>=3000)return"⭐⭐ Good!";
  return"⭐ Keep Practicing!";
}

/* ============================================================
   FIREBASE / LOCALSTORAGE LEADERBOARD
   ============================================================ */
const LS_KEY = "mmg_lb_v4";

async function saveScore(diff, entry) {
  if (firebaseReady && db) {
    try {
      await addDoc(collection(db,"leaderboard"), {
        difficulty:diff, name:entry.name, score:entry.score,
        time:entry.time, moves:entry.moves, seconds:entry.seconds,
        date:entry.date, createdAt:serverTimestamp(),
      });
      return;
    } catch(e) { console.warn("Firebase save failed.",e); }
  }
  const data = getLSData();
  if (!data[diff]) data[diff]=[];
  data[diff].push(entry);
  data[diff].sort((a,b)=>b.score!==a.score?b.score-a.score:a.seconds-b.seconds);
  data[diff]=data[diff].slice(0,10);
  localStorage.setItem(LS_KEY,JSON.stringify(data));
}

async function fetchScores(diff) {
  if (firebaseReady && db) {
    try {
      const q = query(collection(db,"leaderboard"), where("difficulty","==",diff), orderBy("score","desc"), orderBy("seconds","asc"), limit(10));
      const snap = await getDocs(q);
      return snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch(e) { console.warn("Firebase fetch failed.",e); }
  }
  return getLSData()[diff]||[];
}

function getLSData() {
  try{return JSON.parse(localStorage.getItem(LS_KEY))||{};}catch{return{};}
}

/* ============================================================
   LEADERBOARD UI
   ============================================================ */
function openLeaderboard() {
  DOM.lbTabs.forEach(t=>t.classList.toggle("active",t.dataset.diff===state.difficulty));
  openModal(DOM.leaderboardModal);
  loadAndRender(state.difficulty);
}

async function loadAndRender(diff) {
  DOM.leaderboardContent.innerHTML=`<div class="lb-loading"><i class="fas fa-spinner fa-spin"></i> Loading…</div>`;
  const entries = await fetchScores(diff);
  const medals  = ["🥇","🥈","🥉"];
  const avatars  = ["🎮","🕹️","🏅","🎯","🎲","⭐","🔥","💎","🚀","🌟"];
  if (!entries.length) {
    DOM.leaderboardContent.innerHTML=`<div class="lb-empty"><i class="fas fa-trophy"></i><p>No scores yet for <strong>${DIFFICULTY[diff].label}</strong>.</p><p style="font-size:.75rem;margin-top:5px;opacity:.7">Win a game and save your score!</p></div>`;
    return;
  }
  DOM.leaderboardContent.innerHTML = entries.map((e,i)=>`
    <div class="lb-entry">
      <div class="lb-rank">${medals[i]!==undefined?`<span style="font-size:1.2rem">${medals[i]}</span>`:`<span class="lb-rank-num">${i+1}</span>`}</div>
      <div class="lb-avatar">${avatars[i%avatars.length]}</div>
      <div class="lb-info">
        <div class="lb-name">${escHtml(e.name||"Anonymous")}</div>
        <div class="lb-metrics"><span>⏱ ${e.time}</span><span>🖱 ${e.moves} moves</span><span>📅 ${e.date}</span></div>
      </div>
      <div class="lb-score-col">
        <div class="lb-score">${Number(e.score).toLocaleString()}</div>
        <div class="lb-diff-badge">${DIFFICULTY[diff].label}</div>
      </div>
    </div>`).join("");
}

function escHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

/* ============================================================
   THEME
   ============================================================ */
function toggleTheme() {
  const isLight = document.documentElement.getAttribute("data-theme")==="light";
  const icon = DOM.themeToggle.querySelector("i");
  if(isLight){document.documentElement.removeAttribute("data-theme");icon.className="fas fa-moon";showToast("🌙 Dark Mode");}
  else{document.documentElement.setAttribute("data-theme","light");icon.className="fas fa-sun";showToast("☀️ Light Mode");}
}

/* ============================================================
   MODALS
   ============================================================ */
function openModal(m)  { m.classList.add("active");    document.body.style.overflow="hidden"; }
function closeModal(m) { m.classList.remove("active"); document.body.style.overflow=""; }

/* ============================================================
   CONFETTI
   ============================================================ */
const CC=["#7c3aed","#a855f7","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#84cc16"];
function launchConfetti() {
  DOM.confettiContainer.innerHTML="";
  for(let i=0;i<75;i++){
    const p=document.createElement("div"); p.className="confetti-piece";
    const s=6+Math.random()*10,col=CC[Math.floor(Math.random()*CC.length)];
    p.style.cssText=`left:${Math.random()*100}%;top:${-10-Math.random()*20}px;width:${s}px;height:${s}px;background:${col};border-radius:${Math.random()>.5?"50%":"3px"};animation-duration:${1.4+Math.random()*2.2}s;animation-delay:${Math.random()*.7}s;`;
    DOM.confettiContainer.appendChild(p);
  }
}

/* ============================================================
   PARTICLES
   ============================================================ */
const PC=["#7c3aed","#a855f7","#ec4899","#f59e0b","#10b981"];
function generateParticles() {
  const c=document.getElementById("particles"); if(!c)return;
  for(let i=0;i<20;i++){
    const p=document.createElement("div"),sz=4+Math.random()*14;
    p.className="particle";
    p.style.cssText=`width:${sz}px;height:${sz}px;left:${Math.random()*100}%;bottom:-20px;background:${PC[Math.floor(Math.random()*PC.length)]};animation-duration:${8+Math.random()*16}s;animation-delay:${Math.random()*10}s;${Math.random()>.6?"filter:blur(1px);":""}`;
    c.appendChild(p);
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let _tc=null;
function getTC(){if(!_tc){_tc=document.createElement("div");_tc.className="toast-container";document.body.appendChild(_tc);}return _tc;}
function showToast(msg,dur=2500){
  const c=getTC(),t=document.createElement("div");
  t.className="toast";t.textContent=msg;c.appendChild(t);
  setTimeout(()=>{t.style.animation="toastOut .32s ease forwards";setTimeout(()=>{if(t.parentNode)t.parentNode.removeChild(t);},340);},dur);
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener("DOMContentLoaded", init);