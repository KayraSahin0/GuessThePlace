let streetViewPanorama;
let streetViewService;
let miniMap, miniMapMarker, actualMarker, resultLine;
let actualLatLng = null;
let guessedLatLng = null;
let currentBounds = null;
let roundLocked = false;
let guessMarkerIcon, actualMarkerIcon;

// P2P Değişkenleri
let peer = null;
let conn = null;
let isMultiplayer = false;
let isHost = false;
let myName = "Oyuncu";
let opponentName = "Rakip";
let opponentScore = 0;
let opponentGuessed = false;

// DOM Elementleri
const screens = {
  menu: document.getElementById("main-menu-screen"),
  lobby: document.getElementById("lobby-screen"),
  setup: document.getElementById("setup-screen"),
  game: document.getElementById("game-screen"),
  end: document.getElementById("end-screen")
};

// Menü Elementleri
const playerNameInput = document.getElementById("player-name-input");
const singleplayerBtn = document.getElementById("singleplayer-btn");
const multiplayerBtn = document.getElementById("multiplayer-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const joinRoomBtn = document.getElementById("join-room-btn");
const roomCodeInput = document.getElementById("room-code-input");
const myRoomIdEl = document.getElementById("my-room-id");
const roomInfoDiv = document.getElementById("room-info");
const lobbyActionsDiv = document.getElementById("lobby-actions");
const lobbyBackBtn = document.getElementById("lobby-back-btn");
const lobbyStatus = document.getElementById("lobby-status");

// Oyun Elementleri
const globalBtn = document.getElementById("global-btn");
const regionBtn = document.getElementById("region-btn");
const regionInput = document.getElementById("region-input");
const guessBtn = document.getElementById("guess-btn");
const nextRoundBtn = document.getElementById("next-round-btn");
const backToMenuBtn = document.getElementById("back-to-menu-btn");
const mpScoreboard = document.getElementById("mp-scoreboard");
const opponentFeedback = document.getElementById("opponent-feedback");

// Oyun Sonu Elementleri
const playAgainMatchBtn = document.getElementById("play-again-match-btn");
const exitMenuBtn = document.getElementById("exit-menu-btn");

// Durum Değişkenleri
let lastGameMode = null;
let lastRegionQuery = null;
let totalRounds = 3;
let currentRound = 0;
let totalScore = 0;
let maxScore = 3000;

window.initApp = () => {
  streetViewService = new google.maps.StreetViewService();
  initMiniMap();
  attachListeners();
};

function showScreen(screenName) {
  Object.values(screens).forEach(el => el.classList.remove("active"));
  screens[screenName].classList.add("active");
}

function attachListeners() {
  // 1. Ana Menü
  singleplayerBtn.addEventListener("click", () => {
    myName = playerNameInput.value.trim() || "Oyuncu";
    isMultiplayer = false;
    showScreen("setup");
    resetSetupUI();
  });

  multiplayerBtn.addEventListener("click", () => {
    myName = playerNameInput.value.trim() || "Oyuncu";
    if(!myName) { alert("Lütfen bir isim gir."); return; }
    isMultiplayer = true;
    showScreen("lobby");
    initPeer(); // PeerJS Başlat
  });

  // 2. Lobby & P2P
  createRoomBtn.addEventListener("click", createRoom);
  joinRoomBtn.addEventListener("click", joinRoom);
  lobbyBackBtn.addEventListener("click", () => {
    if(peer) peer.destroy();
    showScreen("menu");
    lobbyActionsDiv.classList.remove("hidden");
    roomInfoDiv.classList.add("hidden");
  });

  // 3. Oyun Ayarları
  document.querySelectorAll(".round-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Joiner (Katılımcı) ayar değiştiremez
      if(isMultiplayer && !isHost) return; 

      document.querySelectorAll(".round-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      totalRounds = parseInt(btn.dataset.rounds);
      maxScore = totalRounds * 1000;
      globalBtn.disabled = false;
      regionBtn.disabled = false;
    });
  });

  globalBtn.addEventListener("click", () => {
    if(isMultiplayer && !isHost) return;
    startGame("global");
  });

  regionBtn.addEventListener("click", () => {
    if(isMultiplayer && !isHost) return;
    const query = regionInput.value.trim();
    if (!query) return alert("Bölge adı girin.");
    startGame("region", query);
  });

  // 4. Oyun İçi
  guessBtn.addEventListener("click", handleGuess);
  nextRoundBtn.addEventListener("click", handleNextRound);
  
  backToMenuBtn.addEventListener("click", () => {
    if(confirm("Oyundan çıkmak istediğine emin misin?")) {
      fullReset();
    }
  });

  // 5. Oyun Sonu (Play Again Fix)
  if (playAgainMatchBtn) {
    playAgainMatchBtn.addEventListener("click", () => {
      if (isMultiplayer) {
        if (isHost) {
          // Host ise diğer tarafa sinyal gönder ve kendini resetle
          conn.send({ type: 'PLAY_AGAIN' });
          resetToSetup(); 
        } else {
          alert("Yeni oyunu sadece oda kurucusu başlatabilir.");
        }
      } else {
        // Tek kişilikse direkt resetle
        resetToSetup();
      }
    });
  }

  if (exitMenuBtn) {
    exitMenuBtn.addEventListener("click", () => {
      if(confirm("Menüye dönersen bağlantı kopacak. Emin misin?")) {
        fullReset();
      }
    });
  }
}

// --- P2P MANTIK (PEERJS) ---

function initPeer() {
  peer = new Peer(null, { debug: 1 });

  peer.on('open', (id) => {
    console.log('My Peer ID is: ' + id);
  });

  peer.on('connection', (c) => {
    // HOST tarafı: Birisi bağlandığında çalışır
    if(conn && conn.open) {
      c.close();
      return;
    }
    conn = c;
    setupConnection();
  });

  peer.on('error', (err) => {
    alert("Bağlantı hatası: " + err.type);
    showScreen("menu");
  });
}

function createRoom() {
  isHost = true;
  lobbyActionsDiv.classList.add("hidden");
  roomInfoDiv.classList.remove("hidden");
  lobbyStatus.textContent = "Oda oluşturuluyor...";
  
  if(peer.id) {
    myRoomIdEl.textContent = peer.id;
  } else {
    peer.on('open', (id) => {
      myRoomIdEl.textContent = id;
    });
  }
}

function joinRoom() {
  isHost = false;
  const roomId = roomCodeInput.value.trim();
  if(!roomId) return alert("Oda kodu girin.");

  conn = peer.connect(roomId);
  setupConnection();
}

function setupConnection() {
  conn.on('open', () => {
    conn.send({ type: 'HELLO', name: myName });
    
    if(isHost) {
      lobbyStatus.textContent = "Oyuncu bağlandı! Ayarlar yapılıyor...";
      setTimeout(() => {
        showScreen("setup");
        resetSetupUI();
      }, 1000);
    } else {
      lobbyStatus.textContent = "Bağlandı! Host ayarları yapıyor...";
      showScreen("setup");
      lockSetupUIForJoiner();
    }
  });

  conn.on('data', (data) => {
    handleData(data);
  });

  conn.on('close', () => {
    alert("Bağlantı koptu.");
    fullReset();
  });
}

function handleData(data) {
  switch(data.type) {
    case 'HELLO':
      opponentName = data.name || "Rakip";
      break;
      
    case 'START_GAME':
      totalRounds = data.rounds;
      maxScore = totalRounds * 1000;
      lastGameMode = data.mode;
      lastRegionQuery = data.query;
      currentBounds = data.bounds;
      startScreenTransition();
      break;

    case 'ROUND_COORDS':
      loadPanorama(new google.maps.LatLng(data.lat, data.lng));
      break;

    case 'OPPONENT_GUESS':
      opponentScore += data.score;
      opponentGuessed = true;
      updateMPScoreboard();
      
      if(roundLocked) {
        opponentFeedback.textContent = `${opponentName} +${data.score} puan aldı.`;
        opponentFeedback.classList.remove("hidden");
      }
      break;

    case 'NEXT_ROUND':
      loadRound();
      break;
      
    case 'GAME_OVER':
      endGame(true);
      break;
    
    case 'PLAY_AGAIN':
      resetToSetup();
      lockSetupUIForJoiner();
      break;
  }
}

function lockSetupUIForJoiner() {
  document.getElementById("setup-title").textContent = "Host Ayarları Yapıyor...";
  document.getElementById("setup-subtitle").textContent = "Lütfen bekleyin.";
  document.querySelectorAll("#setup-screen button").forEach(b => b.disabled = true);
}

function resetSetupUI() {
  document.getElementById("setup-title").textContent = "Oyun Ayarları";
  document.getElementById("setup-subtitle").textContent = "Dünya turuna çık veya istediğin şehirde oyna.";
  document.querySelectorAll("#setup-screen button").forEach(b => b.disabled = false);
  globalBtn.disabled = true; 
  regionBtn.disabled = true;
  document.querySelectorAll(".round-btn").forEach(b => b.classList.remove("selected"));
  totalRounds = 0;
}

// --- OYUN MANTIĞI ---

function startGame(mode, query = null) {
  if (totalRounds === 0) return alert("Raund sayısı seçin.");

  lastGameMode = mode;
  lastRegionQuery = query;

  if (isMultiplayer) {
    if (isHost) {
      if (mode === "region") {
        fetchRegionBounds(query).then(bounds => {
          currentBounds = bounds;
          conn.send({ 
            type: 'START_GAME', 
            rounds: totalRounds, 
            mode: mode, 
            query: query,
            bounds: bounds 
          });
          startScreenTransition();
        }).catch(() => alert("Bölge bulunamadı"));
      } else {
        conn.send({ type: 'START_GAME', rounds: totalRounds, mode: 'global' });
        startScreenTransition();
      }
    }
  } else {
    if (mode === "region") {
        fetchRegionBounds(query).then(bounds => {
            currentBounds = bounds;
            startScreenTransition();
        });
    } else {
        startScreenTransition();
    }
  }
}

function startScreenTransition() {
  currentRound = 0;
  totalScore = 0;
  opponentScore = 0;
  showScreen("game");
  updateMPScoreboard();
  
  if (isMultiplayer) {
    mpScoreboard.classList.remove("hidden");
    document.getElementById("p1-name").textContent = myName;
    document.getElementById("p2-name").textContent = opponentName;
  } else {
    mpScoreboard.classList.add("hidden");
  }

  loadRound();
}

function loadRound() {
  currentRound++;
  
  if (currentRound > totalRounds) {
    endGame();
    return;
  }

  roundLocked = false;
  guessBtn.disabled = true;
  guessedLatLng = null;
  actualLatLng = null;
  opponentGuessed = false;
  
  hideFeedback();
  clearMiniMapAnnotations();
  positionMiniMap();
  updateGameStats();

  if(isMultiplayer) {
    if(isHost) {
      nextRoundBtn.disabled = true;
      generateCoordinatesAndLoad();
    } else {
      nextRoundBtn.disabled = true;
    }
  } else {
    generateCoordinatesAndLoad();
  }
}

function generateCoordinatesAndLoad() {
  if (lastGameMode === "global") {
    fetchRandomGlobalPanorama();
  } else if (currentBounds) {
    fetchRandomRegionalPanorama();
  }
}

function fetchRandomGlobalPanorama(attempt = 0) {
  const sv = new google.maps.StreetViewService();
  const latLng = new google.maps.LatLng(Math.random()*170-85, Math.random()*360-180);
  
  sv.getPanorama({ location: latLng, radius: 100000 }, (data, status) => {
    if (status === "OK") {
      processValidLocation(data.location.latLng);
    } else {
      if(attempt < 10) fetchRandomGlobalPanorama(attempt + 1);
    }
  });
}

function fetchRandomRegionalPanorama(attempt = 0) {
  if (!currentBounds) return;
  const sw = currentBounds.southwest;
  const ne = currentBounds.northeast;
  const lat = Math.random() * (ne.lat - sw.lat) + sw.lat;
  const lng = Math.random() * (ne.lng - sw.lng) + sw.lng;
  
  const sv = new google.maps.StreetViewService();
  sv.getPanorama({ location: {lat, lng}, radius: 1000 }, (data, status) => {
    if (status === "OK") {
      processValidLocation(data.location.latLng);
    } else {
      if(attempt < 20) fetchRandomRegionalPanorama(attempt + 1);
    }
  });
}

function processValidLocation(latLng) {
  loadPanorama(latLng);
  if (isMultiplayer && isHost) {
    conn.send({ 
      type: 'ROUND_COORDS', 
      lat: latLng.lat(), 
      lng: latLng.lng() 
    });
  }
}

function loadPanorama(latLng) {
  actualLatLng = latLng;
  streetViewPanorama = new google.maps.StreetViewPanorama(
    document.getElementById("street-view"),
    {
      position: latLng,
      pov: { heading: 0, pitch: 0 },
      zoomControl: true,
      addressControl: false,
      showRoadLabels: false
    }
  );
}

function handleGuess() {
  if (!guessedLatLng || !actualLatLng || roundLocked) return;
  roundLocked = true;

  const distanceMeters = google.maps.geometry.spherical.computeDistanceBetween(guessedLatLng, actualLatLng);
  const distanceKm = distanceMeters / 1000;
  const roundScore = calculateScore(distanceKm);
  totalScore += roundScore;

  drawResultLines();

  if(isMultiplayer) {
    conn.send({ type: 'OPPONENT_GUESS', score: roundScore });
    updateMPScoreboard();
  }

  showFeedback(distanceKm, roundScore);
  updateGameStats();
}

function handleNextRound() {
  if(isMultiplayer) {
    if(isHost) {
      conn.send({ type: 'NEXT_ROUND' });
      loadRound();
    }
  } else {
    loadRound();
  }
}

function showFeedback(dist, score) {
  const fb = document.getElementById("round-feedback");
  document.getElementById("feedback-distance").textContent = `${dist.toFixed(1)} km`;
  document.getElementById("feedback-score").textContent = `+${score} puan`;
  fb.classList.remove("hidden");

  if(isMultiplayer) {
    if(opponentGuessed) {
      opponentFeedback.textContent = `${opponentName} de tahmin yaptı.`;
      opponentFeedback.classList.remove("hidden");
    } else {
      opponentFeedback.textContent = `${opponentName} bekleniyor...`;
      opponentFeedback.classList.remove("hidden");
    }
    
    if(isHost) {
      nextRoundBtn.disabled = false;
      nextRoundBtn.textContent = (currentRound === totalRounds) ? "Sonuçları Gör" : "Diğer Raund";
    } else {
      nextRoundBtn.disabled = true;
      nextRoundBtn.textContent = "Host Bekleniyor...";
    }
  } else {
    opponentFeedback.classList.add("hidden");
    nextRoundBtn.disabled = false;
    nextRoundBtn.textContent = (currentRound === totalRounds) ? "Sonuçları Gör" : "Devam Et";
  }
}

function hideFeedback() {
  document.getElementById("round-feedback").classList.add("hidden");
}

function endGame(fromNetwork = false) {
  if(isMultiplayer && isHost && !fromNetwork) {
    conn.send({ type: 'GAME_OVER' });
  }

  showScreen("end");
  document.getElementById("final-total-score").textContent = totalScore;
  
  const mpResult = document.getElementById("mp-result");
  if(isMultiplayer) {
    mpResult.classList.remove("hidden");
    document.getElementById("opponent-final-score").textContent = `${opponentName}: ${opponentScore}`;
    
    const winnerText = document.getElementById("winner-text");
    if(totalScore > opponentScore) winnerText.textContent = "KAZANDIN! 🏆";
    else if(totalScore < opponentScore) winnerText.textContent = "KAYBETTİN...";
    else winnerText.textContent = "BERABERE!";
    
    // Joiner'a butonu kilitle
    if(!isHost) {
      playAgainMatchBtn.disabled = true;
      playAgainMatchBtn.textContent = "Host Bekleniyor...";
      playAgainMatchBtn.style.opacity = "0.5";
    } else {
      playAgainMatchBtn.disabled = false;
      playAgainMatchBtn.textContent = "Yeni Oyun Başlat";
      playAgainMatchBtn.style.opacity = "1";
    }

  } else {
    mpResult.classList.add("hidden");
    playAgainMatchBtn.disabled = false;
    playAgainMatchBtn.textContent = "Yeni Oyun Başlat";
    playAgainMatchBtn.style.opacity = "1";
  }
}

function resetToSetup() {
  showScreen("setup");
  
  // Değişkenleri sıfırla
  currentRound = 0;
  totalScore = 0;
  opponentScore = 0;
  opponentGuessed = false;
  roundLocked = false;
  guessedLatLng = null;
  actualLatLng = null;
  
  clearMiniMapAnnotations();
  resetSetupUI();
  
  if(isMultiplayer) {
    document.getElementById("p1-score").textContent = "0";
    document.getElementById("p2-score").textContent = "0";
    
    // Joiner buton durumunu ayarla
    if(!isHost) {
        playAgainMatchBtn.disabled = true;
        playAgainMatchBtn.textContent = "Host Bekleniyor...";
    } else {
        playAgainMatchBtn.disabled = false;
        playAgainMatchBtn.textContent = "Yeni Oyun Başlat";
    }
  }
}

function fullReset() {
  if(conn) conn.close();
  if(peer) peer.destroy();
  location.reload();
}

function initMiniMap() {
  miniMap = new google.maps.Map(document.getElementById("mini-map"), {
    zoom: 2, center: { lat: 0, lng: 0 },
    disableDefaultUI: true, clickableIcons: false
  });
  
  guessMarkerIcon = {
    path: google.maps.SymbolPath.CIRCLE, scale: 7,
    fillColor: "#ff6b6b", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2
  };
  actualMarkerIcon = {
    path: google.maps.SymbolPath.CIRCLE, scale: 7,
    fillColor: "#4ecdc4", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2
  };

  miniMap.addListener("click", (e) => {
    if(roundLocked) return;
    guessedLatLng = e.latLng;
    guessBtn.disabled = false;
    
    if(!miniMapMarker) {
      miniMapMarker = new google.maps.Marker({ position: e.latLng, map: miniMap, icon: guessMarkerIcon });
    } else {
      miniMapMarker.setPosition(e.latLng);
    }
  });
}

function drawResultLines() {
  guessBtn.disabled = true;
  new google.maps.Marker({ position: actualLatLng, map: miniMap, icon: actualMarkerIcon });
  new google.maps.Polyline({
    path: [guessedLatLng, actualLatLng], map: miniMap,
    strokeColor: "#4ecdc4", strokeOpacity: 0.8, strokeWeight: 3
  });
  
  const bounds = new google.maps.LatLngBounds();
  bounds.extend(guessedLatLng);
  bounds.extend(actualLatLng);
  miniMap.fitBounds(bounds);
}

function clearMiniMapAnnotations() {
  if (miniMapMarker) miniMapMarker.setMap(null);
  if (actualMarker) actualMarker.setMap(null);
  if (resultLine) resultLine.setMap(null);

  miniMapMarker = null;
  actualMarker = null;
  resultLine = null;

  initMiniMap(); 
}

function positionMiniMap() {
  if(miniMap) {
    miniMap.setCenter({lat:0, lng:0});
    miniMap.setZoom(2);
  }
}

function updateGameStats() {
  document.getElementById("current-round").textContent = currentRound;
  document.getElementById("total-rounds").textContent = totalRounds;
  document.getElementById("total-score").textContent = totalScore;
}

function updateMPScoreboard() {
  if(isMultiplayer) {
    document.getElementById("p1-score").textContent = totalScore;
    document.getElementById("p2-score").textContent = opponentScore;
  }
}

function calculateScore(km) {
  const maxDist = 20000;
  if (km >= maxDist) return 0;
  return Math.round(1000 * Math.exp(-(km / maxDist) * 10));
}

function fetchRegionBounds(query) {
  return fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=AIzaSyBK_loZ_NDlW9jQ1KXrqjrkGMcgjzSnWtM`)
    .then(r => r.json())
    .then(d => d.results[0].geometry.viewport);
}