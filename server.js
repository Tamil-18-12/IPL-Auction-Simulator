/**
 * IPL AUCTION SERVER - ROBUST AI SIMULATION UPDATE
 * Fixed: Simulation crashes, Bowler selection logic, NRR calculation, Result sending
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
});

const AUCTION_TIMER_SECONDS = 10;
const PORT = process.env.PORT || 3001;

// --- SERVE FILES ---
app.use(express.static(__dirname));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "ipl.html")));

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
  if (r.timerInterval) clearInterval(r.timerInterval);

  r.timer = AUCTION_TIMER_SECONDS;
  r.timerPaused = false;

  io.to(roomId).emit("timer_tick", r.timer);
  io.to(roomId).emit("timer_status", false);

  r.timerInterval = setInterval(() => {
    if (r.timerPaused) return;
    r.timer--;
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

  // Skip if already processed (Resuming)
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
      socket.emit("sync_data", {
        teams: r.teams,
        queue: r.auctionQueue,
        auctionIndex: r.auctionIndex,
        currentLot: r.currentPlayer,
        currentBid: r.currentBid,
        currentBidder: r.currentBidder,
        timer: r.timer,
        timerPaused: r.timerPaused,
      });
    }
  });

  socket.on("update_lobby_teams", (teams) => {
    const roomId = getRoomId(socket);
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

  socket.on("start_auction", ({ teams, queue }) => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      r.teams = teams.map((t) => ({
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

  socket.on("finalize_sale", ({ isUnsold, soldTo, price }) => {
    const roomId = getRoomId(socket);
    if (isAdmin(socket)) {
      if (isUnsold) rooms[roomId].currentBidder = null;
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
    }
  });

  socket.on("run_simulation", () => {
    const roomId = getRoomId(socket);
    const r = rooms[roomId];
    if (r && isAdmin(socket)) {
      console.log("Starting Simulation for Room:", roomId);
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

      // If still less than 11 (e.g. they only bought 5 players), use what they have
      // In a real scenario, this is an invalid team, but for sim we proceed to avoid crash

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
    console.log("Teams prepared, running advanced sim...");
    const results = runAdvancedSimulation(tourneyTeams);
    console.log("Simulation complete, sending results.");
    io.to(roomId).emit("tournament_results", results);
  } catch (e) {
    console.error("Simulation Error:", e);
    io.to(roomId).emit("simulation_error", "Server Logic Error: " + e.message);
  }
}

function runAdvancedSimulation(teams) {
  const stats = {};
  const leagueMatches = [];
  const playoffs = [];

  // Initialize stats for ALL players in rosters to prevent undefined access
  teams.forEach((t) => {
    t.stats = {
      p: 0,
      w: 0,
      l: 0,
      pts: 0,
      nrr: 0,
      runsScored: 0,
      runsConceded: 0,
      oversFaced: 0,
      oversBowled: 0,
    };
    // Initialize stats for anyone who might play
    t.playing11.forEach((p) => {
      stats[p.name] = {
        name: p.name,
        role: p.roleKey || "batter",
        runs: 0,
        wkts: 0,
        pts: 0,
        fours: 0,
        sixes: 0,
      };
    });
  });

  function getStat(name) {
    if (!stats[name]) {
      stats[name] = {
        name: name,
        runs: 0,
        wkts: 0,
        pts: 0,
        fours: 0,
        sixes: 0,
      };
    }
    return stats[name];
  }

  function simulateInnings(batTeam, bowlTeam, target) {
    let score = 0,
      wickets = 0,
      balls = 0;

    // Create Batting Card
    const battingCard = batTeam.playing11.map((p) => ({
      name: p.name,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      status: "dnb",
      skill: (p.stats?.bat || 50) + (Math.random() * 10 - 5),
    }));

    // Create Bowling Card - Select bowlers from playing 11
    // Prioritize players with 'bowl', 'fast', 'spin', 'all' in role
    let availableBowlers = bowlTeam.playing11.filter((p) => {
      const r = (p.roleKey || "").toLowerCase();
      return (
        r.includes("bowl") ||
        r.includes("fast") ||
        r.includes("spin") ||
        r.includes("all") ||
        r.includes("ar")
      );
    });

    // If not enough bowlers, take anyone from the bottom up
    if (availableBowlers.length < 5) {
      const others = bowlTeam.playing11.filter(
        (p) => !availableBowlers.includes(p)
      );
      availableBowlers = [...availableBowlers, ...others.reverse()].slice(0, 6); // Cap at 6 options
    }

    let bowlingCard = availableBowlers.map((p) => ({
      name: p.name,
      runs: 0,
      wkts: 0,
      balls: 0,
      skill: (p.stats?.bowl || 50) + (Math.random() * 10 - 5),
      luck: p.stats?.luck || 50,
    }));

    // Sort bowlers by skill so the best options (Bowlers or ARs) bowl the most
    bowlingCard.sort((a, b) => b.skill - a.skill);

    // Ensure we have at least 1 bowler to prevent crash
    if (bowlingCard.length === 0) {
      // Should not happen due to fallback above, but safety check
      if (bowlTeam.playing11.length > 0) {
        bowlingCard.push({
          name: bowlTeam.playing11[0].name,
          runs: 0,
          wkts: 0,
          balls: 0,
          skill: 40,
        });
      } else {
        // Absolute worst case: dummy bowler
        bowlingCard.push({
          name: "Auto Bowler",
          runs: 0,
          wkts: 0,
          balls: 0,
          skill: 40,
        });
      }
    }

    let strikerIdx = 0;
    let nonStrikerIdx = 1;
    if (battingCard[strikerIdx]) battingCard[strikerIdx].status = "not out";
    if (battingCard[nonStrikerIdx])
      battingCard[nonStrikerIdx].status = "not out";

    // Limit wickets to actual players count - 1 (all out)
    const maxWickets = Math.max(0, battingCard.length - 1);

    while (balls < 120 && wickets < maxWickets) {
      if (target && score > target) break;

      // Rotate through top 5 bowlers (standard T20 attack)
      const overNum = Math.floor(balls / 6);
      const bowler = bowlingCard[overNum % Math.min(5, bowlingCard.length)];
      const striker = battingCard[strikerIdx];

      if (!striker || !bowler) break;

      let outcome = 0;
      const diff = striker.skill - bowler.skill;
      const luckRoll = Math.random();

      // Dynamic wicket threshold: High luck bowlers (like top ARs) strike more often
      const wicketThreshold = 0.975 - (bowler.luck / 4000); // Range approx 0.95 to 0.97

      if (luckRoll > wicketThreshold && diff < 40) outcome = -1; // Wicket (Widened diff for AR impact)
      else if (luckRoll > 0.88) outcome = 6;
      else if (luckRoll > 0.75) outcome = 4;
      else if (luckRoll > 0.45) outcome = 1;
      else outcome = 0;

      balls++;
      bowler.balls++;

      if (outcome === -1) {
        wickets++;
        bowler.wkts++;
        getStat(bowler.name).wkts++;
        getStat(bowler.name).pts += 25;
        striker.status = "out";
        striker.balls++;

        // New batsman
        // find next dnb
        const nextBatIdx = battingCard.findIndex((b) => b.status === "dnb");
        if (nextBatIdx > -1) {
          strikerIdx = nextBatIdx;
          battingCard[strikerIdx].status = "not out";
        }
      } else {
        score += outcome;
        striker.runs += outcome;
        striker.balls++;
        bowler.runs += outcome;

        getStat(striker.name).runs += outcome;
        getStat(striker.name).pts += outcome;
        if (outcome === 4) {
          striker.fours++;
          getStat(striker.name).fours++;
          getStat(striker.name).pts += 1;
        }
        if (outcome === 6) {
          striker.sixes++;
          getStat(striker.name).sixes++;
          getStat(striker.name).pts += 2;
        }

        if (outcome % 2 !== 0) {
          // Swap strike
          [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
          // Ensure new striker is valid (if non-striker wasn't set somehow)
          if (!battingCard[strikerIdx] && battingCard[nonStrikerIdx]) {
            strikerIdx = nonStrikerIdx;
          }
        }
      }

      if (balls % 6 === 0) {
        [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
      }
    }

    // Formatting for display
    bowlingCard.forEach((b) => {
      b.oversDisplay = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
      b.economy = b.balls > 0 ? (b.runs / (b.balls / 6)).toFixed(1) : "0.0";
    });

    return {
      score,
      wickets,
      balls,
      battingCard,
      bowlingCard,
      teamName: batTeam.name,
    };
  }

  function playMatch(t1, t2, type) {
    const i1 = simulateInnings(t1, t2, null);
    const i2 = simulateInnings(t2, t1, i1.score);

    // Determine winner
    let winner, margin;
    if (i2.score > i1.score) {
      winner = t2;
      margin = `${Math.max(0, 10 - i2.wickets)} wkts`; // Simplified margin
    } else {
      winner = t1;
      margin = `${i1.score - i2.score} runs`;
      if (i1.score === i2.score) {
        margin = "Super Over (Simulated Tie)";
        // Coin toss tie breaker for sim simplicity
        winner = Math.random() > 0.5 ? t1 : t2;
      }
    }

    if (type === "League") {
      winner.stats.p++;
      winner.stats.w++;
      winner.stats.pts += 2;
      const loser = winner === t1 ? t2 : t1;
      loser.stats.p++;
      loser.stats.l++;

      // NRR Data
      winner.stats.runsScored += winner === t1 ? i1.score : i2.score;
      winner.stats.oversFaced += winner === t1 ? 20 : i2.balls / 6;
      winner.stats.runsConceded += winner === t1 ? i2.score : i1.score;
      winner.stats.oversBowled += winner === t1 ? i2.balls / 6 : 20;

      loser.stats.runsScored += loser === t1 ? i1.score : i2.score;
      loser.stats.oversFaced += loser === t1 ? 20 : i2.balls / 6;
      loser.stats.runsConceded += loser === t1 ? i2.score : i1.score;
      loser.stats.oversBowled += loser === t1 ? i2.balls / 6 : 20;
    }

    const getBestBat = (card) =>
      card.sort((a, b) => b.runs - a.runs)[0] || { name: "-", runs: 0 };
    const getBestBowl = (card) =>
      card.sort((a, b) => b.wkts - a.wkts)[0] || { name: "-", wkts: 0 };

    return {
      t1: t1.name,
      t2: t2.name,
      score1: `${i1.score}/${i1.wickets}`,
      score2: `${i2.score}/${i2.wickets}`,
      winnerName: winner.name,
      margin,
      type,
      topScorer: getBestBat([...i1.battingCard, ...i2.battingCard]),
      bestBowler: {
        name: getBestBowl([...i1.bowlingCard, ...i2.bowlingCard]).name,
        figures: `${
          getBestBowl([...i1.bowlingCard, ...i2.bowlingCard]).wkts
        } wkts`,
      },
      details: {
        i1: {
          team: t1.name,
          score: i1.score,
          wkts: i1.wickets,
          bat: i1.battingCard,
          bowl: i1.bowlingCard,
        },
        i2: {
          team: t2.name,
          score: i2.score,
          wkts: i2.wickets,
          bat: i2.battingCard,
          bowl: i2.bowlingCard,
        },
      },
    };
  }

  // --- LEAGUE STAGE ---
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      leagueMatches.push(playMatch(teams[i], teams[j], "League"));
    }
  }

  // --- NRR CALCULATION (Safety Check) ---
  teams.forEach((t) => {
    if (t.stats.oversFaced > 0 && t.stats.oversBowled > 0) {
      t.stats.nrr =
        t.stats.runsScored / t.stats.oversFaced -
        t.stats.runsConceded / t.stats.oversBowled;
    } else {
      t.stats.nrr = 0;
    }
  });

  // Sort by Points, then NRR
  teams.sort((a, b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

  // --- PLAYOFFS ---
  let champion = teams[0].name;
  let runner = teams.length > 1 ? teams[1].name : "None";

  // Only run playoffs if at least 2 teams
  if (teams.length >= 2) {
    if (teams.length >= 4) {
      const q1 = playMatch(teams[0], teams[1], "Qualifier 1");
      const elim = playMatch(teams[2], teams[3], "Eliminator");

      const tQ2_1 = q1.winnerName === teams[0].name ? teams[1] : teams[0];
      const tQ2_2 = elim.winnerName === teams[2].name ? teams[2] : teams[3];

      const q2 = playMatch(tQ2_1, tQ2_2, "Qualifier 2");

      const tFin_1 = teams.find((t) => t.name === q1.winnerName);
      const tFin_2 = teams.find((t) => t.name === q2.winnerName);

      const final = playMatch(tFin_1, tFin_2, "FINAL");

      playoffs.push(q1, elim, q2, final);
      champion = final.winnerName;
      runner = final.winnerName === tFin_1.name ? tFin_2.name : tFin_1.name;
    } else {
      // Fallback for 2 or 3 teams: Just a Final between top 2
      const final = playMatch(teams[0], teams[1], "FINAL");
      playoffs.push(final);
      champion = final.winnerName;
      runner = champion === teams[0].name ? teams[1].name : teams[0].name;
    }
  }

  const allStatsValues = Object.values(stats);

  return {
    winner: champion,
    runnerUp: runner,
    standings: teams,
    leagueMatches,
    playoffs,
    allTeamsData: teams,
    orangeCap: allStatsValues.sort((a, b) => b.runs - a.runs)[0] || {
      name: "-",
      runs: 0,
    },
    purpleCap: allStatsValues.sort((a, b) => b.wkts - a.wkts)[0] || {
      name: "-",
      wkts: 0,
    },
    mvp: allStatsValues.sort((a, b) => b.pts - a.pts)[0] || {
      name: "-",
      pts: 0,
    },
  };
}

server.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`)
);
