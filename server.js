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
let spectators = []; // ★観戦者リストを追加
let game = null;
let gameStartTimeout = null;
let rolesAcknowledged = new Set();
let gameStartFunction = null;

// ★ Requirement ④: 特殊能力の管理用変数を追加
let availableCheats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const cheatRoles = {
    1: { name: "鉄壁", description: "「7わたし」の対象になりません。相手のラッキーセブンをブロックします。" },
    2: { name: "未来予知", description: "「未来予知」ボタンで次の自分のツモ牌を見ることができます。" },
    3: { name: "連荘モード", description: "一度和了すると「連荘モード」に突入。モード中は良い配牌が来るまで配り直されます。" },
    4: { name: "風神", description: "東南西北、全ての風牌が自分の役牌になります。" },
    5: { name: "幻惑オーラ", description: "リーチをかけていない相手からのロンアガリを50%の確率で無効化します。" },
    6: { name: "ドラ蒐集", description: "配牌時に必ずドラが2枚以上含まれるようになります。" },
    7: { name: "下剋上", description: "1翻または2翻の安い手で和了した際、役の翻数が自動的に3翻にパワーアップします。" },
    8: { name: "富豪", description: "毎局開始時にボーナスとして2000点を受け取ります。" },
    9: { name: "革命家", description: "自分のターンに1度だけ、ボタン1つで「革命」を起こしたり、終わらせたりできます。" },
};

// ★ Requirement ④: 配列シャッフル用のヘルパー関数
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}


function broadcast(type, payload) {
    const message = JSON.stringify({ type, ...payload });
    clients.forEach(client => {
        if (client.ws.readyState === 1) { // WebSocket.OPEN
             client.ws.send(message);
        }
    });
    // ★観戦者にもブロードキャスト
    spectators.forEach(spectator => {
        if (spectator.ws.readyState === 1) {
            spectator.ws.send(message);
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
    // ★観戦者には完全な情報を送信
    spectators.forEach(spectator => {
         if(spectator.ws.readyState === 1) {
            spectator.ws.send(JSON.stringify({ type: 'update', state: createSpectatorState() }));
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

    gameStartFunction = (gameLength = 'half') => {
        clearTimeout(gameStartTimeout);
        if (game && game.state.gameStarted) return;

        const allPlayers = [
            ...clients.map(c => ({ playerIndex: c.playerIndex, name: c.name, isCpu: false, ws: c.ws })),
            ...cpuPlayers
        ];

        game = new Game(allPlayers, {
            onUpdate: broadcastGameState,
            onResult: broadcastRoundResult,
            onSystemMessage: broadcastSystemMessage
        });

        game.setupNewRound(true, gameLength);
        gameStartFunction = null;
    };

    const promptForGameLength = () => {
        const oyaClient = clients.find(c => c.playerIndex === 0);
        if (oyaClient) { // 親が人間
            const oyaName = oyaClient.name.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
            broadcastSystemMessage(`${oyaName} がゲーム形式を選択中です...`);
            oyaClient.ws.send(JSON.stringify({ type: 'prompt_game_length' }));
            gameStartTimeout = setTimeout(() => {
                broadcastSystemMessage('選択がタイムアウトしたため、半荘戦で開始します。');
                if (gameStartFunction) gameStartFunction('half');
            }, 10000);
        } else { // 親がCPU
            broadcastSystemMessage('親がCPUのため、半荘戦で開始します。');
            if (gameStartFunction) gameStartFunction('half');
        }
    };

    const afterRolesAction = promptForGameLength;

    availableCheats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const allPlayersWithCheats = clients.filter(c => c.name.startsWith("##"));

    if (allPlayersWithCheats.length > 0) {
        rolesAcknowledged.clear();
        allPlayersWithCheats.forEach(client => {
            let roleToShow = null;
            if (client.name.startsWith("##konpotas")) {
                const playerName = client.name.replace(/^##konpotas\s*/, '');
                roleToShow = { name: playerName, roleName: "創造神", description: "全ての特殊能力を併せ持つデバッグ用の全能者です。" };
            } else {
                const match = client.name.match(/^##(\d+)\s*(.*)/);
                if (match) {
                    const cheatNumber = parseInt(match[1], 10);
                    const playerName = match[2];
                    const role = cheatRoles[cheatNumber];
                    if (role) {
                        roleToShow = { name: playerName, roleName: role.name, description: role.description };
                    }
                }
            }
            if (roleToShow) {
                client.ws.send(JSON.stringify({ type: 'show_roles', roles: [roleToShow] }));
            }
        });
        const GAME_START_DELAY = 30000;
        broadcastSystemMessage(`${GAME_START_DELAY / 1000}秒後、または全員の準備完了後にゲームを開始します...`);
        gameStartTimeout = setTimeout(afterRolesAction, GAME_START_DELAY);
    } else {
        const GAME_START_DELAY = 1000;
        broadcastSystemMessage(`${GAME_START_DELAY / 1000}秒後にゲームを開始します...`);
        gameStartTimeout = setTimeout(afterRolesAction, GAME_START_DELAY);
    }
}

wss.on('connection', (ws) => {
    console.log('クライアントが接続しました。');

    ws.on('message', function messageHandler(message) {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join_game') {
                let clientName = data.name || `Player ${clients.length + 1}`;

                // ★管理者（観戦者）判定
                if (clientName === 'konpotanau') {
                    const spectator = { ws, name: clientName };
                    spectators.push(spectator);
                    console.log(`観戦者 (${clientName}) が参加しました。`);
                    ws.send(JSON.stringify({ type: 'spectator_assignment' }));

                    if (game && game.state.gameStarted) {
                        ws.send(JSON.stringify({ type: 'update', state: createSpectatorState() }));
                    }

                    ws.removeListener('message', messageHandler);
                    ws.on('message', (m) => handleGameMessages(ws, m));
                    ws.on('close', () => handleDisconnect(ws));
                    return;
                }

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
                
                // ★ Requirement ④: 特殊能力のランダム割り当て
                if (clientName.startsWith('##')) {
                    if(clientName.startsWith('##konpotas')) {
                        // そのまま維持
                    } else if (availableCheats.length > 0) {
                        shuffleArray(availableCheats);
                        const cheatNumber = availableCheats.pop();
                        const originalName = clientName.substring(2).trim();
                        clientName = `##${cheatNumber} ${originalName}`;
                        console.log(`Player ${originalName} was assigned cheat ##${cheatNumber}`);
                    } else {
                        console.log(`No more cheats available for ${clientName}`);
                        clientName = clientName.substring(2).trim();
                    }
                }


                const playerIndex = clients.length;
                const client = { ws, playerIndex, name: clientName };
                clients.push(client);

                console.log(`Player ${playerIndex} (${clientName}) が参加しました。(現在 ${clients.length}人)`);
                ws.send(JSON.stringify({ type: 'player_assignment', playerIndex }));
                
                ws.removeListener('message', messageHandler);
                ws.on('message', (m) => handleGameMessages(ws, m));
                ws.on('close', () => handleDisconnect(ws));

                clearTimeout(gameStartTimeout);

                if (clients.length >= 1) {
                    const displayName = clientName.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
                    broadcastSystemMessage(`${displayName} が入室しました。`);
                    if(clients.length < 4) {
                       gameStartTimeout = setTimeout(addCpusAndStartGame, 10000);
                       broadcastSystemMessage(`10秒後にCPUを追加してゲームを開始します...`);
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
        // ★観戦者からの操作は無視する
        const isSpectator = spectators.some(s => s.ws === ws);
        if (isSpectator) {
            console.log('観戦者からのアクションを無視しました。');
            return;
        }
        
        const data = JSON.parse(message);
        const client = clients.find(c => c.ws === ws);
        if (!client) return;

        if (data.type === 'select_game_length') {
            if (client.playerIndex === 0 && typeof gameStartFunction === 'function') {
                const length = data.length === 'east' ? 'east' : 'half';
                const lengthText = length === 'east' ? '東風戦' : '半荘戦';
                const clientName = client.name.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
                broadcastSystemMessage(`${clientName} が ${lengthText} を選択しました。`);
                gameStartFunction(length);
            }
            return;
        }

        if (data.type === 'roles_acknowledged') {
            console.log(`Player ${client.playerIndex} (${client.name}) acknowledged roles.`);
            rolesAcknowledged.add(client.playerIndex);

            const specialPlayers = clients.filter(c => c.name.startsWith("##"));
            const specialPlayerIndexes = new Set(specialPlayers.map(p => p.playerIndex));
            const acknowledgedSpecialPlayers = [...rolesAcknowledged].filter(idx => specialPlayerIndexes.has(idx));

            if (acknowledgedSpecialPlayers.length === specialPlayers.length && specialPlayers.length > 0) {
                console.log("All special players are ready. Starting game now.");
                if (gameStartFunction) {
                    const afterRolesAction = () => {
                         const oyaClient = clients.find(c => c.playerIndex === 0);
                        if (oyaClient) { // 親が人間
                            const oyaName = oyaClient.name.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
                            broadcastSystemMessage(`${oyaName} がゲーム形式を選択中です...`);
                            oyaClient.ws.send(JSON.stringify({ type: 'prompt_game_length' }));
                            gameStartTimeout = setTimeout(() => {
                                broadcastSystemMessage('選択がタイムアウトしたため、半荘戦で開始します。');
                                if (gameStartFunction) gameStartFunction('half');
                            }, 10000);
                        } else { // 親がCPU
                            broadcastSystemMessage('親がCPUのため、半荘戦で開始します。');
                            if (gameStartFunction) gameStartFunction('half');
                        }
                    };
                    clearTimeout(gameStartTimeout);
                    afterRolesAction();
                }
            }
            return;
        }

        if (!game || !game.state.gameStarted) {
            console.log(`ゲーム未開始時のアクションを無視: ${data.type}`);
            return;
        }

        if (data.type === 'discard') {
            game.handleDiscard(client.playerIndex, data.tile);
        } else if (data.type === 'action') {
            if (data.action.type === 'peek_tsumo') {
                game.handlePeekRequest(client.playerIndex);
            } else {
                game.handlePlayerAction(client.playerIndex, data.action);
            }
        }
    } catch (e) {
        console.error('ゲームメッセージの処理に失敗しました:', e);
    }
}

function handleDisconnect(ws) {
    // ★観戦者の切断処理
    const disconnectingSpectator = spectators.find(s => s.ws === ws);
    if (disconnectingSpectator) {
        console.log(`観戦者 (${disconnectingSpectator.name}) が切断しました。`);
        spectators = spectators.filter(s => s.ws !== ws);
        return;
    }

    const disconnectingPlayer = clients.find(c => c.ws === ws);
    if (!disconnectingPlayer) return;

    console.log(`Player ${disconnectingPlayer.playerIndex} (${disconnectingPlayer.name}) が切断しました。`);
    clients = clients.filter(c => c.ws !== ws);
    clearTimeout(gameStartTimeout);
    
    if (game && game.state.gameStarted) {
        game = null;
        const displayName = disconnectingPlayer.name.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
        broadcastSystemMessage(`${displayName}が切断したため、ゲームをリセットします。`);
    } else if (clients.length > 0) {
        const displayName = disconnectingPlayer.name.replace(/^##\d+\s*/, '').replace(/^##konpotas\s*/, '');
        broadcastSystemMessage(`${displayName}が退出しました。`);
    }
    
    // リセットロジック
    if (clients.length === 0) {
        game = null;
        availableCheats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        console.log("全プレイヤーが退出したため、ゲームをリセットしました。");
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
        broadcastSystemMessage(`10秒後にCPUを追加してゲームを開始します...`);
    }
}


function createPersonalizedState(playerIndex) {
    if (!game || !game.state) return {};

    const stateToSend = {};
    for (const key in game.state) {
        if (key === 'players') {
            stateToSend.players = game.state.players.map(p => ({ 
                playerIndex: p.playerIndex, 
                name: p.name, 
                isCpu: p.isCpu 
            }));
        } else if (key !== 'turnTimer' && key !== 'waitingForAction') {
            stateToSend[key] = game.state[key];
        }
    }

    if (game.state.waitingForAction) {
        const { actionTimeout, ...rest } = game.state.waitingForAction;
        stateToSend.waitingForAction = rest;
    }

    if (game.state.turnTimer) {
        const { timeout, ...rest } = game.state.turnTimer;
        stateToSend.turnTimer = rest;
    }
    
    const maskedHands = stateToSend.hands.map((hand, i) => {
        if (i !== playerIndex) {
            return new Array(hand.length).fill('back');
        }
        return hand;
    });
    stateToSend.hands = maskedHands;

    if (stateToSend.waitingForAction) {
        const myActions = stateToSend.waitingForAction.possibleActions[playerIndex];
        stateToSend.waitingForAction.possibleActions = [];
        if (myActions) {
            stateToSend.waitingForAction.possibleActions[playerIndex] = myActions;
        }
    }
    if (stateToSend.turnActions && stateToSend.turnIndex !== playerIndex) {
        stateToSend.turnActions = {};
    }

    // ★ 修正点②: ##2/##konpotas プレイヤーに覗き見情報を追加
    const player = game.players.find(p => p.playerIndex === playerIndex);
    if (player && (player.name.startsWith('##2') || player.name.startsWith('##konpotas'))) {
        stateToSend.canPeek = !game.state.peekInfo.used[playerIndex] && game.state.turnIndex === playerIndex;
        stateToSend.peekedTile = game.state.peekInfo.tile[playerIndex];
    }
    
    stateToSend.yamaLength = game.state.yama.length;
    delete stateToSend.yama;
    delete stateToSend.deadWall;
    delete stateToSend.uraDoraIndicators;
    delete stateToSend.peekInfo;

    return stateToSend;
}

// ★観戦者用の完全なゲーム状態を返す関数を追加
function createSpectatorState() {
    if (!game || !game.state) return {};

    const stateToSend = {};
     for (const key in game.state) {
        if (key === 'players') {
            stateToSend.players = game.state.players.map(p => ({ 
                playerIndex: p.playerIndex, 
                name: p.name, 
                isCpu: p.isCpu 
            }));
        } else if (key !== 'turnTimer' && key !== 'waitingForAction') {
            stateToSend[key] = game.state[key];
        }
    }

    if (game.state.waitingForAction) {
        const { actionTimeout, ...rest } = game.state.waitingForAction;
        stateToSend.waitingForAction = rest;
    }
    if (game.state.turnTimer) {
        const { timeout, ...rest } = game.state.turnTimer;
        stateToSend.turnTimer = rest;
    }

    stateToSend.yamaLength = game.state.yama.length;
    delete stateToSend.yama;
    delete stateToSend.deadWall;
    delete stateToSend.uraDoraIndicators;
    delete stateToSend.peekInfo;

    return stateToSend;
}


server.listen(PORT, () => console.log(`サーバーがポート ${PORT} で起動しました。`));