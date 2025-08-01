// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { Game } = require('./game-manager.js');

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let clients = [];
let cpuPlayers = [];
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
    cpuPlayers = [];
    for (let i = 0; i < neededCpus; i++) {
        const cpuIndex = clients.length + i;
        cpuPlayers.push({ playerIndex: cpuIndex, isCpu: true });
        console.log(`CPU Player ${cpuIndex} を追加しました。`);
    }

    const allPlayers = [
        ...clients.map(c => ({ playerIndex: c.playerIndex, isCpu: false })),
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
    if (clients.length >= 4) {
        ws.send(JSON.stringify({ type: 'error', message: 'ルームは満員です。' }));
        ws.close();
        return;
    }
    const playerIndex = clients.length;
    clients.push({ ws, playerIndex });
    console.log(`Player ${playerIndex} が接続しました。(現在 ${clients.length}人)`);
    ws.send(JSON.stringify({ type: 'player_assignment', playerIndex }));
    
    clearTimeout(gameStartTimeout);

    if (clients.length >= 1) {
        broadcastSystemMessage(`プレイヤー ${playerIndex + 1} が入室。`);
        gameStartTimeout = setTimeout(addCpusAndStartGame, 10000);
    }
    if (clients.length === 4) {
        addCpusAndStartGame();
    }

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const client = clients.find(c => c.ws === ws);
            if (!client) return;

            if (data.type === 'start_with_cpu') {
                addCpusAndStartGame();
                return;
            }
            
            if (!game || !game.state || !game.state.gameStarted) return;
            
            if (data.type === 'discard') {
                game.handleDiscard(client.playerIndex, data.tile);
            } else if (data.type === 'action') {
                game.handlePlayerAction(client.playerIndex, data.action);
            }
        } catch (e) {
            console.error('メッセージの処理に失敗しました:', e);
        }
    });
    
    ws.on('close', () => {
        const disconnectingPlayer = clients.find(c => c.ws === ws);
        if (!disconnectingPlayer) return;

        console.log(`Player ${disconnectingPlayer.playerIndex} が切断しました。`);
        clients = clients.filter(c => c.ws !== ws);
        clearTimeout(gameStartTimeout);
        game = null;
        cpuPlayers = [];
        broadcastSystemMessage(`プレイヤーが切断したため、ゲームをリセットします。`);
        
        // 残ったプレイヤーのインデックスを再割り当て
        clients.forEach((c, i) => { 
            c.playerIndex = i; 
            c.ws.send(JSON.stringify({ type: 'player_assignment', playerIndex: i }));
        });
        console.log(`残りのプレイヤー: ${clients.map(c => c.playerIndex).join(', ')}`);
    });
});

function createPersonalizedState(playerIndex) {
    if (!game || !game.state) return {};

    const serializableState = { ...game.state };
    if (serializableState.waitingForAction) {
        // actionTimeoutはシリアライズできないので除外
        const { actionTimeout, ...rest } = serializableState.waitingForAction;
        serializableState.waitingForAction = rest;
    }

    const stateCopy = JSON.parse(JSON.stringify(serializableState));
    
    // 他のプレイヤーの手牌を隠す
    for (let i = 0; i < 4; i++) {
        if (i !== playerIndex && stateCopy.hands[i]) {
            stateCopy.hands[i] = new Array(stateCopy.hands[i].length).fill('back');
        }
    }
    
    // アクションをパーソナライズ
    if (stateCopy.waitingForAction) {
        const myActions = stateCopy.waitingForAction.possibleActions[playerIndex];
        // 自分のアクション以外は空にする
        stateCopy.waitingForAction.possibleActions = [];
        if (myActions) {
            stateCopy.waitingForAction.possibleActions[playerIndex] = myActions;
        }
    }
    if (stateCopy.turnActions && stateCopy.turnIndex !== playerIndex) {
        stateCopy.turnActions = {};
    }

    // サーバー内部情報を削除
    delete stateCopy.yama;
    delete stateCopy.deadWall;
    delete stateCopy.uraDoraIndicators; // 裏ドラは結果表示時まで見せない

    stateCopy.yamaLength = game.state.yama.length;

    return stateCopy;
}

server.listen(PORT, () => console.log(`サーバーがポート ${PORT} で起動しました。`));