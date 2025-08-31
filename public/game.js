// game.js (クライアントサイド)
let gameState = null;
let myPlayerIndex = -1;
let isGameStarted = false;
let isSpectator = false; // ★観戦者モードフラグ
let spectatingPlayerIndex = 0; // ★現在観戦中のプレイヤーインデックス
let hasShownPeekedTile = false; // ★ Requirement ④: 覗き見牌を一度だけ表示するためのフラグ

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
        this.bgmNormal.volume = 0.25;

        this.bgmRiichi = new Audio('bgm/BGMrichi.mp3');
        this.bgmRiichi.loop = true;
        this.bgmRiichi.volume = 0.25;
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
    // loginOverlayはサーバーからの応答を待ってから非表示にする
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
            isSpectator = false;
            console.log(`あなたは Player ${myPlayerIndex} です。`);
            loginOverlay.style.display = 'none';
            document.getElementById('spectator-controls').style.display = 'none';
            document.body.classList.remove('spectator-mode');
            break;
        case 'spectator_assignment':
            myPlayerIndex = -1;
            isSpectator = true;
            spectatingPlayerIndex = 0;
            console.log("観戦者モードで参加しました。");
            loginOverlay.style.display = 'none';
            document.getElementById('spectator-controls').style.display = 'block';
            document.body.classList.add('spectator-mode');
            setupSpectatorButtons();
            break;
        case 'prompt_game_length':
            showGameLengthModal((choice) => {
                socket.send(JSON.stringify({ type: 'select_game_length', length: choice }));
            });
            break;
        // ★ Requirement ④: 新しいイベントハンドラ
        case 'show_roles':
            displayRolesModal(data.roles);
            break;
        case 'update':
            const povPlayerIndex = isSpectator ? spectatingPlayerIndex : myPlayerIndex;
            if (data.state && (povPlayerIndex !== -1 || isSpectator)) {
                document.body.classList.toggle('spectator-mode', isSpectator);

                 // --- BGM & SE Control ---
                const previousGameStarted = isGameStarted;
                isGameStarted = data.state.gameStarted;
                const isRevolution = data.state.isRevolution;

                if (isGameStarted && !previousGameStarted) {
                    hasShownPeekedTile = false;
                    bgmManager.play('normal');
                }
                
                const someoneInRiichi = data.state.isRiichi.some(r => r);
                if (isGameStarted) {
                    if (isRevolution || someoneInRiichi) {
                        bgmManager.play('riichi');
                    } else {
                        bgmManager.play('normal');
                    }
                }

                const newDiscard = data.state.lastDiscard;
                if (newDiscard && 
                    (newDiscard.player !== lastDiscardInfo?.player || newDiscard.discardIndex !== lastDiscardInfo?.discardIndex)) {
                    if ((!isSpectator && newDiscard.player !== myPlayerIndex) || isSpectator) {
                        playSound('dahai.mp3');
                    }
                }
                lastDiscardInfo = newDiscard ? {...newDiscard} : null;

                for (let i = 0; i < 4; i++) {
                    if (!isSpectator && i === myPlayerIndex) continue;

                    const newFuroCount = data.state.furos[i].length;
                    if (newFuroCount > lastFuroCounts[i]) {
                        const newFuro = data.state.furos[i][newFuroCount - 1];
                        if (newFuro.type === 'pon') playSound('pon.wav');
                        if (newFuro.type === 'chi') playSound('chi.wav');
                        if (newFuro.type.includes('kan')) playSound('kan.wav');
                    }
                }
                lastFuroCounts = data.state.furos.map(f => f.length);

                gameState = data.state;

                if (!isSpectator && gameState.peekedTile && !hasShownPeekedTile) {
                    infoEl.textContent = `（次のあなたのツモ牌は ${gameState.peekedTile} です）`;
                    hasShownPeekedTile = true;
                }

                renderAll(gameState, povPlayerIndex, isSpectator, handlePlayerDiscard, sendAction);
                if(isSpectator) updateSpectatorButtons(gameState.playerNames);
            }
            break;
        case 'round_result':
            if (data.result.type === 'game_over') {
                isGameStarted = false;
                bgmManager.stop();
                displayGameOver(data.result);
                hideActionButtons();
                if (isSpectator) {
                     document.getElementById('spectator-controls').style.display = 'none';
                }
                break;
            }
            isGameStarted = false;
            bgmManager.stop();
            const povIdxForResult = isSpectator ? spectatingPlayerIndex : myPlayerIndex;
            displayRoundResult(data.result, povIdxForResult, gameState.playerNames);
            hideActionButtons();
            break;
        case 'system_message':
            const msg = data.message;
            if (typeof msg === 'object' && msg.type === 'special_event') {
                showSpecialEvent(msg.event);
            } else if (typeof msg === 'object' && msg.type === 'nanawatashi_event') {
                showNanaWatashiNotification(msg, myPlayerIndex);
                const displayNameFrom = msg.fromName.replace(/^##\d\s*/, '');
                const displayNameTo = msg.toName.replace(/^##\d\s*/, '');
                infoEl.textContent = `${displayNameFrom}が${displayNameTo}に牌を渡しました。`;
            } else {
                infoEl.textContent = msg;
            }
            break;
        case 'error':
            alert(data.message);
            isSpectator = false;
            document.body.classList.remove('spectator-mode');
            document.getElementById('spectator-controls').style.display = 'none';
            loginOverlay.style.display = 'flex'; 
            break;
    }
};

socket.onclose = function(event) {
    infoEl.textContent = "サーバーとの接続が切れました。ページをリロードしてください。";
    isGameStarted = false;
    bgmManager.stop();
    loginOverlay.style.display = 'flex';
    myPlayerIndex = -1;
    gameState = null;
};

socket.onerror = function(error) {
    console.error("WebSocket Error: ", error);
    infoEl.textContent = "サーバーとの接続に問題が発生しました。";
};

// ★ Requirement ④: ロール表示モーダルを制御する関数
function displayRolesModal(roles) {
    const modal = document.getElementById('roles-modal');
    const contentDiv = document.getElementById('roles-content');
    const timerEl = modal.querySelector('.modal-timer');
    const closeBtn = document.getElementById('close-roles-modal');
    if (!modal || !contentDiv || !timerEl || !closeBtn) return;

    let contentHTML = '<ul style="list-style-type: none; padding: 0;">';
    roles.forEach(role => {
        contentHTML += `<li style="margin-bottom: 1em;"><strong>${role.name}:</strong> <strong style="color: #d4af37;">${role.roleName}</strong><br>${role.description}</li>`;
    });
    contentHTML += '</ul>';
    contentDiv.innerHTML = contentHTML;

    modal.style.display = 'flex';

    let intervalId = null;

    closeBtn.onclick = () => {
        socket.send(JSON.stringify({ type: 'roles_acknowledged' }));
        modal.style.display = 'none';
        if (intervalId) clearInterval(intervalId);
    };

    let countdown = 30;
    timerEl.textContent = `(ゲーム開始まで ${countdown} 秒)`;
    intervalId = setInterval(() => {
        countdown--;
        timerEl.textContent = `(ゲーム開始まで ${countdown} 秒)`;
        if (countdown <= 0) {
            clearInterval(intervalId);
            modal.style.display = 'none';
        }
    }, 1000);
}

function setupSpectatorButtons() {
    const container = document.getElementById('spectator-view-buttons');
    container.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const btn = document.createElement('button');
        btn.dataset.player = i;
        btn.textContent = `Player ${i + 1}`;
        btn.onclick = () => {
            spectatingPlayerIndex = i;
            if (gameState) {
                renderAll(gameState, spectatingPlayerIndex, isSpectator, handlePlayerDiscard, sendAction);
            }
            document.querySelectorAll('#spectator-view-buttons button').forEach(b => {
                b.classList.toggle('selected', parseInt(b.dataset.player, 10) === i);
            });
        };
        container.appendChild(btn);
    }
    container.querySelector('button[data-player="0"]').classList.add('selected');
}

function updateSpectatorButtons(playerNames) {
    if (!isSpectator || !playerNames) return;
    document.querySelectorAll('#spectator-view-buttons button').forEach(btn => {
        const playerIdx = parseInt(btn.dataset.player, 10);
        btn.textContent = playerNames[playerIdx] || `Player ${playerIdx + 1}`;
    });
}

function handlePlayerDiscard(tile) {
    if (isSpectator) return;
    if (!gameState || !isGameStarted) return;
    
    if (gameState.waitingForAction) {
        console.log("他プレイヤーのアクション待ちのため、打牌できません。");
        return;
    }

    const pa = gameState.pendingSpecialAction;
    
    if (pa && pa.playerIndex === myPlayerIndex && pa.type === 'nanawatashi') {
        console.log("「7わたし」の選択を完了してください。");
        return;
    }
    
    if (pa && pa.playerIndex === myPlayerIndex && pa.type === 'kyusute') {
        playSound('dahai.mp3');
        sendAction({ type: 'kyusute_discard', tile: tile });
        return;
    }
    
    if (gameState.turnIndex !== myPlayerIndex) {
        console.log("自分のターンではありません。");
        return;
    }
    
    const isKyusuteDiscard = tile.match(/^9[mps]$/);
    const isNanawatashiDiscard = tile.match(/^[r]?7[mps]$/);
    if (gameState.isRiichi[myPlayerIndex] && tile !== gameState.drawnTile && !isKyusuteDiscard && !isNanawatashiDiscard) {
        console.log("リーチ後はツモった牌以外は捨てられません。");
        return;
    }
    playSound('dahai.mp3');
    socket.send(JSON.stringify({ type: 'discard', tile: tile }));
}

function sendAction(action) {
    if (isSpectator) return;
    if (!gameState || !isGameStarted) return;
    socket.send(JSON.stringify({ type: 'action', action: action }));
    hideActionButtons();
}