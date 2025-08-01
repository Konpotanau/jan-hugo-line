// game.js (クライアントサイド)
let gameState = null;
let myPlayerIndex = -1;
let isGameStarted = false;

// WebSocketサーバーのURLを決定する
const getWebSocketURL = () => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host;
  // HTTPまたはHTTPSでアクセスされている場合
  if (window.location.protocol.startsWith('http')) {
    // RenderなどのPaaS環境では、WebサーバーとWebSocketサーバーが同じホスト・ポートを共有します
    return `${protocol}://${host}`;
  }
  // ローカルファイルとして開かれている場合 (開発用)
  return 'ws://localhost:3000'; // server.jsのデフォルトポート
};

// サーバー接続
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

    if (data.type !== 'round_result') resultModalEl.style.display = 'none';

    switch (data.type) {
        case 'player_assignment':
            myPlayerIndex = data.playerIndex;
            console.log(`あなたは Player ${myPlayerIndex} です。`);
            break;
        case 'update':
            if (!isGameStarted && data.state.gameStarted) {
                isGameStarted = true;
                startWithCpuBtn.style.display = 'none';
            }
            gameState = data.state;
            renderAll(gameState, myPlayerIndex, handlePlayerDiscard, sendAction);
            break;
        case 'round_result':
            isGameStarted = false; // ラウンド終了で一旦フラグを倒す
            displayRoundResult(data.result, myPlayerIndex);
            break;
        case 'system_message':
             infoEl.textContent = data.message;
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

// サーバーに打牌情報を送信
function handlePlayerDiscard(tile) {
    if (gameState.turnIndex !== myPlayerIndex) return;

    if (gameState.isRiichi[myPlayerIndex] && tile !== gameState.drawnTile) {
        console.log("リーチ後はツモった牌以外は捨てられません。");
        return;
    }
    socket.send(JSON.stringify({ type: 'discard', tile: tile }));
}

// サーバーにアクション（ポン、チー、カンなど）を送信
function sendAction(action) {
    socket.send(JSON.stringify({ type: 'action', action: action }));
    hideActionButtons();
}