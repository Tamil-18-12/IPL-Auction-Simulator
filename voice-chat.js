// ======================================================
// 🎤 VOICE CHAT SYSTEM (WebRTC)
// ======================================================

let isMicEnabled = false;
let localStream = null;
let peerConnections = {}; // Map of socketId -> RTCPeerConnection

const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize Mic Toggle Button
document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micToggleBtn");
  
  if (micBtn) {
    micBtn.addEventListener("click", toggleMicrophone);
  }
});

async function toggleMicrophone() {
  const micBtn = document.getElementById("micToggleBtn");
  
  if (!isMicEnabled) {
    // Enable microphone
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: false 
      });
      
      isMicEnabled = true;
      micBtn.classList.remove("btn-outline-danger");
      micBtn.classList.add("btn-success");
      micBtn.innerHTML = '<i class="bi bi-mic-fill"></i>';
      micBtn.title = "Voice Chat: ON";
      
      // Notify server that we're ready for voice chat
      socket.emit("voice_ready", { roomId: myRoomId });
      
      logEvent("🎤 Microphone enabled", true);
    } catch (err) {
      console.error("Microphone access denied:", err);
      alert("⚠️ Microphone access denied!\n\nPlease allow microphone permission in your browser settings.");
    }
  } else {
    // Disable microphone
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    isMicEnabled = false;
    micBtn.classList.remove("btn-success");
    micBtn.classList.add("btn-outline-danger");
    micBtn.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
    micBtn.title = "Voice Chat: OFF";
    
    socket.emit("voice_stopped", { roomId: myRoomId });
    
    logEvent("🎤 Microphone disabled", true);
  }
}

// WebRTC Signaling
socket.on("voice_user_ready", async (data) => {
  const { userId } = data;
  
  if (!isMicEnabled || !localStream) return;
  if (userId === socket.id) return; // Don't connect to ourselves
  
  console.log(`📞 Creating peer connection to ${userId}`);
  
  // Create peer connection
  const pc = new RTCPeerConnection(iceServers);
  peerConnections[userId] = pc;
  
  // Add local stream
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  // Handle incoming stream
  pc.ontrack = (event) => {
    console.log(`🔊 Receiving audio from ${userId}`);
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(e => console.error("Audio play error:", e));
  };
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voice_ice_candidate", {
        to: userId,
        candidate: event.candidate
      });
    }
  };
  
  // Create and send offer
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    socket.emit("voice_offer", {
      to: userId,
      offer: pc.localDescription
    });
  } catch (err) {
    console.error("Error creating offer:", err);
  }
});

socket.on("voice_offer", async (data) => {
  const { from, offer } = data;
  
  if (!isMicEnabled || !localStream) return;
  
  console.log(`📞 Received offer from ${from}`);
  
  // Create peer connection
  const pc = new RTCPeerConnection(iceServers);
  peerConnections[from] = pc;
  
  // Add local stream
  localStream.getTracks().forEach(track => {
    pc.addTrack(track, localStream);
  });
  
  // Handle incoming stream
  pc.ontrack = (event) => {
    console.log(`🔊 Receiving audio from ${from}`);
    const remoteAudio = new Audio();
    remoteAudio.srcObject = event.streams[0];
    remoteAudio.play().catch(e => console.error("Audio play error:", e));
  };
  
  // Handle ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("voice_ice_candidate", {
        to: from,
        candidate: event.candidate
      });
    }
  };
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    socket.emit("voice_answer", {
      to: from,
      answer: pc.localDescription
    });
  } catch (err) {
    console.error("Error creating answer:", err);
  }
});

socket.on("voice_answer", async (data) => {
  const { from, answer } = data;
  
  const pc = peerConnections[from];
  if (!pc) return;
  
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log(`✅ Connection established with ${from}`);
  } catch (err) {
    console.error("Error setting remote description:", err);
  }
});

socket.on("voice_ice_candidate", async (data) => {
  const { from, candidate } = data;
  
  const pc = peerConnections[from];
  if (!pc) return;
  
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("Error adding ICE candidate:", err);
  }
});

socket.on("voice_user_stopped", (data) => {
  const { userId } = data;
  
  if (peerConnections[userId]) {
    peerConnections[userId].close();
    delete peerConnections[userId];
    console.log(`🔇 ${userId} stopped voice chat`);
  }
});
