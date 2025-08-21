// game.js (クライアントサイド)
let gameState = null;
let myPlayerIndex = -1;
let isGameStarted = false;
// ★ AudioContextをグローバルで定義
let audioContext = null;

const getWebSocketURL = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  if (window.location.protocol.startsWith('http')) {
    return `${protocol}://${host}`;
  }
  return 'ws://localhost:3000';
};

const socket = new WebSocket(getWebSocketURL());

const loginOverlay = document.getElementById('login-overlay');
const joinGameBtn = document.getElementById('join-game-btn');
const playerNameInput = document.getElementById('player-name-input');


// ★ ユーザーの最初の操作でオーディオコンテキストをアンロックする関数 (修正版)
function unlockAudioContext() {
    if (audioContext && audioContext.state === 'running') {
        return; 
    }
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("AudioContext is not supported.", e);
            return;
        }
    }
    // resume()はユーザーのジェスチャーイベント内で呼び出す必要がある
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log("AudioContext resumed successfully.");
        }).catch(e => {
            console.error("Failed to resume AudioContext:", e);
        });
    }
}


joinGameBtn.onclick = () => {
    unlockAudioContext(); // ★対戦開始ボタンクリック時にオーディオを有効化
    const name = playerNameInput.value.trim();
    if (!name) {
        alert('名前を入力してください。');
        return;
    }
    socket.send(JSON.stringify({ type: 'join_game', name }));
    loginOverlay.style.display = 'none';
};

socket.onopen = function(event) {
    console.log("サーバーに接続しました。");
    infoEl.textContent = "サーバーに接続しました。名前を入力してゲームを開始してください。";
};

socket.onmessage = function(event) {
    const data = JSON.parse(event.data);

    if (data.type !== 'round_result') {
         const existingModal = document.getElementById('result-modal');
         if(existingModal) existingModal.style.display = 'none';
    }

    switch (data.type) {
        case 'player_assignment':
            myPlayerIndex = data.playerIndex;
            console.log(`あなたは Player ${myPlayerIndex} です。`);
            break;
        case 'update':
            if (data.state && myPlayerIndex !== -1) {
                if (!isGameStarted && data.state.gameStarted) {
                    isGameStarted = true;
                }
                gameState = data.state;
                isGameStarted = gameState.gameStarted; // Update game status
                renderAll(gameState, myPlayerIndex, handlePlayerDiscard, sendAction);
            }
            break;
        case 'round_result':
            isGameStarted = false;
            // playerNamesをgameStateから取得して渡す
            displayRoundResult(data.result, myPlayerIndex, gameState.playerNames);
            hideActionButtons(); // ラウンド結果表示時にアクションボタンを隠す
            break;
        case 'system_message':
            const msg = data.message;
            if (typeof msg === 'object' && msg.type === 'special_event') {
                showSpecialEvent(msg.event);
            } else if (typeof msg === 'object' && msg.type === 'nanawatashi_event') {
                showNanaWatashiNotification(msg, myPlayerIndex);
                // Update the general info text for all players
                infoEl.textContent = `${msg.fromName}が${msg.toName}に牌を渡しました。`;
            } else {
                infoEl.textContent = msg;
            }
            break;
        case 'error':
            alert(data.message);
            loginOverlay.style.display = 'flex'; // エラー時は再度表示
            break;
    }
};

socket.onclose = function(event) {
    infoEl.textContent = "サーバーとの接続が切れました。ページをリロードしてください。";
    isGameStarted = false;
    loginOverlay.style.display = 'flex';
    myPlayerIndex = -1;
    gameState = null;
};

socket.onerror = function(error) {
    console.error("WebSocket Error: ", error);
    infoEl.textContent = "サーバーとの接続に問題が発生しました。";
};

function handlePlayerDiscard(tile) {
    if (!gameState || !isGameStarted) return;
    
    const pa = gameState.pendingSpecialAction;
    // If in the 'kyusute' special action state, send the discard as a special action.
    if (pa && pa.playerIndex === myPlayerIndex && pa.type === 'kyusute') {
        playSound('dahai.mp3');
        sendAction({ type: 'kyusute_discard', tile: tile });
        return;
    }
    
    // Standard turn discard validation.
    if (gameState.turnIndex !== myPlayerIndex) return;

    if (gameState.isRiichi[myPlayerIndex] && tile !== gameState.drawnTile) {
        console.log("リーチ後はツモった牌以外は捨てられません。");
        return;
    }
    playSound('dahai.mp3');
    socket.send(JSON.stringify({ type: 'discard', tile: tile }));
}

function sendAction(action) {
    if (!gameState || !isGameStarted) return;
    socket.send(JSON.stringify({ type: 'action', action: action }));
    hideActionButtons();
}