// const express = require("express");
// const http = require("http");
// const { Server } = require("socket.io");
// const path = require("path");
// const cors = require("cors"); // Added based on your provided snippet

// const app = express();
// app.use(cors()); // Added based on your provided snippet

// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: { origin: "*" },
//   pingTimeout: 60000,
// });

// const AUCTION_TIMER_SECONDS = 10;
// const PORT = process.env.PORT || 3001;

// // --- SERVE FILES ---
// app.use(express.static(__dirname));
// app.get("/", (req, res) => res.sendFile(path.join(__dirname, "ipl.html")));

// // --- UTILS ---
// function getRoomId(socket) {
//   return [...socket.rooms].find((r) => r !== socket.id);
// }

// function isAdmin(socket) {
//   const roomId = getRoomId(socket);
//   const r = rooms[roomId];
//   return r && r.adminSocketId === socket.id;
// }

// // --- GLOBAL STATE ---
// const rooms = {};

// // --- TIMER LOGIC ---
// function startTimer(roomId) {
//   const r = rooms[roomId];
//   if (!r) return;
//   if (r.timerInterval) clearInterval(r.timerInterval);

//   r.timer = AUCTION_TIMER_SECONDS;
//   r.timerPaused = false;

//   io.to(roomId).emit("timer_tick", r.timer);
//   io.to(roomId).emit("timer_status", false);

//   r.timerInterval = setInterval(() => {
//     if (r.timerPaused) return;
//     r.timer--;
//     io.to(roomId).emit("timer_tick", r.timer);
//     if (r.timer <= 0) {
//       processSale(roomId);
//     }
//   }, 1000);
// }

// function stopTimer(roomId) {
//   const r = rooms[roomId];
//   if (r && r.timerInterval) {
//     clearInterval(r.timerInterval);
//     r.timerInterval = null;
//   }
// }

// function processSale(roomId, source = "UNKNOWN") {
//   const r = rooms[roomId];
//   if (!r || !r.currentPlayer || r.sellingInProgress) return;

//   r.sellingInProgress = true;
//   stopTimer(roomId);
//   io.to(roomId).emit("timer_ended");

//   let soldPrice = 0;
//   let soldTeamName = null;
//   let isUnsold = true;

//   if (r.currentBidder) {
//     const team = r.teams.find((t) => t.bidKey === r.currentBidder);
//     if (team) {
//       soldPrice = r.currentBid;
//       team.roster.push({
//         ...r.currentPlayer,
//         price: soldPrice,
//         status: "SOLD",
//       });
//       team.totalSpent += soldPrice;
//       team.totalPlayers += 1;
//       team.budget -= soldPrice;
//       soldTeamName = team.name;
//       isUnsold = false;
//     }
//   }

//   r.currentPlayer.status = isUnsold ? "UNSOLD" : "SOLD";
//   r.currentPlayer.soldPrice = soldPrice;

//   // Send finalized data (used by Frontend TTS)
//   io.to(roomId).emit("sale_finalized", {
//     soldPlayer: r.currentPlayer,
//     isUnsold: isUnsold,
//     soldDetails: { soldTeam: soldTeamName },
//     price: soldPrice,
//     updatedTeams: r.teams,
//   });

//   r.auctionIndex++;

//   setTimeout(() => {
//     if (rooms[roomId]) rooms[roomId].sellingInProgress = false;
//     startNextLot(roomId);
//   }, 4000); // 4s delay to read the result
// }

// function startNextLot(roomId) {
//   const r = rooms[roomId];
//   if (!r) return;

//   if (r.auctionIndex >= r.auctionQueue.length) {
//     io.to(roomId).emit("open_squad_selection");
//     return;
//   }

//   r.currentPlayer = r.auctionQueue[r.auctionIndex];

//   // Skip if already processed (Resuming)
//   if (r.currentPlayer.status) {
//     r.auctionIndex++;
//     startNextLot(roomId);
//     return;
//   }

//   r.currentBid = r.currentPlayer.basePrice;
//   r.currentBidder = null;
//   r.sellingInProgress = false;

//   // Trigger update (Frontend plays "Lot Number..." TTS)
//   io.to(roomId).emit("update_lot", {
//     player: r.currentPlayer,
//     currentBid: r.currentBid,
//     lotNumber: r.auctionIndex + 1,
//   });

//   startTimer(roomId);
// }

// // --- AUTH MIDDLEWARE ---
// io.use((socket, next) => {
//   const playerId = socket.handshake.auth.playerId;
//   socket.playerId = playerId || "guest_" + socket.id;
//   next();
// });

// // --- SOCKET HANDLERS ---
// io.on("connection", (socket) => {
//   console.log(`User Connected: ${socket.id} (PID: ${socket.playerId})`);

//   socket.on("pingServer", () => socket.emit("pongServer"));

//   // 1. CREATE ROOM
//   socket.on("create_room", ({ roomId, password, config }) => {
//     if (rooms[roomId]) return socket.emit("error_message", "Room Exists!");

//     rooms[roomId] = {
//       password,
//       config,
//       users: [],
//       teams: [],
//       auctionQueue: [],
//       auctionIndex: 0,
//       currentBid: 0,
//       currentBidder: null,
//       currentPlayer: null,
//       timer: AUCTION_TIMER_SECONDS,
//       timerInterval: null,
//       timerPaused: true,
//       state: { isActive: false },
//       adminSocketId: socket.id,
//       adminPlayerId: socket.playerId,
//       sellingInProgress: false,
//       squads: {},
//     };
//     socket.join(roomId);
//     rooms[roomId].users.push(socket.id);
//     socket.emit("roomcreated", roomId);
//   });

//   // 2. JOIN ROOM
//   socket.on("join_room", ({ roomId, password }) => {
//     const r = rooms[roomId];
//     if (!r || r.password !== password)
//       return socket.emit("error_message", "Invalid Credentials");

//     socket.join(roomId);
//     if (!r.users.includes(socket.id)) r.users.push(socket.id);

//     let isAdminReconnected = false;

//     if (r.adminPlayerId === socket.playerId) {
//       r.adminSocketId = socket.id;
//       isAdminReconnected = true;
//     }

//     const myTeam = r.teams.find((t) => t.ownerPlayerId === socket.playerId);
//     if (myTeam) {
//       myTeam.ownerSocketId = socket.id;
//       socket.emit("team_claim_success", myTeam.bidKey);
//     }

//     socket.emit("room_joined", {
//       roomId,
//       isAdmin: isAdminReconnected,
//       lobbyState: { teams: r.teams, userCount: r.users.length },
//       state: {
//         isActive: r.state.isActive,
//         teams: r.teams,
//         queue: r.auctionQueue,
//       },
//     });

//     io.to(roomId).emit("lobby_update", {
//       teams: r.teams,
//       userCount: r.users.length,
//     });
//   });

//   socket.on("request_sync", () => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r) {
//       socket.emit("sync_data", {
//         teams: r.teams,
//         queue: r.auctionQueue,
//         auctionIndex: r.auctionIndex,
//         currentLot: r.currentPlayer,
//         currentBid: r.currentBid,
//         currentBidder: r.currentBidder,
//         timer: r.timer,
//         timerPaused: r.timerPaused,
//       });
//     }
//   });

//   socket.on("update_lobby_teams", (teams) => {
//     const roomId = getRoomId(socket);
//     if (rooms[roomId]) {
//       rooms[roomId].teams = teams;
//       io.to(roomId).emit("lobby_update", {
//         teams,
//         userCount: rooms[roomId].users.length,
//       });
//     }
//   });

//   socket.on("claim_lobby_team", (key) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (!r) return;

//     if (
//       r.teams.find(
//         (t) => t.ownerPlayerId === socket.playerId && t.bidKey !== key
//       )
//     ) {
//       return socket.emit("error_message", "You already own a team!");
//     }

//     const t = r.teams.find((x) => x.bidKey === key);
//     if (t && (!t.isTaken || t.ownerPlayerId === socket.playerId)) {
//       t.isTaken = true;
//       t.ownerSocketId = socket.id;
//       t.ownerPlayerId = socket.playerId;
//       socket.emit("team_claim_success", key);
//       io.to(roomId).emit("lobby_update", {
//         teams: r.teams,
//         userCount: r.users.length,
//       });
//     }
//   });

//   socket.on("reclaim_team", (key) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (!r) return;
//     const t = r.teams.find((x) => x.bidKey === key);

//     if (t && t.ownerPlayerId === socket.playerId) {
//       t.ownerSocketId = socket.id;
//       socket.emit("team_claim_success", key);
//     }
//   });

//   socket.on("request_reclaim_manual", ({ teamKey }) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (!r) return;

//     const targetTeam = r.teams.find((t) => t.bidKey === teamKey);
//     if (!targetTeam) return;

//     if (r.adminSocketId) {
//       io.to(r.adminSocketId).emit("admin_reclaim_request", {
//         teamKey: teamKey,
//         teamName: targetTeam.name,
//         requesterId: socket.id,
//         requesterPid: socket.playerId,
//       });
//     }
//   });

//   socket.on(
//     "admin_reclaim_decision",
//     ({ approved, teamKey, requesterId, requesterPid }) => {
//       const roomId = getRoomId(socket);
//       const r = rooms[roomId];
//       if (!r || !isAdmin(socket)) return;

//       if (approved) {
//         const team = r.teams.find((t) => t.bidKey === teamKey);
//         if (team) {
//           team.ownerSocketId = requesterId;
//           team.ownerPlayerId = requesterPid;
//           io.to(requesterId).emit("team_claim_success", teamKey);
//           io.to(roomId).emit("lobby_update", {
//             teams: r.teams,
//             userCount: r.users.length,
//           });
//         }
//       } else {
//         io.to(requesterId).emit(
//           "error_message",
//           "Host denied your reclaim request."
//         );
//       }
//     }
//   );

//   socket.on("admin_rename_team", ({ key, newName }) => {
//     const roomId = getRoomId(socket);
//     if (!isAdmin(socket)) return;
//     const t = rooms[roomId].teams.find((x) => x.bidKey === key);
//     if (t) t.name = newName;
//     io.to(roomId).emit("lobby_update", {
//       teams: rooms[roomId].teams,
//       userCount: rooms[roomId].users.length,
//     });
//   });

//   // START AUCTION - Accepts filtered teams list
//   socket.on("start_auction", ({ teams, queue }) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r && isAdmin(socket)) {
//       // Replace existing teams with the filtered "Active" list sent by Host
//       r.teams = teams.map((t) => ({
//         ...t,
//         roster: [],
//         totalSpent: 0,
//         totalPlayers: 0,
//       }));
//       r.auctionQueue = queue;
//       r.state.isActive = true;
//       io.to(roomId).emit("auction_started", {
//         teams: r.teams,
//         queue: r.auctionQueue,
//       });
//       startNextLot(roomId);
//     }
//   });

//   socket.on("place_bid", ({ teamKey, amount }) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (
//       !r ||
//       !r.state.isActive ||
//       r.timerPaused ||
//       r.sellingInProgress ||
//       !r.currentPlayer
//     )
//       return;

//     const team = r.teams.find((t) => t.bidKey === teamKey);
//     if (!team) return;

//     if (team.ownerSocketId !== socket.id) {
//       if (team.ownerPlayerId === socket.playerId) {
//         team.ownerSocketId = socket.id;
//       } else {
//         return socket.emit("error_message", "Authorization Failed");
//       }
//     }

//     if (r.currentBidder === teamKey) return;
//     if (team.budget < amount) return socket.emit("error_message", "No Budget!");
//     if (amount <= r.currentBid && r.currentBidder)
//       return socket.emit("error_message", "Bid too low!");

//     r.currentBid = amount;
//     r.currentBidder = teamKey;

//     io.to(roomId).emit("bid_update", { amount, team });
//     startTimer(roomId);
//   });

//   socket.on("toggle_timer", () => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r && isAdmin(socket)) {
//       r.timerPaused = !r.timerPaused;
//       io.to(roomId).emit("timer_status", r.timerPaused);
//     }
//   });

//   socket.on("finalize_sale", ({ isUnsold, soldTo, price }) => {
//     const roomId = getRoomId(socket);
//     if (isAdmin(socket)) {
//       if (isUnsold) rooms[roomId].currentBidder = null;
//       processSale(roomId, "ADMIN");
//     }
//   });

//   socket.on("end_auction_trigger", () => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (isAdmin(socket) && r) {
//       stopTimer(roomId);
//       r.state.isActive = false;
//       io.to(roomId).emit("open_squad_selection");
//     }
//   });

//   socket.on("submit_squad", ({ teamKey, playing11, impact, captain }) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r) {
//       r.squads[teamKey] = { playing11, impact, captain };
//       io.to(roomId).emit("squad_submission_update", {
//         submittedCount: Object.keys(r.squads).length,
//         totalTeams: r.teams.filter((t) => t.isTaken).length,
//       });
//     }
//   });

//   socket.on("run_simulation", () => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r && isAdmin(socket)) {
//       console.log("Starting Simulation for Room:", roomId);
//       runSimulationLogic(roomId, r);
//     }
//   });

//   // Added to support the previous script listener
//   socket.on("startTournament", (data) => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r && isAdmin(socket)) {
//       runSimulationLogic(roomId, r);
//     }
//   });

//   socket.on("disconnect", () => {
//     const roomId = getRoomId(socket);
//     const r = rooms[roomId];
//     if (r) {
//       r.users = r.users.filter((id) => id !== socket.id);
//       io.to(roomId).emit("lobby_update", {
//         teams: r.teams,
//         userCount: r.users.length,
//       });
//     }
//   });
// });

// // --- ROBUST AI ENGINE ---
// function runSimulationLogic(roomId, r) {
//   // 1. Prepare Teams (Auto-fill if not submitted)
//   const tourneyTeams = r.teams
//     .filter((t) => t.isTaken)
//     .map((t) => {
//       const squadData = r.squads[t.bidKey];
//       let p11 = squadData ? squadData.playing11 : [];

//       // Auto-fill logic: if squad incomplete, fill from roster
//       if (p11.length < 11 && t.roster.length > 0) {
//         // Simple fill: take first 11 or all if less than 11
//         const needed = 11 - p11.length;
//         const available = t.roster.filter(
//           (p) => !p11.some((x) => x.name === p.name)
//         );
//         p11 = [...p11, ...available.slice(0, needed)];
//       }

//       const captainName = squadData
//         ? squadData.captain
//         : p11.length > 0
//         ? p11[0].name
//         : "None";

//       return {
//         ...t,
//         playing11: p11,
//         captain: captainName,
//       };
//     })
//     .filter((t) => t.playing11.length > 0); // Need at least 1 player to play

//   if (tourneyTeams.length < 2) {
//     return io
//       .to(roomId)
//       .emit(
//         "simulation_error",
//         "Need at least 2 teams with players to simulate!"
//       );
//   }

//   try {
//     console.log("Teams prepared, running NEW GAME LOGIC sim...");
//     // Calling the NEW Logic Engine
//     const results = runNewLogicSimulation(tourneyTeams);
//     console.log("Simulation complete, sending results.");
//     // Sending 'tournament_results' to match frontend listener in script.js
//     io.to(roomId).emit("tournament_results", results);
//   } catch (e) {
//     console.error("Simulation Error:", e);
//     io.to(roomId).emit("simulation_error", "Server Logic Error: " + e.message);
//   }
// }

// // =================================================================
// // 🚀 UPDATED GAME ENGINE (Strict adherence to your Luck/Role Rules)
// // =================================================================

// // 1. Helper to generate Luck (1-10)
// const getLuck = () => Math.floor(Math.random() * 10) + 1;

// // 2. Define Batting Order Priority
// const ROLE_PRIORITY = {
//   opener: 1,
//   wk: 1, // Wicketkeepers are often top/middle
//   "middle order": 2,
//   batter: 2,
//   finisher: 3,
//   "all-rounder": 4,
//   ar: 4,
//   allrounder: 4,
//   spinner: 5,
//   spin: 5,
//   "fast bowler": 6,
//   bowler: 6,
//   fast: 6,
//   pace: 6,
// };

// // Helper to determine order
// const getPriority = (roleKey) => {
//   if (!roleKey) return 99;
//   const lower = roleKey.toLowerCase();
//   for (const key in ROLE_PRIORITY) {
//     if (lower.includes(key)) return ROLE_PRIORITY[key];
//   }
//   return 99;
// };

// // 3. The Core Ball-by-Ball Logic
// function playBall(batsman, bowler) {
//   const luck = getLuck();

//   // Determine if the current batsman is a "Weak Hitter" (Bowler types)
//   const role = (batsman.roleKey || "").toLowerCase();
//   const isWeakHitter =
//     (role.includes("spin") || role.includes("fast") || role.includes("bowl")) &&
//     !role.includes("all");

//   let result = {
//     runs: 0,
//     isOut: false,
//     commentary: "",
//     luck: luck,
//     type: "runs",
//   };

//   if (isWeakHitter) {
//     // --- BOWLER BATTING LOGIC (Weak Hitters) ---
//     // Luck > 8 (9, 10): 6 Runs (Rare power)
//     if (luck > 8) {
//       result.runs = 6;
//       result.type = "six";
//       result.commentary = "Unbelievable! The bowler smashes a SIX!";
//     }
//     // Luck > 6 (7, 8): 4 Runs
//     else if (luck > 6) {
//       result.runs = 4;
//       result.type = "four";
//       result.commentary = "Lucky edge implies a FOUR.";
//     }
//     // Luck > 4 (5, 6): 2-3 Runs
//     else if (luck > 4) {
//       result.runs = Math.floor(Math.random() * 2) + 2; // 2 or 3
//       result.commentary = "Pushed into the gap for runs.";
//     }
//     // Luck > 3 (4): 1 Run
//     else if (luck > 3) {
//       result.runs = 1;
//       result.commentary = "Quick single taken.";
//     }
//     // Luck <= 3 (1, 2, 3): OUT (High probability of getting out for weak hitters)
//     else {
//       result.isOut = true;
//       result.commentary = "Clean bowled! The bowler misses completely.";
//     }
//   } else {
//     // --- BATSMAN / ALL-ROUNDER LOGIC (Risk-Reward) ---

//     // Luck > 8 (9, 10): OUT (Bad luck / Caught on boundary)
//     if (luck > 8) {
//       result.isOut = true;
//       result.commentary = "Caught on the boundary! High risk shot fails.";
//     }
//     // Luck > 6 (7, 8): Dot Ball
//     else if (luck > 6) {
//       result.runs = 0;
//       result.commentary = "Good delivery, straight to the fielder. Dot ball.";
//     }
//     // Luck > 4 (5, 6): Boundary (4 or 6)
//     else if (luck > 4) {
//       result.runs = Math.random() < 0.5 ? 4 : 6;
//       result.type = result.runs === 4 ? "four" : "six";
//       result.commentary =
//         result.runs === 4
//           ? "Beautiful cover drive for FOUR!"
//           : "Huge SIX over mid-wicket!";
//     }
//     // Luck > 3 (4): 1-3 Runs
//     else if (luck > 3) {
//       result.runs = Math.floor(Math.random() * 3) + 1; // 1, 2, or 3
//       result.commentary = "Working the ball around for runs.";
//     }
//     // Luck <= 3 (1, 2, 3): Boundary (Risk-Reward payoff)
//     else {
//       result.runs = Math.random() < 0.5 ? 4 : 6;
//       result.type = result.runs === 4 ? "four" : "six";
//       result.commentary = "Edged but safe! It flies for a boundary!";
//     }
//   }

//   return result;
// }

// function runNewLogicSimulation(teams) {
//   const allStats = {}; // Central stats tracker for Caps
//   const leagueMatches = [];
//   const playoffs = [];

//   // Init Stats
//   teams.forEach((t) => {
//     t.stats = {
//       p: 0,
//       w: 0,
//       l: 0,
//       pts: 0,
//       nrr: 0,
//       runsScored: 0,
//       runsConceded: 0,
//       oversFaced: 0,
//       oversBowled: 0,
//     };
//     t.playing11.forEach((p) => {
//       allStats[p.name] = {
//         name: p.name,
//         runs: 0,
//         wkts: 0,
//         pts: 0,
//         fours: 0,
//         sixes: 0,
//       };
//     });
//   });

//   const getPlayerStat = (name) => {
//     if (!allStats[name])
//       allStats[name] = {
//         name: name,
//         runs: 0,
//         wkts: 0,
//         pts: 0,
//         fours: 0,
//         sixes: 0,
//       };
//     return allStats[name];
//   };

//   // --- INNINGS SIMULATOR ---
//   function simulateInnings(batTeam, bowlTeam, target = null) {
//     // 1. Sort Batting Lineup based on Roles
//     const battingLineup = [...batTeam.playing11].sort(
//       (a, b) => getPriority(a.roleKey) - getPriority(b.roleKey)
//     );

//     // 2. Prepare Bowling Options (All non-WK usually)
//     let bowlers = bowlTeam.playing11.filter(
//       (p) => !getPriority(p.roleKey) === 1
//     ); // exclude openers/wk usually
//     // Prioritize actual bowlers/ARs
//     bowlers = bowlTeam.playing11.filter((p) => {
//       const r = (p.roleKey || "").toLowerCase();
//       return (
//         r.includes("bowl") ||
//         r.includes("fast") ||
//         r.includes("spin") ||
//         r.includes("ar") ||
//         r.includes("all")
//       );
//     });
//     if (bowlers.length < 5) bowlers = bowlTeam.playing11.slice(5); // fallback

//     // Card Data for Scorecard
//     const batCard = battingLineup.map((p) => ({
//       name: p.name,
//       runs: 0,
//       balls: 0,
//       fours: 0,
//       sixes: 0,
//       status: "dnb",
//     }));

//     const bowlCardMap = {}; // Helper to track bowler stats

//     let score = 0,
//       wickets = 0,
//       balls = 0;
//     let strikerIdx = 0,
//       nonStrikerIdx = 1;

//     batCard[strikerIdx].status = "not out";
//     if (batCard[nonStrikerIdx]) batCard[nonStrikerIdx].status = "not out";

//     for (let ball = 1; ball <= 120; ball++) {
//       if (wickets >= 10 || (target && score > target)) break;

//       const currentBatsman = batCard[strikerIdx];
//       const originalBatsmanObj = battingLineup[strikerIdx];

//       // Rotate Bowlers (Simple 5 bowler rotation)
//       const bowlerObj = bowlers[Math.floor((ball - 1) / 6) % bowlers.length];
//       if (!bowlCardMap[bowlerObj.name]) {
//         bowlCardMap[bowlerObj.name] = {
//           name: bowlerObj.name,
//           runs: 0,
//           wkts: 0,
//           balls: 0,
//           economy: 0,
//         };
//       }
//       const bowlerStats = bowlCardMap[bowlerObj.name];

//       // --- PLAY BALL ---
//       const res = playBall(originalBatsmanObj, bowlerObj);

//       currentBatsman.balls++;
//       bowlerStats.balls++;

//       if (res.isOut) {
//         wickets++;
//         currentBatsman.status = "out";
//         bowlerStats.wkts++;

//         // Update Global Stats
//         getPlayerStat(bowlerObj.name).wkts++;
//         getPlayerStat(bowlerObj.name).pts += 25;

//         // Next Batsman
//         strikerIdx = Math.max(strikerIdx, nonStrikerIdx) + 1;
//         if (batCard[strikerIdx]) batCard[strikerIdx].status = "not out";
//       } else {
//         score += res.runs;
//         currentBatsman.runs += res.runs;
//         bowlerStats.runs += res.runs;

//         // Update Global Stats
//         const pStat = getPlayerStat(currentBatsman.name);
//         pStat.runs += res.runs;
//         pStat.pts += res.runs;

//         if (res.type === "four") {
//           currentBatsman.fours++;
//           pStat.fours++;
//           pStat.pts += 1;
//         }
//         if (res.type === "six") {
//           currentBatsman.sixes++;
//           pStat.sixes++;
//           pStat.pts += 2;
//         }

//         // Swap Strike
//         if (res.runs % 2 !== 0) {
//           [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
//         }
//       }

//       // Over End Swap
//       if (ball % 6 === 0) {
//         [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
//       }
//     }

//     // Convert Map to Array for Scorecard
//     const bowlCard = Object.values(bowlCardMap);
//     bowlCard.forEach((b) => {
//       b.oversDisplay = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
//       b.economy = (b.runs / (b.balls / 6 || 1)).toFixed(1);
//     });

//     return {
//       score,
//       wickets,
//       balls,
//       bat: batCard,
//       bowl: bowlCard,
//       team: batTeam.name,
//     };
//   }

//   function playMatch(t1, t2, type) {
//     const i1 = simulateInnings(t1, t2);
//     const i2 = simulateInnings(t2, t1, i1.score);

//     let winnerName = i2.score > i1.score ? t2.name : t1.name;
//     if (i1.score === i2.score) winnerName = t1.name; // Simple tie-break

//     const margin =
//       i2.score > i1.score
//         ? `${10 - i2.wickets} wkts`
//         : `${i1.score - i2.score} runs`;

//     // Stats Update for Table
//     if (type === "League") {
//       const winner = [t1, t2].find((t) => t.name === winnerName);
//       const loser = [t1, t2].find((t) => t.name !== winnerName);

//       winner.stats.played++;
//       winner.stats.p++;
//       winner.stats.won++;
//       winner.stats.w++;
//       winner.stats.pts += 2;
//       loser.stats.played++;
//       loser.stats.p++;
//       loser.stats.lost++;
//       loser.stats.l++;

//       // NRR Calc helpers
//       winner.stats.runsScored += winner === t1 ? i1.score : i2.score;
//       winner.stats.runsConceded += winner === t1 ? i2.score : i1.score;
//       winner.stats.oversFaced += winner === t1 ? 20 : i2.balls / 6;
//       winner.stats.oversBowled += winner === t1 ? i2.balls / 6 : 20;

//       loser.stats.runsScored += loser === t1 ? i1.score : i2.score;
//       loser.stats.runsConceded += loser === t1 ? i2.score : i1.score;
//       loser.stats.oversFaced += loser === t1 ? 20 : i2.balls / 6;
//       loser.stats.oversBowled += loser === t1 ? i2.balls / 6 : 20;
//     }

//     // Helper for Top Performer
//     const bestBat = [...i1.bat, ...i2.bat].sort((a, b) => b.runs - a.runs)[0];
//     const bestBowl = [...i1.bowl, ...i2.bowl].sort(
//       (a, b) => b.wkts - a.wkts
//     )[0];

//     return {
//       t1: t1.name,
//       t2: t2.name,
//       score1: `${i1.score}/${i1.wickets}`,
//       score2: `${i2.score}/${i2.wickets}`,
//       winnerName,
//       margin,
//       type,
//       topScorer: bestBat,
//       bestBowler: {
//         name: bestBowl?.name || "-",
//         figures: `${bestBowl?.wkts || 0} wkts`,
//       },
//       details: { i1, i2 },
//     };
//   }

//   // --- LEAGUE GENERATION (Double Round Robin) ---
//   // 2 Matches against every team
//   for (let i = 0; i < teams.length; i++) {
//     for (let j = 0; j < teams.length; j++) {
//       if (i !== j) {
//         leagueMatches.push(playMatch(teams[i], teams[j], "League"));
//       }
//     }
//   }

//   // Calculate NRR and Sort
//   teams.forEach((t) => {
//     t.stats.nrr =
//       t.stats.runsScored / t.stats.oversFaced -
//         t.stats.runsConceded / t.stats.oversBowled || 0;
//   });
//   teams.sort((a, b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

//   // --- PLAYOFFS ---
//   // Top 4 play playoffs, else Top 2 play final
//   let champion = teams[0].name;
//   let runner = teams[1] ? teams[1].name : "";

//   if (teams.length >= 4) {
//     const q1 = playMatch(teams[0], teams[1], "Qualifier 1");
//     const elim = playMatch(teams[2], teams[3], "Eliminator");

//     const loserQ1 = q1.winnerName === teams[0].name ? teams[1] : teams[0];
//     const winnerElim = elim.winnerName === teams[2].name ? teams[2] : teams[3];

//     const q2 = playMatch(loserQ1, winnerElim, "Qualifier 2");

//     const finalist1 = teams.find((t) => t.name === q1.winnerName);
//     const finalist2 = teams.find((t) => t.name === q2.winnerName);

//     const final = playMatch(finalist1, finalist2, "FINAL");
//     playoffs.push(q1, elim, q2, final);
//     champion = final.winnerName;
//     runner =
//       final.winnerName === finalist1.name ? finalist2.name : finalist1.name;
//   } else if (teams.length >= 2) {
//     const final = playMatch(teams[0], teams[1], "FINAL");
//     playoffs.push(final);
//     champion = final.winnerName;
//   }

//   const statsArr = Object.values(allStats);

//   return {
//     winner: champion,
//     runnerUp: runner,
//     standings: teams,
//     leagueMatches,
//     playoffs,
//     allTeamsData: teams,
//     orangeCap: statsArr.sort((a, b) => b.runs - a.runs)[0],
//     purpleCap: statsArr.sort((a, b) => b.wkts - a.wkts)[0],
//     mvp: statsArr.sort((a, b) => b.pts - a.pts)[0],
//   };
// }

// server.listen(PORT, "0.0.0.0", () =>
//   console.log(`Server running on port ${PORT}`)
// );



const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());

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

    if (r.teams.find((t) => t.ownerPlayerId === socket.playerId && t.bidKey !== key)) {
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

  socket.on("admin_reclaim_decision", ({ approved, teamKey, requesterId, requesterPid }) => {
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
        io.to(requesterId).emit("error_message", "Host denied your reclaim request.");
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
    if (!r || !r.state.isActive || r.timerPaused || r.sellingInProgress || !r.currentPlayer)
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

      if (p11.length < 11 && t.roster.length > 0) {
        const needed = 11 - p11.length;
        const available = t.roster.filter((p) => !p11.some((x) => x.name === p.name));
        p11 = [...p11, ...available.slice(0, needed)];
      }

      const captainName = squadData ? squadData.captain : p11.length > 0 ? p11[0].name : "None";

      return {
        ...t,
        playing11: p11,
        captain: captainName,
      };
    })
    .filter((t) => t.playing11.length > 0);

  if (tourneyTeams.length < 2) {
    return io.to(roomId).emit("simulation_error", "Need at least 2 teams with players to simulate!");
  }

  try {
    console.log("Teams prepared, running NEW GAME LOGIC sim...");
    const results = runNewLogicSimulation(tourneyTeams);
    console.log("Simulation complete, sending results.");
    
    // [FIX] Correct Event Name matching client
    io.to(roomId).emit("tournamentComplete", results);
    
  } catch (e) {
    console.error("Simulation Error:", e);
    io.to(roomId).emit("simulation_error", "Server Logic Error: " + e.message);
  }
}

// =================================================================
// 🚀 UPDATED GAME ENGINE 
// =================================================================

const getLuck = () => Math.floor(Math.random() * 10) + 1;

const ROLE_PRIORITY = {
  opener: 1, wk: 1, "middle order": 2, batter: 2, finisher: 3, "all-rounder": 4, ar: 4, allrounder: 4, spinner: 5, spin: 5, "fast bowler": 6, bowler: 6, fast: 6, pace: 6,
};

const getPriority = (roleKey) => {
  if (!roleKey) return 99;
  const lower = roleKey.toLowerCase();
  for (const key in ROLE_PRIORITY) {
    if (lower.includes(key)) return ROLE_PRIORITY[key];
  }
  return 99;
};

function playBall(batsman, bowler) {
  const luck = getLuck();
  const role = (batsman.roleKey || "").toLowerCase();
  const isWeakHitter = (role.includes("spin") || role.includes("fast") || role.includes("bowl")) && !role.includes("all");

  let result = {
    runs: 0,
    isOut: false,
    commentary: "",
    luck: luck,
    type: "runs",
  };

  if (isWeakHitter) {
    if (luck > 8) {
      result.runs = 6;
      result.type = "six";
      result.commentary = "Unbelievable! The bowler smashes a SIX!";
    } else if (luck > 6) {
      result.runs = 4;
      result.type = "four";
      result.commentary = "Lucky edge implies a FOUR.";
    } else if (luck > 4) {
      result.runs = Math.floor(Math.random() * 2) + 2;
      result.commentary = "Pushed into the gap for runs.";
    } else if (luck > 3) {
      result.runs = 1;
      result.commentary = "Quick single taken.";
    } else {
      result.isOut = true;
      result.commentary = "Clean bowled! The bowler misses completely.";
    }
  } else {
    if (luck > 8) {
      result.isOut = true;
      result.commentary = "Caught on the boundary! High risk shot fails.";
    } else if (luck > 6) {
      result.runs = 0;
      result.commentary = "Good delivery, straight to the fielder. Dot ball.";
    } else if (luck > 4) {
      result.runs = Math.random() < 0.5 ? 4 : 6;
      result.type = result.runs === 4 ? "four" : "six";
      result.commentary = result.runs === 4 ? "Beautiful cover drive for FOUR!" : "Huge SIX over mid-wicket!";
    } else if (luck > 3) {
      result.runs = Math.floor(Math.random() * 3) + 1;
      result.commentary = "Working the ball around for runs.";
    } else {
      result.runs = Math.random() < 0.5 ? 4 : 6;
      result.type = result.runs === 4 ? "four" : "six";
      result.commentary = "Edged but safe! It flies for a boundary!";
    }
  }
  return result;
}

function runNewLogicSimulation(teams) {
  const allStats = {}; 
  const leagueMatches = [];
  const playoffs = [];

  teams.forEach((t) => {
    t.stats = {
      p: 0, w: 0, l: 0, pts: 0, nrr: 0, runsScored: 0, runsConceded: 0, oversFaced: 0, oversBowled: 0,
    };
    t.playing11.forEach((p) => {
      allStats[p.name] = {
        name: p.name, runs: 0, wkts: 0, pts: 0, fours: 0, sixes: 0,
      };
    });
  });

  const getPlayerStat = (name) => {
    if (!allStats[name])
      allStats[name] = { name: name, runs: 0, wkts: 0, pts: 0, fours: 0, sixes: 0 };
    return allStats[name];
  };

  function simulateInnings(batTeam, bowlTeam, target = null) {
    const battingLineup = [...batTeam.playing11].sort((a, b) => getPriority(a.roleKey) - getPriority(b.roleKey));

    // [FIX] Safer Bowler Selection Logic
    let bowlers = bowlTeam.playing11.filter((p) => getPriority(p.roleKey) !== 1);

    if (bowlers.length < 5) {
      bowlers = bowlTeam.playing11.filter((p) => {
        const r = (p.roleKey || "").toLowerCase();
        return r.includes("bowl") || r.includes("fast") || r.includes("spin") || r.includes("ar") || r.includes("all");
      });
    }

    if (bowlers.length === 0) {
      bowlers = bowlTeam.playing11; 
    }

    const batCard = battingLineup.map((p) => ({
      name: p.name, runs: 0, balls: 0, fours: 0, sixes: 0, status: "dnb",
    }));

    const bowlCardMap = {}; 

    let score = 0, wickets = 0, balls = 0;
    let strikerIdx = 0, nonStrikerIdx = 1;

    batCard[strikerIdx].status = "not out";
    if (batCard[nonStrikerIdx]) batCard[nonStrikerIdx].status = "not out";

    for (let ball = 1; ball <= 120; ball++) {
      if (wickets >= 10 || (target && score > target)) break;

      const currentBatsman = batCard[strikerIdx];
      const originalBatsmanObj = battingLineup[strikerIdx];
      const bowlerObj = bowlers[Math.floor((ball - 1) / 6) % bowlers.length];

      if (!bowlCardMap[bowlerObj.name]) {
        bowlCardMap[bowlerObj.name] = { name: bowlerObj.name, runs: 0, wkts: 0, balls: 0, economy: 0 };
      }
      const bowlerStats = bowlCardMap[bowlerObj.name];

      const res = playBall(originalBatsmanObj, bowlerObj);

      currentBatsman.balls++;
      bowlerStats.balls++;

      if (res.isOut) {
        wickets++;
        currentBatsman.status = "out";
        bowlerStats.wkts++;
        getPlayerStat(bowlerObj.name).wkts++;
        getPlayerStat(bowlerObj.name).pts += 25;
        strikerIdx = Math.max(strikerIdx, nonStrikerIdx) + 1;
        if (batCard[strikerIdx]) batCard[strikerIdx].status = "not out";
      } else {
        score += res.runs;
        currentBatsman.runs += res.runs;
        bowlerStats.runs += res.runs;
        const pStat = getPlayerStat(currentBatsman.name);
        pStat.runs += res.runs;
        pStat.pts += res.runs;
        if (res.type === "four") {
          currentBatsman.fours++; pStat.fours++; pStat.pts += 1;
        }
        if (res.type === "six") {
          currentBatsman.sixes++; pStat.sixes++; pStat.pts += 2;
        }
        if (res.runs % 2 !== 0) {
          [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
        }
      }
      if (ball % 6 === 0) {
        [strikerIdx, nonStrikerIdx] = [nonStrikerIdx, strikerIdx];
      }
    }

    const bowlCard = Object.values(bowlCardMap);
    bowlCard.forEach((b) => {
      b.oversDisplay = `${Math.floor(b.balls / 6)}.${b.balls % 6}`;
      b.economy = (b.runs / (b.balls / 6 || 1)).toFixed(1);
    });

    return { score, wickets, balls, bat: batCard, bowl: bowlCard, team: batTeam.name };
  }

  function playMatch(t1, t2, type) {
    const i1 = simulateInnings(t1, t2);
    const i2 = simulateInnings(t2, t1, i1.score);

    let winnerName = i2.score > i1.score ? t2.name : t1.name;
    if (i1.score === i2.score) winnerName = t1.name; 

    const margin = i2.score > i1.score ? `${10 - i2.wickets} wkts` : `${i1.score - i2.score} runs`;

    if (type === "League") {
      const winner = [t1, t2].find((t) => t.name === winnerName);
      const loser = [t1, t2].find((t) => t.name !== winnerName);
      winner.stats.played++; winner.stats.p++; winner.stats.won++; winner.stats.w++; winner.stats.pts += 2;
      loser.stats.played++; loser.stats.p++; loser.stats.lost++; loser.stats.l++;
      winner.stats.runsScored += winner === t1 ? i1.score : i2.score;
      winner.stats.runsConceded += winner === t1 ? i2.score : i1.score;
      winner.stats.oversFaced += winner === t1 ? 20 : i2.balls / 6;
      winner.stats.oversBowled += winner === t1 ? i2.balls / 6 : 20;
      loser.stats.runsScored += loser === t1 ? i1.score : i2.score;
      loser.stats.runsConceded += loser === t1 ? i2.score : i1.score;
      loser.stats.oversFaced += loser === t1 ? 20 : i2.balls / 6;
      loser.stats.oversBowled += loser === t1 ? i2.balls / 6 : 20;
    }

    const bestBat = [...i1.bat, ...i2.bat].sort((a, b) => b.runs - a.runs)[0];
    const bestBowl = [...i1.bowl, ...i2.bowl].sort((a, b) => b.wkts - a.wkts)[0];

    return {
      t1: t1.name, t2: t2.name,
      score1: `${i1.score}/${i1.wickets}`, score2: `${i2.score}/${i2.wickets}`,
      winnerName, margin, type,
      topScorer: bestBat,
      bestBowler: { name: bestBowl?.name || "-", figures: `${bestBowl?.wkts || 0} wkts` },
      details: { i1, i2 },
    };
  }

  for (let i = 0; i < teams.length; i++) {
    for (let j = 0; j < teams.length; j++) {
      if (i !== j) {
        leagueMatches.push(playMatch(teams[i], teams[j], "League"));
      }
    }
  }

  teams.forEach((t) => {
    t.stats.nrr = t.stats.runsScored / t.stats.oversFaced - t.stats.runsConceded / t.stats.oversBowled || 0;
  });
  teams.sort((a, b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

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
    runner = final.winnerName === finalist1.name ? finalist2.name : finalist1.name;
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

server.listen(PORT, "0.0.0.0", () =>
  console.log(`Server running on port ${PORT}`)
);
