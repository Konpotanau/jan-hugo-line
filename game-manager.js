// game-manager.js
const { createAllTiles, shuffle, tileSort } = require('./constants.js');
const { getWaits, checkYaku, getWinningForm, calculateFu, calculateScore, hasValidYaku, isYaochu, isJi, getDoraTile, isYakuhai, isNumberTile, normalizeTile } = require('./yaku.js');

// ##3プレイヤーの配牌チェック用ヘルパー関数
function hasMeldGroup(hand) {
    if (!hand || hand.length < 3) return false;

    const normCounts = hand.map(normalizeTile).reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    if (Object.values(normCounts).some(c => c >= 3)) {
        return true; // 刻子あり
    }

    const numberTiles = hand.filter(isNumberTile).map(normalizeTile).sort(tileSort);
    const uniqueNumberTiles = [...new Set(numberTiles)];

    for (let i = 0; i < uniqueNumberTiles.length - 2; i++) {
        const t1 = uniqueNumberTiles[i];
        const t2 = uniqueNumberTiles[i+1];
        const t3 = uniqueNumberTiles[i+2];

        const n1 = parseInt(t1[0]);
        const s1 = t1[1];
        const n2 = parseInt(t2[0]);
        const s2 = t2[1];
        const n3 = parseInt(t3[0]);
        const s3 = t3[1];

        if (s1 === s2 && s1 === s3 && n2 === n1 + 1 && n3 === n2 + 1) {
            return true; // 順子あり
        }
    }
    return false;
}


class Game {
    constructor(players, callbacks) {
        this.players = players; // { playerIndex, name, isCpu, ws? }
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
                renchanMode: [false, false, false, false], // ##3 Renchan mode
            };
        }

        // ★ Requirement ④: ##8プレイヤーのスコアボーナスを追加
        this.players.forEach(player => {
            if (player.name.startsWith('##8') || player.name.startsWith('##konpotas')) {
                this.state.scores[player.playerIndex] += 2000;
                console.log(`Player ${player.playerIndex} (${player.name}) が##8のボーナス(2000点)を獲得しました。`);
            }
        });
        
        this.state.players = this.players;
        // ★ Requirement ②, ③, etc.: ##X を除いたプレイヤー名をstateに設定
        this.state.playerNames = this.players
            .sort((a, b) => a.playerIndex - b.playerIndex)
            .map(p => p.name.replace(/^##\d\s*/, '').replace(/^##konpotas\s*/, ''));
        
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
        this.state.peekInfo = { used: [false, false, false, false], tile: [null, null, null, null] };
        // ★ 修正点③: 革命ボタン使用状況を追加
        this.state.revolutionUsed = [false, false, false, false];
    
        const winds = ["東", "南", "西", "北"];
        this.state.jikazes = winds.map((_, i) => winds[(i - this.state.oyaIndex + 4) % 4]);
        
        const allTiles = createAllTiles();
        shuffle(allTiles);
    
        this.state.deadWall = allTiles.slice(0, 14);
        this.state.yama = allTiles.slice(14);
        this.state.doraIndicators = [this.state.deadWall[4]];
        this.state.uraDoraIndicators = [this.state.deadWall[5]];
        this.state.dora = this.state.doraIndicators.map(getDoraTile);
    
        // --- ★ Requirement ③: Special dealing logic ---
        let dealIsOk = false;
        let dealAttempts = 0;
        const MAX_DEAL_ATTEMPTS = 10;

        while (!dealIsOk && dealAttempts < MAX_DEAL_ATTEMPTS) {
            dealAttempts++;
            // Temporarily take 52 tiles for hands
            const allPlayerHandTiles = this.state.yama.splice(0, 52);
            let tempHands = [];
            for (let i = 0; i < 4; i++) {
                tempHands.push(allPlayerHandTiles.slice(i * 13, (i + 1) * 13));
            }

            let needsRedeal = false;
            
            // ★ 修正点⑤: ##6 ドラ2枚チェック
            const sixCheatPlayers = this.players.filter(p => p.name.startsWith('##6') || p.name.startsWith('##konpotas'));
            if (sixCheatPlayers.length > 0) {
                for (const player of sixCheatPlayers) {
                    const pIdx = player.playerIndex;
                    let doraCount = 0;
                    tempHands[pIdx].forEach(tile => {
                        if (tile.startsWith('r5')) {
                            doraCount++;
                        }
                        this.state.dora.forEach(doraTile => {
                            if (normalizeTile(tile) === doraTile) {
                                doraCount++;
                            }
                        });
                    });
                    // ★ 修正点⑤: ドラが2枚未満なら配り直し
                    if (doraCount < 2) {
                        needsRedeal = true;
                        break;
                    }
                }
            }

            // ##3 Renchan Check (only if ##6 check passed)
            if (!needsRedeal) {
                const renchanPlayer = this.players.find(p => (p.name.startsWith('##3') || p.name.startsWith('##konpotas')) && this.state.renchanMode[p.playerIndex]);
                if (renchanPlayer) {
                    if (!hasMeldGroup(tempHands[renchanPlayer.playerIndex])) {
                        needsRedeal = true;
                        console.log(`Redealing for ##3/##konpotas player (Renchan Mode), attempt ${dealAttempts}`);
                    }
                }
            }

            if (needsRedeal) {
                // Put all 52 cards back and shuffle
                this.state.yama.unshift(...allPlayerHandTiles);
                shuffle(this.state.yama);
                if (dealAttempts < MAX_DEAL_ATTEMPTS) {
                     console.log(`Redealing, attempt ${dealAttempts}`);
                }
            } else {
                dealIsOk = true;
                for (let i = 0; i < 4; i++) {
                    this.state.hands[i] = tempHands[i].sort(tileSort);
                }
            }
        }
        
        if (!dealIsOk) {
            console.warn(`Could not satisfy cheat conditions after ${MAX_DEAL_ATTEMPTS} attempts. Proceeding with last deal.`);
            // Deal whatever was last attempted if loop fails
            if (this.state.hands[0].length === 0) {
                 for (let i = 0; i < 4; i++) {
                    const hand = this.state.yama.splice(0, 13);
                    this.state.hands[i] = hand.sort(tileSort);
                }
            }
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

        // ★ 修正点①: 他のプレイヤーの「未来予知」が不発になった場合の処理
        for (let i = 0; i < 4; i++) {
            if (i !== playerIndex && this.state.peekInfo.tile[i] === drawnTile) {
                console.log(`Player ${i}'s peeked tile was drawn by player ${playerIndex}. Resetting peek.`);
                this.state.peekInfo.tile[i] = null; // 予知を無効化するが、使用済みにはしない
            }
        }
        
        // 覗き見した牌を実際にツモった場合、その能力を「使用済み」にする
        if (this.state.peekInfo.tile[playerIndex] && this.state.peekInfo.tile[playerIndex] === drawnTile) {
            console.log(`Player ${playerIndex} consumed their peeked tile.`);
            this.state.peekInfo.used[playerIndex] = true;
            this.state.peekInfo.tile[playerIndex] = null;
        }

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
                 
                 const hand = this.state.hands[playerIndex];
                 
                 // ★ ##1と##konpotasプレイヤー、およびリーチ中のプレイヤーを除外
                 let possibleTargets = this.players.filter(p => 
                     p.playerIndex !== playerIndex && 
                     !this.state.isRiichi[p.playerIndex] && 
                     !p.name.startsWith("##1") &&
                     !p.name.startsWith("##konpotas")
                 ).map(p => p.playerIndex);

                 // 渡せる相手がいなければ、対面をデフォルトターゲットとする（ただし除外対象は除く）
                 let targetPlayerIndex = (playerIndex + 2) % 4;
                 if (!possibleTargets.includes(targetPlayerIndex)) {
                    targetPlayerIndex = possibleTargets.length > 0 ? possibleTargets[0] : -1;
                 }

                 // 渡せる相手がいて、かつ手牌がある場合のみ処理
                 if (hand && hand.length > 0 && targetPlayerIndex !== -1) {
                     const tileToGive = hand[hand.length - 1]; // 手牌の最後の牌
                     this.handlePlayerAction(playerIndex, { type: 'nanawatashi_select', tileToGive, targetPlayerIndex });
                 } else {
                     // 渡せない場合はそのままターン終了
                     this.state.pendingSpecialAction = null;
                     this.proceedToNextTurn(this.state.turnIndex, this.state.lastDiscard?.tile);
                 }

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
        
        if (this.state.waitingForAction) {
            console.error(`(Server) Invalid operation: Player ${playerIndex} tried to discard (${tile}) while waiting for action responses.`);
            return;
        }

        if (this.state.turnIndex !== playerIndex) return;

        const pa = this.state.pendingSpecialAction;

        if (pa && pa.playerIndex === playerIndex && pa.type === 'nanawatashi') {
            console.error(`(Server) Invalid operation: Player ${playerIndex} tried to discard (${tile}) during nanawatashi selection.`);
            return;
        }
        
        if(pa && pa.type === 'kyusute' && pa.playerIndex === playerIndex) {
             this.handlePlayerAction(playerIndex, { type: 'kyusute_discard', tile: tile });
             return;
        }

        if (this.state.turnTimer) {
            clearTimeout(this.state.turnTimer.timeout);
            this.state.turnTimer = null;
        }

        const isKyusuteDiscard = tile.match(/^9[mps]$/);
        if (this.state.isRiichi[playerIndex] && tile !== this.state.drawnTile && !isKyusuteDiscard) {
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

        // プレイヤーが打牌した時点で、そのターンの覗き見情報は無効になる
        if (this.state.peekInfo.tile[playerIndex]) {
            console.log(`Clearing peek info for player ${playerIndex} after their discard (peek was not used).`);
            this.state.peekInfo.tile[playerIndex] = null;
        }

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
        
        this.checkForActionsAfterDiscard(playerIndex, tile, false, true, !this.state.isRiichi[playerIndex]);
    }

    checkForTurnActions(playerIndex) {
        const hand = this.state.hands[playerIndex];
        const furo = this.state.furos[playerIndex];
        const actions = { canTsumo: false, canRiichi: false, canKakan: [], canAnkan: [], isDeclaringRiichi: false, canKyuKyu: false, canRevolution: false };
    
        const winForm = getWinningForm(hand, furo);
        if (winForm) {
            const winner = this.players.find(p => p.playerIndex === playerIndex);
            const winContext = { 
                hand, furo, winTile: this.state.drawnTile, isTsumo: true, 
                isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu[playerIndex], 
                isRinshan: !!this.state.lastKanContext, isChankan: false, 
                dora: this.state.dora, uraDora: null, 
                bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex],
                playerCheats: {
                    allWindsAreJikaze: winner && (winner.name.startsWith('##4') || winner.name.startsWith('##konpotas')),
                }
            };
            const yakuResult = checkYaku(winContext);
            if (yakuResult.totalHan > 0) {
                actions.canTsumo = true;
            }
        }
    
        // ★ 修正点①: リーチチェックの直前にフリテン状態を再計算して、最新の状態で判定する
        this.updateFuritenState(playerIndex);
        const isMenzen = furo.length === 0;

        if (isMenzen && !this.state.isRiichi[playerIndex] && this.state.scores[playerIndex] >= 1000 && this.state.yama.length >= 4 && !this.state.isFuriten[playerIndex]) {
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
            const normHandCounts = hand.reduce((acc, t) => {
                const norm = normalizeTile(t);
                acc[norm] = (acc[norm] || 0) + 1;
                return acc;
            }, {});

            for (const normTile in normHandCounts) {
                if (normHandCounts[normTile] === 4) {
                    const actualTile = hand.find(t => normalizeTile(t) === normTile);
                    if (actualTile) actions.canAnkan.push(actualTile);
                }
            }
            
            furo.forEach(f => {
                if (f.type === 'pon') {
                    const normTile = normalizeTile(f.tiles[0]);
                    const tileInHandForKakan = hand.find(t => normalizeTile(t) === normTile);
                    if (tileInHandForKakan) {
                        actions.canKakan.push(tileInHandForKakan);
                    }
                }
            });
        }
        
        // ★ 修正点③: ##9/##konpotasプレイヤーの革命ボタンのチェック
        const player = this.players.find(p => p.playerIndex === playerIndex);
        if (player && (player.name.startsWith('##9') || player.name.startsWith('##konpotas')) && !this.state.revolutionUsed[playerIndex]) {
            actions.canRevolution = true;
        }
    
        if (actions.canTsumo || actions.canRiichi || actions.canKakan.length > 0 || actions.canAnkan.length > 0 || actions.canKyuKyu || actions.canRevolution) {
            this.state.turnActions = actions;
        } else {
            this.state.turnActions = null;
        }
    }

    checkForActionsAfterDiscard(discarderIndex, tile, isKakan = false, canTriggerKyusute, canTriggerNanawatashi) {
        const possibleActions = [null, null, null, null];
        let canAnyoneAct = false;
    
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
                    const winner = this.players.find(p => p.playerIndex === i);
                    const tempWinContext = {
                        hand: winnableHand, furo, winTile: tile, isTsumo: false, 
                        isRiichi: this.state.isRiichi[i], 
                        isIppatsu: this.state.isIppatsu.some(Boolean) && !isKakan,
                        isRinshan: false, 
                        isChankan: isKakan,
                        dora: this.state.dora, uraDora: [], 
                        bakaze: this.state.bakaze, jikaze: this.state.jikazes[i],
                        playerCheats: {
                            allWindsAreJikaze: winner && (winner.name.startsWith('##4') || winner.name.startsWith('##konpotas')),
                        }
                    };
                    const yakuResult = checkYaku(tempWinContext);
                    if (yakuResult.totalHan > 0) {
                        playerActions.canRon = true;
                    }
                }
            }

            if (playerActions.canRon) {
                const discarder = this.players.find(p => p.playerIndex === discarderIndex);
                const isTenpai = getWaits(hand, furo).length > 0;
                if (discarder && (discarder.name.startsWith('##5') || discarder.name.startsWith('##konpotas')) && !this.state.isRiichi[i] && isTenpai && Math.random() < 0.5) {
                    playerActions.canRon = false;
                    console.log(`##5/##konpotas cheat activated against Player ${i}. Ron is disabled for this discard.`);
                }
            }
    
            const actingPlayer = this.players.find(p => p.playerIndex === i);
            
            // ★ Requirement ②: ##7プレイヤーの鳴き制限を解除
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
            }
        }
    
        if (canAnyoneAct) {
            const ACTION_TIMEOUT_MS = 10000;
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
            const originalTurnPlayer = this.state.turnIndex;
            if (this.state.peekInfo.tile[originalTurnPlayer]) {
                console.log(`Player ${originalTurnPlayer}'s peek was invalidated by a call being skipped.`);
                this.state.peekInfo.tile[originalTurnPlayer] = null;
            }

            const isGotoshi = tile && tile.match(/^[r]?5[mps]$/);
            const isHachigiri = tile && tile.match(/^8[mps]$/);
            if (isGotoshi) this.callbacks.onSystemMessage({ type: 'special_event', event: 'gotobashi' });
            if (isHachigiri) this.callbacks.onSystemMessage({ type: 'special_event', event: 'hachigiri' });
            
            const isKyusute = tile.match(/^9[mps]$/);
            const isNanawatashi = tile.match(/^[r]?7[mps]$/);
            const SPECIAL_ACTION_TIMEOUT_MS = 15000;

            if (canTriggerKyusute && isKyusute) {
                this.state.pendingSpecialAction = { type: 'kyusute', playerIndex: discarderIndex, wasInRiichi: this.state.isRiichi[discarderIndex] };
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
            if (canTriggerNanawatashi && isNanawatashi) {
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

    handlePeekRequest(playerIndex) {
        if (!this.state.gameStarted) return;
    
        const player = this.players.find(p => p.playerIndex === playerIndex);
        if (!player || !(player.name.startsWith('##2') || player.name.startsWith('##konpotas')) || this.state.peekInfo.used[playerIndex]) {
            console.log(`Player ${playerIndex} cannot peek.`);
            return;
        }
    
        // A player peeks on their turn. Their next turn is 3 draws away (assuming no calls/skips), so we peek at the 4th tile.
        const peekIndex = 4;
        if (this.state.yama.length >= peekIndex) {
            const nextTile = this.state.yama[this.state.yama.length - peekIndex];
            this.state.peekInfo.tile[playerIndex] = nextTile;
            console.log(`Player ${playerIndex} peeked at their potential next tile: ${nextTile}`);
            this.callbacks.onUpdate();
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
                return;
            }
            if (action.type !== 'kyusute_discard') {
                return;
            }
        }
        
        if (this.state.pendingSpecialAction && this.state.pendingSpecialAction.playerIndex === playerIndex) {
            const pa = this.state.pendingSpecialAction;
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
                
                if (pa.wasInRiichi) {
                    const isStillTenpai = getWaits(this.state.hands[playerIndex], this.state.furos[playerIndex]).length > 0;
                    if (!isStillTenpai) {
                        this.state.isRiichi[playerIndex] = false;
                        console.log(`Player ${playerIndex} のリーチは9捨てにより解除されました。`);
                        this.callbacks.onSystemMessage(`Player ${this.state.playerNames[playerIndex]}のリーチは解除されました。`);
                    }
                }

                const discardObject = { tile: action.tile, isRiichi: false };
                this.state.discards[playerIndex].push(discardObject);
                this.state.lastDiscard = { 
                    player: playerIndex, 
                    tile: action.tile,
                    discardIndex: this.state.discards[playerIndex].length - 1 
                };
                
                this.callbacks.onUpdate();
                setTimeout(() => this.checkForActionsAfterDiscard(playerIndex, action.tile, false, true, !this.state.isRiichi[playerIndex]), 50);
                return;
            }
            
            if (pa.type === 'nanawatashi' && action.type === 'nanawatashi_select') {
                const { tileToGive, targetPlayerIndex } = action;

                const targetPlayer = this.players.find(p => p.playerIndex === targetPlayerIndex);
                if (targetPlayer && (targetPlayer.name.startsWith("##1") || targetPlayer.name.startsWith("##konpotas"))) {
                     console.error(`サーバーエラー: Player ${targetPlayerIndex} (${targetPlayer.name}) には7わたしできません。`);
                     this.callbacks.onSystemMessage("エラー: このプレイヤーには渡せません。");
                     return;
                }

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
                        fromName: this.state.playerNames[playerIndex],
                        toName: this.state.playerNames[targetPlayerIndex],
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
            // ★ 修正点②: 革命アクションのハンドリングを修正
            if (action.type === 'revolution') {
                if (this.state.turnActions.canRevolution) {
                    this.state.roundKans++; // カンと同じようにカウンターを増やす
                    this.state.isRevolution = (this.state.roundKans % 2) === 1; // カウンターの奇数/偶数で状態を決定
                    this.state.revolutionUsed[playerIndex] = true;
                    this.state.turnActions.canRevolution = false; // Disable after use
                    this.callbacks.onSystemMessage(this.state.isRevolution ? "革命！点数計算が反転します。" : "革命終了。点数計算が元に戻ります。");
                    this.callbacks.onUpdate();
                }
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

            // 鳴きによって覗き見が無効になる場合の処理
            const nextPlayerIndex = (wa.discarderIndex + 1) % 4;
            if (Object.values(wa.responses).some(r => r.type !== 'skip') && this.state.peekInfo.tile[nextPlayerIndex]) {
                console.log(`Player ${nextPlayerIndex}'s peek was invalidated by a call.`);
                this.state.peekInfo.tile[nextPlayerIndex] = null;
            }
    
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
                const discardedTile = wa.tile;
                const isGotoshi = discardedTile && discardedTile.match(/^[r]?5[mps]$/);
                const isHachigiri = discardedTile && discardedTile.match(/^8[mps]$/);
                if (isGotoshi) this.callbacks.onSystemMessage({ type: 'special_event', event: 'gotobashi' });
                if (isHachigiri) this.callbacks.onSystemMessage({ type: 'special_event', event: 'hachigiri' });

                const isKyusute = discardedTile.match(/^9[mps]$/);
                const canTriggerNanaWatashi = !this.state.isRiichi[wa.discarderIndex];
                const isNanawatashi = discardedTile.match(/^[r]?7[mps]$/);
                const SPECIAL_ACTION_TIMEOUT_MS = 15000;

                if (isKyusute) {
                    this.state.pendingSpecialAction = { type: 'kyusute', playerIndex: wa.discarderIndex, wasInRiichi: this.state.isRiichi[wa.discarderIndex] };
                    this.state.turnIndex = wa.discarderIndex;
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
                if (canTriggerNanaWatashi && isNanawatashi) {
                    this.state.pendingSpecialAction = { type: 'nanawatashi', playerIndex: wa.discarderIndex };
                    this.state.turnIndex = wa.discarderIndex;
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
            this.checkForActionsAfterDiscard(playerIndex, tile, true, true, true);
            return;
        }

        const hand = this.state.hands[playerIndex];
        if (kanType === 'ankan') {
            if (Math.random() < 0.5) {
                console.log(`Player ${playerIndex} の暗槓 (${tile}) がバグりました！`);
                const buggedKanTiles = [];
                const normTile = normalizeTile(tile);
    
                let removedCount = 0;
                for (let i = hand.length - 1; i >= 0 && removedCount < 2; i--) {
                    if (normalizeTile(hand[i]) === normTile) {
                        buggedKanTiles.push(hand.splice(i, 1)[0]);
                        removedCount++;
                    }
                }
    
                const remainingHand = [...hand];
                for (let i = 0; i < 2 && remainingHand.length > 0; i++) {
                    const randomIndex = Math.floor(Math.random() * remainingHand.length);
                    const randomTile = remainingHand.splice(randomIndex, 1)[0];
                    buggedKanTiles.push(randomTile);
    
                    const originalIndex = hand.findIndex(t => t === randomTile);
                    if(originalIndex > -1) {
                        hand.splice(originalIndex, 1);
                    }
                }
                
                while (buggedKanTiles.length < 4) {
                    const tileToAdd = hand.find(t => normalizeTile(t) === normTile) || tile;
                     if(tileToAdd){
                        const idx = hand.indexOf(tileToAdd);
                        if(idx > -1) hand.splice(idx,1);
                        buggedKanTiles.push(tileToAdd);
                     } else {
                        break;
                     }
                }

                this.state.furos[playerIndex].push({ type: 'ankan', tiles: buggedKanTiles.sort(tileSort), from: playerIndex });
    
            } else {
                console.log(`Player ${playerIndex} が暗槓 (${tile}) に成功しました。`);
                const normTile = normalizeTile(tile);
                let removedCount = 0;
                for (let i = hand.length - 1; i >= 0 && removedCount < 4; i--) {
                    if (normalizeTile(hand[i]) === normTile) {
                       hand.splice(i, 1);
                       removedCount++;
                    }
                }
                this.state.furos[playerIndex].push({ type: 'ankan', tiles: [tile, tile, tile, tile], from: playerIndex });
            }
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

        // 5とばしでスキップされたプレイヤーの未来予知をリセット
        if (isGotoshi) {
            const skippedPlayerIndex = (lastPlayerIndex + 1) % 4;
            if (this.state.peekInfo.tile[skippedPlayerIndex]) {
                console.log(`Player ${skippedPlayerIndex}'s peek was invalidated by 5-tobashi.`);
                this.state.peekInfo.tile[skippedPlayerIndex] = null;
            }
        }
    
        if (isGotoshi) {
            this.state.turnIndex = (lastPlayerIndex + 2) % 4;
            const skippedPlayerIndex = (lastPlayerIndex + 1) % 4;
            console.log(`5とばし！ Player ${lastPlayerIndex} -> Player ${this.state.turnIndex} (Player ${skippedPlayerIndex} をスキップ)`);
        } else if (isHachigiri) {
            this.state.turnIndex = lastPlayerIndex;
            console.log(`8切り！ Player ${lastPlayerIndex} がもう一度ツモります。`);
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

        const winner = this.players.find(p => p.playerIndex === winnerIndex);
    
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
            jikaze: this.state.jikazes[winnerIndex],
            playerCheats: {
                allWindsAreJikaze: winner && (winner.name.startsWith('##4') || winner.name.startsWith('##konpotas')),
            }
        };
    
        const yakuResult = checkYaku(winContext);
        if (!hasValidYaku(yakuResult.yakuList)) { 
            console.error("役なしエラー（フリテンなどのチェック漏れの可能性）"); 
            this.handleDraw('exhaustive');
            return; 
        }
        
        const winForm = getWinningForm(winnerHand, this.state.furos[winnerIndex]);
        const fu = calculateFu(winForm, yakuResult.yakuList, winContext);
        
        let finalHan = yakuResult.totalHan;

        // ★ 修正点②: ##7/##konpotas Han boost (1-2翻 -> 3翻)
        const isPlayer7 = winner && (winner.name.startsWith('##7') || winner.name.startsWith('##konpotas'));
        if (isPlayer7 && !yakuResult.isYakuman) {
            const yakuHanOnly = yakuResult.yakuList.reduce((s, y) => (y.name !== 'ドラ' ? s + y.han : s), 0);
            if (yakuHanOnly >= 1 && yakuHanOnly <= 2) {
                 const doraHan = yakuResult.totalHan - yakuHanOnly;
                 finalHan = 3 + doraHan;
                 console.log(`Player ##7/##konpotas Han Boost applied: ${yakuResult.totalHan} -> ${finalHan}`);
            }
        }

        const originalHan = yakuResult.isYakuman ? (finalHan - (yakuResult.yakuList.find(y => y.name === "ドラ")?.han || 0)) : yakuResult.yakuList.reduce((s, y) => (y.name !== 'ドラ' ? s + y.han : s), 0);
        let hanForCalc = originalHan;
        
        const doraHan = finalHan - hanForCalc;

        if (this.state.isRevolution && !yakuResult.isYakuman) {
            console.log("革命中のため翻数を反転します。");
            if (hanForCalc >= 13) hanForCalc = 13; // 役満以上は13としてカウント

            let revolutionaryHan = (14 - hanForCalc);
            if (revolutionaryHan <= 0) revolutionaryHan = 1;

            finalHan = revolutionaryHan + doraHan;
            console.log(`元の役翻数: ${hanForCalc}, ドラ: ${doraHan} => 革命後の翻数: ${finalHan}`);
        } else if (this.state.isRevolution && yakuResult.isYakuman) {
            console.log("革命中ですが役満は影響を受けません。");
        }
        
        const scoreResult = calculateScore(finalHan, fu, isDealer, isTsumo);
        
        const honbaPayment = this.state.honba * 300;
        const riichiStickPayment = this.state.riichiSticks * 1000;
        
        // ##3 Renchan mode activation (also for ##konpotas)
        this.state.renchanMode = [false, false, false, false]; // Deactivate for all first
        if (winner && (winner.name.startsWith('##3') || winner.name.startsWith('##konpotas'))) {
            this.state.renchanMode[winnerIndex] = true;
            console.log(`Player ${winnerIndex} (${this.state.playerNames[winnerIndex]}) entered/maintained Renchan Mode.`);
        }

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
            originalHan: originalHan + doraHan,
            isRevolution: this.state.isRevolution && !yakuResult.isYakuman,
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

        let tenpaiPlayers = [];
    
        if (drawType === 'exhaustive') {
            const playerStates = [0, 1, 2, 3].map(i => ({ index: i, isTenpai: getWaits(this.state.hands[i], this.state.furos[i]).length > 0 }));
            tenpaiPlayers = playerStates.filter(p => p.isTenpai).map(p => p.index);
            const notenPlayers = playerStates.filter(p => !p.isTenpai).map(p => p.index);
    
            if (tenpaiPlayers.length > 0 && tenpaiPlayers.length < 4) {
                const receiptPerTenpai = 3000 / tenpaiPlayers.length;
                const paymentPerNoten = 3000 / notenPlayers.length;
                tenpaiPlayers.forEach(pIdx => this.state.scores[pIdx] += receiptPerTenpai);
                notenPlayers.forEach(pIdx => this.state.scores[pIdx] -= paymentPerNoten);
            }
        }
        
        const isOyaTenpai = drawType !== 'exhaustive' || tenpaiPlayers.includes(this.state.oyaIndex);
        
        // ##3 Renchan mode deactivation on draw
        const playerInRenchanIdx = this.state.renchanMode.findIndex(v => v === true);
        if (playerInRenchanIdx !== -1) {
            const renchanPlayerIsTenpai = tenpaiPlayers.includes(playerInRenchanIdx);
            if (!renchanPlayerIsTenpai) {
                this.state.renchanMode[playerInRenchanIdx] = false;
                console.log(`Player ${playerInRenchanIdx} loses Renchan Mode due to noten in a draw.`);
            }
        }
    
        const roundResult = { type: 'draw', drawType, tenpaiPlayers, finalScores: this.state.scores.map(Math.round), ...context };
        this.callbacks.onResult(roundResult);
    
        setTimeout(() => this.startNextRound(isOyaTenpai), 5000);
    }
    
    startNextRound(isRenchan) {
        if (this.state.bakaze === "南" && this.state.kyoku === 4 && !isRenchan) {
            console.log("ゲーム終了です。最終結果を計算します。");
            const finalRanking = this.players
                .map(p => ({
                    name: this.state.playerNames[p.playerIndex] || `Player ${p.playerIndex + 1}`,
                    score: this.state.scores[p.playerIndex]
                }))
                .sort((a, b) => b.score - a.score);

            this.callbacks.onSystemMessage("ゲーム終了です。");
            this.callbacks.onResult({ type: 'game_over', ranking: finalRanking });
            return;
        }

        if (isRenchan) {
            this.state.honba++;
        } else {
            this.state.honba = 0;
            this.state.oyaIndex = (this.state.oyaIndex + 1) % 4;
    
            if (this.state.kyoku === 4) {
                 this.state.kyoku = 1;
                 if (this.state.bakaze === "東") {
                     this.state.bakaze = "南";
                 }
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
                    .filter(p => p.playerIndex !== playerIndex && !this.state.isRiichi[p.playerIndex] && !p.name.startsWith("##1") && !p.name.startsWith("##konpotas"))
                    .map(p => p.playerIndex);

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
            const winner = this.players.find(p => p.playerIndex === playerIndex);
            const winContext = { 
                hand: winnableHand, furo, winTile: tile, isTsumo: false, 
                isRiichi: this.state.isRiichi[playerIndex], isIppatsu: this.state.isIppatsu.some(Boolean), 
                isRinshan: false, isChankan: !!this.state.pendingKakan, 
                dora: this.state.dora, uraDora: [], 
                bakaze: this.state.bakaze, jikaze: this.state.jikazes[playerIndex],
                playerCheats: {
                    allWindsAreJikaze: winner && (winner.name.startsWith('##4') || winner.name.startsWith('##konpotas')),
                }
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