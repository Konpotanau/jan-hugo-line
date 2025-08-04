// game-manager.js
const { createAllTiles, shuffle, tileSort } = require('./constants.js');
const { getWaits, checkYaku, getWinningForm, calculateFu, calculateScore, hasValidYaku, isYaochu, getDoraTile, isYakuhai, isNumberTile } = require('./yaku.js');

class Game {
    constructor(players, callbacks) {
        this.players = players; // { playerIndex, isCpu, ws? }
        this.callbacks = callbacks; // { onUpdate, onResult, onSystemMessage }
        this.state = null;
    }

    setupNewRound(isFirstGame = false) {
        console.log("新しいラウンドをセットアップします...");
        
        if (isFirstGame) {
            this.state = {
                scores: [25000, 25000, 25000, 25000],
                bakaze: "東",
                kyoku: 1,
                honba: 0,
                riichiSticks: 0,
                oyaIndex: 0,
            };
        }
        
        this.state.hands = [[], [], [], []];
        this.state.furos = [[], [], [], []];
        this.state.discards = [[], [], [], []];
        this.state.isRiichi = [false, false, false, false];
        this.state.isIppatsu = [false, false, false, false];
        this.state.isFuriten = [false, false, false, false]; 
        this.state.temporaryFuriten = [false, false, false, false];
        this.state.waitingForAction = null;
        this.state.turnActions = null;
        this.state.drawnTile = null;
        this.state.lastKanContext = null;
        this.state.pendingKakan = null;
        // ★ ターンごとのタイマー情報を追加
        this.state.turnTimer = null;
        this.state.lastDiscard = null; // 最後の捨て牌情報を初期化
    
        const winds = ["東", "南", "西", "北"];
        this.state.jikazes = winds.map((_, i) => winds[(i - this.state.oyaIndex + 4) % 4]);
        
        const allTiles = createAllTiles();
        shuffle(allTiles);
    
        this.state.deadWall = allTiles.slice(0, 14);
        this.state.yama = allTiles.slice(14);
        this.state.doraIndicators = [this.state.deadWall[4]];
        this.state.uraDoraIndicators = [this.state.deadWall[5]];
        this.state.dora = this.state.doraIndicators.map(getDoraTile);
    
        for (let i = 0; i < 4; i++) {
            const hand = this.state.yama.splice(0, 13);
            hand.sort(tileSort);
            this.state.hands[i] = hand;
        }
        
        this.state.turnIndex = this.state.oyaIndex;
        this.state.gameStarted = true;
        
        this.processTurn();
    }
    
    processTurn() {
        this.state.temporaryFuriten[this.state.turnIndex] = false;
        
        const playerIndex = this.state.turnIndex;
        
        this.updateFuritenState(playerIndex);
        
        this.drawTile(playerIndex);
    
        const isCpu = this.players.some(p => p.playerIndex === playerIndex && p.isCpu);
        if (isCpu) {
            setTimeout(() => this.handleCpuTurn(playerIndex), 1000);
        }
    }

    drawTile(playerIndex, isRinshan = false) {
        if (this.state.yama.length <= 0) {
            this.handleDraw('exhaustive');
            return;
        }
    
        const drawnTile = isRinshan ? this.state.deadWall.pop() : this.state.yama.pop();
        
        this.state.hands[playerIndex].push(drawnTile);
        this.state.drawnTile = drawnTile;
    
        if (isRinshan) {
            this.state.lastKanContext = { rinshanWinner: playerIndex };
        }
    
        console.log(`Player ${playerIndex} がツモりました。残り牌山: ${this.state.yama.length}枚`);
        
        // ★ ターンタイマーを設定
        const DISCARD_TIMEOUT_MS = 15000;
        if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
        this.state.turnTimer = {
            startTime: Date.now(),
            duration: DISCARD_TIMEOUT_MS,
            timeout: setTimeout(() => this.handleAutoDiscard(playerIndex), DISCARD_TIMEOUT_MS)
        };
        
        this.checkForTurnActions(playerIndex);
        this.callbacks.onUpdate();
    }
    
    // ★ タイムアウト時にツモ切りまたは手動で打牌する処理を修正
    handleAutoDiscard(playerIndex) {
        if (this.state.turnIndex !== playerIndex) {
            return; 
        }

        // ツモ牌があればそれを、なければ（鳴きの後など）手牌の最後の牌を捨てる
        const tileToDiscard = this.state.drawnTile || this.state.hands[playerIndex][this.state.hands[playerIndex].length - 1];

        if (!tileToDiscard) {
            console.error(`Player ${playerIndex} timed out, but no tile to discard.`);
            return;
        }

        console.log(`Player ${playerIndex} timed out. Auto-discarding ${tileToDiscard}`);
        this.handleDiscard(playerIndex, tileToDiscard);
    }


    handleDiscard(playerIndex, tile) {
        if (this.state.turnIndex !== playerIndex) return;

        // ★ 打牌時にターンタイマーをクリア
        if (this.state.turnTimer) {
            clearTimeout(this.state.turnTimer.timeout);
            this.state.turnTimer = null;
        }

        if (this.state.isRiichi[playerIndex] && tile !== this.state.drawnTile) {
            console.error(`(Server) 不正な操作: リーチ中のPlayer ${playerIndex}がツモ牌 (${this.state.drawnTile}) 以外の牌 (${tile}) を捨てようとしました。`);
            return;
        }
    
        const hand = this.state.hands[playerIndex];
        const tileIndex = hand.lastIndexOf(tile);
        if (tileIndex === -1) {
            console.error("手牌にない牌を捨てようとしました:", tile);
            return;
        }
    
        hand.splice(tileIndex, 1);
        hand.sort(tileSort);
        this.state.drawnTile = null;
        this.state.lastKanContext = null;

        this.state.temporaryFuriten[playerIndex] = false;
    
        const isRiichiDeclare = this.state.turnActions && this.state.turnActions.isDeclaringRiichi;
        const discardObject = { tile, isRiichi: isRiichiDeclare || false };

        this.state.discards[playerIndex].push(discardObject);
        
        // ★★★ ここで最新の捨て牌情報を記録 ★★★
        this.state.lastDiscard = { 
            player: playerIndex, 
            tile: tile,
            // 各プレイヤーの捨て牌配列内でのインデックスも記録
            discardIndex: this.state.discards[playerIndex].length - 1 
        };
    
        if (isRiichiDeclare) {
            this.state.isRiichi[playerIndex] = true;
            this.state.isIppatsu = [true, true, true, true];
            this.state.scores[playerIndex] -= 1000;
            this.state.riichiSticks++;
        }
        
        if (this.state.discards.every(d => d.length === 1)) {
            const firstDiscards = this.state.discards.map(d => d[0].tile);
            if ( /^[東西南北]$/.test(firstDiscards[0]) && firstDiscards.every(t => t === firstDiscards[0])) {
                setTimeout(() => this.handleDraw('suufon_renda'), 500);
                return;
            }
        }
    
        if (isRiichiDeclare && this.state.isRiichi.filter(Boolean).length === 4) {
            setTimeout(() => this.handleDraw('suucha_riichi'), 500);
            return;
        }

        this.updateAllFuritenStates();
        
        console.log(`Player ${playerIndex} が ${tile} を捨てました。`);
        
        this.state.turnActions = null;
        this.checkForActionsAfterDiscard(playerIndex, tile, false);
    }

    checkForTurnActions(playerIndex) {
        const hand = this.state.hands[playerIndex];
        const furo = this.state.furos[playerIndex];
        const actions = { canTsumo: false, canRiichi: false, canKakan: [], canAnkan: [], isDeclaringRiichi: false, canKyuKyu: false };
    
        const winForm = getWinningForm(hand, furo);
        if (winForm) {
            const winContext = { hand, furo, winTile: this.state.drawnTile, isTsumo: true, isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu[playerIndex], isRinshan: !!this.state.lastKanContext, isChankan: false, dora: this.state.dora, uraDora: null, bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex] };
            const yakuResult = checkYaku(winContext);
            if (yakuResult.totalHan > 0) {
                actions.canTsumo = true;
            }
        }
    
        const isMenzen = furo.length === 0;
        if (isMenzen && !this.state.isRiichi[playerIndex] && this.state.scores[playerIndex] >= 1000 && this.state.yama.length >= 4 && !this.state.isFuriten[playerIndex] && !this.state.temporaryFuriten[playerIndex]) {
            for (const tileToDiscard of new Set(hand)) {
                const tempHand = [...hand];
                tempHand.splice(tempHand.indexOf(tileToDiscard), 1);
                if (getWaits(tempHand, []).length > 0) {
                    actions.canRiichi = true;
                    break;
                }
            }
        }
    
        const isFirstTurnForPlayer = this.state.discards[playerIndex].length === 0 && this.state.furos[playerIndex].length === 0;
        const isOverallFirstTurn = this.state.discards.every(d => d.length === 0);
    
        if (isMenzen && isFirstTurnForPlayer && isOverallFirstTurn) {
            const uniqueYaochu = new Set(hand.filter(isYaochu));
            if (uniqueYaochu.size >= 9) {
                actions.canKyuKyu = true;
            }
        }
        
        if (!this.state.isRiichi[playerIndex]) {
            const handCounts = hand.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
            furo.forEach(f => {
                if (f.type === 'pon' && handCounts[f.tiles[0]]) {
                    actions.canKakan.push(f.tiles[0]);
                }
            });
            for (const tile in handCounts) {
                if (handCounts[tile] === 4) {
                    actions.canAnkan.push(tile);
                }
            }
        }
    
        if (actions.canTsumo || actions.canRiichi || actions.canKakan.length > 0 || actions.canAnkan.length > 0 || actions.canKyuKyu) {
            this.state.turnActions = actions;
        } else {
            this.state.turnActions = null;
        }
    }

    checkForActionsAfterDiscard(discarderIndex, tile, isKakan = false) {
        const possibleActions = [null, null, null, null];
        let canAnyoneAct = false;
        let hasPriorityAction = false; 
    
        if (!isKakan) {
        }

        for (let i = 0; i < 4; i++) {
            if (i === discarderIndex) continue;
            
            const playerActions = { canRon: false, canPon: false, canDaiminkan: false, canChi: [] };
            const hand = this.state.hands[i];
            const furo = this.state.furos[i];
    
            const isFuriten = this.state.isFuriten[i] || this.state.temporaryFuriten[i];
            if (!isFuriten) {
                const winnableHand = [...hand, tile];
                const winForm = getWinningForm(winnableHand, furo);
                if (winForm) {
                    const tempWinContext = {
                        hand: winnableHand, furo, winTile: tile, isTsumo: false, 
                        isRiichi: this.state.isRiichi[i], 
                        isIppatsu: this.state.isIppatsu.some(Boolean) && !isKakan,
                        isRinshan: false, 
                        isChankan: isKakan,
                        dora: this.state.dora, uraDora: [], 
                        bakaze: this.state.bakaze, jikaze: this.state.jikazes[i]
                    };
                    const yakuResult = checkYaku(tempWinContext);
                    if (yakuResult.totalHan > 0) {
                        playerActions.canRon = true;
                    }
                }
            }
    
            if (!isKakan && !this.state.isRiichi[i]) {
                if (hand.filter(t => t === tile).length >= 2) playerActions.canPon = true;
                if (hand.filter(t => t === tile).length >= 3) playerActions.canDaiminkan = true;
        
                if (i === (discarderIndex + 1) % 4 && /^[1-9][mps]$/.test(tile)) {
                    const num = parseInt(tile[0]);
                    const suit = tile[1];
                    const counts = hand.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
        
                    if (num > 2 && counts[`${num-2}${suit}`] && counts[`${num-1}${suit}`]) playerActions.canChi.push([`${num-2}${suit}`, `${num-1}${suit}`]);
                    if (num > 1 && num < 9 && counts[`${num-1}${suit}`] && counts[`${num+1}${suit}`]) playerActions.canChi.push([`${num-1}${suit}`, `${num+1}${suit}`]);
                    if (num < 8 && counts[`${num+1}${suit}`] && counts[`${num+2}${suit}`]) playerActions.canChi.push([`${num+1}${suit}`, `${num+2}${suit}`]);
                }
            }
            
            if (playerActions.canRon || playerActions.canPon || playerActions.canDaiminkan || playerActions.canChi.length > 0) {
                possibleActions[i] = playerActions;
                canAnyoneAct = true;
                if (playerActions.canRon || playerActions.canPon || playerActions.canDaiminkan) hasPriorityAction = true;
            }
        }
    
        if (canAnyoneAct) {
            const ACTION_TIMEOUT_MS = hasPriorityAction ? 10000 : 5000;
            // ★★★ 修正箇所: waitingForActionにtimer情報を追加 ★★★
            this.state.waitingForAction = { 
                discarderIndex, 
                tile, 
                possibleActions, 
                responses: {}, 
                timer: { // timer情報をまとめる
                    startTime: Date.now(),
                    duration: ACTION_TIMEOUT_MS,
                },
                actionTimeout: setTimeout(() => this.handleResponseToAction(null, {type: 'timeout'}), ACTION_TIMEOUT_MS),
            };

            // --- CPU REACTION LOGIC ---
            this.players.forEach(player => {
                if(player.isCpu && possibleActions[player.playerIndex] && !this.state.waitingForAction.responses[player.playerIndex]){
                    setTimeout(() => {
                        // Check if action is still available
                        if(this.state.waitingForAction && this.state.waitingForAction.possibleActions[player.playerIndex]){
                             const cpuAction = this.getCpuReaction(player.playerIndex, tile, discarderIndex);
                             this.handleResponseToAction(player.playerIndex, cpuAction);
                        }
                    }, 500 + Math.random() * 1000); // Add some delay
                }
            });

            this.callbacks.onUpdate();
        } else {
            if (this.state.pendingKakan) {
                this.finalizeKakan();
            } else {
                this.state.isIppatsu = [false, false, false, false];
                this.proceedToNextTurn(discarderIndex);
            }
        }
    }

    handlePlayerAction(playerIndex, action) {
        if (this.state.turnIndex === playerIndex) {
             // ★ 自分のターンのアクション実行時にタイマーをクリア
            if (this.state.turnTimer) {
                clearTimeout(this.state.turnTimer.timeout);
                this.state.turnTimer = null;
            }
        }

        if (this.state.isRiichi[playerIndex]) {
            if (action.type === 'tsumo' && this.state.turnActions && this.state.turnActions.canTsumo) {
                this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true, false);
            }
            return;
        }

        if (this.state.turnActions && this.state.turnIndex === playerIndex) {
            if (action.type === 'tsumo') {
                this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true, false);
                return;
            }
            if (action.type === 'riichi') {
                this.state.turnActions.isDeclaringRiichi = true;
                // ★ リーチ宣言時はタイマーをリセットして打牌を待つ
                 const DISCARD_TIMEOUT_MS = 15000;
                 if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                 this.state.turnTimer = {
                     startTime: Date.now(),
                     duration: DISCARD_TIMEOUT_MS,
                     timeout: setTimeout(() => this.handleAutoDiscard(playerIndex), DISCARD_TIMEOUT_MS)
                 };
                this.callbacks.onUpdate();
                return;
            }
            if (action.type === 'kan') {
                this.handleKan(playerIndex, action.tile, action.kanType);
                return;
            }
            if (action.type === 'kyukyu') {
                this.handleDraw('kyuushuu_kyuuhai', { playerIndex });
                return;
            }
        }
        if (this.state.waitingForAction) {
            this.handleResponseToAction(playerIndex, action);
        }
    }
    
    handleResponseToAction(playerIndex, action) {
        const wa = this.state.waitingForAction;
        if (!wa) return;
    
        if (playerIndex !== null) {
            wa.responses[playerIndex] = action;
        }

        const actingPlayers = this.players.filter(p => wa.possibleActions[p.playerIndex]);
        const respondedPlayers = Object.keys(wa.responses).map(Number);
        
        // --- TIMEOUT or ALL RESPONDED ---
        // 人間プレイヤーが全員応答したか、もしくはタイムアウトした場合に処理を進める
        const humanPlayersWithActions = actingPlayers.filter(p => !p.isCpu);
        const haveAllHumansResponded = humanPlayersWithActions.every(p => respondedPlayers.includes(p.playerIndex));

        if (action.type === 'timeout' || haveAllHumansResponded) {
            // タイムアウトしたCPUがいたら、スキップさせる
            const pendingCpus = actingPlayers.filter(p => p.isCpu && !respondedPlayers.includes(p.playerIndex));
            pendingCpus.forEach(cpu => wa.responses[cpu.playerIndex] = {type: 'skip'});

            clearTimeout(wa.actionTimeout);
    
            const potentialRonners = this.players.map(p => p.playerIndex).filter(pIdx => wa.possibleActions[pIdx]?.canRon);
            potentialRonners.forEach(pIdx => {
                const response = wa.responses[pIdx];
                if (!response || response.type !== 'ron') {
                    console.log(`Player ${pIdx} がロン/搶槓を見逃しました。`);
                    if (this.state.isRiichi[pIdx]) {
                        this.state.isFuriten[pIdx] = true; 
                        console.log(`Player ${pIdx} はリーチ後のため永続フリテンになります。`);
                    } else {
                        this.state.temporaryFuriten[pIdx] = true;
                        console.log(`Player ${pIdx} は同巡フリテンになります。`);
                    }
                }
            });

            this.state.waitingForAction = null;

            const ronResponses = Object.entries(wa.responses).filter(([, r]) => r.type === 'ron');
            const ponAction = Object.values(wa.responses).find(r => r.type === 'pon');
            const daiminkanAction = Object.values(wa.responses).find(r => r.type === 'daiminkan');
            const chiAction = Object.values(wa.responses).find(r => r.type === 'chi');
            
            if (ronResponses.length > 0 || ponAction || daiminkanAction || chiAction) {
                this.state.isIppatsu = [false, false, false, false];
            }

            if (ronResponses.length >= 3) {
                console.log("三家和 (Sanchaho) のため途中流局します。");
                this.handleDraw('sancha_ho');
                return;
            }
    
            if (ronResponses.length > 0) {
                let winnerIndex = -1;
                let minDiff = 4;
                ronResponses.forEach(([pIdxStr]) => {
                    const pIdx = Number(pIdxStr);
                    const diff = (pIdx - wa.discarderIndex + 4) % 4;
                    if (diff < minDiff) {
                        minDiff = diff;
                        winnerIndex = pIdx;
                    }
                });

                const isChankan = !!this.state.pendingKakan;
                if(isChankan) console.log(`搶槓成立！ Player ${winnerIndex} が和了`);

                this.state.pendingKakan = null; 
                this.handleWin(winnerIndex, wa.discarderIndex, wa.tile, false, isChankan);

            } else if (ponAction || daiminkanAction) {
                const actionPlayerIndex = Number(Object.keys(wa.responses).find(pIdx => wa.responses[pIdx] === (ponAction || daiminkanAction)));
                if (ponAction) {
                    const hand = this.state.hands[actionPlayerIndex];
                    for(let i=0; i<2; i++) hand.splice(hand.lastIndexOf(wa.tile), 1);
                    this.state.furos[actionPlayerIndex].push({type: 'pon', tiles: [wa.tile, wa.tile, wa.tile], from: wa.discarderIndex});
                    
                    // ★★★ ここから修正 ★★★
                    this.state.turnIndex = actionPlayerIndex;
                    this.state.drawnTile = null;
                    this.state.turnActions = null;

                    const DISCARD_TIMEOUT_MS = 15000;
                    if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                    this.state.turnTimer = {
                        startTime: Date.now(),
                        duration: DISCARD_TIMEOUT_MS,
                        timeout: setTimeout(() => this.handleAutoDiscard(actionPlayerIndex), DISCARD_TIMEOUT_MS)
                    };

                    this.callbacks.onUpdate();

                    const isCpu = this.players.some(p => p.playerIndex === actionPlayerIndex && p.isCpu);
                    if (isCpu) {
                        setTimeout(() => this.handleCpuTurn(actionPlayerIndex), 1000);
                    }
                    // ★★★ ここまで修正 ★★★

                } else { // Daiminkan
                    this.handleKan(actionPlayerIndex, wa.tile, 'daiminkan', wa.discarderIndex);
                }
            } else if (chiAction) {
                const actionPlayerIndex = Number(Object.keys(wa.responses).find(pIdx => wa.responses[pIdx] === chiAction));
                const hand = this.state.hands[actionPlayerIndex];
                chiAction.tiles.forEach(t => hand.splice(hand.indexOf(t), 1));
                
                const meldTiles = [...chiAction.tiles, wa.tile].sort(tileSort);
                this.state.furos[actionPlayerIndex].push({type: 'chi', tiles: meldTiles, from: wa.discarderIndex, called: wa.tile});

                // ★★★ ここから修正 ★★★
                this.state.turnIndex = actionPlayerIndex;
                this.state.drawnTile = null;
                this.state.turnActions = null;

                const DISCARD_TIMEOUT_MS = 15000;
                if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                this.state.turnTimer = {
                    startTime: Date.now(),
                    duration: DISCARD_TIMEOUT_MS,
                    timeout: setTimeout(() => this.handleAutoDiscard(actionPlayerIndex), DISCARD_TIMEOUT_MS)
                };

                this.callbacks.onUpdate();

                const isCpu = this.players.some(p => p.playerIndex === actionPlayerIndex && p.isCpu);
                if (isCpu) {
                    setTimeout(() => this.handleCpuTurn(actionPlayerIndex), 1000);
                }
                // ★★★ ここまで修正 ★★★

            } else {
                if (this.state.pendingKakan) {
                    this.finalizeKakan();
                } else {
                    this.state.isIppatsu = [false, false, false, false];
                    this.proceedToNextTurn(wa.discarderIndex);
                }
            }
        }
    }

    handleKan(playerIndex, tile, kanType, fromIndex = playerIndex) {
        if (kanType === 'kakan') {
            console.log(`Player ${playerIndex} が加槓 (${tile}) を試みます。搶槓チェック...`);
            this.state.pendingKakan = { playerIndex, tile };
            this.checkForActionsAfterDiscard(playerIndex, tile, true);
            return;
        }

        const hand = this.state.hands[playerIndex];
        if (kanType === 'ankan') {
            for (let i = 0; i < 4; i++) hand.splice(hand.lastIndexOf(tile), 1);
            this.state.furos[playerIndex].push({ type: 'ankan', tiles: [tile, tile, tile, tile], from: playerIndex });
        } else if (kanType === 'daiminkan') {
            for (let i = 0; i < 3; i++) hand.splice(hand.lastIndexOf(tile), 1);
            this.state.furos[playerIndex].push({ type: 'daiminkan', tiles: [tile, tile, tile, tile], from: fromIndex });
        }
        
        this.performKanPostActions(playerIndex);
    }

    finalizeKakan() {
        if (!this.state.pendingKakan) return;
        const { playerIndex, tile } = this.state.pendingKakan;
        console.log(`搶槓は発生しませんでした。Player ${playerIndex} の加槓 (${tile}) が成立します。`);

        const hand = this.state.hands[playerIndex];
        hand.splice(hand.indexOf(tile), 1);
        const furoToUpdate = this.state.furos[playerIndex].find(f => f.type === 'pon' && f.tiles[0] === tile);
        furoToUpdate.type = 'kakan';
        furoToUpdate.tiles.push(tile);

        this.state.pendingKakan = null;
        this.performKanPostActions(playerIndex);
    }
    
    performKanPostActions(playerIndex) {
        const totalKans = this.state.furos.flat().filter(f => f.type.includes('kan')).length;
        if (totalKans === 4) {
            const kanMakers = new Set();
            this.state.furos.forEach((playerFuros, pIdx) => {
                playerFuros.forEach(f => {
                    if (f.type.includes('kan')) kanMakers.add(pIdx);
                });
            });
            if (kanMakers.size > 1) {
                setTimeout(() => this.handleDraw('suukaikan'), 500);
                return;
            }
        }

        this.state.turnIndex = playerIndex;
        this.state.turnActions = null;
        this.state.isIppatsu = [false, false, false, false];
        this.state.lastKanContext = null;

        this.state.doraIndicators.push(this.state.deadWall[6 + (this.state.doraIndicators.length - 1) * 2]);
        this.state.dora = this.state.doraIndicators.map(getDoraTile);

        this.drawTile(playerIndex, true);
    }

    
    proceedToNextTurn(lastPlayerIndex) {
        this.state.waitingForAction = null;
        this.state.turnIndex = (lastPlayerIndex + 1) % 4;
        this.processTurn();
    }
    
    handleWin(winnerIndex, fromIndex, winTile, isTsumo, isChankan = false) {
        this.state.gameStarted = false;
        
        // ★ すべてのタイマーをクリア
        if (this.state.turnTimer) {
            clearTimeout(this.state.turnTimer.timeout);
            this.state.turnTimer = null;
        }
        if (this.state.waitingForAction) {
            clearTimeout(this.state.waitingForAction.actionTimeout);
            this.state.waitingForAction = null;
        }

        let winnerHand = isTsumo ? [...this.state.hands[winnerIndex]] : [...this.state.hands[winnerIndex], winTile];
        winnerHand.sort(tileSort);
        
        const isIppatsu = isTsumo ? this.state.isIppatsu[winnerIndex] : Object.values(this.state.isIppatsu).some(Boolean);
        const isDealer = this.state.oyaIndex === winnerIndex;
    
        const winContext = { 
            hand: winnerHand, 
            furo: this.state.furos[winnerIndex], 
            winTile, 
            isTsumo, 
            isRiichi: this.state.isRiichi[winnerIndex], 
            isIppatsu, 
            isRinshan: isTsumo && this.state.lastKanContext?.rinshanWinner === winnerIndex, 
            isChankan,
            dora: this.state.dora, 
            uraDora: this.state.isRiichi[winnerIndex] ? this.state.uraDoraIndicators.map(getDoraTile) : [], 
            bakaze: this.state.bakaze, 
            jikaze: this.state.jikazes[winnerIndex] 
        };
    
        const yakuResult = checkYaku(winContext);
        if (!hasValidYaku(yakuResult.yakuList)) { 
            console.error("役なしエラー（フリテンなどのチェック漏れの可能性）"); 
            this.handleDraw('exhaustive');
            return; 
        }
        
        const winForm = getWinningForm(winnerHand, this.state.furos[winnerIndex]);
        const fu = calculateFu(winForm, yakuResult.yakuList, winContext);
        const scoreResult = calculateScore(yakuResult.totalHan, fu, isDealer, isTsumo);
        
        const honbaPayment = this.state.honba * 300;
        const riichiStickPayment = this.state.riichiSticks * 1000;
        
        if (isTsumo) {
            this.state.scores[winnerIndex] += scoreResult.total + honbaPayment + riichiStickPayment;
            for (let i = 0; i < 4; i++) {
                if (i === winnerIndex) continue;
                const payment = (i === this.state.oyaIndex) ? scoreResult.payments[0] : (scoreResult.payments.length > 1 ? scoreResult.payments[1] : scoreResult.payments[0] / 2);
                this.state.scores[i] -= payment + (isDealer ? (this.state.honba * 100) : (i === this.state.oyaIndex ? this.state.honba * 100 : this.state.honba * 100));
            }
        } else {
            this.state.scores[winnerIndex] += scoreResult.total + honbaPayment + riichiStickPayment;
            this.state.scores[fromIndex] -= scoreResult.total + honbaPayment;
        }
    
        this.state.riichiSticks = 0;
    
        const roundResult = { type: 'win', winnerIndex, fromIndex, winTile, isTsumo, hand: winnerHand, furo: this.state.furos[winnerIndex], yakuList: yakuResult.yakuList, fu, han: yakuResult.totalHan, scoreResult, finalScores: this.state.scores, doraIndicators: this.state.doraIndicators, uraDoraIndicators: this.state.isRiichi[winnerIndex] ? this.state.uraDoraIndicators : [] };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(isDealer), 10000);
    }
    
    handleDraw(drawType, context = {}) {
        this.state.gameStarted = false;
        
        // ★ すべてのタイマーをクリア
        if (this.state.turnTimer) {
            clearTimeout(this.state.turnTimer.timeout);
            this.state.turnTimer = null;
        }
        if (this.state.waitingForAction) {
            clearTimeout(this.state.waitingForAction.actionTimeout);
            this.state.waitingForAction = null;
        }

        let isOyaTenpai = false;
        let tenpaiPlayers = [];
    
        if (drawType === 'exhaustive') {
            const playerStates = [0, 1, 2, 3].map(i => ({ index: i, isTenpai: getWaits(this.state.hands[i], this.state.furos[i]).length > 0 }));
            tenpaiPlayers = playerStates.filter(p => p.isTenpai).map(p => p.index);
            const notenPlayers = playerStates.filter(p => !p.isTenpai).map(p => p.index);
            isOyaTenpai = tenpaiPlayers.includes(this.state.oyaIndex);
    
            if (tenpaiPlayers.length > 0 && tenpaiPlayers.length < 4) {
                const payment = 3000 / tenpaiPlayers.length;
                const receipt = 3000 / notenPlayers.length;
                tenpaiPlayers.forEach(pIdx => this.state.scores[pIdx] += receipt);
                notenPlayers.forEach(pIdx => this.state.scores[pIdx] -= payment);
            }
        } else {
            isOyaTenpai = true;
        }
    
        const roundResult = { type: 'draw', drawType, tenpaiPlayers, finalScores: this.state.scores, ...context };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(isOyaTenpai), 10000);
    }
    
    startNextRound(isRenchan) {
        if (isRenchan) {
            this.state.honba++;
        } else {
            this.state.honba = 0;
            const currentOya = this.state.oyaIndex;
            this.state.oyaIndex = (currentOya + 1) % 4;
    
            if (this.state.bakaze === "南" && this.state.kyoku === 4 && this.state.oyaIndex === 0) {
                 this.callbacks.onSystemMessage("ゲーム終了です。");
                 return;
            }
            if (currentOya === 3) {
                this.state.bakaze = this.state.bakaze === "東" ? "南" : "西"; // 次の風へ
                this.state.kyoku = 1;
            } else {
                this.state.kyoku++;
            }
        }
        this.setupNewRound();
    }
    
    // --- START: CPU LOGIC ENHANCEMENT ---

    handleCpuTurn(playerIndex) {
        if (this.state.turnIndex !== playerIndex) return;
        
        // ★ 修正: ツモ牌がある場合のみツモ和了をチェック
        if (this.state.drawnTile && this.state.turnActions && this.state.turnActions.canTsumo) {
            console.log(`CPU ${playerIndex} がツモ和了を選択しました。`);
            setTimeout(() => this.handlePlayerAction(playerIndex, { type: 'tsumo' }), 500);
            return;
        }
        
        // 2. Choose discard
        const tileToDiscard = this.evaluateAndChooseDiscard(playerIndex);
        
        console.log(`CPU ${playerIndex} が ${tileToDiscard} を捨てます。`);
        setTimeout(() => this.handleDiscard(playerIndex, tileToDiscard), 500);
    }

    /**
     * CPUが捨てる牌を評価・選択する
     * @param {number} playerIndex - CPUのプレイヤーインデックス
     * @returns {string} 捨てるべき牌
     */
    evaluateAndChooseDiscard(playerIndex) {
        const hand = [...this.state.hands[playerIndex]];
        hand.sort(tileSort);

        // --- 1. Defensive Logic: Check for Riichi players ---
        const riichiPlayers = this.state.isRiichi.map((is, i) => is ? i : -1).filter(i => i !== -1 && i !== playerIndex);
        if (riichiPlayers.length > 0) {
            const safeTilesInHand = [];
            const allRiichiDiscards = new Set();
            riichiPlayers.forEach(riichiIdx => {
                this.state.discards[riichiIdx].forEach(d => allRiichiDiscards.add(d.tile));
            });

            hand.forEach(tile => {
                if (allRiichiDiscards.has(tile)) {
                    safeTilesInHand.push(tile);
                }
            });

            if (safeTilesInHand.length > 0) {
                console.log(`CPU ${playerIndex} is defending. Found safe tiles: ${safeTilesInHand.join(', ')}`);
                // 複数の安全牌がある場合、その中で最も不要な牌を評価して捨てる
                return this.findMostUselessTile(safeTilesInHand, playerIndex);
            }
        }
        
        // --- 2. Offensive Logic: Find the most useless tile in hand ---
        return this.findMostUselessTile(hand, playerIndex);
    }

    /**
     * 指定された牌のリストの中から最も不要な牌を見つける
     * @param {string[]} tiles - 評価対象の牌の配列
     * @param {number} playerIndex - CPUのプレイヤーインデックス
     * @returns {string} 最も不要な牌
     */
    findMostUselessTile(tiles, playerIndex) {
        const fullHand = this.state.hands[playerIndex];
        const counts = fullHand.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});

        let bestTileToDiscard = tiles[tiles.length - 1]; // Fallback
        let maxScore = -1;

        for (const tile of new Set(tiles)) {
            let score = 0;

            // 評価ロジック (高いほど不要)
            // a. 孤立した役牌か？
            if (isYakuhai(tile, this.state.bakaze, this.state.jikazes[playerIndex])) {
                score += (counts[tile] === 1) ? 0 : -10; // ペアなら保持
            } 
            // b. 孤立した字牌か？
            else if (!isNumberTile(tile)) {
                score += (counts[tile] === 1) ? 50 : 0; // 孤立オタ風は最優先で捨てる
            }
            // c. 孤立した数牌か？
            else {
                const num = parseInt(tile[0]);
                const suit = tile[1];
                let isIsolated = true;
                
                // 周辺の牌があるかチェック
                for (let i = -2; i <= 2; i++) {
                    if (i === 0) continue;
                    const neighbor = `${num + i}${suit}`;
                    if (counts[neighbor]) {
                        isIsolated = false;
                        score -= 5; // 関連牌があれば価値が上がる
                    }
                }

                if (isIsolated) {
                    score += 20;
                    // 端に近いほど価値が低い（鳴かれにくい）
                    score += Math.min(num - 1, 9 - num); // 1,9 -> 0; 2,8 -> 1; ... 5 -> 4
                }
                
                // ペアや刻子なら価値が高い
                if (counts[tile] >= 2) score -= 20;
                // ドラなら価値が高い
                if (this.state.dora.includes(tile)) score -= 50;
            }
            
            if (score > maxScore) {
                maxScore = score;
                bestTileToDiscard = tile;
            }
        }
        return bestTileToDiscard;
    }

    getCpuReaction(playerIndex, tile, discarderIndex) {
        const possibleActions = this.state.waitingForAction.possibleActions[playerIndex];
        if (!possibleActions) return { type: 'skip' };

        // 1. Ron Check (Highest Priority)
        if (possibleActions.canRon) {
            const hand = this.state.hands[playerIndex];
            const furo = this.state.furos[playerIndex];
            const winnableHand = [...hand, tile];
            const winContext = { 
                hand: winnableHand, furo, winTile: tile, isTsumo: false, 
                isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu.some(Boolean), 
                isRinshan: false, isChankan: !!this.state.pendingKakan, 
                dora: this.state.dora, uraDora: [], 
                bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex] 
            };
            if (checkYaku(winContext).totalHan > 0) {
                 console.log(`CPU ${playerIndex} がロンを選択しました。`);
                return { type: 'ron' };
            }
        }

        // 2. Meld (Pon/Daiminkan) Check
        // 現状、CPUはリーチしていない時のみ鳴く
        if (!this.state.isRiichi[playerIndex]) {
            if (possibleActions.canDaiminkan || possibleActions.canPon) {
                // 役牌なら鳴く
                if (isYakuhai(tile, this.state.bakaze, this.state.jikazes[playerIndex])) {
                    console.log(`CPU ${playerIndex} が役牌 (${tile}) のポン/カンを選択しました。`);
                    return possibleActions.canDaiminkan ? { type: 'daiminkan' } : { type: 'pon' };
                }
                // (ここに他の鳴き戦略を追加可能。例：断么九に向かう、聴牌するなど)
            }
            // チーは現状見送る（より高度な判断が必要なため）
            if (possibleActions.canChi.length > 0) {
                // (ここにチーの戦略を追加可能)
            }
        }

        // 3. Skip if no action is taken
        return { type: 'skip' };
    }

    // --- END: CPU LOGIC ENHANCEMENT ---
    
    isDiscardFuriten(playerIndex) {
        const waits = getWaits(this.state.hands[playerIndex], this.state.furos[playerIndex]);
        if (waits.length === 0) {
            return false;
        }
        const discardTiles = this.state.discards[playerIndex].map(d => d.tile);
        return waits.some(waitTile => discardTiles.includes(waitTile));
    }

    updateFuritenState(playerIndex) {
        const hadRonMissAfterRiichi = this.state.isFuriten[playerIndex] && this.state.isRiichi[playerIndex] && !this.isDiscardFuriten(playerIndex);
        if (hadRonMissAfterRiichi) {
             return;
        }
        this.state.isFuriten[playerIndex] = this.isDiscardFuriten(playerIndex);
    }

    updateAllFuritenStates() {
        for (let i = 0; i < 4; i++) {
            this.updateFuritenState(i);
        }
    }
}

module.exports = { Game };