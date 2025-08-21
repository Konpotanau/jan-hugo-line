// server.js
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./game-manager.js');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// 静的ファイルのディレクトリを 'public' フォルダに設定
app.use(express.static(path.join(__dirname, 'public')));
// ★ 修正点: /bgm パスで bgm フォルダを提供するように設定
app.use('/bgm', express.static(path.join(__dirname, 'bgm')));


// ルートURLへのアクセスで 'public/index.html' を返すように設定
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


let clients = [];
let game = null;
let gameStartTimeout = null;

function broadcast(type, payload) {
    const message = JSON.stringify({ type, ...payload });
    clients.forEach(client => {
        if (client.ws.readyState === 1) { // WebSocket.OPEN
             client.ws.send(message);
        }
    });
}

function broadcastGameState() {
    if (!game || !game.state) return;
    clients.forEach(client => {
        if(client.ws.readyState === 1) {
            client.ws.send(JSON.stringify({ type: 'update', state: createPersonalizedState(client.playerIndex) }));
        }
    });
}

function broadcastSystemMessage(message) {
    broadcast('system_message', { message });
}

function broadcastRoundResult(result) {
    broadcast('round_result', { result });
}

function addCpusAndStartGame() {
    if (game && game.state.gameStarted) return;
    clearTimeout(gameStartTimeout);

    const neededCpus = 4 - clients.length;
    let cpuPlayers = [];
    for (let i = 0; i < neededCpus; i++) {
        const cpuIndex = clients.length + i;
        cpuPlayers.push({ playerIndex: cpuIndex, name: `CPU-${i + 1}`, isCpu: true });
        console.log(`CPU Player ${cpuIndex} (${cpuPlayers[i].name}) を追加しました。`);
    }

    const allPlayers = [
        ...clients.map(c => ({ playerIndex: c.playerIndex, name: c.name, isCpu: false })),
        ...cpuPlayers
    ];

    game = new Game(allPlayers, {
        onUpdate: broadcastGameState,
        onResult: broadcastRoundResult,
        onSystemMessage: broadcastSystemMessage
    });

    game.setupNewRound(true);
}

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');

    ws.on('message', function messageHandler(message) {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join_game') {
                if (game && game.state.gameStarted) {
                    ws.send(JSON.stringify({ type: 'error', message: '現在ゲームが進行中です。しばらくしてから再接続してください。' }));
                    ws.close();
                    return;
                }
                
                if (clients.length >= 4) {
                    ws.send(JSON.stringify({ type: 'error', message: 'ルームは満員です。' }));
                    ws.close();
                    return;
                }
                
                const playerIndex = clients.length;
                const name = data.name || `Player ${playerIndex + 1}`;
                const client = { ws, playerIndex, name };
                clients.push(client);

                console.log(`Player ${playerIndex} (${name}) が参加しました。(現在 ${clients.length}人)`);
                ws.send(JSON.stringify({ type: 'player_assignment', playerIndex }));
                
                ws.removeListener('message', messageHandler); // このハンドラは一度きり
                ws.on('message', (m) => handleGameMessages(ws, m));
                ws.on('close', () => handleDisconnect(ws));

                clearTimeout(gameStartTimeout);

                if (clients.length >= 1) {
                    broadcastSystemMessage(`${name} が入室しました。`);
                    if(clients.length < 4) {
                       gameStartTimeout = setTimeout(addCpusAndStartGame, 10000);
                       broadcastSystemMessage(`10秒後にCPUを加えてゲームを開始します...`);
                    }
                }
                if (clients.length === 4) {
                    addCpusAndStartGame();
                }
            }
        } catch (e) {
            console.error('参加メッセージの処理に失敗しました:', e);
        }
    });
});

function handleGameMessages(ws, message) {
    try {
        const data = JSON.parse(message);
        const client = clients.find(c => c.ws === ws);
        if (!client) return;

        if (!game || !game.state.gameStarted) {
            console.log(`ゲーム未開始時のアクションを無視: ${data.type}`);
            return;
        }

        if (data.type === 'discard') {
            game.handleDiscard(client.playerIndex, data.tile);
        } else if (data.type === 'action') {
            game.handlePlayerAction(client.playerIndex, data.action);
        }
    } catch (e) {
        console.error('ゲームメッセージの処理に失敗しました:', e);
    }
}

function handleDisconnect(ws) {
    const disconnectingPlayer = clients.find(c => c.ws === ws);
    if (!disconnectingPlayer) return;

    console.log(`Player ${disconnectingPlayer.playerIndex} (${disconnectingPlayer.name}) が切断しました。`);
    clients = clients.filter(c => c.ws !== ws);
    clearTimeout(gameStartTimeout);
    
    if (game && game.state.gameStarted) {
        game = null;
        broadcastSystemMessage(`${disconnectingPlayer.name}が切断したため、ゲームをリセットします。`);
    } else if (game) { 
        game = null; 
        broadcastSystemMessage(`${disconnectingPlayer.name}が退出しました。`);
    }
    
    clients.forEach((c, i) => {
        if(c.playerIndex !== i) {
            c.playerIndex = i;
            c.ws.send(JSON.stringify({ type: 'player_assignment', playerIndex: i }));
        }
    });
    console.log(`残りのプレイヤー: ${clients.map(c => c.name).join(', ')}`);
    
    if (clients.length > 0 && !game) {
        gameStartTimeout = setTimeout(addCpusAndStartGame, 10000);
        broadcastSystemMessage(`10秒後にCPUを加えてゲームを開始します...`);
    }
}


function createPersonalizedState(playerIndex) {
    if (!game || !game.state) return {};

    const serializableState = { ...game.state };

    if (serializableState.waitingForAction) {
        const { actionTimeout, ...rest } = serializableState.waitingForAction;
        serializableState.waitingForAction = rest;
    }
    
    if (serializableState.turnTimer) {
        const { timeout, ...rest } = serializableState.turnTimer;
        serializableState.turnTimer = rest;
    }

    const stateCopy = JSON.parse(JSON.stringify(serializableState));

    for (let i = 0; i < 4; i++) {
        if (i !== playerIndex && stateCopy.hands[i]) {
            stateCopy.hands[i] = new Array(stateCopy.hands[i].length).fill('back');
        }
    }

    if (stateCopy.waitingForAction) {
        const myActions = stateCopy.waitingForAction.possibleActions[playerIndex];
        stateCopy.waitingForAction.possibleActions = [];
        if (myActions) {
            stateCopy.waitingForAction.possibleActions[playerIndex] = myActions;
        }
    }
    if (stateCopy.turnActions && stateCopy.turnIndex !== playerIndex) {
        stateCopy.turnActions = {};
    }
    
    delete stateCopy.yama;
    delete stateCopy.deadWall;
    delete stateCopy.uraDoraIndicators;

    stateCopy.yamaLength = game.state.yama.length;

    return stateCopy;
}


server.listen(PORT, () => console.log(`サーバーがポート ${PORT} で起動しました。`));