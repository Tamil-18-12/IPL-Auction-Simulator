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
const PORT = process.env.PORT || 3002;

// --- SERVE FILES ---
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

  if (r.timerInterval && r.timer > AUCTION_TIMER_SECONDS - 2) return;

  if (r.timerInterval) clearInterval(r.timerInterval);

  r.timer = AUCTION_TIMER_SECONDS;
  r.timerPaused = false;
  
  r.timerEndTime = Date.now() + (r.timer * 1000);

  io.to(roomId).emit("timer_tick", r.timer);
  io.to(roomId).emit("timer_status", false);

  r.timerInterval = setInterval(() => {
    if (r.timerPaused) {
       r.timerEndTime += 1000;
       return;
    }
    
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
  }, 4000);
}

function startNextLot(roomId) {
  const r = rooms[roomId];
  if (!r) return;

  if (r.auctionIndex >= r.auctionQueue.length) {
    io.to(roomId).emit("open_squad_selection");
    return;
  }

  r.currentPlayer = r.auctionQueue[r.auctionIndex];

  if (r.currentPlayer.status) {
    r.auctionIndex++;
    startNextLot(roomId);
    return;
  }

  r.currentBid = r.currentPlayer.basePrice;
  r.currentBidder = null;
  r.sellingInProgress = false;

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
  socket.on("create_room", ({ roomId, password, config, playerName }) => {
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
      playerNames: {}, // Store player names
    };
    socket.join(roomId);
    rooms[roomId].users.push(socket.id);
    
    // Store player name
    if (playerName) {
      rooms[roomId].playerNames[socket.playerId] = playerName;
    }
    
    socket.emit("roomcreated", roomId);
  });

  // 2. JOIN ROOM
  socket.on("join_room", ({ roomId, password, playerName }) => {
    const r = rooms[roomId];
    if (!r || r.password !== password)
      return socket.emit("error_message", "Invalid Credentials");

    socket.join(roomId);
    if (!r.users.includes(socket.id)) r.users.push(socket.id);

    // Store player name
    if (playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = playerName;
    }

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
      
      // Attach player name to team
      if (r.playerNames && r.playerNames[socket.playerId]) {
        t.playerName = r.playerNames[socket.playerId];
      }
      
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

  socket.on("admin_auto_test", ({ rcb, csk }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    
    if(!r || !isAdmin(socket)) return;

    const takenTeams = r.teams.filter(t => t.isTaken);
    
    if(takenTeams.length === 0) {
        return socket.emit("error_message", "No active teams joined yet!");
    }

    // 1. Assign Rosters
    if(takenTeams[0]) {
        takenTeams[0].roster = rcb;
        takenTeams[0].totalPlayers = rcb.length;
        takenTeams[0].budget = 10000000;
        console.log(`Auto-assigned RCB roster to ${takenTeams[0].name}`);
    }
    
    if(takenTeams[1]) {
        takenTeams[1].roster = csk;
        takenTeams[1].totalPlayers = csk.length;
        takenTeams[1].budget = 10000000;
        console.log(`Auto-assigned CSK roster to ${takenTeams[1].name}`);
    }

    // 2. Ensure they are marked as valid for simulation
    // (start_auction filters by isTaken, so we are good)
    
    // 3. Sync Updated Rosters to Client
    io.to(roomId).emit("lobby_update", {
        teams: r.teams,
        userCount: r.users.length
    });

    // 4. Skip to Squad Selection
    r.state.isActive = false;
    io.to(roomId).emit("open_squad_selection", { teams: r.teams }); // Send teams directly as fallback
  });

  socket.on("start_auction", ({ queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
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

  socket.on("submit_squad", ({ teamKey, squad, batImpact, bowlImpact, captain }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r) {
      r.squads[teamKey] = { squad, batImpact, bowlImpact, captain };
      io.to(roomId).emit("squad_submission_update", {
        submittedCount: Object.keys(r.squads).length,
        totalTeams: r.teams.filter((t) => t.isTaken).length,
      });

      const activeTeamsCount = r.teams.filter((t) => t.isTaken).length;
      if (Object.keys(r.squads).length === activeTeamsCount) {
         console.log("All squads submitted. Auto-starting simulation...");
         runSimulationLogic(roomId, r);
      }
    }
  });

  socket.on("startTournament", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      runSimulationLogic(roomId, r);
    }
  });

  socket.on("request_tournament_data", ({ roomId }) => {
    const rId = roomId || getRoomId(socket);
    const r = rooms[rId];
    if (r && r.lastTournamentResults) {
      socket.emit("tournament_data_response", { tournamentResults: r.lastTournamentResults });
    }
  });

  // Chat Message Handler
  socket.on("chat_message", (data) => {
    const roomId = getRoomId(socket);
    if (roomId) {
      // Broadcast message to all players in the room
      io.to(roomId).emit("chat_message", {
        playerName: data.playerName,
        message: data.message,
        timestamp: data.timestamp || Date.now()
      });
    }
  });

  // Update Player Name Handler
  socket.on("update_player_name", (data) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && data.playerName) {
      if (!r.playerNames) r.playerNames = {};
      r.playerNames[socket.playerId] = data.playerName;
      
      // Update team if player has already claimed one
      const team = r.teams.find(t => t.ownerPlayerId === socket.playerId);
      if (team) {
        team.playerName = data.playerName;
        io.to(roomId).emit("lobby_update", {
          teams: r.teams,
          userCount: r.users.length
        });
      }
    }
  });

  // Voice Chat Signaling
  socket.on("voice_ready", ({ roomId }) => {
    // Notify all other users in the room
    socket.to(roomId).emit("voice_user_ready", { userId: socket.id });
  });

  socket.on("voice_offer", ({ to, offer }) => {
    io.to(to).emit("voice_offer", { from: socket.id, offer });
  });

  socket.on("voice_answer", ({ to, answer }) => {
    io.to(to).emit("voice_answer", { from: socket.id, answer });
  });

  socket.on("voice_ice_candidate", ({ to, candidate }) => {
    io.to(to).emit("voice_ice_candidate", { from: socket.id, candidate });
  });

  socket.on("voice_stopped", ({ roomId }) => {
    socket.to(roomId).emit("voice_user_stopped", { userId: socket.id });
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

// =================================================================
// 🚀 NEW SIMULATION ENGINE (IMPORTED FROM ai.js)
// =================================================================
const ai = require('./ai');

function runSimulationLogic(roomId, r) {
    if (!r) return;
    
    // Prepare teams for the AI
    const tourneyTeams = r.teams.filter(t => t.isTaken).map(t => {
        const squad = r.squads[t.bidKey];
        if (!squad) return null;
        return {
            ...t,
            squad: squad.squad,
            batImpact: squad.batImpact,
            bowlImpact: squad.bowlImpact,
            captain: squad.captain
        };
    }).filter(t => t);

    // Call the AI Engine
    try {
        console.log(`Running AI Simulation for Room ${roomId} with ${tourneyTeams.length} teams.`);
        const aiResults = ai.runFullTournament(tourneyTeams);

        // Merge with Room Data for Frontend
        const results = {
            ...aiResults,
            squads: r.squads, 
            teams: r.teams
        };

        // Save for persistence
        r.lastTournamentResults = results;

        io.to(roomId).emit("tournamentComplete", results);

    } catch (e) {
        console.error("AI Simulation Failed:", e);
        io.to(roomId).emit("simulation_error", e.message);
    }
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
