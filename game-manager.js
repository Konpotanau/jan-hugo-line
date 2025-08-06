// game-manager.js
const { createAllTiles, shuffle, tileSort } = require('./constants.js');
const { getWaits, checkYaku, getWinningForm, calculateFu, calculateScore, hasValidYaku, isYaochu, isJi, getDoraTile, isYakuhai, isNumberTile, normalizeTile } = require('./yaku.js');

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
        
        this.state.roundKans = 0;
        this.state.isRevolution = false;
        
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
        this.state.pendingSpecialAction = null;
        this.state.turnTimer = null;
        this.state.lastDiscard = null;
    
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
            setTimeout(() => this.handleCpuTurn(playerIndex), 100 + Math.random() * 1000); 
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
    
        console.log(`Player ${playerIndex} がツモりました: ${drawnTile}。残り牌山: ${this.state.yama.length}枚`);
        
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
    
    handleAutoDiscard(playerIndex) {
        if (this.state.turnIndex !== playerIndex && !(this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex)) {
            return; 
        }
        
        if (this.state.pendingSpecialAction) {
             const pa = this.state.pendingSpecialAction;
             if (pa.type === 'nanawatashi') {
                 console.log(`Player ${playerIndex} (7わたし) timed out.`);
                 this.callbacks.onSystemMessage("7わたしの選択がタイムアウトしました。");
                 this.state.pendingSpecialAction = null;
                 this.proceedToNextTurn(this.state.turnIndex, this.state.lastDiscard?.tile);
             } else if (pa.type === 'kyusute') {
                 console.log(`Player ${playerIndex} (9捨て) timed out. Auto-discarding.`);
                 const hand = this.state.hands[playerIndex];
                 if (hand && hand.length > 0) {
                    const tileToDiscard = this.state.hands[playerIndex][this.state.hands[playerIndex].length - 1];
                    this.handlePlayerAction(playerIndex, { type: 'kyusute_discard', tile: tileToDiscard });
                 } else {
                    this.state.pendingSpecialAction = null;
                    this.proceedToNextTurn(this.state.turnIndex, this.state.lastDiscard?.tile);
                 }
             }
            return;
        }

        const tileToDiscard = this.state.drawnTile || this.state.hands[playerIndex][this.state.hands[playerIndex].length - 1];

        if (!tileToDiscard) {
            console.error(`Player ${playerIndex} timed out, but no tile to discard.`);
            this.proceedToNextTurn(playerIndex, null);
            return;
        }

        console.log(`Player ${playerIndex} timed out. Auto-discarding ${tileToDiscard}`);
        this.handleDiscard(playerIndex, tileToDiscard);
    }


    handleDiscard(playerIndex, tile) {
        if (!this.state.gameStarted) return;
        if (this.state.turnIndex !== playerIndex) return;

        // 9捨ての2枚目の打牌処理
        const pa = this.state.pendingSpecialAction;
        if(pa && pa.type === 'kyusute' && pa.playerIndex === playerIndex) {
             this.handlePlayerAction(playerIndex, { type: 'kyusute_discard', tile: tile });
             return;
        }

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
        
        this.state.lastDiscard = { 
            player: playerIndex, 
            tile: tile,
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
                setTimeout(() => this.handleDraw('suufon_renda'), 100);
                return;
            }
        }
    
        if (isRiichiDeclare && this.state.isRiichi.filter(Boolean).length === 4) {
            setTimeout(() => this.handleDraw('suucha_riichi'), 100);
            return;
        }

        this.updateAllFuritenStates();
        
        console.log(`Player ${playerIndex} が ${tile} を捨てました。`);
        
        this.state.turnActions = null;
        const canTriggerSpecialRule = !this.state.isRiichi[playerIndex];
        this.checkForActionsAfterDiscard(playerIndex, tile, false, canTriggerSpecialRule);
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
                if(tempHand.length === 0) continue;
                tempHand.splice(tempHand.lastIndexOf(tileToDiscard), 1);
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
                if (f.type === 'pon') {
                    const normTile = normalizeTile(f.tiles[0]);
                    const hasTileForKakan = hand.some(t => normalizeTile(t) === normTile);
                    if(hasTileForKakan) {
                        actions.canKakan.push(f.tiles[0]);
                    }
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

    checkForActionsAfterDiscard(discarderIndex, tile, isKakan = false, canTriggerSpecialRule = true) {
        const possibleActions = [null, null, null, null];
        let canAnyoneAct = false;
        let hasPriorityAction = false; 
    
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
                const normTile = normalizeTile(tile);
                const sameTilesInHand = hand.filter(t => normalizeTile(t) === normTile);
                if (sameTilesInHand.length >= 2) playerActions.canPon = true;
                if (sameTilesInHand.length >= 3) playerActions.canDaiminkan = true;
        
                if (i === (discarderIndex + 1) % 4 && isNumberTile(tile)) {
                    const num = parseInt(normalizeTile(tile)[0]);
                    const suit = normalizeTile(tile)[1];
                    const handNormCounts = hand.reduce((acc, t) => {
                        const norm = normalizeTile(t);
                        if (!acc[norm]) acc[norm] = [];
                        acc[norm].push(t);
                        return acc;
                    }, {});
        
                    const findTiles = (nums) => {
                        const tempCounts = JSON.parse(JSON.stringify(handNormCounts));
                        const result = [];
                        for(const n of nums) {
                            const key = `${n}${suit}`;
                            if(!tempCounts[key] || tempCounts[key].length === 0) return null;
                            result.push(tempCounts[key].pop());
                        }
                        return result;
                    };

                    if (num > 2) {
                       const meld = findTiles([num - 2, num - 1]);
                       if (meld) playerActions.canChi.push(meld);
                    }
                    if (num > 1 && num < 9) {
                       const meld = findTiles([num - 1, num + 1]);
                       if (meld) playerActions.canChi.push(meld);
                    }
                    if (num < 8) {
                       const meld = findTiles([num + 1, num + 2]);
                       if (meld) playerActions.canChi.push(meld);
                    }
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
            this.state.waitingForAction = { 
                discarderIndex, 
                tile, 
                possibleActions, 
                responses: {}, 
                timer: {
                    startTime: Date.now(),
                    duration: ACTION_TIMEOUT_MS,
                },
                actionTimeout: setTimeout(() => this.handleResponseToAction(null, {type: 'timeout'}), ACTION_TIMEOUT_MS),
            };

            this.players.forEach(player => {
                if(player.isCpu && possibleActions[player.playerIndex] && !this.state.waitingForAction.responses[player.playerIndex]){
                    setTimeout(() => {
                        if(this.state.waitingForAction && this.state.waitingForAction.possibleActions[player.playerIndex]){
                             const cpuAction = this.getCpuReaction(player.playerIndex, tile, discarderIndex);
                             this.handleResponseToAction(player.playerIndex, cpuAction);
                        }
                    }, 100 + Math.random() * 1500);
                }
            });

            this.callbacks.onUpdate();
        } else {
            const isKyusute = tile.match(/^9[mps]$/);
            const isNanawatashi = tile.match(/^[r]?7[mps]$/);
            const SPECIAL_ACTION_TIMEOUT_MS = 15000;

            if (canTriggerSpecialRule && isKyusute) {
                this.state.pendingSpecialAction = { type: 'kyusute', playerIndex: discarderIndex };
                this.state.turnIndex = discarderIndex; 
                if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                this.state.turnTimer = {
                    startTime: Date.now(),
                    duration: SPECIAL_ACTION_TIMEOUT_MS,
                    timeout: setTimeout(() => this.handleAutoDiscard(discarderIndex), SPECIAL_ACTION_TIMEOUT_MS)
                };
                console.log(`Player ${discarderIndex} が9捨てを行いました。追加の打牌待ち。`);
                this.callbacks.onSystemMessage({ type: 'special_event', event: 'kyusute' });
                this.callbacks.onUpdate();
                const isCpu = this.players.some(p => p.playerIndex === discarderIndex && p.isCpu);
                if (isCpu) {
                    setTimeout(() => this.handleCpuTurn(discarderIndex), 1000 + Math.random() * 100);
                }
                return; 
            }
            if (canTriggerSpecialRule && isNanawatashi) {
                this.state.pendingSpecialAction = { type: 'nanawatashi', playerIndex: discarderIndex };
                this.state.turnIndex = discarderIndex;
                if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                this.state.turnTimer = {
                    startTime: Date.now(),
                    duration: SPECIAL_ACTION_TIMEOUT_MS,
                    timeout: setTimeout(() => this.handleAutoDiscard(discarderIndex), SPECIAL_ACTION_TIMEOUT_MS)
                };
                console.log(`Player ${discarderIndex} が7わたしを行いました。選択待ち。`);
                this.callbacks.onSystemMessage({ type: 'special_event', event: 'nanawatashi' });
                this.callbacks.onUpdate();
                const isCpu = this.players.some(p => p.playerIndex === discarderIndex && p.isCpu);
                if (isCpu) {
                    setTimeout(() => this.handleCpuTurn(discarderIndex), 1000 + Math.random() * 100);
                }
                return;
            }

            if (this.state.pendingKakan) {
                this.finalizeKakan();
            } else {
                this.state.isIppatsu = [false, false, false, false];
                this.proceedToNextTurn(discarderIndex, tile);
            }
        }
    }

    handlePlayerAction(playerIndex, action) {
        if (!this.state.gameStarted) return;

        if (this.state.turnIndex === playerIndex || (this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex)) {
             if (this.state.turnTimer) {
                clearTimeout(this.state.turnTimer.timeout);
                this.state.turnTimer = null;
            }
        }

        if (this.state.isRiichi[playerIndex] && this.state.turnIndex === playerIndex) {
            if (action.type === 'tsumo' && this.state.turnActions && this.state.turnActions.canTsumo) {
                this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true, false);
            }
            return;
        }
        
        if (this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex) {
            const pa = this.state.pendingSpecialAction;
            if (this.state.isRiichi[playerIndex]) {
                 console.error("リーチ中は特殊アクションを実行できません。");
                 return;
            }
            if (pa.type === 'kyusute' && action.type === 'kyusute_discard') {
                console.log(`Player ${playerIndex} が9捨ての2枚目として ${action.tile} を捨てます。`);
                this.state.pendingSpecialAction = null;
                this.state.turnIndex = playerIndex; 

                const hand = this.state.hands[playerIndex];
                const tileIndex = hand.lastIndexOf(action.tile);
                if (tileIndex === -1) {
                    console.error("9捨てエラー: 手牌にない牌を捨てようとしました:", action.tile);
                    this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                    return;
                }
                hand.splice(tileIndex, 1);
                hand.sort(tileSort);
                
                const discardObject = { tile: action.tile, isRiichi: false };
                this.state.discards[playerIndex].push(discardObject);
                this.state.lastDiscard = { 
                    player: playerIndex, 
                    tile: action.tile,
                    discardIndex: this.state.discards[playerIndex].length - 1 
                };
                
                this.callbacks.onUpdate();
                setTimeout(() => this.checkForActionsAfterDiscard(playerIndex, action.tile, false, !this.state.isRiichi[playerIndex]), 50);
                return;
            }
            
            if (pa.type === 'nanawatashi' && action.type === 'nanawatashi_select') {
                const { tileToGive, targetPlayerIndex } = action;

                if (this.state.isRiichi[targetPlayerIndex]) {
                    console.error("エラー: リーチ中のプレイヤーに7わたしはできません。");
                    this.callbacks.onSystemMessage("エラー: リーチ中のプレイヤーには渡せません。");
                    this.callbacks.onUpdate();
                    return;
                }
                if (playerIndex === targetPlayerIndex) {
                    console.error("エラー: 自分自身に7わたしはできません。");
                    this.callbacks.onSystemMessage("エラー: 自分自身には渡せません。");
                    this.callbacks.onUpdate();
                    return;
                }

                const hand = this.state.hands[playerIndex];
                const tileIndex = hand.indexOf(tileToGive);
                if (tileIndex > -1) {
                    const [givenTile] = hand.splice(tileIndex, 1);
                    this.state.hands[targetPlayerIndex].push(givenTile);
                    this.state.hands[targetPlayerIndex].sort(tileSort);
                    
                    console.log(`Player ${playerIndex} が ${givenTile} を Player ${targetPlayerIndex} に渡しました。`);
                    this.callbacks.onSystemMessage({
                        type: 'nanawatashi_event',
                        from: playerIndex,
                        to: targetPlayerIndex,
                        tile: givenTile
                    });

                    this.state.pendingSpecialAction = null;
                    
                    this.callbacks.onUpdate();

                    this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                } else {
                    console.error("7わたしエラー: 指定された牌が手牌にありません。");
                    this.callbacks.onSystemMessage("エラー: 渡そうとした牌が手牌にありません。");
                    this.state.pendingSpecialAction = null;
                    this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                }
                return;
            }
        }


        if (this.state.turnActions && this.state.turnIndex === playerIndex) {
            if (action.type === 'tsumo') {
                this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true, false);
                return;
            }
            if (action.type === 'riichi') {
                this.state.turnActions.isDeclaringRiichi = true;
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
        
        const allActingPlayersHaveResponded = actingPlayers.every(p => respondedPlayers.includes(p.playerIndex));

        if (action.type === 'timeout' || allActingPlayersHaveResponded) {
            if(action.type === 'timeout'){
                const pendingPlayers = actingPlayers.filter(p => !respondedPlayers.includes(p.playerIndex));
                pendingPlayers.forEach(p => wa.responses[p.playerIndex] = {type: 'skip'});
            }

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
                    const normTile = normalizeTile(wa.tile);
                    let removedCount = 0;
                    const ponTiles = [wa.tile];

                    for (let i = hand.length - 1; i >= 0 && removedCount < 2; i--) {
                        if (normalizeTile(hand[i]) === normTile) {
                            ponTiles.push(hand[i]);
                            hand.splice(i, 1);
                            removedCount++;
                        }
                    }
                    this.state.furos[actionPlayerIndex].push({type: 'pon', tiles: ponTiles.sort(tileSort), from: wa.discarderIndex});
                    
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
                        setTimeout(() => this.handleCpuTurn(actionPlayerIndex), 1000 + Math.random() * 100);
                    }

                } else { // Daiminkan
                    this.handleKan(actionPlayerIndex, wa.tile, 'daiminkan', wa.discarderIndex);
                }
            } else if (chiAction) {
                const actionPlayerIndex = Number(Object.keys(wa.responses).find(pIdx => wa.responses[pIdx] === chiAction));
                const hand = this.state.hands[actionPlayerIndex];
                chiAction.tiles.forEach(t => {
                    const idx = hand.indexOf(t);
                    if(idx > -1) hand.splice(idx, 1);
                });
                
                const meldTiles = [...chiAction.tiles, wa.tile].sort(tileSort);
                this.state.furos[actionPlayerIndex].push({type: 'chi', tiles: meldTiles, from: wa.discarderIndex, called: wa.tile});

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
                    setTimeout(() => this.handleCpuTurn(actionPlayerIndex), 100 + Math.random() * 1000);
                }

            } else {
                // 鳴かれなかった場合、ここで特殊ルールを再チェック
                const canTriggerSpecialRule = !this.state.isRiichi[wa.discarderIndex];
                const isKyusute = wa.tile.match(/^9[mps]$/);
                const isNanawatashi = wa.tile.match(/^[r]?7[mps]$/);
                const SPECIAL_ACTION_TIMEOUT_MS = 15000;

                if (canTriggerSpecialRule && isKyusute) {
                    this.state.pendingSpecialAction = { type: 'kyusute', playerIndex: wa.discarderIndex };
                    this.state.turnIndex = wa.discarderIndex; // ターンを維持
                    if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                    this.state.turnTimer = {
                        startTime: Date.now(),
                        duration: SPECIAL_ACTION_TIMEOUT_MS,
                        timeout: setTimeout(() => this.handleAutoDiscard(wa.discarderIndex), SPECIAL_ACTION_TIMEOUT_MS)
                    };
                    console.log(`Player ${wa.discarderIndex} が9捨てを行いました。追加の打牌待ち。`);
                    this.callbacks.onSystemMessage({ type: 'special_event', event: 'kyusute' });
                    this.callbacks.onUpdate();
                    if(this.players.find(p=>p.playerIndex === wa.discarderIndex && p.isCpu)){
                         setTimeout(() => this.handleCpuTurn(wa.discarderIndex), 100 + Math.random() * 1000);
                    }
                    return; 
                }
                if (canTriggerSpecialRule && isNanawatashi) {
                    this.state.pendingSpecialAction = { type: 'nanawatashi', playerIndex: wa.discarderIndex };
                    this.state.turnIndex = wa.discarderIndex; // ターンを維持
                    if (this.state.turnTimer) clearTimeout(this.state.turnTimer.timeout);
                    this.state.turnTimer = {
                        startTime: Date.now(),
                        duration: SPECIAL_ACTION_TIMEOUT_MS,
                        timeout: setTimeout(() => this.handleAutoDiscard(wa.discarderIndex), SPECIAL_ACTION_TIMEOUT_MS)
                    };
                    console.log(`Player ${wa.discarderIndex} が7わたしを行いました。選択待ち。`);
                    this.callbacks.onSystemMessage({ type: 'special_event', event: 'nanawatashi' });
                    this.callbacks.onUpdate();
                     if(this.players.find(p=>p.playerIndex === wa.discarderIndex && p.isCpu)){
                         setTimeout(() => this.handleCpuTurn(wa.discarderIndex), 100 + Math.random() * 1000);
                    }
                    return;
                }

                if (this.state.pendingKakan) {
                    this.finalizeKakan();
                } else {
                    this.state.isIppatsu = [false, false, false, false];
                    this.proceedToNextTurn(wa.discarderIndex, wa.tile);
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
            const normTile = normalizeTile(tile);
            let removedCount = 0;
            for (let i = hand.length - 1; i >= 0 && removedCount < 3; i--) {
                if (normalizeTile(hand[i]) === normTile) {
                    hand.splice(i, 1);
                    removedCount++;
                }
            }
            this.state.furos[playerIndex].push({ type: 'daiminkan', tiles: [tile, tile, tile, tile], from: fromIndex });
        }
        
        this.performKanPostActions(playerIndex);
    }

    finalizeKakan() {
        if (!this.state.pendingKakan) return;
        const { playerIndex, tile } = this.state.pendingKakan;
        console.log(`搶槓は発生しませんでした。Player ${playerIndex} の加槓 (${tile}) が成立します。`);

        const hand = this.state.hands[playerIndex];
        const normTile = normalizeTile(tile);
        
        const kakanTileIndex = hand.findIndex(t => normalizeTile(t) === normTile);
        if(kakanTileIndex > -1) {
            hand.splice(kakanTileIndex, 1);
        }

        const furoToUpdate = this.state.furos[playerIndex].find(f => f.type === 'pon' && normalizeTile(f.tiles[0]) === normTile);
        furoToUpdate.type = 'kakan';
        furoToUpdate.tiles.push(tile);

        this.state.pendingKakan = null;
        this.performKanPostActions(playerIndex);
    }
    
    performKanPostActions(playerIndex) {
        this.state.roundKans++;
        this.state.isRevolution = (this.state.roundKans % 2) === 1;
        console.log(`カンが成立しました。この局のカン回数: ${this.state.roundKans}, 革命状態: ${this.state.isRevolution}`);
        if(this.state.isRevolution){
            this.callbacks.onSystemMessage("革命！点数計算が反転します。");
        } else {
            if (this.state.roundKans > 0 && this.state.roundKans % 2 === 0) {
                 this.callbacks.onSystemMessage("革命終了。点数計算が元に戻ります。");
            }
        }

        const totalKansInRound = this.state.furos.flat().filter(f => f.type.includes('kan')).length;
        if (totalKansInRound >= 4) {
            const kanMakers = new Set();
            this.state.furos.forEach((playerFuros, pIdx) => {
                playerFuros.forEach(f => {
                    if (f.type.includes('kan')) kanMakers.add(pIdx);
                });
            });
            if (kanMakers.size > 1) {
                setTimeout(() => this.handleDraw('suukaikan'), 100);
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

    
    proceedToNextTurn(lastPlayerIndex, discardedTile) {
        this.state.waitingForAction = null;
        this.state.pendingSpecialAction = null; 
    
        const isGotoshi = discardedTile && discardedTile.match(/^[r]?5[mps]$/);
        const isHachigiri = discardedTile && discardedTile.match(/^8[mps]$/);
    
        if (isGotoshi) {
            this.state.turnIndex = (lastPlayerIndex + 2) % 4;
            const skippedPlayerIndex = (lastPlayerIndex + 1) % 4;
            console.log(`5とばし！ Player ${lastPlayerIndex} -> Player ${this.state.turnIndex} (Player ${skippedPlayerIndex} をスキップ)`);
            this.callbacks.onSystemMessage({ type: 'special_event', event: 'gotobashi' });
        } else if (isHachigiri) {
            this.state.turnIndex = lastPlayerIndex;
            console.log(`8切り！ Player ${lastPlayerIndex} がもう一度ツモります。`);
            this.callbacks.onSystemMessage({ type: 'special_event', event: 'hachigiri' });
        } else {
            this.state.turnIndex = (lastPlayerIndex + 1) % 4;
        }
    
        this.processTurn();
    }
    
    handleWin(winnerIndex, fromIndex, winTile, isTsumo, isChankan = false) {
        this.state.gameStarted = false;
        
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
        
        const originalHan = yakuResult.isYakuman ? (yakuResult.totalHan - (yakuResult.yakuList.find(y => y.name === "ドラ")?.han || 0)) : yakuResult.yakuList.reduce((s, y) => (y.name !== 'ドラ' ? s + y.han : s), 0);
        let finalHan = yakuResult.totalHan;
        let hanForCalc = originalHan;
        
        const doraHan = yakuResult.yakuList.find(y => y.name === 'ドラ')?.han || 0;

        if (this.state.isRevolution && !yakuResult.isYakuman) {
            console.log("革命中のため翻数を反転します。");
            if (hanForCalc >= 13) hanForCalc = 13; // 役満以上は13としてカウント

            const yakuHanOnly = hanForCalc;
            let revolutionaryHan = (14 - yakuHanOnly);
            if (revolutionaryHan <= 0) revolutionaryHan = 1;

            finalHan = revolutionaryHan + doraHan;
            console.log(`元の役翻数: ${yakuHanOnly}, ドラ: ${doraHan} => 革命後の翻数: ${finalHan}`);
        } else if (this.state.isRevolution && yakuResult.isYakuman) {
            console.log("革命中ですが役満は影響を受けません。");
        }
        
        const scoreResult = calculateScore(finalHan, fu, isDealer, isTsumo);
        
        const honbaPayment = this.state.honba * 300;
        const riichiStickPayment = this.state.riichiSticks * 1000;
        
        if (isTsumo) {
            this.state.scores[winnerIndex] += scoreResult.total + honbaPayment + riichiStickPayment;
            for (let i = 0; i < 4; i++) {
                if (i === winnerIndex) continue;
                const oyaPayment = isDealer ? scoreResult.payments[0] : scoreResult.payments[0];
                const koPayment = isDealer ? scoreResult.payments[0] : scoreResult.payments[1];
                this.state.scores[i] -= (i === this.state.oyaIndex ? oyaPayment : koPayment);
                this.state.scores[i] -= (this.state.honba * 100);
            }
        } else { // Ron
            this.state.scores[winnerIndex] += scoreResult.total + honbaPayment + riichiStickPayment;
            this.state.scores[fromIndex] -= scoreResult.total + honbaPayment;
        }
    
        this.state.riichiSticks = 0;
    
        const roundResult = { 
            type: 'win', 
            winnerIndex, 
            fromIndex, 
            winTile, 
            isTsumo, 
            hand: winnerHand, 
            furo: this.state.furos[winnerIndex], 
            yakuList: yakuResult.yakuList, 
            fu, 
            han: finalHan, 
            originalHan: originalHan + doraHan, // 表示用にドラも足す
            isRevolution: this.state.isRevolution,
            scoreResult, 
            finalScores: this.state.scores.map(Math.round), 
            doraIndicators: this.state.doraIndicators, 
            uraDoraIndicators: this.state.isRiichi[winnerIndex] ? this.state.uraDoraIndicators : [] 
        };

        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(isDealer), 10000);
    }
    
    handleDraw(drawType, context = {}) {
        this.state.gameStarted = false;
        
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
    
        const roundResult = { type: 'draw', drawType, tenpaiPlayers, finalScores: this.state.scores.map(Math.round), ...context };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(isOyaTenpai), 5000);
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
                this.state.bakaze = this.state.bakaze === "東" ? "南" : "西";
                this.state.kyoku = 1;
            } else {
                this.state.kyoku++;
            }
        }
        this.setupNewRound();
    }
    
    handleCpuTurn(playerIndex) {
        if (this.state.turnIndex !== playerIndex && !(this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex)) return;
        
        if (this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex) {
            const pa = this.state.pendingSpecialAction;
            if (pa.type === 'kyusute') {
                const hand = this.state.hands[playerIndex];
                if (!hand || hand.length === 0) {
                     console.error(`CPU ${playerIndex} (9捨て)は捨てる牌がありません。`);
                     this.state.pendingSpecialAction = null;
                     this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                     return;
                }
                const tileToDiscard = this.evaluateAndChooseDiscard(playerIndex) || hand[hand.length - 1];
                console.log(`CPU ${playerIndex} (9捨て)が ${tileToDiscard} を捨てます。`);
                setTimeout(() => this.handlePlayerAction(playerIndex, { type: 'kyusute_discard', tile: tileToDiscard }), 100 + Math.random() * 500);

            } else if (pa.type === 'nanawatashi') {
                const hand = this.state.hands[playerIndex];
                
                const possibleTargets = this.players
                    .map(p => p.playerIndex)
                    .filter(pIdx => pIdx !== playerIndex && !this.state.isRiichi[pIdx]);

                if (!hand || hand.length === 0 || possibleTargets.length === 0) {
                    console.log(`CPU ${playerIndex} (7わたし)は渡す牌または相手がないため、ターンを終了します。`);
                    this.state.pendingSpecialAction = null;
                    this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                    return;
                }
                const tileToGive = this.findMostUselessTile(hand, playerIndex);
                
                if (tileToGive) {
                    const targetPlayerIndex = possibleTargets[Math.floor(Math.random() * possibleTargets.length)];
                    console.log(`CPU ${playerIndex} (7わたし)が ${tileToGive} を Player ${targetPlayerIndex} に渡します。`);
                    setTimeout(() => this.handlePlayerAction(playerIndex, { type: 'nanawatashi_select', tileToGive, targetPlayerIndex }), 100 + Math.random() * 1000);
                } else {
                    console.log(`CPU ${playerIndex} (7わたし)は渡す牌がないため、ターンを終了します。`);
                    this.state.pendingSpecialAction = null;
                    this.proceedToNextTurn(playerIndex, this.state.lastDiscard?.tile);
                }
            }
            return;
        }
        
        if (this.state.hands[playerIndex].length === 0) {
            console.log(`CPU ${playerIndex} は手牌がないため、ターンをスキップします。`);
            this.proceedToNextTurn(playerIndex, null);
            return;
        }

        if (this.state.drawnTile && this.state.turnActions && this.state.turnActions.canTsumo) {
            console.log(`CPU ${playerIndex} がツモ和了を選択しました。`);
            setTimeout(() => this.handlePlayerAction(playerIndex, { type: 'tsumo' }), 100);
            return;
        }
        
        const tileToDiscard = this.evaluateAndChooseDiscard(playerIndex);
        
        if (tileToDiscard) {
            console.log(`CPU ${playerIndex} が ${tileToDiscard} を捨てます。`);
            setTimeout(() => this.handleDiscard(playerIndex, tileToDiscard), 100);
        } else {
             const hand = this.state.hands[playerIndex];
             if(hand && hand.length > 0) {
                const fallbackTile = hand[hand.length-1];
                console.log(`CPU ${playerIndex} は評価で牌を選べず、最後の牌 ${fallbackTile} を捨てます。`);
                setTimeout(() => this.handleDiscard(playerIndex, fallbackTile), 100);
             } else {
                console.log(`CPU ${playerIndex} は捨てる牌がありません。ターンをスキップします。`);
                this.proceedToNextTurn(playerIndex, null);
             }
        }
    }

    evaluateAndChooseDiscard(playerIndex) {
        const hand = [...this.state.hands[playerIndex]];
        if (hand.length === 0) return null;
        hand.sort(tileSort);

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
                return this.findMostUselessTile(safeTilesInHand, playerIndex);
            }
        }
        
        return this.findMostUselessTile(hand, playerIndex);
    }

    findMostUselessTile(tiles, playerIndex) {
        if (!tiles || tiles.length === 0) {
            const hand = this.state.hands[playerIndex];
            if (!hand || hand.length === 0) return null;
            return hand[hand.length-1]; // Fallback
        }

        const fullHand = this.state.hands[playerIndex];
        const counts = fullHand.reduce((acc, t) => { const norm = normalizeTile(t); acc[norm] = (acc[norm] || 0) + 1; return acc; }, {});

        let bestTileToDiscard = tiles[tiles.length - 1];
        let maxScore = -Infinity;

        for (const tile of new Set(tiles)) {
            let score = 0;
            const normTile = normalizeTile(tile);

            if (isYakuhai(normTile, this.state.bakaze, this.state.jikazes[playerIndex])) {
                score += (counts[normTile] === 1) ? 20 : -10;
            } 
            else if (isYaochu(normTile)){
                 score += (counts[normTile] === 1) ? 30 : 0;
            }
            else if (isJi(normTile)) { // Guest winds
                score += (counts[normTile] === 1) ? 50 : 0;
            }
            else if (isNumberTile(normTile)){
                const num = parseInt(normTile[0]);
                const suit = normTile[1];
                let isIsolated = true;
                
                for (let i = -2; i <= 2; i++) {
                    if (i === 0) continue;
                    const neighborNorm = `${num + i}${suit}`;
                    if (counts[neighborNorm]) {
                        isIsolated = false;
                        score -= 5;
                    }
                }

                if (isIsolated) {
                    score += 20 + Math.min(num - 1, 9 - num);
                }
                
                if (counts[normTile] >= 2) score -= 20;
                if (this.state.dora.includes(normTile)) score -= 50;
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
            const yaku = checkYaku(winContext);
            if (yaku.totalHan > 2) {
                 console.log(`CPU ${playerIndex} がロンを選択しました。`);
                return { type: 'ron' };
            }
        }

        if (!this.state.isRiichi[playerIndex]) {
            if (possibleActions.canDaiminkan || possibleActions.canPon) {
                if (isYakuhai(tile, this.state.bakaze, this.state.jikazes[playerIndex])) {
                    console.log(`CPU ${playerIndex} が役牌 (${tile}) のポン/カンを選択しました。`);
                    return possibleActions.canDaiminkan ? { type: 'daiminkan' } : { type: 'pon' };
                }
            }
        }

        return { type: 'skip' };
    }
    
    isDiscardFuriten(playerIndex) {
        const waits = getWaits(this.state.hands[playerIndex], this.state.furos[playerIndex]);
        if (waits.length === 0) {
            return false;
        }
        const discardNormTiles = new Set(this.state.discards[playerIndex].map(d => normalizeTile(d.tile)));
        return waits.some(waitTile => discardNormTiles.has(normalizeTile(waitTile)));
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