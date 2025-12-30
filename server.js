const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());

// Method Change: Create Server
const server = http.createServer(app);

// Method Change: Socket.io setup for production environment
const io = new Server(server, {
  cors: {
    origin: "*", // Allow connections from any domain (crucial for hosting)
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
});

const AUCTION_TIMER_SECONDS = 10;

// Method Change: GoDaddy assigns a specific named pipe or port.
// We MUST use process.env.PORT
const PORT = process.env.PORT || 3001;

// --- SERVE FILES ---
// Method Change: Robust path resolving
app.use(express.static(path.join(__dirname)));

// Serve the main file
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "ipl.html"));
});

// --- UTILS ---
function getRoomId(socket) {
  return [...socket.rooms].find((r) => r !== socket.id);
}

function isAdmin(socket) {
  const roomId = getRoomId(socket);
  const r = rooms[roomId];
  return r && r.adminSocketId === socket.id;
}

// --- GLOBAL STATE ---
const rooms = {};

// --- TIMER LOGIC ---
function startTimer(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  // Optimization: Don't restart if timer is basically full (prevents spam jitter)
  if (r.timerInterval && r.timer > AUCTION_TIMER_SECONDS - 2) return;

  if (r.timerInterval) clearInterval(r.timerInterval);

  r.timer = AUCTION_TIMER_SECONDS;
  r.timerPaused = false;
  
  // Anti-Drift: precise end time
  r.timerEndTime = Date.now() + (r.timer * 1000);

  io.to(roomId).emit("timer_tick", r.timer);
  io.to(roomId).emit("timer_status", false);

  r.timerInterval = setInterval(() => {
    if (r.timerPaused) {
       // If paused, dragging the end time forward so we don't jump when unpaused
       r.timerEndTime += 1000;
       return;
    }
    
    // Calculate remaining based on system clock
    const remaining = Math.ceil((r.timerEndTime - Date.now()) / 1000);
    r.timer = remaining;

    io.to(roomId).emit("timer_tick", r.timer);
    if (r.timer <= 0) {
      processSale(roomId);
    }
  }, 1000);
}

function stopTimer(roomId) {
  const r = rooms[roomId];
  if (r && r.timerInterval) {
    clearInterval(r.timerInterval);
    r.timerInterval = null;
  }
}

function processSale(roomId, source = "UNKNOWN") {
  const r = rooms[roomId];
  if (!r || !r.currentPlayer || r.sellingInProgress) return;

  r.sellingInProgress = true;
  stopTimer(roomId);
  io.to(roomId).emit("timer_ended");

  let soldPrice = 0;
  let soldTeamName = null;
  let isUnsold = true;

  if (r.currentBidder) {
    const team = r.teams.find((t) => t.bidKey === r.currentBidder);
    if (team) {
      soldPrice = r.currentBid;
      team.roster.push({
        ...r.currentPlayer,
        price: soldPrice,
        status: "SOLD",
      });
      team.totalSpent += soldPrice;
      team.totalPlayers += 1;
      team.budget -= soldPrice;
      soldTeamName = team.name;
      isUnsold = false;
    }
  }

  r.currentPlayer.status = isUnsold ? "UNSOLD" : "SOLD";
  r.currentPlayer.soldPrice = soldPrice;

  // Send finalized data (used by Frontend TTS)
  io.to(roomId).emit("sale_finalized", {
    soldPlayer: r.currentPlayer,
    isUnsold: isUnsold,
    soldDetails: { soldTeam: soldTeamName },
    price: soldPrice,
    updatedTeams: r.teams,
  });

  r.auctionIndex++;

  setTimeout(() => {
    if (rooms[roomId]) rooms[roomId].sellingInProgress = false;
    startNextLot(roomId);
  }, 4000); // 4s delay to read the result
}

function startNextLot(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  if (r.auctionIndex >= r.auctionQueue.length) {
    io.to(roomId).emit("open_squad_selection");
    return;
  }

  r.currentPlayer = r.auctionQueue[r.auctionIndex];

  // Skip if already processed (Resuming)
  if (r.currentPlayer.status) {
    r.auctionIndex++;
    startNextLot(roomId);
    return;
  }

  r.currentBid = r.currentPlayer.basePrice;
  r.currentBidder = null;
  r.sellingInProgress = false;

  // Trigger update (Frontend plays "Lot Number..." TTS)
  io.to(roomId).emit("update_lot", {
    player: r.currentPlayer,
    currentBid: r.currentBid,
    lotNumber: r.auctionIndex + 1,
  });

  startTimer(roomId);
}

// --- AUTH MIDDLEWARE ---
io.use((socket, next) => {
  const playerId = socket.handshake.auth.playerId;
  socket.playerId = playerId || "guest_" + socket.id;
  next();
});

// --- SOCKET HANDLERS ---
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id} (PID: ${socket.playerId})`);

  socket.on("pingServer", () => socket.emit("pongServer"));

  // 1. CREATE ROOM
  socket.on("create_room", ({ roomId, password, config }) => {
    if (rooms[roomId]) return socket.emit("error_message", "Room Exists!");

    rooms[roomId] = {
      password,
      config,
      users: [],
      teams: [],
      auctionQueue: [],
      auctionIndex: 0,
      currentBid: 0,
      currentBidder: null,
      currentPlayer: null,
      timer: AUCTION_TIMER_SECONDS,
      timerInterval: null,
      timerPaused: true,
      state: { isActive: false },
      adminSocketId: socket.id,
      adminPlayerId: socket.playerId,
      sellingInProgress: false,
      squads: {},
    };
    socket.join(roomId);
    rooms[roomId].users.push(socket.id);
    socket.emit("roomcreated", roomId);
  });

  // 2. JOIN ROOM
  socket.on("join_room", ({ roomId, password }) => {
    const r = rooms[roomId];
    if (!r || r.password !== password)
      return socket.emit("error_message", "Invalid Credentials");

    socket.join(roomId);
    if (!r.users.includes(socket.id)) r.users.push(socket.id);

    let isAdminReconnected = false;

    if (r.adminPlayerId === socket.playerId) {
      r.adminSocketId = socket.id;
      isAdminReconnected = true;
    }

    const myTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
    if (myTeam) {
      myTeam.ownerSocketId = socket.id;
      socket.emit("team_claim_success", myTeam.bidKey);
    }

    socket.emit("room_joined", {
      roomId,
      isAdmin: isAdminReconnected,
      lobbyState: { teams: r.teams, userCount: r.users.length },
      state: {
        isActive: r.state.isActive,
        teams: r.teams,
        queue: r.auctionQueue,
      },
    });

    io.to(roomId).emit("lobby_update", {
      teams: r.teams,
      userCount: r.users.length,
    });
  });

  socket.on("request_sync", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      let remaining = r.timer;
      if (!r.timerPaused && r.timerEndTime) {
         remaining = Math.ceil((r.timerEndTime - Date.now()) / 1000);
         if (remaining < 0) remaining = 0;
      }
      
      socket.emit("sync_data", {
        teams: r.teams,
        queue: r.auctionQueue,
        auctionIndex: r.auctionIndex,
        currentLot: r.currentPlayer,
        currentBid: r.currentBid,
        currentBidder: r.currentBidder,
        timer: remaining,
        timerPaused: r.timerPaused,
      });
    }
  });

  socket.on("update_lobby_teams", (teams) => {
    const roomId = getRoomId(socket);
    if (!isAdmin(socket)) return;
    if (rooms[roomId]) {
      rooms[roomId].teams = teams;
      io.to(roomId).emit("lobby_update", {
        teams,
        userCount: rooms[roomId].users.length,
      });
    }
  });

  socket.on("claim_lobby_team", (key) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    if (
      r.teams.find(
        (t) => t.ownerPlayerId === socket.playerId && t.bidKey !== key
      )
    ) {
      return socket.emit("error_message", "You already own a team!");
    }

    const t = r.teams.find((x) => x.bidKey === key);
    if (t && (!t.isTaken || t.ownerPlayerId === socket.playerId)) {
      t.isTaken = true;
      t.ownerSocketId = socket.id;
      t.ownerPlayerId = socket.playerId;
      socket.emit("team_claim_success", key);
      io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length,
      });
    }
  });

  socket.on("reclaim_team", (key) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;
    const t = r.teams.find((x) => x.bidKey === key);

    if (t && t.ownerPlayerId === socket.playerId) {
      t.ownerSocketId = socket.id;
      socket.emit("team_claim_success", key);
    }
  });

  socket.on("request_reclaim_manual", ({ teamKey }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (!r) return;

    const targetTeam = r.teams.find((t) => t.bidKey === teamKey);
    if (!targetTeam) return;

    if (r.adminSocketId) {
      io.to(r.adminSocketId).emit("admin_reclaim_request", {
        teamKey: teamKey,
        teamName: targetTeam.name,
        requesterId: socket.id,
        requesterPid: socket.playerId,
      });
    }
  });

  socket.on(
    "admin_reclaim_decision",
    ({ approved, teamKey, requesterId, requesterPid }) => {
      const roomId = getRoomId(socket);
      const r = rooms[roomId];
      if (!r || !isAdmin(socket)) return;

      if (approved) {
        const team = r.teams.find((t) => t.bidKey === teamKey);
        if (team) {
          team.ownerSocketId = requesterId;
          team.ownerPlayerId = requesterPid;
          io.to(requesterId).emit("team_claim_success", teamKey);
          io.to(roomId).emit("lobby_update", {
            teams: r.teams,
            userCount: r.users.length,
          });
        }
      } else {
        io.to(requesterId).emit(
          "error_message",
          "Host denied your reclaim request."
        );
      }
    }
  );

  socket.on("admin_rename_team", ({ key, newName }) => {
    const roomId = getRoomId(socket);
    if (!isAdmin(socket)) return;
    const t = rooms[roomId].teams.find((x) => x.bidKey === key);
    if (t) t.name = newName;
    io.to(roomId).emit("lobby_update", {
      teams: rooms[roomId].teams,
      userCount: rooms[roomId].users.length,
    });
  });

  // START AUCTION - Accepts filtered teams list
  socket.on("start_auction", ({ queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      // SECURITY FIX: Use Server Internal State for Teams, do not trust client 'teams'
      const activeTeams = r.teams.filter(t => t.isTaken);
      
      r.teams = activeTeams.map((t) => ({
        ...t,
        roster: [],
        totalSpent: 0,
        totalPlayers: 0,
      }));
      r.auctionQueue = queue;
      r.state.isActive = true;
      io.to(roomId).emit("auction_started", {
        teams: r.teams,
        queue: r.auctionQueue,
      });
      startNextLot(roomId);
    }
  });

  socket.on("place_bid", ({ teamKey, amount }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (
      !r ||
      !r.state.isActive ||
      r.timerPaused ||
      r.sellingInProgress ||
      !r.currentPlayer
    )
      return;

    const team = r.teams.find((t) => t.bidKey === teamKey);
    if (!team) return;

    if (team.ownerSocketId !== socket.id) {
      if (team.ownerPlayerId === socket.playerId) {
        team.ownerSocketId = socket.id;
      } else {
        return socket.emit("error_message", "Authorization Failed");
      }
    }

    if (r.currentBidder === teamKey) return;
    if (team.budget < amount) return socket.emit("error_message", "No Budget!");
    if (amount <= r.currentBid && r.currentBidder)
      return socket.emit("error_message", "Bid too low!");

    r.currentBid = amount;
    r.currentBidder = teamKey;

    io.to(roomId).emit("bid_update", { amount, team });
    startTimer(roomId);
  });

  socket.on("toggle_timer", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      r.timerPaused = !r.timerPaused;
      io.to(roomId).emit("timer_status", r.timerPaused);
    }
  });

  socket.on("finalize_sale", () => {
    const roomId = getRoomId(socket);
    if (isAdmin(socket)) {
      // Server Authority: We ignore client params (isUnsold, price, etc.)
      // internal state (r.currentBidder) determines the outcome.
      processSale(roomId, "ADMIN");
    }
  });

  socket.on("end_auction_trigger", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (isAdmin(socket) && r) {
      stopTimer(roomId);
      r.state.isActive = false;
      io.to(roomId).emit("open_squad_selection");
    }
  });

  socket.on("submit_squad", ({ teamKey, playing11, impact, captain }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      r.squads[teamKey] = { playing11, impact, captain };
      io.to(roomId).emit("squad_submission_update", {
        submittedCount: Object.keys(r.squads).length,
        totalTeams: r.teams.filter((t) => t.isTaken).length,
      });

      // Auto-start simulation if all teams have submitted
      const activeTeamsCount = r.teams.filter((t) => t.isTaken).length;
      if (Object.keys(r.squads).length === activeTeamsCount) {
         console.log("All squads submitted. Auto-starting simulation...");
         runSimulationLogic(roomId, r);
      }
    }
  });



  // Added to support the previous script listener
  socket.on("startTournament", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      runSimulationLogic(roomId, r);
    }
  });

  socket.on("disconnect", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      r.users = r.users.filter((id) => id !== socket.id);
      io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length,
      });
    }
  });
});

// --- ROBUST AI ENGINE ---
function runSimulationLogic(roomId, r) {
  // 1. Prepare Teams (Auto-fill if not submitted)
  const tourneyTeams = r.teams
    .filter((t) => t.isTaken)
    .map((t) => {
      const squadData = r.squads[t.bidKey];
      let p11 = squadData ? squadData.playing11 : [];

      // Auto-fill logic: if squad incomplete, fill from roster
      if (p11.length < 11 && t.roster.length > 0) {
        // Simple fill: take first 11 or all if less than 11
        const needed = 11 - p11.length;
        const available = t.roster.filter(
          (p) => !p11.some((x) => x.name === p.name)
        );
        p11 = [...p11, ...available.slice(0, needed)];
      }

      const captainName = squadData
        ? squadData.captain
        : p11.length > 0
        ? p11[0].name
        : "None";

      return {
        ...t,
        playing11: p11,
        captain: captainName,
      };
    })
    .filter((t) => t.playing11.length > 0); // Need at least 1 player to play

  if (tourneyTeams.length < 2) {
    return io
      .to(roomId)
      .emit(
        "simulation_error",
        "Need at least 2 teams with players to simulate!"
      );
  }

  try {
    console.log("Teams prepared, running NEW GAME LOGIC sim...");
    // Calling the NEW Logic Engine
    const results = runNewLogicSimulation(tourneyTeams);
    console.log("Simulation complete, sending results.");
    // Sending 'tournament_results' to match frontend listener in script.js
    io.to(roomId).emit("tournamentComplete", results);
  } catch (e) {
    console.error("Simulation Error:", e);
    io.to(roomId).emit("simulation_error", "Server Logic Error: " + e.message);
  }
}

// =================================================================
// 🚀 UPDATED GAME ENGINE (Strict adherence to your Luck/Role Rules)
// =================================================================

// 1. Helper to generate Luck (1-10)
const getLuck = () => Math.floor(Math.random() * 10) + 1;

// 2. Define Batting Order Priority
const ROLE_PRIORITY = {
  opener: 1,
  wk: 1, // Wicketkeepers are often top/middle
  "middle order": 2,
  batter: 2,
  finisher: 3,
  "all-rounder": 4,
  ar: 4,
  allrounder: 4,
  spinner: 5,
  spin: 5,
  "fast bowler": 6,
  bowler: 6,
  fast: 6,
  pace: 6,
};

// Helper to determine order
const getPriority = (roleKey) => {
  if (!roleKey) return 99;
  const lower = roleKey.toLowerCase();
  for (const key in ROLE_PRIORITY) {
    if (lower.includes(key)) return ROLE_PRIORITY[key];
  }
  return 99;
};

// 3. The Core Ball-by-Ball Logic
// 3. The Core Ball-by-Ball Logic (Rebalanced for T20)
// --- SIMULATION HELPERS ---

const BATTER_PROFILE = {
  opener: { aggression: 0.6, risk: 0.4 },
  anchor: { aggression: 0.35, risk: 0.2 }, // Tuned: Slower accumulation
  finisher: { aggression: 0.9, risk: 0.65 },
  allrounder: { aggression: 0.55, risk: 0.4 },
  bowler: { aggression: 0.2, risk: 0.7 },
};

function getBatterProfile(roleKey) {
  const r = (roleKey || "").toLowerCase();
  if (r.includes("finisher")) return BATTER_PROFILE.finisher;
  if (r.includes("opener")) return BATTER_PROFILE.opener;
  if (r.includes("all")) return BATTER_PROFILE.allrounder;
  if (r.includes("bowl") || r.includes("spin") || r.includes("fast"))
    return BATTER_PROFILE.bowler;
  return BATTER_PROFILE.anchor;
}

function getPhase(over) {
  if (over <= 6) return "powerplay";
  if (over <= 15) return "middle";
  return "death";
}



function getBowlerType(roleKey) {
  const r = (roleKey || "").toLowerCase();
  if (r.includes("spin")) return "spin";
  if (r.includes("fast") || r.includes("pace")) return "pace";
  if (r.includes("fast") || r.includes("pace")) return "pace";
  return "medium";
}

// 🏟️ PITCH TYPES (Fixed Definition)
const PITCH_TYPES = {
  BATTING: {
    name: "Batting Friendly",
    runBoost: 1,
    luckShift: -1   // fewer wickets
  },
  BOWLING: {
    name: "Bowling Friendly",
    runBoost: -1,
    luckShift: 1    // more wickets
  },
  COMMON: {
    name: "Balanced",
    runBoost: 0,
    luckShift: 0
  }
};



// --- NEW REALISTIC ENGINE ---
// --- FINAL BALL ENGINE (WITH PITCH INFLUENCE) ---
function simulateBall(batsman, bowler, phase = "middle", pitch = PITCH_TYPES.COMMON) {
  let luck = Math.floor(Math.random() * 10) + 1;

  // Pitch influence
  luck += pitch.luckShift;

  // Bowler skill bias (Skill modifiers to luck)
  if ((bowler.bowl || 50) > 85) luck += 2;
  else if ((bowler.bowl || 50) > 75) luck += 1;

  // Phase effect
  if (phase === "death") luck += 1;
  if (phase === "powerplay") luck -= 1;
  
  // Bowler pressure (Additional small nudge based on raw skill vs random)
  const bowlBoost = (bowler.bowl || 50) / 100;
  luck += Math.random() < bowlBoost ? 1 : 0;

  // Clamp luck to ensure valid range 1-10+ (Logic handles >9 anyway, but let's keep it sane if needed, though high luck = OUT)
  // Actually, don't clamp high, as high = Wicket. Clamp low to 1.
  luck = Math.max(1, luck);

  return resolveBall(luck, batsman, pitch);
}

function resolveBall(luck, batsman, pitch) {
  const batBoost = (batsman.bat || 50) / 100;
  let event = {
    runs: 0,
    wicket: false,
    extra: null,
    legal: true,
    commentary: ""
  };

  // 1. WICKET (High Luck)
  if (luck >= 9) {
    event.wicket = true;
    event.commentary = "OUT! Cleaned him up!";
    return event;
  }

  // 2. BOUNDARY (Medium-High Luck)
  else if (luck >= 7) {
    event.runs = Math.random() < batBoost ? 6 : 4;
    event.commentary = event.runs === 6 ? "Maximum!" : "Four runs!";
  }
  else if (luck >= 5) {
    event.runs = Math.random() < 0.5 ? 4 : 6;
    event.commentary = "Boundary!";
  }
  
  // 3. RUNS (Medium Luck)
  else if (luck === 4) {
    event.runs = Math.random() < 0.5 ? 2 : 3;
    event.commentary = "Good running.";
  }
  else if (luck === 3) {
    event.runs = 1;
    event.commentary = "Single taken.";
  }
  
  // 4. DOT / EXTRA (Low Luck)
  else if (luck === 2) {
    event.runs = 0;
    event.commentary = "Dot ball.";
  }
  else {
    // luck <= 1
    event.extra = Math.random() < 0.7 ? "WIDE" : "NO BALL";
    if(event.extra === "NO BALL") event.legal = false; // both wide & no-ball are illegal
    event.runs = 1;
    event.legal = false;
    event.commentary = event.extra;
    // Applying run boost to extras? No, distinct event.
    return event; 
  }

  // Apply Pitch Run Boost (Only to legal runs)
  if (event.legal && !event.wicket) {
      // Logic from user: runs = Math.max(0, runs + pitch.runBoost);
      // But we must handle boundaries carefully? 
      // User said "runs = Math.max(0, runs + pitch.runBoost)".
      // If runBoost is +1, singles become doubles? 4 becomes 5? (5 runs valid? maybe overthrown).
      // If runBoost is -1, 4 becomes 3? 
      // User prompt: "runs = Math.max(0, runs + pitch.runBoost);"
      // Let's trust the "Simple & Powerful" logic.
      const originalRuns = event.runs;
      event.runs = Math.max(0, event.runs + pitch.runBoost);
      
      // Fix commentary if run count changes weirdly?
      if (originalRuns === 4 && event.runs !== 4) event.commentary = `${event.runs} runs (cut off).`;
      if (originalRuns === 6 && event.runs !== 6) event.commentary = `Just inside ropes! ${event.runs} runs.`;
  }

  return event;
}

function runNewLogicSimulation(teams) {
  const allStats = {}; // Central stats tracker for Caps
  const leagueMatches = [];
  const playoffs = [];

  // Init Stats
  teams.forEach((t) => {
    t.stats = {
      played: 0,
      won: 0,
      lost: 0,
      pts: 0,
      nrr: 0,
      runsScored: 0,
      runsConceded: 0,
      oversFaced: 0,
      oversBowled: 0,
    };
    t.playing11.forEach((p) => {
      allStats[p.name] = {
        name: p.name,
        runs: 0,
        wkts: 0,
        pts: 0,
        fours: 0,
        sixes: 0,
      };
    });
  });

  const getPlayerStat = (name) => {
    if (!allStats[name])
      allStats[name] = {
        name: name,
        runs: 0,
        wkts: 0,
        pts: 0,
        fours: 0,
        sixes: 0,
      };
    return allStats[name];
  };

  // --- INNINGS SIMULATOR ---
  // --- INNINGS SIMULATOR (FINAL STRICT VERSION) ---
  function simulateInnings(batTeam, bowlTeam, target = null, pitch = PITCH_TYPES.COMMON) {
    // 1. LOCKED BATTING ORDER (User Selected)
    // We clone playing11 below to ensure we don't mutate the global team object
    // const battingOrder = batTeam.playing11; // Moved below to be explicitly a copy 
    let strikerIndex = 0;
    let nonStrikerIndex = 1;
    let nextBatsmanIndex = 2;

    // 2. Bowling Options (Filter valid bowlers)
    const bowlers = bowlTeam.playing11.filter((p) => {
        const r = (p.roleKey || "").toLowerCase();
        return (r.includes("bowl") || r.includes("fast") || r.includes("spin") || r.includes("ar") || r.includes("all")) && !r.includes("wk") && !r.includes("wicketkeeper");
    });
    // Fallback
    const validBowlers = bowlers.length >= 5 ? bowlers : bowlTeam.playing11.slice(5).length > 0 ? bowlTeam.playing11.slice(5) : bowlTeam.playing11.slice(0, 5); // Ensure at least someone bowls

    // Initialize Cards
    // CLONE playing11 to avoid permanent mutation, but respect order
    const battingOrder = [...batTeam.playing11];
    
    // Track Impact Usage Local to Innings
    let impactUsed = false;

    const batCard = battingOrder.map((p) => ({
      name: p.name,
      runs: 0, 
      balls: 0, 
      fours: 0, 
      sixes: 0, 
      status: "dnb"
    }));
    
    // Set Openers
    if(batCard[strikerIndex]) batCard[strikerIndex].status = "not out";
    if(batCard[nonStrikerIndex]) batCard[nonStrikerIndex].status = "not out";

    const bowlCardMap = {}; 
    let score = 0;
    let wickets = 0;
    let ballLog = [];
    let isFreeHit = false;

    // --- OVER LOOP ---
    for (let over = 0; over < 20; over++) {
       if (wickets >= 10 || (target && score > target)) break;

       // Select Bowler
       const bowlerObj = validBowlers[over % validBowlers.length];
       if (!bowlCardMap[bowlerObj.name]) {
           bowlCardMap[bowlerObj.name] = { name: bowlerObj.name, runs: 0, wkts: 0, balls: 0, economy: 0 };
       }
       const bowlerStats = bowlCardMap[bowlerObj.name];

       // Phase Logic
       let phase = "middle";
       if (over < 6) phase = "powerplay";
       if (over >= 15) phase = "death";

       let balls = 0;
       
       // --- BALL LOOP ---
       while (balls < 6) {
           if (wickets >= 10 || (target && score > target)) break;

           const striker = battingOrder[strikerIndex];
           if(!striker) break; // Should not happen if logic matches
           const strikerStats = batCard[strikerIndex];

           // AGGRESSION BIAS
           const wicketTakerBias = (bowlerObj.bowl > 85) ? 2 : (bowlerObj.bowl > 75 ? 1 : 0);
           
           const result = simulateBall(striker, bowlerObj, phase, pitch);
           
           // FREE HIT LOGIC FIX: Wicket does not count on Free Hit
           if (result.wicket && isFreeHit) {
               result.wicket = false;
               result.commentary = "Not Out (Free Hit)";
           }

           // Log Event
           ballLog.push({
             over: `${over}.${balls + 1}`,
             batsman: striker.name,
             bowler: bowlerObj.name,
             runs: result.runs,
             extra: result.extra,
             wicket: result.wicket
           });

           score += result.runs;
           bowlerStats.runs += result.runs;

           // Legality
           if (result.legal) {
               balls++;
               strikerStats.balls++;
               bowlerStats.balls++;
               if (isFreeHit) isFreeHit = false;
           } else {
               if (result.extra === "NO BALL") isFreeHit = true;
               // Wides/Noballs don't increment balls faced/bowled usually, but run counts.
           }

           // Batting Stats (Only runs off bat)
           if (result.legal || result.extra === "NO BALL") {
               if (!result.extra) {
                   strikerStats.runs += result.runs;
                   if (result.runs === 4) { strikerStats.fours++; getPlayerStat(striker.name).fours++; }
                   if (result.runs === 6) { strikerStats.sixes++; getPlayerStat(striker.name).sixes++; }
                   getPlayerStat(striker.name).runs += result.runs;
                   getPlayerStat(striker.name).pts += result.runs;
               }
           }
           
           // WICKET
           if (result.wicket) {
                wickets++;
                strikerStats.status = "out";
                bowlerStats.wkts++;
                getPlayerStat(bowlerObj.name).wkts++;
                getPlayerStat(bowlerObj.name).pts += 25;
                
                if (nextBatsmanIndex < battingOrder.length) {
                    strikerIndex = nextBatsmanIndex++;
                    if(batCard[strikerIndex]) batCard[strikerIndex].status = "not out";
                } else {
                    strikerIndex = -1; // All out mostly
                }
           } 
           // RUNS RUNNING (Strike Rotate)
           else {
               if (result.runs % 2 === 1) {
                   if (nonStrikerIndex !== -1 && strikerIndex !== -1) {
                       [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
                   }
               }
           }
       } // balls loop
       
       // End Over Swap
       if (nonStrikerIndex !== -1 && strikerIndex !== -1) {
           [strikerIndex, nonStrikerIndex] = [nonStrikerIndex, strikerIndex];
       }
       
       // --- IMPACT PLAYER LOGIC ---
       if (over >= 9 && !impactUsed && batTeam.impact && batCard[10].status === "dnb") {
            const impactPlayer = batTeam.impact;
            battingOrder[10] = impactPlayer; 
            batCard[10].name = impactPlayer.name;
            batCard[10].runs = 0; 
            batCard[10].balls = 0;
            batCard[10].status = "not out";
            impactUsed = true;
       }

    } // over loop

    // Calculate Actual Balls Bowled for Stats
    const totalLegalBalls = bowlCardMap && Object.values(bowlCardMap).reduce((acc, b) => acc + b.balls, 0);

    // Format Bowling Card
    const bowlCard = Object.values(bowlCardMap);
    bowlCard.forEach((b) => {
      b.oversDisplay = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
      b.economy = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(1) : "0.0";
    });

    return {
      score,
      wickets,
      balls: totalLegalBalls || 0, 
      bat: batCard,
      bowl: bowlCard,
      team: batTeam.name,
      ballLog
    };
  }

  function playMatch(t1, t2, type) {
    // Determine Pitch Condition: 33% Each (Bat/Bowl/Common)
    const r = Math.random();
    let pitch = PITCH_TYPES.COMMON;
    if (r < 0.33) pitch = PITCH_TYPES.BATTING;
    else if (r < 0.66) pitch = PITCH_TYPES.BOWLING;
    
    const i1 = simulateInnings(t1, t2, null, pitch);
    const i2 = simulateInnings(t2, t1, i1.score + 1, pitch);

    let winnerName = i2.score > i1.score ? t2.name : t1.name;
    if (i1.score === i2.score) winnerName = t1.name; // Simple tie-break

    const margin =
      i2.score > i1.score
        ? `${10 - i2.wickets} wkts`
        : `${i1.score - i2.score} runs`;

    // Stats Update for Table
    if (type === "League") {
      const winner = [t1, t2].find((t) => t.name === winnerName);
      const loser = [t1, t2].find((t) => t.name !== winnerName);

      winner.stats.played++;
      winner.stats.won++;
      winner.stats.pts += 2;

      loser.stats.played++;
      loser.stats.lost++;

      // NRR Calc helpers
      winner.stats.runsScored += winner === t1 ? i1.score : i2.score;
      winner.stats.runsConceded += winner === t1 ? i2.score : i1.score;
      winner.stats.oversFaced += winner === t1 ? 20 : i2.balls / 6;
      winner.stats.oversBowled += winner === t1 ? i2.balls / 6 : 20;

      loser.stats.runsScored += loser === t1 ? i1.score : i2.score;
      loser.stats.runsConceded += loser === t1 ? i2.score : i1.score;
      loser.stats.oversFaced += loser === t1 ? 20 : i2.balls / 6;
      loser.stats.oversBowled += loser === t1 ? i2.balls / 6 : 20;
    }

    // Helper for Top Performer
    const bestBat = [...i1.bat, ...i2.bat].sort((a, b) => b.runs - a.runs)[0];
    const bestBowl = [...i1.bowl, ...i2.bowl].sort(
      (a, b) => b.wkts - a.wkts
    )[0];

    return {
      t1: t1.name,
      t2: t2.name,
      score1: `${i1.score}/${i1.wickets}`,
      score2: `${i2.score}/${i2.wickets}`,
      winnerName,
      margin,
      type,
      topScorer: bestBat,
      bestBowler: {
        name: bestBowl?.name || "-",
        figures: `${bestBowl?.wkts || 0} wkts`,
      },
      details: { i1, i2 },
    };
  }

  // --- LEAGUE GENERATION (Double Round Robin) ---
  // 2 Matches against every team (Home and Away)
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
        // Match 1: i vs j
        leagueMatches.push(playMatch(teams[i], teams[j], "League"));
        // Match 2: j vs i
        leagueMatches.push(playMatch(teams[j], teams[i], "League"));
    }
  }

  // Calculate NRR and Sort
  teams.forEach((t) => {
    t.stats.nrr =
      t.stats.runsScored / t.stats.oversFaced -
        t.stats.runsConceded / t.stats.oversBowled || 0;
  });
  teams.sort((a, b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

  // --- PLAYOFFS ---
  // Top 4 play playoffs, else Top 2 play final
  let champion = teams[0].name;
  let runner = teams[1] ? teams[1].name : "";

  if (teams.length >= 4) {
    const q1 = playMatch(teams[0], teams[1], "Qualifier 1");
    const elim = playMatch(teams[2], teams[3], "Eliminator");

    const loserQ1 = q1.winnerName === teams[0].name ? teams[1] : teams[0];
    const winnerElim = elim.winnerName === teams[2].name ? teams[2] : teams[3];

    const q2 = playMatch(loserQ1, winnerElim, "Qualifier 2");

    const finalist1 = teams.find((t) => t.name === q1.winnerName);
    const finalist2 = teams.find((t) => t.name === q2.winnerName);

    const final = playMatch(finalist1, finalist2, "FINAL");
    playoffs.push(q1, elim, q2, final);
    champion = final.winnerName;
    runner =
      final.winnerName === finalist1.name ? finalist2.name : finalist1.name;
  } else if (teams.length >= 2) {
    const final = playMatch(teams[0], teams[1], "FINAL");
    playoffs.push(final);
    champion = final.winnerName;
  }

  const statsArr = Object.values(allStats);

  return {
    winner: champion,
    runnerUp: runner,
    standings: teams,
    leagueMatches,
    playoffs,
    allTeamsData: teams,
    orangeCap: statsArr.sort((a, b) => b.runs - a.runs)[0],
    purpleCap: statsArr.sort((a, b) => b.wkts - a.wkts)[0],
    mvp: statsArr.sort((a, b) => b.pts - a.pts)[0],
  };
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
