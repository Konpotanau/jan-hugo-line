// game-manager.js
const { createAllTiles, shuffle, tileSort } = require('./constants.js');
const { getWaits, checkYaku, getWinningForm, calculateFu, calculateScore, hasValidYaku, isYaochu, getDoraTile } = require('./yaku.js');

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
        this.state.waitingForAction = null;
        this.state.turnActions = null;
        this.state.drawnTile = null;
        this.state.lastKanContext = null;
        this.state.firstDiscards = [null, null, null, null];
    
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
        this.state.isIppatsu = [false, false, false, false];
        const playerIndex = this.state.turnIndex;
        
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
        this.checkForTurnActions(playerIndex);
        this.callbacks.onUpdate();
    }

    handleDiscard(playerIndex, tile) {
        if (this.state.turnIndex !== playerIndex) return;

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
    
        const isRiichiDeclare = this.state.turnActions && this.state.turnActions.isDeclaringRiichi;
    
        if (isRiichiDeclare) {
            this.state.isRiichi[playerIndex] = true;
            this.state.isIppatsu[playerIndex] = true;
            this.state.scores[playerIndex] -= 1000;
            this.state.riichiSticks++;
            this.state.discards[playerIndex].push({ tile, isRiichi: true });
        } else {
            this.state.discards[playerIndex].push({ tile, isRiichi: false });
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
        
        console.log(`Player ${playerIndex} が ${tile} を捨てました。`);
        
        this.state.turnActions = null;
        this.checkForActionsAfterDiscard(playerIndex, tile);
    }

    checkForTurnActions(playerIndex) {
        const hand = this.state.hands[playerIndex];
        const furo = this.state.furos[playerIndex];
        const actions = { canTsumo: false, canRiichi: false, canKakan: [], canAnkan: [], isDeclaringRiichi: false, canKyuKyu: false };
    
        const winForm = getWinningForm(hand, furo);
        if (winForm) {
            const winContext = { hand, furo, winTile: this.state.drawnTile, isTsumo: true, isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu[playerIndex], isRinshan: !!this.state.lastKanContext, dora: this.state.dora, uraDora: null, bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex] };
            const yakuResult = checkYaku(winContext);
            if (yakuResult.totalHan > 0) {
                actions.canTsumo = true;
            }
        }
    
        const isMenzen = furo.length === 0;
        if (isMenzen && !this.state.isRiichi[playerIndex] && this.state.scores[playerIndex] >= 1000 && this.state.yama.length >= 4) {
            for (const tileToDiscard of new Set(hand)) {
                const tempHand = [...hand];
                tempHand.splice(tempHand.indexOf(tileToDiscard), 1);
                if (getWaits(tempHand, []).length > 0) {
                    actions.canRiichi = true;
                    break;
                }
            }
        }
    
        const isFirstTurnForPlayer = this.state.discards[playerIndex].length === 0;
        const isOverallFirstTurn = this.state.turnIndex === this.state.oyaIndex && this.state.discards.every(d => d.length === 0);
    
        if (isMenzen && (isFirstTurnForPlayer || isOverallFirstTurn) && !this.state.furos.flat().length > 0) {
            const uniqueYaochu = new Set(hand.filter(isYaochu));
            if (uniqueYaochu.size >= 9) {
                actions.canKyuKyu = true;
            }
        }
        
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
    
        if (actions.canTsumo || actions.canRiichi || actions.canKakan.length > 0 || actions.canAnkan.length > 0 || actions.canKyuKyu) {
            this.state.turnActions = actions;
        } else {
            this.state.turnActions = null;
        }
    }

    checkForActionsAfterDiscard(discarderIndex, tile) {
        const possibleActions = [null, null, null, null];
        let canAnyoneAct = false;
        let hasPriorityAction = false;
    
        for (let i = 0; i < 4; i++) {
            if (i === discarderIndex) continue;
            
            const playerActions = { canRon: false, canPon: false, canDaiminkan: false, canChi: [] };
            const hand = this.state.hands[i];
            const furo = this.state.furos[i];
    
            const waits = getWaits(hand, furo);
            if (waits.includes(tile)) {
                const winContext = { hand: [...hand, tile], furo, winTile: tile, isTsumo: false, isRiichi: this.state.isRiichi[i], isIppatsu: this.state.isIppatsu.some(Boolean), isRinshan: false, dora: this.state.dora, uraDora: [], bakaze: this.state.bakaze, jikaze: this.state.jikazes[i] };
                const yakuResult = checkYaku(winContext);
                if (yakuResult.totalHan > 0) {
                    playerActions.canRon = true;
                }
            }
    
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
            
            if (playerActions.canRon || playerActions.canPon || playerActions.canDaiminkan || playerActions.canChi.length > 0) {
                possibleActions[i] = playerActions;
                canAnyoneAct = true;
                if (playerActions.canRon || playerActions.canPon || playerActions.canDaiminkan) hasPriorityAction = true;
            }
        }
    
        if (canAnyoneAct) {
            this.state.waitingForAction = { 
                discarderIndex, 
                tile, 
                possibleActions, 
                responses: {}, 
                actionTimeout: setTimeout(() => this.handleResponseToAction(null, {type: 'timeout'}), hasPriorityAction ? 3000 : 1500),
            };
            this.callbacks.onUpdate();
        } else {
            this.proceedToNextTurn(discarderIndex);
        }
    }

    handlePlayerAction(playerIndex, action) {
        if (this.state.turnActions && this.state.turnIndex === playerIndex) {
            if (action.type === 'tsumo') {
                this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true);
                return;
            }
            if (action.type === 'riichi') {
                this.state.turnActions.isDeclaringRiichi = true;
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

        const allPlayers = this.players.map(p => p.playerIndex);
        const respondedPlayers = Object.keys(wa.responses).map(Number);
        const pendingPlayers = allPlayers.filter(pIdx => wa.possibleActions[pIdx] && !respondedPlayers.includes(pIdx));
        
        if (action.type === 'timeout' || pendingPlayers.length === 0) {
            clearTimeout(wa.actionTimeout);
            this.state.waitingForAction = null;
    
            const ronAction = Object.values(wa.responses).find(r => r.type === 'ron');
            const ponKanAction = Object.values(wa.responses).find(r => r.type === 'pon' || r.type === 'daiminkan');
            const chiAction = Object.values(wa.responses).find(r => r.type === 'chi');
    
            if (ronAction) {
                let ronPlayerIndex = -1;
                let minDiff = 4;
                for (const pIdx in wa.responses) {
                    if (wa.responses[pIdx].type === 'ron') {
                        const diff = (pIdx - wa.discarderIndex + 4) % 4;
                        if (diff < minDiff) {
                            minDiff = diff;
                            ronPlayerIndex = Number(pIdx);
                        }
                    }
                }
                this.handleWin(ronPlayerIndex, wa.discarderIndex, wa.tile, false);
            } else if (ponKanAction) {
                const actionPlayerIndex = Number(Object.keys(wa.responses).find(pIdx => wa.responses[pIdx] === ponKanAction));
                const hand = this.state.hands[actionPlayerIndex];
                
                if (ponKanAction.type === 'pon') {
                    for(let i=0; i<2; i++) hand.splice(hand.lastIndexOf(wa.tile), 1);
                    this.state.furos[actionPlayerIndex].push({type: 'pon', tiles: [wa.tile, wa.tile, wa.tile], from: wa.discarderIndex});
                    this.state.turnIndex = actionPlayerIndex;
                    this.state.drawnTile = null;
                    this.callbacks.onUpdate();
                } else {
                    this.handleKan(actionPlayerIndex, wa.tile, 'daiminkan', wa.discarderIndex);
                }
            } else if (chiAction) {
                const actionPlayerIndex = Number(Object.keys(wa.responses).find(pIdx => wa.responses[pIdx] === chiAction));
                const hand = this.state.hands[actionPlayerIndex];
                chiAction.tiles.forEach(t => hand.splice(hand.indexOf(t), 1));
                
                const meldTiles = [...chiAction.tiles, wa.tile].sort(tileSort);
                this.state.furos[actionPlayerIndex].push({type: 'chi', tiles: meldTiles, from: wa.discarderIndex, called: wa.tile});
                this.state.turnIndex = actionPlayerIndex;
                this.state.drawnTile = null;
                this.callbacks.onUpdate();
            } else {
                this.proceedToNextTurn(wa.discarderIndex);
            }
        }
    }

    handleKan(playerIndex, tile, kanType, fromIndex = playerIndex) {
        const hand = this.state.hands[playerIndex];
        
        switch (kanType) {
            case 'ankan':
                for(let i=0; i<4; i++) hand.splice(hand.lastIndexOf(tile), 1);
                this.state.furos[playerIndex].push({ type: 'ankan', tiles: [tile, tile, tile, tile], from: playerIndex });
                break;
            case 'kakan':
                hand.splice(hand.indexOf(tile), 1);
                const furoToUpdate = this.state.furos[playerIndex].find(f => f.type === 'pon' && f.tiles[0] === tile);
                furoToUpdate.type = 'kakan';
                furoToUpdate.tiles.push(tile);
                break;
            case 'daiminkan':
                for(let i=0; i<3; i++) hand.splice(hand.lastIndexOf(tile), 1);
                this.state.furos[playerIndex].push({ type: 'daiminkan', tiles: [tile, tile, tile, tile], from: fromIndex });
                break;
        }
    
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
    
        this.state.doraIndicators.push(this.state.deadWall[6 + (this.state.doraIndicators.length-1)*2]);
        this.state.dora = this.state.doraIndicators.map(getDoraTile);
    
        this.drawTile(playerIndex, true);
    }
    
    proceedToNextTurn(lastPlayerIndex) {
        this.state.waitingForAction = null;
        this.state.turnIndex = (lastPlayerIndex + 1) % 4;
        this.processTurn();
    }
    
    handleWin(winnerIndex, fromIndex, winTile, isTsumo) {
        this.state.gameStarted = false;
        
        let winnerHand = isTsumo ? [...this.state.hands[winnerIndex]] : [...this.state.hands[winnerIndex], winTile];
        winnerHand.sort(tileSort);
        
        const isIppatsu = isTsumo ? this.state.isIppatsu[winnerIndex] : Object.values(this.state.isIppatsu).some(Boolean);
        const isDealer = this.state.oyaIndex === winnerIndex;
    
        const winContext = { 
            hand: winnerHand, furo: this.state.furos[winnerIndex], winTile, isTsumo, 
            isRiichi: this.state.isRiichi[winnerIndex], isIppatsu, 
            isRinshan: isTsumo && this.state.lastKanContext?.rinshanWinner === winnerIndex, 
            dora: this.state.dora, uraDora: this.state.isRiichi[winnerIndex] ? this.state.uraDoraIndicators.map(getDoraTile) : [], 
            bakaze: this.state.bakaze, jikaze: this.state.jikazes[winnerIndex] 
        };
    
        const yakuResult = checkYaku(winContext);
        if (!hasValidYaku(yakuResult.yakuList)) { console.error("役なしエラー"); return; }
        
        const winForm = getWinningForm(winnerHand, this.state.furos[winnerIndex]);
        const fu = calculateFu(winForm, yakuResult.yakuList, winContext);
        const scoreResult = calculateScore(yakuResult.totalHan, fu, isDealer, isTsumo);
        
        const honbaPayment = this.state.honba * 300;
        const riichiStickPayment = this.state.riichiSticks * 1000;
        
        if (isTsumo) {
            const totalWinAmount = scoreResult.total + honbaPayment;
            this.state.scores[winnerIndex] += totalWinAmount + riichiStickPayment;
            const dealerPayment = isDealer ? scoreResult.payments[0] : scoreResult.payments[0] + (this.state.honba * 100);
            const nonDealerPayment = isDealer ? scoreResult.payments[0] : scoreResult.payments[1] + (this.state.honba * 100);
            for (let i = 0; i < 4; i++) {
                if (i === winnerIndex) continue;
                this.state.scores[i] -= (i === this.state.oyaIndex) ? dealerPayment : nonDealerPayment;
            }
        } else {
            const totalPayment = scoreResult.total + honbaPayment;
            this.state.scores[winnerIndex] += totalPayment + riichiStickPayment;
            this.state.scores[fromIndex] -= totalPayment;
        }
    
        this.state.riichiSticks = 0;
    
        const roundResult = { type: 'win', winnerIndex, fromIndex, winTile, isTsumo, hand: winnerHand, furo: this.state.furos[winnerIndex], yakuList: yakuResult.yakuList, fu, han: yakuResult.totalHan, scoreResult, finalScores: this.state.scores, doraIndicators: this.state.doraIndicators, uraDoraIndicators: this.state.isRiichi[winnerIndex] ? this.state.uraDoraIndicators : [] };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(winnerIndex, isDealer), 10000);
    }
    
    handleDraw(drawType, context = {}) {
        this.state.gameStarted = false;
        let isOyaTenpai = false;
        let scoreChanges = [0, 0, 0, 0];
        let tenpaiPlayers = [];
        let notenPlayers = [];
        let isRenchan = false;
    
        if (drawType === 'exhaustive') {
            const playerStates = [0, 1, 2, 3].map(i => ({ index: i, isTenpai: getWaits(this.state.hands[i], this.state.furos[i]).length > 0 }));
            tenpaiPlayers = playerStates.filter(p => p.isTenpai).map(p => p.index);
            notenPlayers = playerStates.filter(p => !p.isTenpai).map(p => p.index);
            isOyaTenpai = tenpaiPlayers.includes(this.state.oyaIndex);
    
            if (tenpaiPlayers.length > 0 && tenpaiPlayers.length < 4) {
                const payment = 3000 / tenpaiPlayers.length;
                const receipt = 3000 / notenPlayers.length;
                tenpaiPlayers.forEach(pIdx => scoreChanges[pIdx] += receipt);
                notenPlayers.forEach(pIdx => scoreChanges[pIdx] -= payment);
            }
            isRenchan = isOyaTenpai;
        } else {
            isRenchan = true;
        }
    
        for(let i=0; i<4; i++) this.state.scores[i] += scoreChanges[i];
        
        const roundResult = { type: 'draw', drawType, tenpaiPlayers, finalScores: this.state.scores, ...context };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(this.state.oyaIndex, isRenchan, true), 10000);
    }
    
    startNextRound(lastWinnerIndex, isDealerWinOrRenchan, isDraw = false) {
        if (isDealerWinOrRenchan) {
            this.state.honba++;
        } else {
            this.state.honba = 0;
            const currentOya = this.state.oyaIndex;
            this.state.oyaIndex = (currentOya + 1) % 4;
    
            if (this.state.oyaIndex === 0 && this.state.bakaze === "南" && this.state.kyoku === 4) {
                console.log("ゲーム終了");
                // TODO: ゲーム終了処理
                this.callbacks.onSystemMessage("ゲーム終了です。お疲れ様でした。");
                return;
            }
    
            if (currentOya === 3) {
                this.state.bakaze = "南";
                this.state.kyoku = 1;
            } else {
                this.state.kyoku++;
            }
        }
        this.setupNewRound();
    }
    
    handleCpuTurn(playerIndex) {
        if (this.state.turnIndex !== playerIndex) return;
        
        if (this.state.turnActions && this.state.turnActions.canTsumo) {
            console.log(`CPU ${playerIndex} がツモ和了しました。`);
            setTimeout(() => this.handleWin(playerIndex, playerIndex, this.state.drawnTile, true), 500);
            return;
        }
        
        // とりあえずツモ切りするだけのシンプルなAI
        const hand = this.state.hands[playerIndex];
        let tileToDiscard = this.state.drawnTile || hand[hand.length - 1]; 
        
        console.log(`CPU ${playerIndex} が ${tileToDiscard} を捨てます。`);
        setTimeout(() => this.handleDiscard(playerIndex, tileToDiscard), 500);
    }
    
    getCpuReaction(playerIndex, tile, discarderIndex) {
        // ロンできるなら必ずロンするシンプルなAI
        const hand = this.state.hands[playerIndex];
        const waits = getWaits(hand, this.state.furos[playerIndex]);
        if (waits.includes(tile)) {
            const winContext = { hand: [...hand, tile], furo: this.state.furos[playerIndex], winTile: tile, isTsumo: false, isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu.some(Boolean), isRinshan: false, dora: this.state.dora, uraDora: [], bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex] };
            if (checkYaku(winContext).totalHan > 0) {
                 console.log(`CPU ${playerIndex} がロンを検出しました。`);
                return { type: 'ron' };
            }
        }
        // 他の鳴きはスキップ
        return { type: 'skip' };
    }
}

module.exports = { Game };