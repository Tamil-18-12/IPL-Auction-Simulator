// ======================================================
// 🔧 0. PERSISTENT IDENTITY (THE WRISTBAND)
// ======================================================
// This ensures that if a user refreshes, they keep the same ID.
let myPersistentId = localStorage.getItem("ipl_auction_player_id");

if (!myPersistentId) {
  // Generate a random unique ID if one doesn't exist
  myPersistentId =
    "user_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  localStorage.setItem("ipl_auction_player_id", myPersistentId);
}

console.log("🔑 My Persistent ID:", myPersistentId);

// ======================================================
// 🔧 1. ROBUST SOCKET INITIALIZATION
// ======================================================

const socket = io({
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 2000,
  timeout: 20000,
  // SEND THE ID TO THE SERVER ON CONNECT
  auth: {
    playerId: myPersistentId,
  },
});

const lobbyScreen = document.getElementById("lobbyScreen");
const gameContainer = document.getElementById("gameContainer");
const lobbyError = document.getElementById("lobbyError");

// --- GLOBAL VARIABLES ---
let myRoomId = null;
let mySelectedTeamKey = null; // Stores your joined team ID
let isAdmin = false;
let saleProcessing = false;
let auctionQueue = [];
let globalTeams = [];
let currentActivePlayer = null;
let auctionStarted = false;
let currentHighestBidderKey = null;
let connectedUsersCount = 1;
let lastTournamentData = null;

// ======================================================
// 🔧 2. SOCKET HEALTH + HEARTBEAT (UPDATED FOR RENDER)
// ======================================================
let socketAlive = true;

// --- HEARTBEAT (PREVENT RENDER SLEEP) ---
// This runs every 5 minutes (300,000 ms) to keep the app awake
setInterval(() => {
  // 1. Ping the Socket (Keeps the WebSocket connection alive)
  if (socket.connected) {
    socket.emit("pingServer");
  }

  // 2. Ping the HTTP Server (Keeps the Render Server awake)
  fetch(window.location.href)
    .then(() => console.log("✅ Keep-Alive: HTTP Ping Sent"))
    .catch(() => console.log("⚠️ Keep-Alive: HTTP Ping Failed"));
}, 120000);

// --- SOCKET STATUS HANDLERS ---
socket.on("connect", () => {
  socketAlive = true;
  console.log("✅ Socket connected:", socket.id);
  if (lobbyError) lobbyError.innerText = ""; // Clear errors on connect
});

socket.on("disconnect", (reason) => {
  socketAlive = false;
  console.warn("⚠️ Socket disconnected:", reason);
  logEvent("⚠️ Connection lost. Reconnecting...", true);
});

socket.on("reconnect", () => {
  socketAlive = true;
  console.log("🔁 Reconnected");
  logEvent("🔁 Reconnected to server", true);

  // Ask server to sync auction state again
  if (myRoomId) {
    socket.emit("request_sync");
    // Also try to reclaim team based on persistent ID logic which server will handle
    // But we also keep the local storage backup for safety
    const savedTeamKey = localStorage.getItem(`ipl_team_${myRoomId}`);
    if (savedTeamKey) {
      socket.emit("reclaim_team", savedTeamKey);
    }
  }
});

socket.on("pongServer", () => {
  // silent keep-alive response
});

// ======================================================
// 🔧 3. SAFE PAGE REFRESH HANDLING
// ======================================================
window.addEventListener("beforeunload", (e) => {
  e.preventDefault();
  e.returnValue = "";
  return "";
});

// --- PLAYER DATABASE & CONSTANTS ---
const PLAYER_DATABASE = {
  "Virat Kohli": { bat: 98, bowl: 10, luck: 90, type: "bat" },
  "Rohit Sharma": { bat: 95, bowl: 15, luck: 85, type: "bat" },
  "Shubman Gill": { bat: 92, bowl: 5, luck: 88, type: "bat" },
  "Suryakumar Yadav": { bat: 96, bowl: 5, luck: 80, type: "bat" },
  "Travis Head": { bat: 94, bowl: 20, luck: 85, type: "bat" },
  "David Warner": { bat: 89, bowl: 5, luck: 75, type: "bat" },
  "Faf du Plessis": { bat: 88, bowl: 5, luck: 80, type: "bat" },
  "Yashasvi Jaiswal": { bat: 90, bowl: 10, luck: 85, type: "bat" },
  "Shreyas Iyer": { bat: 85, bowl: 10, luck: 80, type: "bat" },
  "Ruturaj Gaikwad": { bat: 87, bowl: 5, luck: 85, type: "bat" },
  "Rinku Singh": { bat: 88, bowl: 5, luck: 95, type: "bat" },
  "David Miller": { bat: 89, bowl: 5, luck: 90, type: "bat" },
  "Harry Brook": { bat: 86, bowl: 10, luck: 70, type: "bat" },
  "Kane Williamson": { bat: 88, bowl: 15, luck: 80, type: "bat" },
  "Shimron Hetmyer": { bat: 85, bowl: 5, luck: 85, type: "bat" },
  "Rovman Powell": { bat: 82, bowl: 15, luck: 80, type: "bat" },
  "Will Jacks": { bat: 85, bowl: 40, luck: 80, type: "bat" },
  "Steve Smith": { bat: 86, bowl: 10, luck: 75, type: "bat" },
  "Devon Conway": { bat: 89, bowl: 5, luck: 85, type: "bat" },
  "Daryl Mitchell": { bat: 86, bowl: 40, luck: 80, type: "bat" },
  "Jake Fraser-McGurk": { bat: 85, bowl: 5, luck: 85, type: "bat" },
  "Dewald Brevis": { bat: 80, bowl: 20, luck: 75, type: "bat" },
  "Tim David": { bat: 86, bowl: 10, luck: 85, type: "bat" },
  "Aiden Markram": { bat: 85, bowl: 40, luck: 80, type: "bat" },
  "Finn Allen": { bat: 83, bowl: 5, luck: 75, type: "bat" },
  "Rilee Rossouw": { bat: 84, bowl: 5, luck: 70, type: "bat" },
  "Sai Sudharsan": { bat: 85, bowl: 5, luck: 85, type: "bat" },
  "Tilak Varma": { bat: 86, bowl: 15, luck: 85, type: "bat" },
  "Shikhar Dhawan": { bat: 84, bowl: 5, luck: 80, type: "bat" },
  "Ajinkya Rahane": { bat: 80, bowl: 5, luck: 75, type: "bat" },
  "Prithvi Shaw": { bat: 82, bowl: 5, luck: 70, type: "bat" },
  "Venkatesh Iyer": { bat: 83, bowl: 40, luck: 80, type: "bat" },
  "Rajat Patidar": { bat: 84, bowl: 5, luck: 80, type: "bat" },
  "Nitish Rana": { bat: 82, bowl: 30, luck: 75, type: "bat" },
  "Rahul Tripathi": { bat: 81, bowl: 5, luck: 75, type: "bat" },
  "Shivam Dube": { bat: 88, bowl: 30, luck: 85, type: "bat" },
  "Manish Pandey": { bat: 78, bowl: 5, luck: 70, type: "bat" },
  "Abhishek Sharma": { bat: 86, bowl: 40, luck: 85, type: "bat" },

  // --- DOMESTIC BATSMEN ---
  "Sameer Rizvi": { bat: 78, bowl: 10, luck: 75, type: "bat" },
  "Angkrish Raghuvanshi": { bat: 78, bowl: 10, luck: 75, type: "bat" },
  "Ashutosh Sharma": { bat: 82, bowl: 5, luck: 85, type: "bat" },
  "Nehal Wadhera": { bat: 80, bowl: 15, luck: 80, type: "bat" },
  "Naman Dhir": { bat: 78, bowl: 40, luck: 75, type: "bat" },
  "Ayush Badoni": { bat: 80, bowl: 10, luck: 80, type: "bat" },
  "Yash Dhull": { bat: 76, bowl: 5, luck: 75, type: "bat" },
  "Sarfaraz Khan": { bat: 78, bowl: 5, luck: 75, type: "bat" },
  "Shashank Singh": { bat: 83, bowl: 10, luck: 85, type: "bat" },
  "Abdul Samad": { bat: 80, bowl: 15, luck: 80, type: "bat" },

  // --- WICKETKEEPERS ---
  "Rishabh Pant": { bat: 92, bowl: 0, luck: 88, type: "wk" },
  "MS Dhoni": { bat: 85, bowl: 0, luck: 99, type: "wk" },
  "Jos Buttler": { bat: 93, bowl: 0, luck: 88, type: "wk" },
  "Heinrich Klaasen": { bat: 94, bowl: 0, luck: 90, type: "wk" },
  "Sanju Samson": { bat: 90, bowl: 0, luck: 85, type: "wk" },
  "KL Rahul": { bat: 91, bowl: 0, luck: 85, type: "wk" },
  "Nicholas Pooran": { bat: 90, bowl: 0, luck: 85, type: "wk" },
  "Quinton de Kock": { bat: 89, bowl: 0, luck: 85, type: "wk" },
  "Phil Salt": { bat: 88, bowl: 0, luck: 80, type: "wk" },
  "Ishan Kishan": { bat: 87, bowl: 0, luck: 80, type: "wk" },
  "Jitesh Sharma": { bat: 82, bowl: 0, luck: 75, type: "wk" },
  "Dhruv Jurel": { bat: 80, bowl: 0, luck: 80, type: "wk" },
  "Dinesh Karthik": { bat: 85, bowl: 0, luck: 85, type: "wk" },
  "Jonny Bairstow": { bat: 90, bowl: 0, luck: 85, type: "wk" },
  "Rahmanullah Gurbaz": { bat: 84, bowl: 0, luck: 80, type: "wk" },
  "Josh Inglis": { bat: 85, bowl: 0, luck: 82, type: "wk" },
  "Shai Hope": { bat: 83, bowl: 0, luck: 80, type: "wk" },
  "Tristan Stubbs": { bat: 88, bowl: 15, luck: 85, type: "wk" },
  "Wriddhiman Saha": { bat: 82, bowl: 0, luck: 80, type: "wk" },
  "Anuj Rawat": { bat: 78, bowl: 0, luck: 75, type: "wk" },
  "Prabhsimran Singh": { bat: 84, bowl: 0, luck: 80, type: "wk" },
  "KS Bharat": { bat: 78, bowl: 0, luck: 75, type: "wk" },
  "Vishnu Vinod": { bat: 78, bowl: 0, luck: 75, type: "wk" },
  "Abishek Porel": { bat: 83, bowl: 0, luck: 80, type: "wk" },

  // --- ALL-ROUNDERS ---
  "Hardik Pandya": { bat: 88, bowl: 85, luck: 90, type: "ar" },
  "Ravindra Jadeja": { bat: 85, bowl: 88, luck: 90, type: "ar" },
  "Andre Russell": { bat: 92, bowl: 80, luck: 88, type: "ar" },
  "Glenn Maxwell": { bat: 90, bowl: 75, luck: 80, type: "ar" },
  "Cameron Green": { bat: 86, bowl: 80, luck: 85, type: "ar" },
  "Liam Livingstone": { bat: 87, bowl: 70, luck: 80, type: "ar" },
  "Sam Curran": { bat: 75, bowl: 85, luck: 85, type: "ar" },
  "Marcus Stoinis": { bat: 88, bowl: 70, luck: 85, type: "ar" },
  "Moeen Ali": { bat: 82, bowl: 75, luck: 80, type: "ar" },
  "Mitchell Marsh": { bat: 88, bowl: 75, luck: 82, type: "ar" },
  "Rachin Ravindra": { bat: 85, bowl: 70, luck: 82, type: "ar" },
  "Azmatullah Omarzai": { bat: 80, bowl: 78, luck: 78, type: "ar" },
  "Romario Shepherd": { bat: 82, bowl: 75, luck: 78, type: "ar" },
  "Mohammad Nabi": { bat: 80, bowl: 80, luck: 78, type: "ar" },
  "Jason Holder": { bat: 75, bowl: 82, luck: 75, type: "ar" },
  "Krunal Pandya": { bat: 78, bowl: 80, luck: 80, type: "ar" },
  "Deepak Hooda": { bat: 78, bowl: 30, luck: 75, type: "ar" },
  "Rahul Tewatia": { bat: 82, bowl: 40, luck: 90, type: "ar" },
  "Riyan Parag": { bat: 80, bowl: 40, luck: 75, type: "ar" },
  "Shahrukh Khan": { bat: 82, bowl: 10, luck: 78, type: "ar" },
  "Chris Woakes": { bat: 65, bowl: 85, luck: 82, type: "ar" },
  "Daniel Sams": { bat: 60, bowl: 82, luck: 80, type: "ar" },
  "Kyle Mayers": { bat: 85, bowl: 70, luck: 80, type: "ar" },
  "Vijay Shankar": { bat: 78, bowl: 60, luck: 75, type: "ar" },
  "Shahbaz Ahmed": { bat: 70, bowl: 78, luck: 80, type: "ar" },
  "Ramandeep Singh": { bat: 75, bowl: 65, luck: 78, type: "ar" },
  "Lalit Yadav": { bat: 72, bowl: 65, luck: 75, type: "ar" },
  "Musheer Khan": { bat: 76, bowl: 60, luck: 75, type: "ar" },
  "Mitchell Santner": { bat: 65, bowl: 86, luck: 85, type: "ar" },
  "Arjun Tendulkar": { bat: 40, bowl: 78, luck: 75, type: "ar" },

  // --- BOWLERS (PACERS) ---
  "Gerald Coetzee": { bat: 20, bowl: 85, luck: 85, type: "bowl" },
  "Lockie Ferguson": { bat: 20, bowl: 89, luck: 90, type: "bowl" },
  "Mark Wood": { bat: 20, bowl: 89, luck: 95, type: "bowl" },
  "Jasprit Bumrah": { bat: 20, bowl: 99, luck: 95, type: "bowl" },
  "Mitchell Starc": { bat: 30, bowl: 92, luck: 85, type: "bowl" },
  "Pat Cummins": { bat: 50, bowl: 90, luck: 90, type: "bowl" },
  "Mohammed Shami": { bat: 15, bowl: 91, luck: 85, type: "bowl" },
  "Trent Boult": { bat: 20, bowl: 90, luck: 88, type: "bowl" },
  "Kagiso Rabada": { bat: 25, bowl: 89, luck: 85, type: "bowl" },
  "Mohammed Siraj": { bat: 10, bowl: 88, luck: 82, type: "bowl" },
  "Arshdeep Singh": { bat: 10, bowl: 87, luck: 85, type: "bowl" },
  "Deepak Chahar": { bat: 30, bowl: 85, luck: 80, type: "bowl" },
  "Shardul Thakur": { bat: 40, bowl: 82, luck: 90, type: "bowl" },
  "Bhuvneshwar Kumar": { bat: 30, bowl: 85, luck: 80, type: "bowl" },
  "T Natarajan": { bat: 5, bowl: 86, luck: 80, type: "bowl" },
  "Mohit Sharma": { bat: 10, bowl: 85, luck: 85, type: "bowl" },
  "Anrich Nortje": { bat: 10, bowl: 88, luck: 80, type: "bowl" },
  "Josh Hazlewood": { bat: 15, bowl: 90, luck: 85, type: "bowl" },
  "Jofra Archer": { bat: 40, bowl: 90, luck: 80, type: "bowl" },
  "Matheesha Pathirana": { bat: 5, bowl: 89, luck: 85, type: "bowl" },
  "Marco Jansen": { bat: 65, bowl: 86, luck: 82, type: "bowl" },
  "Spencer Johnson": { bat: 20, bowl: 84, luck: 80, type: "bowl" },
  "Alzarri Joseph": { bat: 35, bowl: 85, luck: 80, type: "bowl" },
  "Dilshan Madushanka": { bat: 10, bowl: 84, luck: 80, type: "bowl" },
  "Nuwan Thushara": { bat: 10, bowl: 83, luck: 80, type: "bowl" },
  "Mustafizur Rahman": { bat: 10, bowl: 87, luck: 85, type: "bowl" },
  "Fazalhaq Farooqi": { bat: 10, bowl: 84, luck: 80, type: "bowl" },
  "Umesh Yadav": { bat: 30, bowl: 84, luck: 80, type: "bowl" },
  "Prasidh Krishna": { bat: 10, bowl: 86, luck: 82, type: "bowl" },
  "Avesh Khan": { bat: 15, bowl: 85, luck: 80, type: "bowl" },
  "Harshal Patel": { bat: 40, bowl: 88, luck: 88, type: "bowl" },
  "Khaleel Ahmed": { bat: 10, bowl: 86, luck: 82, type: "bowl" },
  "Mukesh Kumar": { bat: 10, bowl: 85, luck: 82, type: "bowl" },
  "Ishant Sharma": { bat: 20, bowl: 83, luck: 80, type: "bowl" },
  "Umran Malik": { bat: 10, bowl: 85, luck: 75, type: "bowl" },
  "Harshit Rana": { bat: 40, bowl: 84, luck: 85, type: "bowl" },
  "Mayank Yadav": { bat: 10, bowl: 88, luck: 85, type: "bowl" },
  "Yash Dayal": { bat: 10, bowl: 83, luck: 80, type: "bowl" },
  "Akash Madhwal": { bat: 10, bowl: 84, luck: 80, type: "bowl" },
  "Vidwath Kaverappa": { bat: 10, bowl: 80, luck: 75, type: "bowl" },
  "Tushar Deshpande": { bat: 15, bowl: 84, luck: 82, type: "bowl" },
  "Vaibhav Arora": { bat: 15, bowl: 82, luck: 80, type: "bowl" },
  "Yash Thakur": { bat: 10, bowl: 83, luck: 80, type: "bowl" },
  "Kartik Tyagi": { bat: 20, bowl: 82, luck: 75, type: "bowl" },
  "Chetan Sakariya": { bat: 20, bowl: 82, luck: 80, type: "bowl" },
  "Simarjeet Singh": { bat: 15, bowl: 82, luck: 75, type: "bowl" },

  // --- BOWLERS (SPINNERS) ---
  "Rashid Khan": { bat: 60, bowl: 96, luck: 92, type: "bowl" },
  "Yuzvendra Chahal": { bat: 5, bowl: 93, luck: 88, type: "bowl" },
  "Kuldeep Yadav": { bat: 10, bowl: 92, luck: 85, type: "bowl" },
  "Ravichandran Ashwin": { bat: 60, bowl: 88, luck: 90, type: "bowl" },
  "Axar Patel": { bat: 70, bowl: 89, luck: 85, type: "bowl" },
  "Ravi Bishnoi": { bat: 10, bowl: 87, luck: 85, type: "bowl" },
  "Varun Chakravarthy": { bat: 5, bowl: 88, luck: 80, type: "bowl" },
  "Sunil Narine": { bat: 80, bowl: 90, luck: 90, type: "bowl" },
  "Wanindu Hasaranga": { bat: 50, bowl: 90, luck: 85, type: "bowl" },
  "Maheesh Theekshana": { bat: 20, bowl: 86, luck: 80, type: "bowl" },
  "Adam Zampa": { bat: 10, bowl: 87, luck: 80, type: "bowl" },
  "Washington Sundar": { bat: 75, bowl: 82, luck: 80, type: "bowl" },
  "Mujeeb Ur Rahman": { bat: 20, bowl: 86, luck: 80, type: "bowl" },
  "Noor Ahmad": { bat: 15, bowl: 87, luck: 85, type: "bowl" },
  "Keshav Maharaj": { bat: 40, bowl: 85, luck: 80, type: "bowl" },
  "Adil Rashid": { bat: 30, bowl: 86, luck: 82, type: "bowl" },
  "Tabraiz Shamsi": { bat: 10, bowl: 85, luck: 80, type: "bowl" },
  "Rahul Chahar": { bat: 20, bowl: 84, luck: 80, type: "bowl" },
  "Amit Mishra": { bat: 25, bowl: 83, luck: 85, type: "bowl" },
  "Piyush Chawla": { bat: 35, bowl: 85, luck: 88, type: "bowl" },
  "Karn Sharma": { bat: 30, bowl: 82, luck: 80, type: "bowl" },
  "Mayank Markande": { bat: 20, bowl: 83, luck: 80, type: "bowl" },
  "R Sai Kishore": { bat: 25, bowl: 84, luck: 82, type: "bowl" },
  "Suyash Sharma": { bat: 5, bowl: 84, luck: 80, type: "bowl" },
  "Manimaran Siddharth": { bat: 10, bowl: 80, luck: 75, type: "bowl" },

  // Add more specific stats here if needed
};

const MARQUEE_PLAYERS = {
  batter: [
    { name: "Virat Kohli", type: "Indian" },
    { name: "Rohit Sharma", type: "Indian" },
    { name: "Shubman Gill", type: "Indian" },
    { name: "Suryakumar Yadav", type: "Indian" },
    { name: "Travis Head", type: "Foreign" },
    { name: "David Warner", type: "Foreign" },
    { name: "Faf du Plessis", type: "Foreign" },
    { name: "Yashasvi Jaiswal", type: "Indian" },
  ],
  bowler: [
    { name: "Jasprit Bumrah", type: "Indian" },
    { name: "Mitchell Starc", type: "Foreign" },
    { name: "Pat Cummins", type: "Foreign" },
    { name: "Mohammed Shami", type: "Indian" },
    { name: "Rashid Khan", type: "Foreign" },
    { name: "Trent Boult", type: "Foreign" },
    { name: "Kagiso Rabada", type: "Foreign" },
    { name: "Yuzvendra Chahal", type: "Indian" },
  ],
  allrounder: [
    { name: "Hardik Pandya", type: "Indian" },
    { name: "Ravindra Jadeja", type: "Indian" },
    { name: "Andre Russell", type: "Foreign" },
    { name: "Glenn Maxwell", type: "Foreign" },
  ],
  wicketkeeper: [
    { name: "Rishabh Pant", type: "Indian" },
    { name: "MS Dhoni", type: "Indian" },
    { name: "Jos Buttler", type: "Foreign" },
    { name: "Heinrich Klaasen", type: "Foreign" },
    { name: "Sanju Samson", type: "Indian" },
    { name: "KL Rahul", type: "Indian" },
    { name: "Nicholas Pooran", type: "Foreign" },
    { name: "Quinton de Kock", type: "Foreign" },
  ],
};

const RAW_DATA = {
  Batsmen: {
    foreign: [
      "David Miller",
      "Harry Brook",
      "Kane Williamson",
      "Shimron Hetmyer",
      "Rovman Powell",
      "Will Jacks",
      "Steve Smith",
      "Devon Conway",
      "Daryl Mitchell",
      "Jake Fraser-McGurk",
      "Dewald Brevis",
      "Tim David",
      "Aiden Markram",
      "Finn Allen",
      "Rilee Rossouw",
    ],
    indian: [
      "Shreyas Iyer",
      "Ruturaj Gaikwad",
      "Sai Sudharsan",
      "Tilak Varma",
      "Rinku Singh",
      "Shikhar Dhawan",
      "Ajinkya Rahane",
      "Prithvi Shaw",
      "Venkatesh Iyer",
      "Rajat Patidar",
      "Nitish Rana",
      "Rahul Tripathi",
      "Shivam Dube",
      "Manish Pandey",
      "Abhishek Sharma",
    ],
  },
  "Fast Bowlers": {
    foreign: [
      "Anrich Nortje",
      "Josh Hazlewood",
      "Jofra Archer",
      "Mark Wood",
      "Lockie Ferguson",
      "Matheesha Pathirana",
      "Gerald Coetzee",
      "Marco Jansen",
      "Spencer Johnson",
      "Alzarri Joseph",
      "Dilshan Madushanka",
      "Nuwan Thushara",
      "Mustafizur Rahman",
      "Fazalhaq Farooqi",
    ],
    indian: [
      "Mohammed Siraj",
      "Arshdeep Singh",
      "Deepak Chahar",
      "Shardul Thakur",
      "Bhuvneshwar Kumar",
      "T Natarajan",
      "Mohit Sharma",
      "Umesh Yadav",
      "Prasidh Krishna",
      "Avesh Khan",
      "Harshal Patel",
      "Khaleel Ahmed",
      "Mukesh Kumar",
      "Ishant Sharma",
      "Umran Malik",
      "Harshit Rana",
    ],
  },
  Spinners: {
    foreign: [
      "Sunil Narine",
      "Wanindu Hasaranga",
      "Maheesh Theekshana",
      "Adam Zampa",
      "Mujeeb Ur Rahman",
      "Noor Ahmad",
      "Mitchell Santner",
      "Keshav Maharaj",
      "Adil Rashid",
      "Tabraiz Shamsi",
    ],
    indian: [
      "Kuldeep Yadav",
      "Ravichandran Ashwin",
      "Axar Patel",
      "Ravi Bishnoi",
      "Varun Chakravarthy",
      "Washington Sundar",
      "Rahul Chahar",
      "Amit Mishra",
      "Piyush Chawla",
      "Karn Sharma",
      "Mayank Markande",
      "R Sai Kishore",
    ],
  },
  Wicketkeeper: {
    foreign: [
      "Phil Salt",
      "Jonny Bairstow",
      "Rahmanullah Gurbaz",
      "Josh Inglis",
      "Shai Hope",
      "Tristan Stubbs",
    ],
    indian: [
      "Ishan Kishan",
      "Jitesh Sharma",
      "Dhruv Jurel",
      "Dinesh Karthik",
      "Wriddhiman Saha",
      "Anuj Rawat",
      "Prabhsimran Singh",
      "KS Bharat",
      "Vishnu Vinod",
    ],
  },
  "All-rounders": {
    foreign: [
      "Cameron Green",
      "Liam Livingstone",
      "Sam Curran",
      "Marcus Stoinis",
      "Moeen Ali",
      "Mitchell Marsh",
      "Rachin Ravindra",
      "Azmatullah Omarzai",
      "Romario Shepherd",
      "Mohammad Nabi",
      "Jason Holder",
      "Chris Woakes",
      "Daniel Sams",
      "Kyle Mayers",
    ],
    indian: [
      "Krunal Pandya",
      "Deepak Hooda",
      "Rahul Tewatia",
      "Vijay Shankar",
      "Riyan Parag",
      "Shahrukh Khan",
      "Shahbaz Ahmed",
      "Ramandeep Singh",
      "Lalit Yadav",
    ],
  },
  Domestic: {
    batsmen: [
      "Sameer Rizvi",
      "Angkrish Raghuvanshi",
      "Ashutosh Sharma",
      "Nehal Wadhera",
      "Naman Dhir",
      "Abishek Porel",
      "Ayush Badoni",
      "Yash Dhull",
      "Sarfaraz Khan",
      "Musheer Khan",
      "Shashank Singh",
      "Abdul Samad",
    ],
    bowlers: [
      "Mayank Yadav",
      "Yash Dayal",
      "Akash Madhwal",
      "Vidwath Kaverappa",
      "Tushar Deshpande",
      "Vaibhav Arora",
      "Yash Thakur",
      "Kartik Tyagi",
      "Chetan Sakariya",
      "Simarjeet Singh",
      "Suyash Sharma",
      "Manimaran Siddharth",
      "Arjun Tendulkar",
    ],
  },
};

const PLAYER_IMAGE_MAP = {
  "David Warner":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRy2UoIz9RctCjtDw0iTDr9W8lq_jMqGo0JpQ&s",
  "Virat Kohli":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSXd7IOQ0NKyGMznUdvuNfPqT1PjyLLWs2PlA&s",
  "rohit sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ3sfdazCnce91FbLAu66M2aa49A2OJ_UfWRg&s",
  "rishabh pant":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR5UKPHZLy9Mb72EvFlbnmH6PA3ySNWbxvLWA&s",
  "kl rahul":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQs5YIL9kZU5kRl0nW4CMDXezaXSrn_7d1cWw&s",
  "jasprit bumrah":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSOhggyxRW4R8C5stRZeM6xF_-MLpKGeTTnNQ&s",
  "hardik pandya":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSMl97E5YCG_qhtODqspjhQbiVKdgkGSQoj2w&s",
  "axar patel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTZq-Wt00Pd8Olb3f8vzTE7ud9xeUv5yMcgsg&s",
  "rashid khan":
    "https://www.iplbetonline.in/wp-content/uploads/2023/04/218.png",
  "heinrich klaasen":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQiFL5rG_FgzbJjvdATUOQrhdsE90YPI4fuug&s",
  "sanju samson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8Xp0CvnGYY2QCwxVow7kvpP3ZTkzVus1MGg&s",
  "yashasvi jaiswal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTMMIlG4UCovEfziX_SI09qkf3_Cg2SX-P-Lg&s",
  "mitchell starc":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPGz1TkJbf1sCV4pLRxdmXi6-QqjDAV3EKbw&s",
  "nicholas pooran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQttQw5G5G4LV07_JzAAlJwQYzTiJHDO-7JRQ&s",
  "yuzvendra chahal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSl2t1XzBVcHqNBLVc1n75AaJd2-tcnk4g48g&s",
  "kuldeep yadav":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ3BdPeWcBfg_ShlOT1BJcl1uhXwd6_jWxBoA&s",
  "sai sudharsan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQYqNPZ_ROZnx8SiGAG9uWubwN7ghfjPq3XXA&s",
  "varun chakravarthy": "https://static.toiimg.com/photo/119129071.cms",
  "t natarajan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRqUl5j0TmK38vQvoxg9ngJVAUVhEzar1tT_w&s",
  "abhishek sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSvUeLIbFDGe9Whp3BX3CSqQ93dQoeZubgwBw&s",
  "mohammed shami":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTnFzvB9NG74q7rS8MjSW_zD1pBRBat5YDHmw&s",
  "daryl mitchell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQsC0r1IFYQLEPXhy2OtS1VJp07YA80CCcd8Q&s",
  "dewald brevis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRTQivnVww3TfhkuUmwYJZQuR6wroS0svAppA&s",
  "ms dhoni":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQlUHTyVfbyG3PgcyaRzLI_KE9HHqUqgrFIFQ&s",
  "suryakumar yadav":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHid9tiHpmtLTokHjhRy5N6vkVcxzL7thkeQ&s",
  "travis head":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQdPCSKpkwcuZDMlFoiDm3R3BAo1EzRtNdiPg&s",
  "ravindra jadeja":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRI8Z-1QJiEVn2_eCbhrW5MyXhUJn9HE2XdAA&s",
  "trent boult":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQIoXfsx5jBlVAr1H3fGk0S_c-0MNn-r-4o9Q&s",
  "arshdeep singh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRz9QMCpjUJj5Smz5WS0If_WXhC-9F2-Tvs3w&s",
  "glenn maxwell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTH8L43Zy6vc06DL4pDJKRxaazWyqeJFs_xdw&s",
  "sam curran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR-X04hvyAKngMVDfBpYVahZeB58Rb4ryXO0A&s",
  "krunal pandya":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRRTGdJoU_Hofobj-hU3tpyPMAKg_jtq9Lg1A&s",
  "romario shepherd":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQJvAy_9pMhWWvU7jvLjvq4IjAD_kluu7Kh2A&s",
  "aiden markram":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOajmONNd7d64dfVUFmUbVEsO3yPHHnAx8Yg&s",
  "liam livingstone":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTflymyT3ojb12YfLmIWYwvK7maoqsYvftyIw&s",
  "shivam dube":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGsxQpnbZyU0mtKlvBgnhPErZiGHehmb4YuA&s",
  "quinton de kock":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS1husYcqQxzXbB2jYZctsHKUO1r5KYMUxyrA&s",
  "dhruv jurel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZm_mMkVrBrfrY9bs0swEN5Td1hE-aRz9n2w&s",
  "jos buttler":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRJyXqCruiGYygsRkxwF7NIrT7IpAPR5fJJJA&s",
  "andre russell":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRiGYYt9ovNiRcFSjadP2AksRsd0Mdi1dNZDg&s",
  "ruturaj gaikwad":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSXGbBtm6R4GJT2j2ZxvROVEeV7UbrIuRDleA&s",
  "shubman gill":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRtakT_H1Gyp9KF85UHvLv0MjQbT0OXLJlsEQ&s",
  "shreyas iyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRO10-jV4zy9JtIxbWzRZiJagKzkYR4l507Cw&s",
  "tilak varma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTfMM-hv47GDNhi-6WrbcBfD-AUAPy0qnjSnw&s",
  "devon conway":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcREdCc6o0V15HYS4vv_HFww4fUehf5t9ByGxA&s",
  "devdatt padikal":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSAuY6qP02fFUlKZ4ld7Wrhm-alVVJeTcNv2A&s",
  "kane williamson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGpOxgmrjBEe7v76wwMov_YFuAoogFSrZ_zg&s",
  "will jacks":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR6J3WVvja_9EB2qJ8er90GqkEDTCGv5hQBag&s",
  "harry brook":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRAArvrYHQzYLSlOugAi6drdAg5IzIibCyjaw&s",
  "ibrahim zadran":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSS0O-R0JSfMt0maVI6v6OU1a0SSIj8ijeOnQ&s",
  "lockie ferguson":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQGQmTjuxXSYhQHZcRi9U8UlqMyYiYBLn2cBg&s",
  "josh hazlewood":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ-4ZjUwjHrvhukWLmMNoM2P69feAJ9zck9uQ&s",
  "harshit rana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQpcXQmpK-CbFtlnQnmCoN9FmPS3xbOGLwUDQ&s",
  "prasidh krishna":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOhgXERAAoBAuhwRRZf2wMWISXjnIYDlrEmA&s",
  "kagiso rabada":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxvidFiausg2Me1UfVNU7f1cx_jYsLdeUwaQ&s",
  "harshal patel":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQFgJDXgf0In2PO3Ie9mO4_8VjqwwRkRP2e8Q&s",
  "pat cummins":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS9nkSiV6jtCApLRnOFSKUAUQspjV5hpJOdBQ&s",
  "matheesha pathirana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR4TerGmA61_rrVaNBeBHejm5J60vzQs0rWTg&s",
  "mark wood":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT61NLgM2DT5tYUhLKRjLyylZzRbxc4wTb_3A&s",
  "mukesh kumar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS8hgsxXLIMkdEMRyqIzCMlnwpGjG2nKV1hGw&s",
  "anrich nortje":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQp_INFjiNgN1e9CgcoGSYEoHR7d863BrAEkg&s",
  "tushar deshpande":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ2chrGKb_zLMRCjpQh2rSEG6AewNxP5L3k7Q&s",
  "sunil narine":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRWsWXzcPF-5GJEEjgr9IaPPn-yCHMyZxCMqA&s",
  "wanindu hasaranga":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTOd5ea0dPuQ2Piq3gCg0k2XdaF810mFPWFoA&s",
  "mujeeb ur rahman":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTC9WDInYus_x1b86moJX9kYdTW3Le84sDrWg&s",
  "rahmanullah gurbaz":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRW2tuWnal4q-leOBRU4aWfcngk1NWbY04XnQ&s",
  "noor ahmad":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT4Aw3GMm7PPUQOM4Z1csrE8n5rxcfLZfu5sg&s",
  "maheesh theekshana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRprnzQmcBvOhfS1eqZHcporjcEYFWqQmVMnQ&s",
  "murugan ashwin":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZp4FDSxl5b3K9mouAdn5zJJ_cyrXQvhf0mg&s",
  "adam zampa":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQqVlUCngLKUeqaRirZaRWkeQIsEmHmoAIuqw&s",
  "mayank markande":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTAR6Wt6xq1oPl5upF_8CiXxmc37xT-CisXLw&s",
  "ravi bishnoi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQvLEQRAinM5V7CwTqzdau9AqiOC7erIisKw&s",
  "alex carey":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3fx9oUbwobdrMkbA2eWpUwzRWazNT3Sk1ug&s",
  "dinesh karthik":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRQ7EgmJkgCRpcfBrFV0CXGx6bIKjtk5wEeVQ&s",
  "jitesh sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTjeHFwIBbAbF_tpPcXNUp0-5D1LOANzxLxWA&s",
  "washington sundar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRkWDcgskNJH3SvDpogZ-QXE7WQnstEvuk8Kg&s",
  "riyan parag":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTNQGzq26UBlFu_dPv--OOFgCiyHBGTnqBumw&s",
  "nitish rana":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQJLQfDqFWetnMsl8WmFsRZhQBCLlDv7fiT1Q&s",
  "mitchell marsh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSctxL2Fnj4DdMI8wf84B8Zku6tdXqBMs3lrw&s",
  "tim david":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRFdb361FkQD3qyQTu2z9oqHQ7MJLXTKYuSsA&s",
  "cameron green":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR1x3cvTR2n1ab-W6LhAwKcyUuHUuDMqzMiSw&s",
  "marcus stoinis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS7TaJF3IIbU7FPkYCHT0j3LQGVrVhnzIDR7Q&s",
  "rinku singh":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQzbWiyOzr11AFN-yAzFYWzQmEu5F3JsRyRrw&s",
  "deepak hooda":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTF918ic4VnyxQvakJJsXT1OKmeBIuIkwKyhA&s",
  "rahul tewatia":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTeCWXJoDrKnXVVrV3IYBNhhrUwwBaOi_l5NA&s",
  "phil salt":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ6CRh_5YOiZaB_s-OO5w1z5AvBNEM0X-qDDw&s",
  "shahrukh khan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR8Xp0CvnGYY2QCwxVow7kvpP3ZTkzVus1MGg&s",
  "Faf du Plessis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRuw5WAznke_M1y83XWQl3WyTpj8mmvquREPA&s",
  "David Miller":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQZzfUcZmOT3vo7ucCn8zdlh3FTFcB0gs_t8w&s",
  "Shimron Hetmyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQHPHEGd-TGdia5MOHN8DEeNoQm5g4cMpx9SQ&s",
  "Jake Fraser-McGurk":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHbxIFZAqNHXoUfusHxX38_9EPuS5f4V_y6w&s",
  "Shikhar Dhawan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTmSJKeitXBUIzCdNM51xg6URHrI3QbqOijrw&s",
  "Ajinkya Rahane":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSOalqxPGHCV7hgvZXyVQB4xOHofBssMM1QWA&s",
  "Prithvi Shaw":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQO8FOcrG-t8xbjHLMkPJd2Z3PKYkD51LcuaQ&s",
  "Venkatesh Iyer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQxQXScapO97PkWzl-KejLhLg2U6BsTNrRfRA&s",
  "Rajat Patidar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJtqyJBHfsL7M4Vn9pthbqPEoSEPHP7IcTXg&s",
  "Manish Pandey":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTVwDd6V2GJLNk8EElhqC_Yj-W1DJ6130r64A&s",
  "Jofra Archer":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTo8gIuGKKIp3GOCRLEKfTeeWCn7c3FiwjUxQ&s",
  "Gerald Coetzee":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTB6jCTyyHld0Ac-GnphqAk9h-MgYs6y3OoDQ&s",
  "Marco Jansen":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTy_tiNO9KkLrz_axRUXa-4DGdut8N_5nWi-Q&s",
  "Mustafizur Rahman":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQOlM0BXEu-szyb97Gj6ORu1DfDYIosi_BCUg&s",
  "Fazalhaq Farooqi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTlD694z3N59mxkGYeLAM6YTJFHHvBNvU3ntQ&s",
  "Mohammed Siraj":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVAwAb_htAQ9WCy0gaJKmQJiPluMal9hNwLw&s",
  "Deepak Chahar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTHSk-8Xek9lTIVSC9tslRP0_Gxt6tU2QvEbg&s",
  "Shardul Thakur":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRHQBozbzAgGAzQ5JDOLRcr6YQkXoWM1eEyQg&s",
  "Bhuvneshwar Kumar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQT6Ikzu_k3_jaV12gy2td03yTJFJanJcNn-A&s",
  "Mohit Sharma":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQt9Q8umC9f5_f-8YyvFlqNxNZpKiQ00DqHnQ&s",
  "Khaleel Ahmed":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRPGM9mnxrIQvVNL5T5BJ5H0r1FLqCX2_56SA&s",
  "Mitchell Santner":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSyCFUEjnNWNYhNQWt2pVY-nraaeT7Xp5CLDw&s",
  "Ravichandran Ashwin":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTP-_GveSb4AACOwVRgOXYTISPvlt4XFaeNlg&s",
  "Rahul Chahar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRlgntjI0Wv5sx8A2bzstHCl7wMJW6pHv5tkw&s",
  "R Sai Kishore":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSyhgmmkhP8CIvTQRT-WwI-k1PVHzm1usIwHw&s",
  "Vijay Shankar":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRa0X4bPB_8GWQh2bnPVKLjLhMnCvuGpx0jUw&s",
  "Shahbaz Ahmed":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR_A8dTo3ziPjrxTsNrnMOdA0lIg1mKuQHIhg&s",
  "Moeen Ali":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRnblRwkKMZo2eRojywZhyIznpY6h-ct0LFog&s",
  "Rachin Ravindra":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcScrUYzDrJV6lwAh-h9ZKzBF72Dh-apAivglg&s",
  "Azmatullah Omarzai":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSI_vHDCuM1AWo_zEDwUbc_sG2I-4mJDlNgbw&s",
  "Mohammad Nabi":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRgPYEEBo2iJrQeUxClBQIq8ZA0cr6AryKh3g&s",
  "Jason Holder":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT949IOng4bWbSkMePYOjMBXKbOQKYkVsm95w&s",
  "Chris Woakes":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSdPCTRMrjZ4gtWa6kx7mhsUxOM_IXsDPQsNg&s",
  "Ishan Kishan":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRvI17T3mE31eNA35OSyvuvIVvtGLjlOYFLGw&s",
  "Wriddhiman Saha":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQLxziLIljwF5qLn-CsUtL1k5MFCOoz_fkL_Q&s",
  "Tristan Stubbs":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQgVBnKUGvBQjHnNvaw_A9lKO7c6MwP2EqHlQ&s",
  "Josh Inglis":
    "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ96_gVuW8JTbxirRPH9mVAjB59jbtQRt6UtQ&s",

  // Add other images
};

const ROLE_ORDER = {
  wk: 1,
  batter: 2,
  bat: 2,
  allrounder: 3,
  ar: 3,
  spinner: 4,
  spin: 4,
  fast: 5,
  pace: 5,
  bowler: 5,
  bowl: 5,
};

function getRolePriority(role) {
  return ROLE_ORDER[role.toLowerCase()] || 6;
}

function getRoleIcon(role) {
  role = role.toLowerCase();
  if (role === "wk") return "🧤";
  if (role === "batter" || role === "bat") return "🏏";
  if (role === "allrounder" || role === "ar") return "🏏⚾";
  if (role === "spinner" || role === "spin") return "🌪️";
  if (role.includes("fast") || role.includes("pace") || role === "bowl")
    return "⚡";
  if (role === "bowler") return "⚾";
  return "";
}

function formatAmount(amount) {
  if (typeof amount !== "number") return "₹-";
  if (amount >= 10000000)
    return "₹" + (amount / 10000000).toFixed(2).replace(/\.00$/, "") + " Cr";
  if (amount >= 100000)
    return "₹" + (amount / 100000).toFixed(1).replace(/\.0$/, "") + " L";
  return "₹" + amount.toLocaleString("en-IN");
}

function parsePrice(text) {
  if (!text || text === "₹-" || text === "") return 0;
  if (text.includes("Cr"))
    return parseFloat(text.replace("₹", "").replace(" Cr", "")) * 10000000;
  if (text.includes("L"))
    return parseFloat(text.replace("₹", "").replace(" L", "")) * 100000;
  return parseFloat(text.replace("₹", "").replace(/,/g, ""));
}

function logEvent(message, highlight = false) {
  const logEl = document.getElementById("log");
  if (!logEl) return;
  const div = document.createElement("div");
  div.className = highlight ? "text-warning mb-1" : "mb-1";
  div.innerHTML = `<span class="text-secondary me-2">[${new Date().toLocaleTimeString(
    "en-GB",
    { hour12: false }
  )}]</span> ${message}`;
  logEl.prepend(div);
}

function getPlayerStats(name, roleHint = "bat") {
  if (PLAYER_DATABASE[name]) {
    const data = PLAYER_DATABASE[name];
    return { bat: data.bat, bowl: data.bowl, luck: data.luck, role: data.type };
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const consistentRand = () => {
    let t = Math.sin(hash++) * 10000;
    return t - Math.floor(t);
  };
  const isBowler =
    roleHint.toLowerCase().includes("bowl") ||
    roleHint.toLowerCase().includes("fast") ||
    roleHint.toLowerCase().includes("spin");
  const isAllRounder = roleHint.toLowerCase().includes("all");
  let bat = 40 + Math.floor(consistentRand() * 40);
  let bowl = 10 + Math.floor(consistentRand() * 40);
  let luck = 50 + Math.floor(consistentRand() * 40);
  if (isBowler) {
    bat = 20 + Math.floor(consistentRand() * 30);
    bowl = 70 + Math.floor(consistentRand() * 20);
  }
  if (isAllRounder) {
    bat = 60 + Math.floor(consistentRand() * 25);
    bowl = 60 + Math.floor(consistentRand() * 25);
  }
  return { bat, bowl, luck, role: roleHint };
}

// --- DOM EVENT LISTENERS ---
document.getElementById("doCreateBtn").addEventListener("click", () => {
  if (!socketAlive)
    return (lobbyError.innerText = "Connection lost. Reconnecting...");
  const roomId = document.getElementById("createRoomId").value.toUpperCase();
  const pass = document.getElementById("createPass").value;
  const numTeams =
    parseInt(document.getElementById("teamCountSelect").value) || 10;
  if (!roomId || pass.length !== 4)
    return (lobbyError.innerText = "Invalid Details");
  socket.emit("create_room", {
    roomId,
    password: pass,
    config: { teamCount: numTeams },
  });
});

document.getElementById("doJoinBtn").addEventListener("click", () => {
  if (!socketAlive)
    return (lobbyError.innerText = "Connection lost. Reconnecting...");
  const roomId = document.getElementById("joinRoomId").value.toUpperCase();
  const pass = document.getElementById("joinPass").value;
  if (!roomId || pass.length !== 4)
    return (lobbyError.innerText = "Check Credentials");
  socket.emit("join_room", { roomId, password: pass });
});

socket.off("roomcreated");
socket.on("roomcreated", (roomId) => {
  isAdmin = true;
  enterGame(roomId);
  document.body.classList.add("is-admin");
  document.getElementById("waitingText").style.display = "none";
  document.getElementById("startBtn").style.display = "block";
  initLobbyState();
});

socket.off("room_joined");
socket.on("room_joined", (data) => {
  enterGame(data.roomId);
  isAdmin = data.isAdmin;
  if (isAdmin) {
    document.body.classList.add("is-admin");
    document.getElementById("waitingText").style.display = "none";
    // 🔧 NEW: NOTIFY ADMIN THAT THEY ARE BACK
    logEvent("✅ Admin privileges restored via IP check.", true);
  } else {
    document.body.classList.remove("is-admin");
    document.getElementById("startBtn").style.display = "none";
    document.getElementById("waitingText").style.display = "block";
  }

  if (data.lobbyState) {
    globalTeams = data.lobbyState.teams;
    connectedUsersCount = data.lobbyState.userCount;
    document.getElementById("joinedCount").innerText = connectedUsersCount;

    // Check localStorage first for visual consistency
    const savedTeamKey = localStorage.getItem(`ipl_team_${data.roomId}`);
    if (savedTeamKey) {
      socket.emit("reclaim_team", savedTeamKey);
    } else {
      // If server recognizes us via Auth ID, it might already assign us
      const myTeam = globalTeams.find((t) => t.ownerSocketId === socket.id);
      if (myTeam) mySelectedTeamKey = myTeam.bidKey;
    }
    renderLobbyTeams();
  }

  if (data.state && data.state.isActive) {
    switchToAuctionMode(data.state.teams);
    if (data.state.queue) auctionQueue = data.state.queue;
    socket.emit("request_sync");
  }
});

socket.off("sync_data");
socket.on("sync_data", (data) => {
  auctionQueue = data.queue;
  globalTeams = data.teams;
  updateTeamSidebar(globalTeams);

  if (data.currentLot) {
    const p = data.currentLot;
    currentActivePlayer = p;
    currentHighestBidderKey = data.currentBidder;

    document.getElementById("currentSet").innerText = p.set;
    document.getElementById("lotNoDisplay").innerText = `LOT #${
      data.auctionIndex + 1
    }`;
    document.getElementById("pName").innerText = p.name;
    document.getElementById("pCat").innerText = p.category;
    document.getElementById("pBase").innerText = formatAmount(p.basePrice);
    document.getElementById("pTypeBadge").innerText = p.roleKey.toUpperCase();

    const avatar = document.getElementById("pInitials");
    if (p.img) {
      avatar.innerText = "";
      avatar.style.backgroundImage = `url('${p.img}')`;
    } else {
      avatar.style.backgroundImage = "none";
      avatar.innerText = p.name.substring(0, 2).toUpperCase();
    }

    document.getElementById("pBid").innerText = formatAmount(data.currentBid);

    if (data.currentBidder) {
      const t = globalTeams.find((x) => x.bidKey === data.currentBidder);
      document.getElementById(
        "pTeam"
      ).innerHTML = `<span class="text-warning">${
        t ? t.name : "Unknown"
      }</span>`;
      document.getElementById("soldBtn").disabled = false;
    } else {
      document.getElementById(
        "pTeam"
      ).innerHTML = `<span class="text-white-50">Opening Bid</span>`;
      document.getElementById("soldBtn").disabled = true;
    }

    const bidBtn = document.getElementById("placeBidBtn");
    if (currentHighestBidderKey === mySelectedTeamKey) {
      bidBtn.disabled = true;
      bidBtn.innerHTML = `WINNING <i class="bi bi-check-circle"></i>`;
      bidBtn.style.background = "#333";
      bidBtn.style.color = "#888";
    } else {
      bidBtn.disabled = false;
      const increment =
        parseInt(document.getElementById("customBidInput").value) ||
        p.incrementStep;
      const nextBid = data.currentBid + increment;
      bidBtn.innerHTML = `BID ${formatAmount(
        nextBid
      )} <i class="bi bi-hammer"></i>`;
      bidBtn.style.background = "";
      bidBtn.style.color = "";
    }

    const timerEl = document.getElementById("auctionTimer");
    timerEl.innerText = data.timer;
    if (data.timerPaused) {
      timerEl.classList.add("timer-paused");
      if (isAdmin) updatePauseButtonState(true);
    } else {
      timerEl.classList.remove("timer-paused");
    }
    updateBidControlsState(p);
  }
});

socket.off("error_message");
socket.on("error_message", (msg) => (lobbyError.innerText = msg));

function enterGame(roomId) {
  myRoomId = roomId;
  document.getElementById("currentRoomDisplay").innerText = roomId;
  lobbyScreen.style.display = "none";
  gameContainer.style.display = "block";
  document.getElementById("setupSection").style.display = "flex";
}

function initLobbyState() {
  const count = parseInt(document.getElementById("teamCountSelect").value);
  globalTeams = [];
  const defaultIPLNames = [
    "CSK",
    "MI",
    "RCB",
    "LSG",
    "SRH",
    "DC",
    "GT",
    "RR",
    "KKR",
    "PBKS",
  ];
  for (let i = 0; i < count; i++) {
    const defName =
      i < defaultIPLNames.length ? defaultIPLNames[i] : `Team ${i + 1}`;
    globalTeams.push({
      id: i,
      bidKey: `T${i}`,
      name: defName,
      ownerSocketId: null,
      budget: parseInt(document.getElementById("budget").value),
      isTaken: false,
    });
  }
  socket.emit("update_lobby_teams", globalTeams);
  renderLobbyTeams();
}

document.getElementById("teamCountSelect").addEventListener("change", () => {
  if (isAdmin) initLobbyState();
});

function renderLobbyTeams() {
  const container = document.getElementById("teamNamesContainer");
  container.innerHTML = "";
  const iHaveATeam = mySelectedTeamKey !== null;

  globalTeams.forEach((t) => {
    let isMyTeam = t.bidKey === mySelectedTeamKey;
    let statusClass,
      statusText,
      clickAction = "";

    if (t.isTaken) {
      if (isMyTeam) {
        statusClass = "my-choice";
        statusText = "YOUR TEAM";
      } else {
        statusClass = "taken";
        statusText = "TAKEN";
      }
    } else {
      statusClass = "available";
      statusText = "CLICK TO JOIN";
      if (iHaveATeam) {
        clickAction = `onclick="alert('You have already joined a team! You cannot join multiple teams.')" style="cursor: not-allowed; opacity: 0.5;"`;
      } else {
        clickAction = `onclick="claimLobbyTeam('${t.bidKey}')"`;
      }
    }

    let nameInput = isAdmin
      ? `<input type="text" class="form-control form-control-sm text-center bg-dark text-white border-secondary" value="${t.name}" onchange="adminRenameTeam('${t.bidKey}', this.value)">`
      : `<div class="fs-4 fw-bold text-white">${t.name}</div>`;

    container.innerHTML += `<div class="lobby-team-card ${statusClass}" ${clickAction}><span class="lobby-status-badge ${
      statusClass === "available"
        ? "bg-success"
        : statusClass === "my-choice"
        ? "bg-warning text-dark"
        : "bg-danger"
    }">${statusText}</span>${nameInput}<div class="small text-white-50">Budget: ${formatAmount(
      t.budget
    )}</div></div>`;
  });

  if (isAdmin) {
    const startBtn = document.getElementById("startBtn");
    const takenCount = globalTeams.filter((t) => t.isTaken).length;
    startBtn.disabled = takenCount < 2;
    startBtn.innerText =
      takenCount < 2 ? "WAITING FOR PLAYERS" : "START AUCTION";
    if (takenCount >= 2) {
      startBtn.classList.remove("btn-secondary");
      startBtn.classList.add("btn-gold");
    }
  }
}

function claimLobbyTeam(key) {
  if (mySelectedTeamKey) {
    alert("You have already joined a team! You cannot join multiple teams.");
    return;
  }
  socket.emit("claim_lobby_team", key);
}

function adminRenameTeam(key, newName) {
  socket.emit("admin_rename_team", { key, newName });
}

socket.off("lobby_update");
socket.on("lobby_update", (data) => {
  globalTeams = data.teams;
  connectedUsersCount = data.userCount;
  document.getElementById("joinedCount").innerText = connectedUsersCount;
  renderLobbyTeams();
});

socket.off("team_claim_success");
socket.on("team_claim_success", (key) => {
  mySelectedTeamKey = key;
  if (myRoomId) localStorage.setItem(`ipl_team_${myRoomId}`, key);
  renderLobbyTeams();
  // 🔧 NEW: VISUAL FEEDBACK FOR TEAM RESTORE
  logEvent("✅ Team ownership restored successfully!", true);
});

function buildAuctionQueue() {
  const queue = [];
  const shuffle = (array) => array.sort(() => Math.random() - 0.5);

  const createPlayer = (dataObj, setName, roleHint, basePrice, increment) => {
    let name, type;
    if (typeof dataObj === "object" && dataObj.name) {
      name = dataObj.name;
      type = dataObj.type;
    } else {
      name = dataObj;
      type = "Unknown";
    }
    const stats = getPlayerStats(name, roleHint);
    const imageSrc =
      PLAYER_IMAGE_MAP[name] || PLAYER_IMAGE_MAP[name.toLowerCase()] || null;

    return {
      name,
      category: `${type} ${roleHint}`,
      roleKey: roleHint.toLowerCase(),
      basePrice,
      incrementStep: increment,
      set: setName,
      img: imageSrc,
      stats: stats,
      playerType: type,
      isProcessed: false,
      status: null,
    };
  };

  const marqueeBat = MARQUEE_PLAYERS.batter.map((p) =>
    createPlayer(p, "Marquee Set (Bat)", "batter", 20000000, 2500000)
  );
  const marqueeBowl = MARQUEE_PLAYERS.bowler.map((p) =>
    createPlayer(p, "Marquee Set (Bowl)", "bowler", 20000000, 2500000)
  );
  const marqueeAR = MARQUEE_PLAYERS.allrounder.map((p) =>
    createPlayer(p, "Marquee Set (AR)", "allrounder", 20000000, 2500000)
  );
  const marqueeWK = MARQUEE_PLAYERS.wicketkeeper.map((p) =>
    createPlayer(p, "Marquee Set (WK)", "wk", 20000000, 2500000)
  );

  queue.push(
    ...shuffle([...marqueeBat, ...marqueeBowl, ...marqueeAR, ...marqueeWK])
  );

  const processCategory = (categoryName, roleName, foreignList, indianList) => {
    const f = foreignList.map((n) =>
      createPlayer(
        { name: n, type: "Foreign" },
        `${categoryName} (Foreign)`,
        roleName,
        15000000,
        2500000
      )
    );
    const i = indianList.map((n) =>
      createPlayer(
        { name: n, type: "Indian" },
        `${categoryName} (Indian)`,
        roleName,
        10000000,
        2500000
      )
    );
    return shuffle([...f, ...i]);
  };

  queue.push(
    ...processCategory(
      "Batters",
      "batter",
      RAW_DATA["Batsmen"].foreign,
      RAW_DATA["Batsmen"].indian
    )
  );
  queue.push(
    ...processCategory(
      "All-Rounders",
      "allrounder",
      RAW_DATA["All-rounders"].foreign,
      RAW_DATA["All-rounders"].indian
    )
  );
  queue.push(
    ...processCategory(
      "Wicketkeepers",
      "wk",
      RAW_DATA["Wicketkeeper"].foreign,
      RAW_DATA["Wicketkeeper"].indian
    )
  );
  queue.push(
    ...processCategory(
      "Fast Bowlers",
      "fast",
      RAW_DATA["Fast Bowlers"].foreign,
      RAW_DATA["Fast Bowlers"].indian
    )
  );
  queue.push(
    ...processCategory(
      "Spinners",
      "spinner",
      RAW_DATA["Spinners"].foreign,
      RAW_DATA["Spinners"].indian
    )
  );

  const domBat = RAW_DATA["Domestic"].batsmen.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "batter",
      2500000,
      500000
    )
  );
  const domBowl = RAW_DATA["Domestic"].bowlers.map((n) =>
    createPlayer(
      { name: n, type: "Uncapped" },
      "Domestic Set",
      "bowler",
      2500000,
      500000
    )
  );
  queue.push(...shuffle([...domBat, ...domBowl]));

  return queue;
}

document.getElementById("startBtn").addEventListener("click", () => {
  if (!isAdmin) return;
  auctionQueue = buildAuctionQueue();
  socket.emit("start_auction", { teams: globalTeams, queue: auctionQueue });
});

socket.off("auction_started");
socket.on("auction_started", (data) => {
  switchToAuctionMode(data.teams);
  auctionQueue = data.queue;
  auctionStarted = true;
  logEvent(`<strong>AUCTION STARTED</strong>`, true);
});

function setupBidControls() {
  const inputContainer = document.querySelector(".input-group");
  if (inputContainer) {
    inputContainer.className = "d-flex align-items-center gap-2";
    inputContainer.style.maxWidth = "250px";
    const oldSpan = inputContainer.querySelector("span");
    if (oldSpan) oldSpan.remove();

    inputContainer.innerHTML = `
            <div class="flex-grow-1">
                <div class="small text-center text-white-50" style="font-size: 0.6rem; letter-spacing:1px;">INCREMENT</div>
                <input type="number" id="customBidInput" class="form-control bg-dark text-warning border-secondary fw-bold text-center p-0 display-font fs-4" value="2500000" readonly style="height: 35px;">
            </div>
            <button id="incBidBtn" class="btn btn-outline-success fw-bold" style="height: 45px; width: 45px; border-radius: 8px;">+</button>
        `;
    document
      .getElementById("incBidBtn")
      .addEventListener("click", () => adjustIncrement(true));
  }
}

function adjustIncrement(isIncrease) {
  const input = document.getElementById("customBidInput");
  let val = parseInt(input.value);
  const step = 2500000;
  if (isIncrease) val += step;
  input.value = val;
  const bidBtn = document.getElementById("placeBidBtn");
  if (bidBtn && !bidBtn.disabled) {
    let currentPrice = parsePrice(document.getElementById("pBid").innerText);
    if (document.getElementById("pBid").innerText.includes("-"))
      currentPrice = currentActivePlayer.basePrice - val;
    if (currentPrice < 0) currentPrice = 0;
    const nextPrice = currentPrice + val;
    bidBtn.innerHTML = `BID ${formatAmount(
      nextPrice
    )} <i class="bi bi-hammer"></i>`;
  }
}

function updateBidControlsState(player) {
  const input = document.getElementById("customBidInput");
  if (input) input.value = player.incrementStep;
}

function switchToAuctionMode(teams) {
  globalTeams = teams;
  document.getElementById("setupSection").style.display = "none";
  document.getElementById("auctionDashboard").style.display = "flex";
  updateTeamSidebar(teams);
  setupBidControls();
}

socket.off("update_lot");
socket.on("update_lot", (data) => {
  const p = data.player;
  currentActivePlayer = p;
  saleProcessing = false;
  document.getElementById("currentSet").innerText = p.set;
  document.getElementById("lotNoDisplay").innerText = `LOT #${data.lotNumber
    .toString()
    .padStart(3, "0")}`;
  document.getElementById("pName").innerText = p.name;
  document.getElementById("pCat").innerText = p.category;
  document.getElementById("pBase").innerText = formatAmount(p.basePrice);
  document.getElementById("pTypeBadge").innerText = p.roleKey.toUpperCase();

  const timerEl = document.getElementById("auctionTimer");
  timerEl.innerText = "10";
  timerEl.classList.remove("timer-danger", "timer-paused");

  document.getElementById("skipBtn").disabled = false;
  document.getElementById("soldBtn").disabled = true;

  const avatar = document.getElementById("pInitials");
  if (p.img) {
    avatar.innerText = "";
    avatar.style.backgroundImage = `url('${p.img}')`;
  } else {
    avatar.style.backgroundImage = "none";
    avatar.innerText = p.name.substring(0, 2).toUpperCase();
  }

  document.getElementById("pBid").innerText = formatAmount(data.currentBid);
  document.getElementById(
    "pTeam"
  ).innerHTML = `<span class="text-white-50">Opening Bid</span>`;
  currentHighestBidderKey = null;

  const bidBtn = document.getElementById("placeBidBtn");
  bidBtn.disabled = false;
  updateBidControlsState(p);

  const initialInc = parseInt(document.getElementById("customBidInput").value);
  bidBtn.innerHTML = `BID (+${formatAmount(
    initialInc
  )}) <i class="bi bi-hammer"></i>`;
  bidBtn.style.background = "";
  bidBtn.style.color = "";

  updateTeamSidebar(globalTeams);
  logEvent(`<strong>LOT UP:</strong> ${p.name}`, true);
});

socket.off("bid_update");
socket.on("bid_update", (data) => {
  const bidEl = document.getElementById("pBid");
  bidEl.innerText = formatAmount(data.amount);
  bidEl.classList.add("price-pulse");
  setTimeout(() => bidEl.classList.remove("price-pulse"), 200);

  document.getElementById(
    "pTeam"
  ).innerHTML = `<span class="text-warning">${data.team.name}</span>`;
  currentHighestBidderKey = data.team.bidKey;

  document.getElementById("skipBtn").disabled = true;
  document.getElementById("soldBtn").disabled = false;

  const timerEl = document.getElementById("auctionTimer");
  timerEl.innerText = "10";
  timerEl.classList.remove("timer-danger");

  if (currentActivePlayer) {
    const input = document.getElementById("customBidInput");
    if (input) input.value = currentActivePlayer.incrementStep;
  }

  const bidBtn = document.getElementById("placeBidBtn");
  if (currentHighestBidderKey === mySelectedTeamKey) {
    bidBtn.disabled = true;
    bidBtn.innerHTML = `WINNING <i class="bi bi-check-circle"></i>`;
    bidBtn.style.background = "#333";
    bidBtn.style.color = "#888";
  } else {
    bidBtn.disabled = false;
    const inc = parseInt(document.getElementById("customBidInput").value);
    const nextBid = data.amount + inc;
    bidBtn.innerHTML = `BID ${formatAmount(
      nextBid
    )} <i class="bi bi-hammer"></i>`;
    bidBtn.style.background = "";
    bidBtn.style.color = "";
  }
  updateTeamSidebar(globalTeams);
  logEvent(`${data.team.name} bids ${formatAmount(data.amount)}`);
});

function submitMyBid() {
  if (!socketAlive) return alert("Connection lost. Please wait…");
  if (
    !auctionStarted ||
    document.getElementById("saleOverlay").classList.contains("overlay-active")
  )
    return;
  if (currentHighestBidderKey === mySelectedTeamKey) return;
  if (!mySelectedTeamKey) return alert("You don't have a team!");
  if (!currentActivePlayer) return;

  let currentPrice = parsePrice(document.getElementById("pBid").innerText);
  const inc = parseInt(document.getElementById("customBidInput").value);

  if (document.getElementById("pBid").innerText === "₹-") {
    currentPrice = currentActivePlayer.basePrice;
  } else {
    currentPrice += inc;
  }

  const myTeamObj = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  socket.emit("place_bid", {
    teamKey: mySelectedTeamKey,
    teamName: myTeamObj.name,
    amount: currentPrice,
  });
}

document.getElementById("placeBidBtn").addEventListener("click", submitMyBid);
document.addEventListener("keydown", (e) => {
  if (lobbyScreen.style.display !== "none") return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    submitMyBid();
  }
});

socket.off("timer_tick");
socket.on("timer_tick", (val) => {
  const timerEl = document.getElementById("auctionTimer");
  if (timerEl) {
    timerEl.innerText = val;
    timerEl.classList.remove("timer-paused", "timer-danger");
    if (val <= 3) timerEl.classList.add("timer-danger");
  }
});

socket.off("timer_status");
socket.on("timer_status", (isPaused) => {
  const timerEl = document.getElementById("auctionTimer");
  if (isAdmin) updatePauseButtonState(isPaused);
  if (timerEl)
    isPaused
      ? timerEl.classList.add("timer-paused")
      : timerEl.classList.remove("timer-paused");
});

socket.off("timer_ended");
socket.on("timer_ended", () => {
  const timerEl = document.getElementById("auctionTimer");
  if (timerEl) {
    timerEl.innerText = "0";
    timerEl.classList.add("timer-danger");
  }
});

socket.off("sale_finalized");
socket.on("sale_finalized", (data) => {
  globalTeams = data.updatedTeams;
  const pIndex = auctionQueue.findIndex((p) => p.name === data.soldPlayer.name);
  if (pIndex > -1) {
    auctionQueue[pIndex].status = data.isUnsold ? "UNSOLD" : "SOLD";
    auctionQueue[pIndex].soldPrice = data.price;
  }

  const overlay = document.getElementById("saleOverlay");
  const stamp = document.getElementById("finalStamp");

  document.getElementById("soldPlayerName").innerText = data.soldPlayer.name;
  document.getElementById("soldPlayerRole").innerText =
    data.soldPlayer.roleKey.toUpperCase();
  document.getElementById("soldPlayerImg").src = data.soldPlayer.img || "";

  if (!data.isUnsold) {
    logEvent(
      `<strong>SOLD:</strong> ${data.soldPlayer.name} to ${data.soldDetails.soldTeam}`,
      true
    );
    document.getElementById("soldToSection").style.display = "block";
    document.getElementById("soldPriceSection").style.display = "block";
    document.getElementById("soldTeamName").innerText =
      data.soldDetails.soldTeam;
    document.getElementById("soldFinalPrice").innerText = formatAmount(
      data.price
    );
    stamp.innerText = "SOLD";
    stamp.className = "stamp-overlay";
  } else {
    logEvent(`<strong>UNSOLD:</strong> ${data.soldPlayer.name}`, true);
    document.getElementById("soldToSection").style.display = "none";
    document.getElementById("soldPriceSection").style.display = "none";
    stamp.innerText = "UNSOLD";
    stamp.className = "stamp-overlay unsold-stamp";
  }
  updateTeamSidebar(globalTeams);
  overlay.classList.add("overlay-active");

  setTimeout(() => {
    overlay.classList.remove("overlay-active");
  }, 3500);
});

// ======================================================
// 🔧 UPDATED TEAM SIDEBAR (FIXED FOR MOBILE + STATS)
// ======================================================
function updateTeamSidebar(teams) {
  const container = document.getElementById("teams");
  const isMobile = window.innerWidth <= 768; // Mobile check

  // 1. Create cards if they don't exist
  if (container.children.length !== teams.length) {
    container.innerHTML = "";
    teams.forEach((t) => {
      const isMine = mySelectedTeamKey === t.bidKey;

      const card = document.createElement("div");
      card.id = `team-card-${t.bidKey}`;
      card.className = "franchise-card";
      if (isMine) card.classList.add("my-team");

      // --- MOBILE-OPTIMIZED CARD HTML ---
      card.innerHTML = `
                <div class="f-header">
                    <div class="f-name text-white text-truncate" style="max-width: 120px;">
                        ${t.name} ${
        isMine ? '<i class="bi bi-person-fill text-success"></i>' : ""
      }
                    </div>
                    <div class="f-budget">${formatAmount(t.budget)}</div> 
                </div>

                <div class="mobile-squad-info" style="display: ${
                  isMobile ? "block" : "none"
                }; font-size: 0.7rem; color: #aaa; margin-top: 4px;">
                    SQUAD: <span class="sq-count">0</span>/25
                    <div class="mobile-progress-bar" style="height: 4px; background: #333; margin-top: 2px; border-radius: 2px;">
                        <div class="sq-progress" style="width: 0%; height: 100%; background: #00E676;"></div>
                    </div>
                </div>

                <div class="f-stats-grid" style="display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.7rem; color: #888;">
                    <div class="f-stat-item">
                        <div class="f-stat-label">Ply</div>
                        <div class="f-stat-value sq-val">0</div>
                    </div>
                    <div class="f-stat-item">
                        <div class="f-stat-label">Frgn</div>
                        <div class="f-stat-value frgn-val">0</div>
                    </div>
                    <div class="f-stat-item">
                        <div class="f-stat-label">RTM</div>
                        <div class="f-stat-value rtm-val">0</div>
                    </div>
                </div>
            `;
      container.appendChild(card);
    });
  }

  // 2. Update dynamic data for existing cards
  teams.forEach((t) => {
    const card = document.getElementById(`team-card-${t.bidKey}`);
    if (!card) return;

    const isHighest = currentHighestBidderKey === t.bidKey;

    // Toggle Active Bidder Styling
    if (isHighest) card.classList.add("active-bidder");
    else card.classList.remove("active-bidder");

    // Calculate Stats
    const squadCount = t.roster ? t.roster.length : 0;
    const foreignCount = t.roster
      ? t.roster.filter((p) => p.playerType === "Foreign").length
      : 0;
    const rtmCount = t.rtmsUsed || 0;

    // Update Text & Bars
    card.querySelector(".f-budget").innerText = formatAmount(t.budget);

    // Update Stats values
    const sqCountEl = card.querySelector(".sq-count");
    if (sqCountEl) sqCountEl.innerText = squadCount;

    const sqProgEl = card.querySelector(".sq-progress");
    if (sqProgEl) sqProgEl.style.width = `${(squadCount / 25) * 100}%`;

    // Update Grid Stats
    card.querySelector(".sq-val").innerText = squadCount;
    card.querySelector(".frgn-val").innerText = foreignCount;
    card.querySelector(".rtm-val").innerText = rtmCount;
  });
}

document.getElementById("soldBtn").addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  if (!currentHighestBidderKey) return alert("No active bidder!");
  saleProcessing = true;
  let price = parsePrice(document.getElementById("pBid").innerText);
  socket.emit("finalize_sale", {
    isUnsold: false,
    soldTo: { bidKey: currentHighestBidderKey },
    price: price,
  });
});

document.getElementById("skipBtn").addEventListener("click", () => {
  if (!isAdmin || saleProcessing) return;
  saleProcessing = true;
  socket.emit("finalize_sale", { isUnsold: true });
});

document
  .getElementById("timerToggleBtn")
  .addEventListener("click", () => isAdmin && socket.emit("toggle_timer"));
document
  .getElementById("endAuctionBtn")
  .addEventListener(
    "click",
    () =>
      isAdmin && confirm("End Auction?") && socket.emit("end_auction_trigger")
  );

function updatePauseButtonState(isPaused) {
  const btn = document.getElementById("timerToggleBtn");
  btn.innerHTML = isPaused
    ? '<i class="bi bi-play-fill"></i>'
    : '<i class="bi bi-pause-fill"></i>';
  btn.className = isPaused
    ? "btn-custom btn-action text-success border-success"
    : "btn-custom btn-action text-warning border-warning";
}

let mySelectedSquad11 = [];
let mySelectedImpact = null;
let mySelectedCaptain = null;

socket.off("open_squad_selection");
socket.on("open_squad_selection", () => {
  document
    .getElementById("squadSelectionScreen")
    .classList.add("overlay-active");
  renderMySquadSelection();
});

function countForeigners(list) {
  return list.filter((p) => p.playerType === "Foreign").length;
}

function countKeepers(list) {
  return list.filter((p) => p.roleKey === "wk").length;
}

function renderMySquadSelection() {
  const myTeam = globalTeams.find((t) => t.bidKey === mySelectedTeamKey);
  const list = document.getElementById("playing11List");
  const impList = document.getElementById("impactList");
  list.innerHTML = "";
  impList.innerHTML = "";

  if (!myTeam || !myTeam.roster || myTeam.roster.length === 0)
    return (list.innerHTML =
      "<div class='text-white-50 text-center mt-5'>No players bought!</div>");

  const sortedRoster = [...myTeam.roster].sort(
    (a, b) => getRolePriority(a.roleKey) - getRolePriority(b.roleKey)
  );

  sortedRoster.forEach((p, i) => {
    const originalIndex = myTeam.roster.findIndex((x) => x.name === p.name);
    const isForeign = p.playerType === "Foreign";
    const badge = isForeign
      ? '<span class="badge bg-danger ms-2" style="font-size:0.6rem">✈️</span>'
      : "";
    const roleIcon = getRoleIcon(p.roleKey);

    const isSelected = mySelectedSquad11.find((x) => x.name === p.name);
    const isCapt = mySelectedCaptain === p.name;
    const num = isSelected ? mySelectedSquad11.indexOf(isSelected) + 1 : "";

    const captainBtn = isSelected
      ? `<button class="btn btn-sm ${
          isCapt ? "btn-warning" : "btn-outline-secondary"
        } ms-2 rounded-circle" style="width:30px;height:30px;padding:0;" onclick="event.stopPropagation(); setCaptain('${
          p.name
        }')">C</button>`
      : "";

    list.innerHTML += `
                <div class="player-check-card p11-card" id="p11-${originalIndex}" onclick="toggleP11(${originalIndex}, '${p.name}')">
                    <span class="squad-number">${num}</span>
                    <div class="fw-bold text-white flex-grow-1">${p.name} <span class="role-icon">${roleIcon}</span> ${badge}</div>
                    ${captainBtn}
                </div>`;

    impList.innerHTML += `<div class="player-check-card impact-card" id="imp-${originalIndex}" onclick="toggleImpact(${originalIndex}, '${p.name}')"><div class="fw-bold text-white flex-grow-1">${p.name} <span class="role-icon">${roleIcon}</span> ${badge}</div></div>`;
  });
  updateSquadUI();
}

function toggleP11(i, name) {
  const p = globalTeams.find((t) => t.bidKey === mySelectedTeamKey).roster[i];
  if (mySelectedImpact && mySelectedImpact.name === name)
    return alert("Already Impact Player");

  const idx = mySelectedSquad11.findIndex((x) => x.name === name);
  if (idx > -1) {
    mySelectedSquad11.splice(idx, 1);
    if (mySelectedCaptain === name) mySelectedCaptain = null;
  } else {
    if (mySelectedSquad11.length >= 11) return alert("Max 11 Players");
    const currentForeignCount = countForeigners(mySelectedSquad11);
    if (p.playerType === "Foreign" && currentForeignCount >= 4) {
      return alert("MAX 4 FOREIGN PLAYERS ALLOWED IN PLAYING XI!");
    }
    mySelectedSquad11.push(p);
  }
  renderMySquadSelection();
}

function toggleImpact(i, name) {
  const p = globalTeams.find((t) => t.bidKey === mySelectedTeamKey).roster[i];
  if (mySelectedSquad11.find((x) => x.name === name))
    return alert("Already in Playing XI");
  mySelectedImpact =
    mySelectedImpact && mySelectedImpact.name === name ? null : p;
  renderMySquadSelection();
}

function setCaptain(name) {
  mySelectedCaptain = name;
  renderMySquadSelection();
}

function updateSquadUI() {
  document.querySelectorAll(".p11-card").forEach((e) => {
    if (e.querySelector(".squad-number").innerText !== "")
      e.classList.add("checked");
    else e.classList.remove("checked");
  });
  document.querySelectorAll(".impact-card").forEach((e) => {
    if (mySelectedImpact && e.innerHTML.includes(mySelectedImpact.name))
      e.classList.add("checked");
    else e.classList.remove("checked");
  });

  const fCount = countForeigners(mySelectedSquad11);
  const fColor = fCount > 4 ? "text-danger" : "text-white-50";
  const wkCount = countKeepers(mySelectedSquad11);
  const wkColor = wkCount < 1 ? "text-danger" : "text-white-50";

  document.getElementById(
    "p11Count"
  ).innerText = `${mySelectedSquad11.length}/11 Selected`;
  document.getElementById(
    "foreignCountDisplay"
  ).innerHTML = `<span class="${fColor}">Foreign: ${fCount}/4</span>`;
  document.getElementById(
    "wkCountDisplay"
  ).innerHTML = `<span class="${wkColor}">WK: ${wkCount}/1</span>`;
  document.getElementById("impactCount").innerText = `${
    mySelectedImpact ? 1 : 0
  }/1 Selected`;

  const isValid =
    mySelectedSquad11.length === 11 &&
    mySelectedImpact &&
    wkCount >= 1 &&
    mySelectedCaptain;
  document.getElementById("submitSquadBtn").disabled = !isValid;
}

document.getElementById("submitSquadBtn").addEventListener("click", () => {
  socket.emit("submit_squad", {
    teamKey: mySelectedTeamKey,
    playing11: mySelectedSquad11,
    impact: mySelectedImpact,
    captain: mySelectedCaptain,
  });
  document.getElementById("submitSquadBtn").innerHTML =
    "SUBMITTED <i class='bi bi-check'></i>";
  document.getElementById("submitSquadBtn").disabled = true;

  const waitMsg = document.getElementById("waitingMsg");
  waitMsg.classList.remove("d-none");
  if (isAdmin) {
    waitMsg.innerHTML += `<br><button onclick="forceRunSim()" class="btn btn-sm btn-outline-warning mt-2">FORCE START SIMULATION</button>`;
  }
});

function forceRunSim() {
  socket.emit("run_simulation");
}

socket.off("squad_submission_update");
socket.on("squad_submission_update", (d) => {
  document.getElementById(
    "waitingMsg"
  ).innerText = `WAITING... (${d.submittedCount}/${d.totalTeams} SUBMITTED)`;
  if (
    isAdmin &&
    !document.getElementById("waitingMsg").innerHTML.includes("FORCE")
  ) {
    document.getElementById(
      "waitingMsg"
    ).innerHTML += `<br><button onclick="forceRunSim()" class="btn btn-sm btn-outline-warning mt-2">FORCE START SIMULATION</button>`;
  }
});

socket.off("simulation_error");
socket.on("simulation_error", (msg) => {
  alert("SIMULATION FAILED: " + msg);
  document.getElementById("waitingMsg").innerText = "ERROR: " + msg;
});

socket.off("tournament_results");
socket.on("tournament_results", (results) => {
  lastTournamentData = results;
  document
    .getElementById("squadSelectionScreen")
    .classList.remove("overlay-active");
  document.getElementById("resultsScreen").style.opacity = "1";
  document.getElementById("resultsScreen").style.pointerEvents = "auto";

  document.getElementById("winnerName").innerText = results.winner;
  document.getElementById("runnerName").innerText = results.runnerUp;
  document.getElementById("resOrange").innerText = results.orangeCap.name;
  document.getElementById(
    "resOrangeStat"
  ).innerText = `${results.orangeCap.runs} Runs`;
  document.getElementById("resPurple").innerText = results.purpleCap.name;
  document.getElementById(
    "resPurpleStat"
  ).innerText = `${results.purpleCap.wickets} Wkts`;
  document.getElementById("resMvp").innerText = results.mvp.name;
  document.getElementById("resMvpStat").innerText = `${results.mvp.pts} Pts`;

  const ptBody = document.getElementById("pointsTableBody");
  ptBody.innerHTML = "";
  results.standings.forEach((t, i) => {
    ptBody.innerHTML += `<tr><td>${i + 1}</td><td class="text-start">${
      t.name
    }</td><td>${t.played}</td><td>${t.won}</td><td>${
      t.lost
    }</td><td>${t.nrr.toFixed(3)}</td><td>${t.points}</td></tr>`;
  });

  const mLog = document.getElementById("matchLogContainer");
  mLog.innerHTML = "";
  results.leagueMatches.forEach(
    (m, i) => (mLog.innerHTML += createMatchCard(m, false, i))
  );

  const tree = document.getElementById("playoffTree");
  tree.innerHTML = "";
  results.playoffs.forEach(
    (m, i) => (tree.innerHTML += createMatchCard(m, true, i))
  );

  renderAllTeams(results.allTeamsData);
});

function renderAllTeams(teamsData) {
  const container = document.getElementById("allTeamsContainer");
  container.innerHTML = "";
  const dataToRender = teamsData || globalTeams;

  dataToRender.forEach((team) => {
    let p11Html = "",
      benchHtml = "";

    const playingList = team.playing11 || [];
    const playingNames = playingList.map((p) => p.name);

    playingList.forEach((p) => {
      const icon = getRoleIcon(p.roleKey);
      const isCapt =
        team.captain === p.name ? '<span class="captain-badge">C</span>' : "";
      p11Html += `
                            <div class="team-player-row" style="border-left: 3px solid #00E676; padding-left:8px;">
                                <span class="text-white">${icon} ${
        p.name
      } ${isCapt}</span>
                                <span class="text-white-50">${formatAmount(
                                  p.price || 0
                                )}</span>
                            </div>`;
    });

    const fullRoster = team.roster || [];
    fullRoster.forEach((p) => {
      if (!playingNames.includes(p.name)) {
        const icon = getRoleIcon(p.roleKey);
        benchHtml += `
                                <div class="team-player-row" style="opacity:0.5;">
                                    <span class="text-white">${icon} ${
          p.name
        } (Bench)</span>
                                    <span class="text-white-50">${formatAmount(
                                      p.price || 0
                                    )}</span>
                                </div>`;
      }
    });

    container.innerHTML += `
                <div class="team-squad-box">
                    <div class="team-squad-header">
                        <span>${team.name}</span>
                        <span class="fs-6 text-white-50">${
                          playingNames.length
                        } Played</span>
                    </div>
                    <div class="mb-2"><small class="text-success">PLAYING XI (Batting Order)</small>${p11Html}</div>
                    ${
                      benchHtml
                        ? `<div><small class="text-muted">BENCH</small>${benchHtml}</div>`
                        : ""
                    }
                </div>`;
  });
}

function createMatchCard(m, isPlayoff = false, index) {
  let footerHtml = `
            <div class="d-flex justify-content-between w-100 px-2">
                <div class="perf-item"><span class="role-badge role-bat me-2">BAT</span> <span class="text-white">${m.topScorer.name} <span class="text-warning">(${m.topScorer.runs})</span></span></div>
                <div class="perf-item"><span class="role-badge role-bowl me-2">BOWL</span> <span class="text-white">${m.bestBowler.name} <span class="text-info">(${m.bestBowler.figures})</span></span></div>
            </div>`;

  const clickFn = `onclick="openScorecard('${
    isPlayoff ? "playoff" : "league"
  }', ${index})"`;
  const momName =
    m.top3Performers && m.top3Performers.length > 0
      ? m.top3Performers[0].name
      : m.topScorer
      ? m.topScorer.name
      : "-";

  return `
            <div class="match-card ${isPlayoff ? "playoff" : ""}" ${clickFn}>
                <div class="match-header">
                    <div class="match-type-label">${m.type.toUpperCase()}</div>
                    <div class="mom-star"><i class="bi bi-star-fill"></i> ${momName}</div>
                </div>
                <div class="match-content">
                    <div class="team-score-box">
                        <div class="ts-name">${m.t1}</div>
                        <div class="ts-score">${
                          m.score1.split("/")[0]
                        }<span class="fs-6 text-white-50">/${
    m.score1.split("/")[1]
  }</span></div>
                    </div>
                    <div class="vs-tag">VS</div>
                    <div class="team-score-box">
                        <div class="ts-name">${m.t2}</div>
                        <div class="ts-score">${
                          m.score2.split("/")[0]
                        }<span class="fs-6 text-white-50">/${
    m.score2.split("/")[1]
  }</span></div>
                    </div>
                </div>
                <div class="win-status">${m.winnerName} won by ${m.margin}</div>
                <div class="match-footer" style="flex-direction:column; align-items:stretch;">${footerHtml}</div>
            </div>`;
}

function openScorecard(type, index) {
  if (!lastTournamentData) return;
  const matchData =
    type === "league"
      ? lastTournamentData.leagueMatches[index]
      : lastTournamentData.playoffs[index];
  const details = matchData.details;
  if (!details) return alert("Scorecard details not available");

  const modalBody = document.getElementById("detailedScorecardContent");
  const renderInnings = (innData) => {
    let batRows = innData.bat
      .map(
        (b) =>
          `<tr class="scorecard-bat-row ${
            b.status === "out" ? "out" : "not-out"
          }"><td>${b.name} ${b.status === "not out" ? "*" : ""}</td><td>${
            b.runs
          }</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${
            b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : "0.0"
          }</td></tr>`
      )
      .join("");
    let bowlRows = innData.bowl
      .map(
        (b) =>
          `<tr><td>${b.name}</td><td>${b.oversDisplay}</td><td>0</td><td>${b.runs}</td><td>${b.wkts}</td><td>${b.economy}</td></tr>`
      )
      .join("");
    return `<div class="scorecard-team-header ${
      matchData.winnerName === innData.team ? "winner" : ""
    }"><span>${innData.team}</span><span>${innData.score}/${
      innData.wkts
    }</span></div><div class="p-2"><table class="scorecard-table"><thead><tr><th width="40%">Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>${batRows}</tbody></table><table class="scorecard-table mt-3"><thead><tr><th width="40%">Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>ECO</th></tr></thead><tbody>${bowlRows}</tbody></table></div>`;
  };
  modalBody.innerHTML = renderInnings(details.i1) + renderInnings(details.i2);
  const modal = new bootstrap.Modal(document.getElementById("scorecardModal"));
  modal.show();
}

function renderPlayerPool() {
  const a = document.getElementById("availableList"),
    s = document.getElementById("soldList"),
    u = document.getElementById("unsoldList");
  a.innerHTML = "";
  s.innerHTML = "";
  u.innerHTML = "";
  auctionQueue.forEach((p) => {
    const card = `<div class="col-md-6"><div class="player-list-card" style="background:rgba(255,255,255,0.05);border:1px solid #333;padding:10px;border-radius:6px;display:flex;gap:10px;"><div class="p-list-img" style="width:50px;height:50px;border-radius:50%;background-size:cover;${
      p.img ? `background-image:url('${p.img}')` : "background-color:#333"
    }"></div><div><div class="fw-bold text-white">${
      p.name
    }</div><div class="text-white-50 small">${p.category} [${p.set}]</div>${
      p.status === "SOLD"
        ? `<div class="text-success small">Sold: ${formatAmount(
            p.soldPrice
          )}</div>`
        : ""
    }</div></div></div>`;
    if (p.status === "SOLD") s.innerHTML += card;
    else if (p.status === "UNSOLD") u.innerHTML += card;
    else a.innerHTML += card;
  });
}

function renderSquads() {
  const mb = document.getElementById("teamStatusOverview");
  mb.innerHTML = "";
  globalTeams.forEach((t) => {
    let h =
      '<div class="table-responsive"><table class="table table-dark table-sm table-bordered"><thead><tr><th>Player</th><th>Price</th></tr></thead><tbody>';
    if (t.roster)
      t.roster.forEach(
        (p) =>
          (h += `<tr><td>${p.name}</td><td>${formatAmount(p.price)}</td></tr>`)
      );
    h += "</tbody></table></div>";
    mb.innerHTML += `<div class="card bg-black border-secondary mb-3"><div class="card-header white border-secondary d-flex justify-content-between"><span class="text-warning fw-bold">${
      t.name
    }</span><span class="text-warning fw-bold">Spent: ${formatAmount(
      t.totalSpent
    )}</span></div><div class="card-body p-2">${h}</div></div>`;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    const introContainer = document.querySelector(".shake-container");
    if (introContainer) {
      introContainer.style.display = "none";
    }
    const lobby = document.getElementById("lobbyScreen");
    if (lobby) {
      lobby.style.display = "flex";
    }
  }, 4500);
});
