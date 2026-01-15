// =================================================================
// 🚀 AI ENGINE: Batting, Bowling & Tournament Logic
// =================================================================

// --- 1. CONFIGURATION & WEIGHTS ---
const OUTCOME_WEIGHTS = {
  anchor:     { 0: 30, 1: 40, 2: 15, 3: 5, 4: 6, 6: 2, 'W': 2, 'WD': 0, 'NB': 0 }, // Consolidate
  normal:     { 0: 26, 1: 34, 2: 21, 3: 8, 4: 5, 6: 2, 'W': 6, 'WD': 3, 'NB': 2 },
  controlled: { 0: 22, 1: 36, 2: 23, 3: 9, 4: 6, 6: 3, 'W': 7, 'WD': 2, 'NB': 2 }, // Rotating strike
  aggressive: { 0: 21, 1: 29, 2: 17, 3: 10, 4: 8, 6: 7, 'W': 8, 'WD': 2, 'NB': 3 },
  desperate:  { 0: 14, 1: 22, 2: 12, 3: 8, 4: 10,6: 14,'W': 16,'WD': 4, 'NB': 6 } // Slog everything
};

const PITCH_EFFECTS = {
  flat:   { 4: 3, 6: 3, 'W': -2 },
  green:  { 'W': 3, 0: 4, 4: -2 }, // Swing helps bowlers
  dusty:  { 'W': 2, 0: 3, 1: -2 }, // Spin grip
  slow:   { 6: -3, 2: 4, 1: 3 }    // Hard to hit boundaries
};

// VENUE MAP provided by User
const VENUE_MAP = {
  "CSK": { name: "M. A. Chidambaram Stadium", city: "Chennai", range: [160, 185], chaseProb: 0.55, pitch: "dusty", boundary: "large" },
  "MI": { name: "Wankhede Stadium", city: "Mumbai", range: [190, 225], chaseProb: 0.65, pitch: "flat", boundary: "small" }, // Capped at 0.65
  "RCB": { name: "M. Chinnaswamy Stadium", city: "Bengaluru", range: [200, 240], chaseProb: 0.70, pitch: "flat", boundary: "tiny" }, // Capped at 0.70
  "GT": { name: "Narendra Modi Stadium", city: "Ahmedabad", range: [170, 200], chaseProb: 0.60, pitch: "green", boundary: "large" },
  "LSG": { name: "Ekana Cricket Stadium", city: "Lucknow", range: [140, 165], chaseProb: 0.40, pitch: "slow", boundary: "large" },
  "PBKS": { name: "PCA Stadium Mohali", city: "Mohali", range: [175, 205], chaseProb: 0.60, pitch: "green", boundary: "medium" },
  "KKR": { name: "Eden Gardens", city: "Kolkata", range: [185, 220], chaseProb: 0.65, pitch: "slow", boundary: "medium" },
  "RR": { name: "Sawai Mansingh Stadium", city: "Jaipur", range: [170, 195], chaseProb: 0.50, pitch: "dusty", boundary: "large" },
  "DC": { name: "Arun Jaitley Stadium", city: "Delhi", range: [180, 210], chaseProb: 0.65, pitch: "flat", boundary: "small" },
  "SRH": { name: "Rajiv Gandhi Intl", city: "Hyderabad", range: [195, 235], chaseProb: 0.45, pitch: "flat", boundary: "medium" }
};

let rngSeed = Date.now();
function seededRandom() {
  rngSeed = (rngSeed * 9301 + 49297) % 233280;
  return rngSeed / 233280;
}

// Global Form Tracker
const formTracker = {}; 
function getForm(name) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    return formTracker[name];
}
function updateForm(name, runs, balls) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    if(balls > 10) {
        const sr = (runs/balls)*100;
        if(sr > 160) formTracker[name] = Math.min(1.25, formTracker[name] + 0.05);
        else if(sr < 100) formTracker[name] = Math.max(0.75, formTracker[name] - 0.05);
    }
}
function updateBowlingForm(name, figures) {
    if(!formTracker[name]) formTracker[name] = 1.0;
    // figures: { runs, wkts }
    if(figures.wkts >= 2) formTracker[name] = Math.min(1.2, formTracker[name] + 0.05);
    else if(figures.runs > 50 && figures.wkts === 0) formTracker[name] = Math.max(0.8, formTracker[name] - 0.05);
}

// Helper for Venue Mapping
function getVenueForTeam(teamName) {
    // Try to match team name directly with keys
    for (const key of Object.keys(VENUE_MAP)) {
        if (teamName.toUpperCase().includes(key)) return VENUE_MAP[key];
    }
    // Default fallback: Random venue instead of always Wankhede
    const venueKeys = Object.keys(VENUE_MAP);
    return VENUE_MAP[venueKeys[Math.floor(seededRandom() * venueKeys.length)]];
}

// --- 2. BOWLING LOGIC ---
const bowlingLogic = {
  getBowlerType: (player) => {
    const role = (player.roleKey?.toLowerCase() || player.role?.toLowerCase() || '');
    const name = (player.name || '').toLowerCase();
    let type = 'pacer';
    
    if (role.includes('off') || name.includes('ashwin') || name.includes('narine')) type = 'off-spinner';
    else if (role.includes('leg') || name.includes('chahal') || name.includes('rashid')) type = 'leg-spinner';
    else if (role.includes('spin') || name.includes('jadeja')) type = 'spinner';
    else if (role.includes('fast') || role.includes('pace')) type = 'pacer';
    
    if (role.includes('ar') || role.includes('all')) {
      const bat = player.stats?.bat || 0;
      const bowl = player.stats?.bowl || 0;
      if (bat >= 80 && bowl >= 60) return `ar-balanced-${type}`;
      return `ar-bowler-${type}`;
    }
    return type;
  },

  prepareBowlersForInnings: (playing11) => {
    // 1. Filter, then Map to NEW Objects to break reference accumulation
    // This is critical to prevent stats from bleeding across matches
    const bowlers = playing11
        .filter(p => {
            const r = (p.roleKey || p.role || '').toLowerCase();
            if(r.includes('wk')) return false;
            return (r.includes('bowl') || r.includes('fast') || r.includes('spin') || r.includes('ar') || r.includes('all'));
        })
        .map(p => ({
            ...p, // Copy basic props (name, stats)
            maxOvers: 4,
            remaining: 4,
            oversUsed: 0,
            balls: 0,
            wkts: 0,
            runs: 0,
            lastBowledOver: -2,
            economy: 0,
            oversDisplay: "0.0"
        }));

    // Ensure 5+ bowlers if shortage
    if (bowlers.length < 5) {
        const others = playing11.filter(p => !bowlers.find(b => b.name === p.name));
        if(others.length > 0) {
             bowlers.push({
                 ...others[0], 
                 isPartTime: true,
                 maxOvers: 2, 
                 remaining: 2,
                 oversUsed: 0,
                 balls: 0,
                 wkts: 0,
                 runs: 0,
                 lastBowledOver: -2,
                 economy: 0,
                 oversDisplay: "0.0"
             });
        }
    }

    // Sort by skill
    const ranked = bowlers.sort((a,b) => (b.stats?.bowl || 0) - (a.stats?.bowl || 0));

    // Refine Overs for Part Timers
    ranked.forEach(b => {
        if(b.isPartTime) { b.maxOvers = 2; b.remaining = 2; }
    });

    // Adjust if 6+ bowlers (distribute overs)
    if(ranked.length >= 6) {
        if(ranked[4]) { ranked[4].maxOvers = 2; ranked[4].remaining = 2; }
        if(ranked[5]) { ranked[5].maxOvers = 2; ranked[5].remaining = 2; }
    }

    return ranked;
  },

  selectBowlerForOver: (bowlable, overNumber, phase) => {
    // Candidates who have overs left and didn't bowl the last over
    let candidates = bowlable.filter(b => b.remaining > 0 && b.lastBowledOver !== overNumber - 1);
    
    // Fallback: If no one is eligible (e.g. only 1 bowler left with overs), pick ANYONE with overs
    if(candidates.length === 0) {
        const any = bowlable.filter(b => b.remaining > 0).sort((a,b) => b.remaining - a.remaining)[0];
        if(!any) return null; // Truly no overs left
        return any;
    }

    // Phase Priorities
    const type = (b) => bowlingLogic.getBowlerType(b);
    
    // Sort by suitability for phase
    // Sort by suitability for phase
    candidates.sort((a, b) => {
        let scoreA = a.stats?.bowl || 50;
        let scoreB = b.stats?.bowl || 50;  

        // Death: Pacers + High Skill
        if(phase === 'death') {
            if(type(a).includes('pacer')) scoreA += 25; // Boost pacers
            if(type(b).includes('pacer')) scoreB += 25;
        }
        // PP: Swing / Pacers
        if(phase === 'pp') {
            if(type(a).includes('pacer')) scoreA += 15;
            if(type(b).includes('pacer')) scoreB += 15;
        }
        // Mid: Spinners
        if(phase === 'mid') {
            if(type(a).includes('spin')) scoreA += 10;
            if(type(b).includes('spin')) scoreB += 10;
        }

        // Economy influence (don't pick expensive bowlers in death if avoided)
        if (a.runs > 11 * (a.oversUsed || 1)) scoreA -= 15;
        if (b.runs > 11 * (b.oversUsed || 1)) scoreB -= 15;
        
        return (scoreB + seededRandom()*15) - (scoreA + seededRandom()*15);
    });

    const selected = candidates[0];
    selected.lastBowledOver = overNumber;
    return selected;
  },

  updateBowlerStats: (bowler, runs) => {
      bowler.runs += runs;
  },
  
  endBowlerOver: (bowler) => {
      bowler.remaining--;

      // Accurate Overs Display
      const overs = Math.floor(bowler.balls / 6);
      const balls = bowler.balls % 6;
      bowler.oversDisplay = `${overs}.${balls}`;

      // Accurate Economy (avoid division by zero)
      const totalOvers = bowler.balls / 6;
      const eco = totalOvers > 0 ? (bowler.runs / totalOvers) : 0;
      bowler.economy = eco.toFixed(2); 
  }
};

function layoutOvers(balls) {
    if(!balls) return "0.0";
    const o = Math.floor(balls/6);
    const b = balls%6;
    return `${o}.${b}`;
}

// --- 3. BATTING LOGIC ---
const battingLogic = {
  getRole: (p) => {
      const n = (p.name || '').toLowerCase();
      if(n.includes('russell') || n.includes('sky') || n.includes('maxwell')) return 'finisher';
      if(n.includes('kohli') || n.includes('rohit')) return 'anchor';
      return 'normal';
  },

  getWicketType: (batter, bowler, phase) => {
      const r = seededRandom();
      // 1. Run Outs are rare/situational events (approx 5% overall, higher in death)
      // Death Phase Pressure: Slightly higher chance of mix-ups
      if(phase === 'death' && r < 0.10) return 'run out';
      if(phase !== 'death' && r < 0.03) return 'run out';

      // 2. Normal Wickets: Re-roll for distribution
      const wR = seededRandom();
      
      if(bowlingLogic.getBowlerType(bowler).includes('spin')) {
          if(wR < 0.50) return 'caught';
          if(wR < 0.75) return 'lbw';
          if(wR < 0.90) return 'bowled';
          return 'stumped';
      } else {
          // Pacers
          if(wR < 0.60) return 'caught';
          if(wR < 0.85) return 'bowled'; // Pacers get more bowled/lbw
          return 'lbw';
      }
  },

  calculateBallOutcome: (batter, bowler, matchState, venue) => {
      const { phase, reqRR, isChasing, recentCollpase, momentum, ballsLeft, currentScore, ballsBowled, dewActive } = matchState;
      let mode = 'normal';
      const role = battingLogic.getRole(batter);

      // --- VENUE RANGE LOGIC ---
      let rangeAggression = 0;
      if (venue.range) {
          const oversBowled = (120 - ballsLeft) / 6;
          const safeOvers = oversBowled === 0 ? 1 : oversBowled; 
          const estimatedTotal = (currentScore / safeOvers) * 20; 
          const targetMin = venue.range[0];
          const targetMax = venue.range[1];

          // Check only after 10 overs (60 balls) to avoid early game bias
          if(ballsBowled > 60) { 
              if (estimatedTotal < targetMin) rangeAggression = 1; 
              if (estimatedTotal > targetMax) rangeAggression = -1; 
          }
      }

      // 1. Situation Analysis
      if (recentCollpase) {
          mode = 'anchor'; // Rebuild after wickets
      } else if (phase === 'death') {
          mode = 'aggressive';
      } else if (momentum > 2) {
          mode = 'aggressive'; // Riding the wave
      }

      // Finisher Bonus - Only if Death or late Mid
      if(role === 'finisher' && (phase === 'death' || (phase === 'mid' && ballsLeft < 30))) {
           mode = 'aggressive'; 
      }

      // Chase Pressure
      if (isChasing) {
          if (reqRR > 13 || (reqRR > 0 && ballsLeft < 18)) mode = 'desperate';
          else if (reqRR > 10) mode = 'aggressive';
          else if (reqRR < 6) mode = 'controlled';
          
          if(dewActive && mode === 'normal') mode = 'aggressive';
      } else if (rangeAggression === 1 && mode !== 'desperate') {
          mode = 'aggressive';
      } else if (rangeAggression === -1 && mode === 'aggressive') {
           mode = 'controlled'; 
      }
      
      // 2. Base Weights from Mode
      let weights = { ...OUTCOME_WEIGHTS[mode] };

      // Dew Factor
      if(dewActive) {
           weights['W'] = Math.max(1, weights['W'] - 2);
           weights[4] += 2; 
           weights[6] += 1;
           // Slippery ball: More extras
           if(weights['WD'] !== undefined) weights['WD'] += 1;
           if(weights['NB'] !== undefined) weights['NB'] += 1;
      }
      
      // 3. Venue & Pitch Adjustments
      if(VENUE_EFFECTS[venue.pitch]) {
           const eff = VENUE_EFFECTS[venue.pitch];
           for(let k in eff) {
               if(weights[k] !== undefined) weights[k] += eff[k];
           }
      }
      if(venue.boundary === 'tiny') { weights[6] += 4; weights[4] += 3; }
      if(venue.boundary === 'large') { 
          weights[1] += 2; weights[2] += 2; weights[6] -= 2; 
          weights[0] = Math.max(0, weights[0] - 2); 
      }

      // 4. Form & Skill Diff
      const f = getForm(batter.name);
      const batSkill = (batter.stats?.bat || 75) * f;
      const bowlSkill = (bowler.stats?.bowl || 75) * getForm(bowler.name);
      
      const diff = batSkill - bowlSkill;

      if (diff > 15) {
          weights[4] += 5; weights[6] += 3; weights['W'] = Math.max(1, weights['W'] - 4);
      } else if (diff < -15) {
          weights[0] += 6; weights['W'] += 5; weights[6] -= 2;
      }
      
      // Death Over Acceleration
      if(phase === 'death') {
          weights[4] += 3; weights[6] += 4;
      }

      // 5. Select Outcome
      const total = Object.values(weights).reduce((a,b)=>a+b,0);
      let r = seededRandom() * total;
      let result = '0';
      for(const [k,v] of Object.entries(weights)) {
          r -= v;
          if(r <= 0) { result = k; break; }
      }

      let out = { runs: 0, wicket: false, extra: null, wicketType: null };
      
      if (result === 'W') {
          out.wicket = true;
          out.wicketType = battingLogic.getWicketType(batter, bowler, phase);
      } else if (result === 'WD' || result === 'NB') {
          out.extra = result;
          out.runs = 1; // 1 run for extra
      } else {
          out.runs = parseInt(result);
      }
      return out;
  }
};

function minDot(weights, amt) {
    weights[0] = Math.max(0, weights[0] - amt);
}

// Helper for Pitch effects (renamed for clarity inside logic)
const VENUE_EFFECTS = PITCH_EFFECTS;

// --- 4. TOURNAMENT SIMULATION ---
function runFullTournament(tourneyTeams) {
    if(tourneyTeams.length < 2) throw new Error("Need at least 2 teams to simulate.");

    // Init Global Stats
    const allStats = {};
    const getPStat = (name) => {
        if(!allStats[name]) allStats[name] = { name, runs:0, wkts:0, pts:0, fours:0, sixes:0 };
        return allStats[name];
    };
    tourneyTeams.forEach(t => {
        t.stats = { played:0, won:0, lost:0, pts:0, nrr:0, rs:0, rc:0, of:0, ob:0 };
    });

    const matches = [];

    // --- MATCH SIMULATOR ---
    function simulateMatch(t1, t2, type) {
        // Select VENUE based on HOME TEAM (t1)
        const venue = getVenueForTeam(t1.name);

        // --- HELPER: GET XI BASED ON ROLE ---
        // If Batting Mode: Include BatImpact, Exclude BowlImpact
        // If Bowling Mode: Include BowlImpact, Exclude BatImpact
        function getActiveXI(team, mode) {
            const squad = team.squad || []; // 12 Players
            const batImp = team.batImpact;
            const bowlImp = team.bowlImpact;

            if (!batImp || !bowlImp) return squad.slice(0, 11); // Fallback

            const unwanted = mode === 'bat' ? bowlImp.name : batImp.name;
            return squad.filter(p => p.name !== unwanted).slice(0, 11);
        }

        function simInnings(batTeam, bowlTeam, target, innIndex) {
            // Determine Active XI for this innings
            // BatTeam is Batting -> Needs BatImp
            const batXI = getActiveXI(batTeam, 'bat');
            
            // BowlTeam is Bowling -> Needs BowlImp
            const bowlXI = getActiveXI(bowlTeam, 'bowl');

            let batOrder = [...batXI];
            
            // Note: Bowling Logic needs 5+ bowlers. getActiveXI('bowl') ensures BowlImp is IN.
            const bowlers = bowlingLogic.prepareBowlersForInnings(bowlXI);
            
            let score = 0, wkts = 0, balls = 0;
            let striker = 0, nonStriker = 1;
            let nextBat = 2;
            let recentWickets = 0; 
            let momentum = 0;
            const ballLog = [];
            
            // FIX: Initialize dew effect properly
            // Dew is more likely in 2nd innings at certain venues
            const dewActive = (innIndex === 2 && seededRandom() < 0.4); // 40% chance in 2nd innings
            
            // Bat Cards Init
            const bCards = batOrder.map(p => ({ name: p.name, runs: 0, balls: 0, status: 'dnb', fours:0, sixes:0 }));
            if(bCards[0]) bCards[0].status = 'not out';
            if(bCards[1]) bCards[1].status = 'not out';

            for(let over=0; over<20; over++) {
                if(wkts>=10 || (target && score > target)) break;

                const phase = over<6?'pp':over<15?'mid':'death';
                
                // NO OLD IMPACT LOGIC HERE (Removed)

                const bowler = bowlingLogic.selectBowlerForOver(bowlers, over, phase);
                if(!bowler) break; 

                // Reset momentum slightly
                if(momentum > 0) momentum--;

                let legalBallsInOver = 0;
                while(legalBallsInOver < 6) {
                    if(wkts>=10 || (target && score > target)) break;

                    const bat = batOrder[striker];
                    const bStat = bCards[striker];
                    
                    let reqRR = 0;
                    if(target) {
                        const remRuns = target - score;
                        const remBalls = 120 - balls;
                        reqRR = remBalls > 0 ? (remRuns/(remBalls/6)) : 99;
                    }

                    const recentCollpase = recentWickets > 0;
                    const outcome = battingLogic.calculateBallOutcome(bat, bowler, {
                        phase, reqRR, isChasing: !!target, recentCollpase, momentum, 
                        ballsLeft: 120-balls, ballsBowled: balls, currentScore: score,
                        dewActive: dewActive // FIX: Now properly passed
                    }, venue);

                    score += outcome.runs;
                    bowlingLogic.updateBowlerStats(bowler, outcome.runs);
                    
                    if(!outcome.extra) bowler.balls++; 
                    
                    ballLog.push({ over: `${over}.${legalBallsInOver+1}`, bat: bat.name, bowl: bowler.name, ...outcome });

                    // Global Stats (Bowler)
                    const bs = getPStat(bowler.name);
                    if(!bs.runsConceded) bs.runsConceded = 0;
                    if(!bs.ballsBowled) bs.ballsBowled = 0;
                    
                    bs.runsConceded += outcome.runs; 
                    if(!outcome.extra) bs.ballsBowled++;

                    if(outcome.wicket) {
                        wkts++;
                        recentWickets = 2; 
                        momentum = 0;
                        bStat.status = 'out';
                        bStat.balls++;
                        updateForm(bat.name, bStat.runs, bStat.balls); 
                        
                        // FIX: Only credit bowler if NOT a run out
                        if(outcome.wicketType !== 'run out') {
                            bs.wkts++; 
                            bs.pts+=25;
                            bowler.wkts++;
                        }

                        if(nextBat < batOrder.length) {
                            striker = nextBat++;
                            bCards[striker].status = 'not out';
                        } else {
                            striker = -1;
                        }
                    } else {
                        if(!outcome.extra) {
                            bStat.runs += outcome.runs;
                            bStat.balls++;
                            
                            if(outcome.runs >= 4) momentum++;
                            else momentum = Math.max(0, momentum-1);

                            const ps = getPStat(bat.name);
                            if(!ps.ballsFaced) ps.ballsFaced = 0;
                            
                            ps.runs += outcome.runs; 
                            ps.ballsFaced++;
                            ps.pts += outcome.runs;
                            
                            if(outcome.runs===4) { ps.fours++; bStat.fours++; }
                            if(outcome.runs===6) { ps.sixes++; bStat.sixes++; }

                            if(outcome.runs % 2 !== 0) {
                                [striker, nonStriker] = [nonStriker, striker];
                            }
                        }
                    }
                    if(!outcome.extra) {
                        balls++;
                        legalBallsInOver++;
                    }
                }

                bowlingLogic.endBowlerOver(bowler);
                [striker, nonStriker] = [nonStriker, striker];
                if(recentWickets > 0) recentWickets--;
            }
            
            bCards.forEach(c => {
                if(c.status === 'not out') updateForm(c.name, c.runs, c.balls);
            });

            return { team: batTeam.name, score, wkts, balls, batting: bCards, bowling: bowlers };
        }

        // TOSS & CHASE DECISION
        let firstBat, secondBat;
        const tossWinner = seededRandom() > 0.5 ? t1 : t2; 
        const tossLoser = tossWinner === t1 ? t2 : t1;
        let electedTo = "bat";

        if (seededRandom() < venue.chaseProb) { 
            firstBat = tossLoser;
            secondBat = tossWinner;
            electedTo = "bowl";
        } else { 
            firstBat = tossWinner;
            secondBat = tossLoser;
        }

        // Innings 1: firstBat batting (ActiveXI='bat'), secondBat bowling (ActiveXI='bowl')
        const i1 = simInnings(firstBat, secondBat, null, 1);
        
        // Innings 2: secondBat batting (ActiveXI='bat'), firstBat bowling (ActiveXI='bowl')
        // This implicitly handles the SWAP because simInnings calls getActiveXI(team, mode)
        const i2 = simInnings(secondBat, firstBat, i1.score, 2);

        // Determine Winner (Robust)
        const s1 = parseInt(i1.score);
        const s2 = parseInt(i2.score);
        
        let winner = s1 > s2 ? firstBat.name : secondBat.name;
        if(s1 === s2) winner = "Tie";

        // Margin Logic
        let margin = "Tie";
        if(winner === firstBat.name) {
            margin = `${s1 - s2} runs`;
        } else if (winner === secondBat.name) {
            margin = `${10 - i2.wkts} wickets`;
        } // Tie case handled implicitly

        // Update League Stats
        if (type === "League") {
            // Stats Update Logic
            if(winner !== "Tie") {
                const wT = winner === firstBat.name ? firstBat : secondBat;
                const lT = winner === firstBat.name ? secondBat : firstBat;
                wT.stats.won++; 
                wT.stats.pts += 2;
                lT.stats.lost++;
            }
            
            // Runs stats (Always update runs, even for ties)
            const t1Obj = firstBat.name === t1.name ? firstBat : secondBat;
            const t2Obj = firstBat.name === t2.name ? firstBat : secondBat;
            
            // Note: i1 is First Bat Innings. i2 is Second Bat Innings.
            // If t1 was First Bat: t1.rs += i1.score, t1.of += 20 (or less if all out)
            
            // We use a helper to calculate official NRR overs
            const getNRROvers = (inn, isChasing, target) => {
                if (inn.wkts === 10) return 20; // All out = 20 overs
                if (isChasing && inn.score > target) return inn.balls / 6; // Won chasing = Actual overs
                return 20; // 20 overs otherwise (including chasing but lost/tied, or batting first not all out)
            };

            // t1 Stats
            const t1Inn = firstBat.name === t1.name ? i1 : i2;
            const t2Inn = firstBat.name === t2.name ? i1 : i2; // Opponent Innings for RC
            
            const t1IsChasing = firstBat.name !== t1.name; 
            const t1Target = t1IsChasing ? t2Inn.score : null;

            t1.stats.rs += t1Inn.score;
            t1.stats.rc += t2Inn.score;
            t1.stats.of += getNRROvers(t1Inn, t1IsChasing, t2Inn.score);
            t1.stats.ob += getNRROvers(t2Inn, !t1IsChasing, t1Inn.score);

            // t2 Stats
            const t2IsChasing = firstBat.name !== t2.name;
            t2.stats.rs += t2Inn.score;
            t2.stats.rc += t1Inn.score;
            t2.stats.of += getNRROvers(t2Inn, t2IsChasing, t1Inn.score);
            t2.stats.ob += getNRROvers(t1Inn, !t2IsChasing, t2Inn.score);
        }
        
        t1.stats.played++;
        t2.stats.played++;

        // Correctly map scores to t1 and t2
        const t1Score = firstBat.name === t1.name ? i1 : i2;
        const t2Score = firstBat.name === t2.name ? i1 : i2;

        return {
            t1: t1.name, t2: t2.name,
            score1: `${t1Score.score}/${t1Score.wkts}`,
            score2: `${t2Score.score}/${t2Score.wkts}`,
            winner: winner,  
            winnerName: winner,
            margin: margin,
            toss: `${tossWinner.name} won toss & chose to ${electedTo}`,
            tossDetails: { winner: tossWinner.name, decision: electedTo },
            venue: venue,
            type,
            details: { 
                i1: { ...i1, teamName: firstBat.name }, 
                i2: { ...i2, teamName: secondBat.name } 
            },
            batFirst: firstBat.name 
        };
    }

    // --- LEAGUE LOOP ---
    const leagueMatches = [];
    for(let i=0; i<tourneyTeams.length; i++) {
        for(let j=i+1; j<tourneyTeams.length; j++) {
            const m1 = simulateMatch(tourneyTeams[i], tourneyTeams[j], "League");
            handleLeaguePoints(m1);
            leagueMatches.push(m1);

            const m2 = simulateMatch(tourneyTeams[j], tourneyTeams[i], "League");
            handleLeaguePoints(m2);
            leagueMatches.push(m2);
        }
    }

    function handleLeaguePoints(match) {
        if(match.winner === "Tie") {
             const t1 = tourneyTeams.find(t => t.name === match.t1);
             const t2 = tourneyTeams.find(t => t.name === match.t2);
             t1.stats.pts += 1;
             t2.stats.pts += 1;
             // NRR Calculation updates for Ties
             // We still track runs/overs for NRR even in ties
             updateNRRStats(t1, match.details.i1, match.details.i2);
             updateNRRStats(t2, match.details.i2, match.details.i1);
        } else {
             // Standard Win/Loss logic handled in simulateMatch? 
             // WAIT, simulateMatch handles league logic internally in previous code.
             // We should strip it from simulateMatch to be cleaner, or just fix it there.
             // The previous code had it INSIDE simulateMatch. Let's look at the implementation below.
        }
    }
    
    // RE-INJECTED HELPER FOR NRR STATS (extracted from simulateMatch to avoid dupes)
    function updateNRRStats(team, myInn, oppInn) {
         team.stats.rs += myInn.score;
         team.stats.rc += oppInn.score;
         
         const myOvers = (myInn.wkts === 10) ? 20 : (myInn.balls/6); 
         const oppOvers = (oppInn.wkts === 10) ? 20 : (oppInn.balls/6);
         
         // Fix for NRR: If team won chasing, they faced actual overs. If lost chasing, 20 overs?
         // Simpler NRR Rule: 
         // For 'rs' (Runs Scored), divide by 'of' (Overs Faced).
         // For 'rc' (Runs Conceded), divide by 'ob' (Overs Bowled).
         
         // We add to 'of' and 'ob'
         team.stats.of += myOvers;
         team.stats.ob += oppOvers;
    }


    // Sort Standings
    tourneyTeams.forEach(t => {
        t.stats.nrr = ((t.stats.rs/Math.max(1,t.stats.of)) - (t.stats.rc/Math.max(1,t.stats.ob))).toFixed(3);
        // Map stats for play.html simple access
        t.played = t.stats.played;
        t.won = t.stats.won;
        t.lost = t.stats.lost;
        t.pts = t.stats.pts;
        t.nrrVal = parseFloat(t.stats.nrr);
    });
    tourneyTeams.sort((a,b) => b.stats.pts - a.stats.pts || b.stats.nrr - a.stats.nrr);

    // --- PLAYOFFS ---
    const playoffs = [];
    let champion = tourneyTeams[0].name;
    
    // Helper to resolve Playoff Ties
    function resolvePlayoff(m) {
        if(m.winner !== "Tie") return m;
        // Super Over Simulation (Simplified)
        m.margin = "Super Over";
        // Random winner for robustness or based on boundaries
        // Let's use boundary count
        const b1 = (m.details.i1.batting.reduce((a,b)=>a+b.fours+b.sixes,0));
        const b2 = (m.details.i2.batting.reduce((a,b)=>a+b.fours+b.sixes,0));
        
        if(b1 > b2) {
            m.winner = m.t1;
            m.winnerName = m.t1;
            m.margin = "Super Over (Boundaries)";
        } else if (b2 > b1) {
            m.winner = m.t2;
            m.winnerName = m.t2;
            m.margin = "Super Over (Boundaries)";
        } else {
             // Coin toss final resort
             m.winner = m.t1;
             m.winnerName = m.t1;
             m.margin = "Super Over (Toss)";
        }
        return m;
    }

    if(tourneyTeams.length >= 4) {
        let q1 = simulateMatch(tourneyTeams[0], tourneyTeams[1], "Qualifier 1");
        q1 = resolvePlayoff(q1);
        
        let elim = simulateMatch(tourneyTeams[2], tourneyTeams[3], "Eliminator");
        elim = resolvePlayoff(elim);
        
        const lQ1 = q1.winnerName === tourneyTeams[0].name ? tourneyTeams[1] : tourneyTeams[0];
        const wElim = elim.winnerName === tourneyTeams[2].name ? tourneyTeams[2] : tourneyTeams[3];
        
        let q2 = simulateMatch(lQ1, wElim, "Qualifier 2");
        q2 = resolvePlayoff(q2);
        
        const f1 = tourneyTeams.find(t => t.name === q1.winnerName);
        const f2 = tourneyTeams.find(t => t.name === q2.winnerName);
        
        let final = simulateMatch(f1, f2, "FINAL");
        final = resolvePlayoff(final);
        
        playoffs.push(q1, elim, q2, final);
        champion = final.winnerName;
    } else if(tourneyTeams.length === 2) {
        let final = simulateMatch(tourneyTeams[0], tourneyTeams[1], "FINAL");
        final = resolvePlayoff(final);
        playoffs.push(final);
        champion = final.winnerName;
    }

    // Return Results Bundle
    const statsArr = Object.values(allStats);
    
    // Awards calculation
    const orange = statsArr.sort((a,b)=>b.runs-a.runs)[0];
    const purple = statsArr.sort((a,b)=>b.wkts-a.wkts)[0];
    const mvp = statsArr.sort((a,b)=>b.pts-a.pts)[0];
    const sixes = statsArr.sort((a,b)=>b.sixes-a.sixes)[0];

    // Calc Complex Stats
    const bestSR = statsArr.filter(p => p.runs > 50).sort((a,b) => {
        const srA = (a.runs/Math.max(1, a.ballsFaced||1))*100;
        const srB = (b.runs/Math.max(1, b.ballsFaced||1))*100;
        return srB - srA;
    })[0];

    const bestEco = statsArr.filter(p => p.ballsBowled > 24).sort((a,b) => { // Min 4 overs
        const ecoA = (a.runsConceded||0) / (a.ballsBowled/6 || 1);
        const ecoB = (b.runsConceded||0) / (b.ballsBowled/6 || 1);
        return ecoA - ecoB;
    })[0];
    
    // Impact: High points / balls faced ratio (Explosive contribution)
    const impactPlayer = statsArr.filter(p => p.pts > 50).sort((a,b) => {
         const impA = a.pts / ((a.ballsFaced || 0) + (a.ballsBowled || 0) + 1);
         const impB = b.pts / ((b.ballsFaced || 0) + (b.ballsBowled || 0) + 1);
         return impB - impA;
    })[0] || mvp;

    return {
        champion: champion, 
        standings: tourneyTeams,
        pointsTable: tourneyTeams, 
        matches: leagueMatches, 
        leagueMatches,
        playoffs,
        
        // Nested awards object for play.html
        awards: {
            orange: { name: orange?.name, val: orange?.runs },
            purple: { name: purple?.name, val: purple?.wkts },
            mvp: { name: mvp?.name, val: mvp?.pts },
            sixes: { name: sixes?.name, val: sixes?.sixes },
            impact: { name: impactPlayer?.name || "N/A", val: (impactPlayer?.pts || 0).toFixed(0) }, 
            sr: { name: bestSR?.name || "N/A", val: bestSR ? ((bestSR.runs/bestSR.ballsFaced)*100).toFixed(2) : 0 }, 
            eco: { name: bestEco?.name || "N/A", val: bestEco ? ((bestEco.runsConceded/(bestEco.ballsBowled/6)).toFixed(2)) : 0 }
        },

        allTeamsData: tourneyTeams
    };
}

module.exports = { runFullTournament };
