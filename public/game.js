// game.js (クライアントサイド)
let gameState = null;
let myPlayerIndex = -1;
let isGameStarted = false;

const getWebSocketURL = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  if (window.location.protocol.startsWith('http')) {
    return `${protocol}://${host}`;
  }
  return 'ws://localhost:3000';
};

const socket = new WebSocket(getWebSocketURL());

const startWithCpuBtn = document.getElementById('start-cpu-btn');

startWithCpuBtn.onclick = () => {
    socket.send(JSON.stringify({ type: 'start_with_cpu' }));
    startWithCpuBtn.style.display = 'none';
};

socket.onopen = function(event) {
    console.log("サーバーに接続しました。");
    infoEl.textContent = "サーバーに接続しました。他のプレイヤーを待っています...";
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
                    startWithCpuBtn.style.display = 'none';
                }
                gameState = data.state;
                isGameStarted = gameState.gameStarted; // Update game status
                renderAll(gameState, myPlayerIndex, handlePlayerDiscard, sendAction);
            }
            break;
        case 'round_result':
            isGameStarted = false;
            displayRoundResult(data.result, myPlayerIndex);
            break;
        case 'system_message':
            const msg = data.message;
            if (typeof msg === 'object' && msg.type === 'nanawatashi_event') {
                showNanaWatashiNotification(msg, myPlayerIndex);
                // Update the general info text for all players
                infoEl.textContent = `P${msg.from + 1}がP${msg.to + 1}に牌を渡しました。`;
            } else {
                infoEl.textContent = msg;
            }
            break;
        case 'error':
            alert(data.message);
            break;
    }
};

socket.onclose = function(event) {
    infoEl.textContent = "サーバーとの接続が切れました。ページをリロードしてください。";
    isGameStarted = false;
    startWithCpuBtn.style.display = 'block';
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
        sendAction({ type: 'kyusute_discard', tile: tile });
        return;
    }
    
    // Standard turn discard validation.
    if (gameState.turnIndex !== myPlayerIndex) return;

    if (gameState.isRiichi[myPlayerIndex] && tile !== gameState.drawnTile) {
        console.log("リーチ後はツモった牌以外は捨てられません。");
        return;
    }
    socket.send(JSON.stringify({ type: 'discard', tile: tile }));
}

function sendAction(action) {
    if (!gameState || !isGameStarted) return;
    socket.send(JSON.stringify({ type: 'action', action: action }));
    hideActionButtons();
}