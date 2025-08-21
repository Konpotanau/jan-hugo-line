// game.js (クライアントサイド)
let gameState = null;
let myPlayerIndex = -1;
let isGameStarted = false;
// ★ AudioContextはui.jsで定義されているものを共有して使用

// ★ BGM管理オブジェクト
const bgmManager = {
    bgmNormal: null,
    bgmRiichi: null,
    currentBGM: null,
    init: function() {
        if (this.bgmNormal) return; // Already initialized
        this.bgmNormal = new Audio('bgm/BGMNormal.mp3');
        this.bgmNormal.loop = true;
        this.bgmNormal.volume = 0.5;

        this.bgmRiichi = new Audio('bgm/BGMrichi.mp3');
        this.bgmRiichi.loop = true;
        this.bgmRiichi.volume = 0.5;
    },
    play: function(type) {
        if (!audioContext || audioContext.state !== 'running') return;
        
        const bgmToPlay = type === 'riichi' ? this.bgmRiichi : this.bgmNormal;
        
        if (this.currentBGM === bgmToPlay && !this.currentBGM.paused) {
            return; // Already playing the correct BGM
        }

        this.stop();
        
        this.currentBGM = bgmToPlay;
        this.currentBGM.play().catch(e => console.error(`BGM play failed for ${type}:`, e));
    },
    stop: function() {
        if (this.bgmNormal) this.bgmNormal.pause();
        if (this.bgmRiichi) this.bgmRiichi.pause();
        if (this.currentBGM) this.currentBGM.currentTime = 0; // 曲を頭出しに戻す
        this.currentBGM = null;
    }
};

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
            // ★ ui.js に AudioContext を渡す
            if (typeof setAudioContext === 'function') {
                setAudioContext(audioContext);
            }
            bgmManager.init();
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

// ★ 前回のゲーム状態を保持するための変数
let lastDiscardInfo = null;
let lastFuroCounts = [0, 0, 0, 0]; // ★ 他家の鳴き検知用

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
                // --- BGM & SE Control ---
                const previousGameStarted = isGameStarted;
                isGameStarted = data.state.gameStarted;
                const isRevolution = data.state.isRevolution;

                // 対局開始BGM
                if (isGameStarted && !previousGameStarted) {
                    bgmManager.play('normal');
                }
                
                // ★ BGMロジック修正: 革命またはリーチでBGM変更
                const someoneInRiichi = data.state.isRiichi.some(r => r);
                if (isGameStarted) {
                    if (isRevolution || someoneInRiichi) {
                        bgmManager.play('riichi');
                    } else {
                        bgmManager.play('normal');
                    }
                }

                // 他家の打牌SE
                const newDiscard = data.state.lastDiscard;
                if (newDiscard && 
                    (newDiscard.player !== lastDiscardInfo?.player || newDiscard.discardIndex !== lastDiscardInfo?.discardIndex)) {
                    if (newDiscard.player !== myPlayerIndex) {
                        playSound('dahai.mp3');
                    }
                }
                lastDiscardInfo = newDiscard ? {...newDiscard} : null;

                // ★ 他家の鳴きSE
                for (let i = 0; i < 4; i++) {
                    if (i === myPlayerIndex) continue;
                    const newFuroCount = data.state.furos[i].length;
                    if (newFuroCount > lastFuroCounts[i]) {
                        const newFuro = data.state.furos[i][newFuroCount - 1];
                        if (newFuro.type === 'pon') playSound('pon.wav');
                        if (newFuro.type === 'chi') playSound('chi.wav');
                        if (newFuro.type.includes('kan')) playSound('kan.wav');
                    }
                }
                lastFuroCounts = data.state.furos.map(f => f.length);
                // --- End BGM & SE Control ---

                gameState = data.state;
                renderAll(gameState, myPlayerIndex, handlePlayerDiscard, sendAction);
            }
            break;
        case 'round_result':
             // ★ game_overイベントをここで処理
            if (data.result.type === 'game_over') {
                isGameStarted = false;
                bgmManager.stop();
                displayGameOver(data.result);
                hideActionButtons();
                break;
            }
            isGameStarted = false;
            bgmManager.stop(); // 局終了時にBGM停止
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
    bgmManager.stop(); // 切断時にBGM停止
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
    playSound('dahai.mp3'); // 自分の打牌音は即時再生
    socket.send(JSON.stringify({ type: 'discard', tile: tile }));
}

function sendAction(action) {
    if (!gameState || !isGameStarted) return;
    socket.send(JSON.stringify({ type: 'action', action: action }));
    hideActionButtons();
}