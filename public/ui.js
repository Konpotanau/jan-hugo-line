// ui.js

// --- DOM Elements ---
const handContainers = [document.getElementById("hand-0"), document.getElementById("hand-1"), document.getElementById("hand-2"), document.getElementById("hand-3")];
const discardContainers = [document.getElementById("discard-0"), document.getElementById("discard-1"), document.getElementById("discard-2"), document.getElementById("discard-3")];
const furoContainers = [document.getElementById("furo-0"), document.getElementById("furo-1"), document.getElementById("furo-2"), document.getElementById("furo-3")];
const playerInfoDivs = [document.getElementById("player-info-0"), document.getElementById("player-info-1"), document.getElementById("player-info-2"), document.getElementById("player-info-3")];
const yamaCountEl = document.getElementById("yama-count");
const infoEl = document.getElementById("info");
const doraDisplayEl = document.getElementById("dora-display");
const roundInfoEl = document.getElementById("round-info");
const riichiSticksEl = document.getElementById("riichi-sticks");
const resultModalEl = document.getElementById("result-modal");
const yakuResultContentEl = document.getElementById("yaku-result-content");
const timerDisplayEl = document.getElementById("timer-display");
const actionButtonsContainer = document.getElementById("action-buttons");
const tenpaiInfoContainerEl = document.getElementById("tenpai-info-container");
const revolutionStatusEl = document.getElementById("revolution-status");
const actionButtons = {
    riichi: document.getElementById("riichi"),
    pon: document.getElementById("pon"),
    chi: document.getElementById("chi"),
    kan: document.getElementById("kan"),
    kyukyu: document.getElementById("kyukyu"),
    ron: document.getElementById("ron"),
    skip: document.getElementById("skip"),
};

// --- Core UI Logic ---

let timerAnimationId = null;

function renderAll(gameState, myPlayerIndex, sendDiscardCb, sendActionCb) {
    if (!gameState || myPlayerIndex === -1) return;

    const playerPositions = [ myPlayerIndex, (myPlayerIndex + 1) % 4, (myPlayerIndex + 2) % 4, (myPlayerIndex + 3) % 4 ];
    playerPositions.forEach((playerIdx, displayIdx) => {
        renderHand(gameState, myPlayerIndex, playerIdx, displayIdx, sendDiscardCb, sendActionCb);
        renderDiscards(gameState, playerIdx, displayIdx);
        renderFuro(gameState, playerIdx, displayIdx);
        renderPlayerInfo(gameState, myPlayerIndex, playerIdx, displayIdx);
    });
    renderCommonInfo(gameState);
    updateInfoText(gameState, myPlayerIndex);
    handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb);
    handleSpecialActions(gameState, myPlayerIndex, sendActionCb);
    renderTenpaiInfo(gameState, myPlayerIndex);
    
    const timerInfo = gameState.turnTimer || gameState.waitingForAction?.timer;
    renderTimer(timerInfo);
}

function renderTimer(timerInfo) {
    if (timerAnimationId) {
        cancelAnimationFrame(timerAnimationId);
        timerAnimationId = null;
    }

    if (timerInfo && timerInfo.startTime && timerInfo.duration) {
        timerDisplayEl.style.opacity = '1';

        const update = () => {
            const elapsedTime = Date.now() - timerInfo.startTime;
            const remainingTime = Math.max(0, timerInfo.duration - elapsedTime);
            const remainingSeconds = Math.ceil(remainingTime / 1000);
            
            timerDisplayEl.textContent = remainingSeconds;

            if (remainingTime > 0) {
                timerAnimationId = requestAnimationFrame(update);
            } else {
                timerDisplayEl.style.opacity = '0';
                timerDisplayEl.textContent = '';
            }
        };
        update();
    } else {
        timerDisplayEl.style.opacity = '0';
        timerDisplayEl.textContent = '';
    }
}

function renderTenpaiInfo(gameState, myPlayerIndex) {
    tenpaiInfoContainerEl.innerHTML = "";
    tenpaiInfoContainerEl.style.display = 'none';

    const isMyTurn = gameState.turnIndex === myPlayerIndex;
    const isMyRiichi = gameState.isRiichi[myPlayerIndex];
    const hand = gameState.hands[myPlayerIndex];
    // This condition correctly determines if the player should be able to discard.
    const canDiscard = isMyTurn;


    if (!canDiscard || isMyRiichi) {
        return;
    }

    const furo = gameState.furos[myPlayerIndex];
    const tenpaiDiscards = new Map();

    const uniqueTiles = [...new Set(hand)];
    uniqueTiles.forEach(tileToDiscard => {
        const tempHand = [...hand];
        if(tempHand.length === 0) return;
        tempHand.splice(tempHand.lastIndexOf(tileToDiscard), 1);
        const waits = getWaits(tempHand, furo);

        if (waits.length > 0) {
            tenpaiDiscards.set(tileToDiscard, waits);
        }
    });

    if (tenpaiDiscards.size === 0) {
        return;
    }
    
    tenpaiInfoContainerEl.style.display = 'flex';

    const sortedDiscards = [...tenpaiDiscards.keys()].sort(tileSort);

    sortedDiscards.forEach(discard => {
        const waits = tenpaiDiscards.get(discard);
        const itemDiv = document.createElement('div');
        itemDiv.className = 'tenpai-info-item';

        const discardLabelDiv = document.createElement('div');
        discardLabelDiv.className = 'discard-label';
        discardLabelDiv.appendChild(createTileImage(discard, null, true));
        discardLabelDiv.append('切り');

        const waitsLabel = document.createElement('span');
        waitsLabel.className = 'waits-label';
        waitsLabel.textContent = '待ち:';

        const waitsTilesDiv = document.createElement('div');
        waitsTilesDiv.className = 'waits-tiles';
        waits.forEach(waitTile => {
            waitsTilesDiv.appendChild(createTileImage(waitTile, null, true));
        });

        itemDiv.appendChild(discardLabelDiv);
        itemDiv.appendChild(waitsLabel);
        itemDiv.appendChild(waitsTilesDiv);
        tenpaiInfoContainerEl.appendChild(itemDiv);
    });
}


function renderHand(gameState, myPlayerIndex, playerIdx, displayIdx, sendDiscardCb) {
    const container = handContainers[displayIdx];
    container.innerHTML = "";
    
    const hand = gameState.hands[playerIdx];
    const isMyTurn = gameState.turnIndex === playerIdx && playerIdx === myPlayerIndex;
    const pa = gameState.pendingSpecialAction;
    const isMySpecialActionTurn = pa && pa.playerIndex === myPlayerIndex && pa.type === 'kyusute';

    const canDiscard = isMyTurn || isMySpecialActionTurn;

    if (playerIdx === myPlayerIndex) {
        let tenpaiDiscardSet = new Set();
        if (canDiscard && !gameState.isRiichi[myPlayerIndex]) {
            const uniqueTilesInHand = [...new Set(hand)];
            uniqueTilesInHand.forEach(tileToDiscard => {
                const tempHand = [...hand];
                if(tempHand.length === 0) return;
                tempHand.splice(tempHand.lastIndexOf(tileToDiscard), 1);
                if (getWaits(tempHand, gameState.furos[myPlayerIndex]).length > 0) {
                    tenpaiDiscardSet.add(tileToDiscard);
                }
            });
        }

        let handToDisplay = [...hand];
        let drawnTile = null;

        if (isMyTurn && gameState.drawnTile) {
            const drawnTileIndex = handToDisplay.lastIndexOf(gameState.drawnTile);
            if (drawnTileIndex > -1) {
                [drawnTile] = handToDisplay.splice(drawnTileIndex, 1);
            } else {
                 console.warn("ツモ牌が手牌に見つかりませんでした。表示を強制します。", { drawnTile: gameState.drawnTile, hand: [...handToDisplay] });
                 // ツモ牌を手牌から見つけられなかった場合でも、ツモ牌を分離して表示する
                 drawnTile = gameState.drawnTile;
                 // この場合 handToDisplay にツモ牌が残っている可能性があるので、手動で探して削除する
                 const stillExistsIndex = handToDisplay.findIndex(t => t === drawnTile);
                 if (stillExistsIndex > -1) {
                    handToDisplay.splice(stillExistsIndex, 1);
                 }
            }
        }
        
        handToDisplay.sort(tileSort).forEach(tile => {
            const isMyRiichi = gameState.isRiichi[myPlayerIndex];
            const isDeclaringRiichi = gameState.turnActions?.isDeclaringRiichi;
            const canClick = canDiscard && (isDeclaringRiichi || !isMyRiichi);
            const clickHandler = canClick ? () => sendDiscardCb(tile) : null;
            const tileImg = createTileImage(tile, clickHandler);
            
            if (tenpaiDiscardSet.has(tile)) {
                tileImg.classList.add('tile-tenpai-candidate');
            }

            container.appendChild(tileImg);
        });

        if (drawnTile) {
            const clickHandler = canDiscard ? () => sendDiscardCb(drawnTile) : null;
            const tileImg = createTileImage(drawnTile, clickHandler);
            tileImg.style.marginLeft = "15px";

            if (tenpaiDiscardSet.has(drawnTile)) {
                tileImg.classList.add('tile-tenpai-candidate');
            }

            container.appendChild(tileImg);
        }

    } else {
        // For other players, just show the back of the tiles.
        const numTiles = gameState.hands[playerIdx].length;
        for (let i = 0; i < numTiles; i++) {
             container.appendChild(createTileImage('back'));
        }
    }
}


function renderDiscards(gameState, playerIdx, displayIdx) {
    const container = discardContainers[displayIdx];
    container.innerHTML = "";
    
    const lastDiscardInfo = gameState.lastDiscard;

    gameState.discards[playerIdx].forEach((discard, index) => {
        const img = createTileImage(discard.tile);
        if (discard.isRiichi) {
            img.classList.add("riichi-discard");
        }
        if (lastDiscardInfo && 
            playerIdx === lastDiscardInfo.player && 
            index === lastDiscardInfo.discardIndex) {
            img.classList.add("latest-discard");
        }
        container.appendChild(img);
    });
}

function renderFuro(gameState, playerIdx, displayIdx) {
    const container = furoContainers[displayIdx];
    container.innerHTML = "";
    gameState.furos[playerIdx].forEach(set => {
        const group = document.createElement("div");
        group.className = "furo-set";
        let tilesToRender = [...set.tiles].sort(tileSort);

        if (set.type === 'ankan') {
            const normTile = normalizeTile(tilesToRender[0]);
            group.appendChild(createTileImage('back', null, true));
            group.appendChild(createTileImage(normTile, null, true));
            group.appendChild(createTileImage(normTile, null, true));
            group.appendChild(createTileImage('back', null, true));
        } else if (set.type === 'kakan') {
            const originalPon = tilesToRender.slice(0, 3);
            const addedKan = tilesToRender[3];
            const fromWho = (playerIdx - set.from + 4) % 4;
            const rotatedIndex = fromWho === 1 ? 2 : (fromWho === 2 ? 1 : 0);
            originalPon.forEach((tile, index) => {
                const img = createTileImage(tile, null, true);
                if (index === rotatedIndex) img.classList.add('called-tile');
                group.appendChild(img);
            });
            const addedImg = createTileImage(addedKan, null, true);
            addedImg.classList.add('kakan-tile');
            group.appendChild(addedImg);
        } else {
            const fromWho = (playerIdx - set.from + 4) % 4;
            let calledTile = set.called || set.tiles[0]; 
            let rotatedIndex = -1;
            if (set.type === 'pon' || set.type === 'daiminkan') {
                rotatedIndex = (fromWho === 1 ? tilesToRender.length-1 : (fromWho === 2 ? 1 : 0));
                let temp = tilesToRender[rotatedIndex];
                tilesToRender.splice(rotatedIndex, 1);
                tilesToRender.splice(0,0,temp);
                rotatedIndex = 0;
            } else { // chi
                rotatedIndex = tilesToRender.indexOf(calledTile);
            }

            tilesToRender.forEach((tile, index) => {
                const img = createTileImage(tile, null, true);
                if (index === rotatedIndex) img.classList.add('called-tile');
                group.appendChild(img);
            });
        }
        container.appendChild(group);
    });
}

function renderPlayerInfo(gameState, myPlayerIndex, playerIdx, displayIdx) {
    const div = playerInfoDivs[displayIdx];
    const jikazeChar = gameState.jikazes[playerIdx];
    const isOya = gameState.oyaIndex === playerIdx;
    const handLength = gameState.hands[playerIdx].length;

    const handCountSpan = div.querySelector('.player-hand-info');
    if (handCountSpan) {
        const isTurn = gameState.turnIndex === playerIdx;
        let isTenpaiShape = false;

        // n面子1雀頭の聴牌形（または和了形）かどうかの判定 (n対子は考慮しない)
        if (isTurn) { // ツモ後の状態 (3n+2枚)
            if (handLength >= 2 && (handLength - 2) % 3 === 0) {
                isTenpaiShape = true;
            }
        } else { // ツモ前の状態 (3n+1枚)
            if (handLength >= 1 && (handLength - 1) % 3 === 0) {
                isTenpaiShape = true;
            }
        }
        
        handCountSpan.textContent = `${playerIdx === myPlayerIndex ? 'あなた' : 'P' + (playerIdx + 1)} (${jikazeChar}${isOya ? '家' : ''}) [${handLength}枚]`;
        handCountSpan.classList.toggle('agari-possible', isTenpaiShape);
    }

    div.querySelector('.player-score').textContent = gameState.scores[playerIdx];
    div.classList.toggle('is-turn', (gameState.turnIndex === playerIdx || (gameState.pendingSpecialAction && gameState.pendingSpecialAction.playerIndex === playerIdx)));
}

function renderCommonInfo(gameState) {
    yamaCountEl.textContent = `牌山残り: ${gameState.yamaLength}枚`;
    doraDisplayEl.innerHTML = "";
    gameState.doraIndicators.forEach(d => doraDisplayEl.appendChild(createTileImage(d, null, true)));
    roundInfoEl.innerHTML = `${gameState.bakaze}${gameState.kyoku}局 ${gameState.honba}本場`;
    riichiSticksEl.textContent = `供託: ${gameState.riichiSticks}本`;

    if (gameState.isRevolution) {
        revolutionStatusEl.textContent = "革命中！";
    } else {
        revolutionStatusEl.textContent = "";
    }
}

function updateInfoText(gameState, myPlayerIndex) {
    if (!gameState || !gameState.gameStarted) return;
    
    const pa = gameState.pendingSpecialAction;
    if (pa && pa.playerIndex === myPlayerIndex) {
        if (pa.type === 'kyusute') {
            infoEl.textContent = "「9捨て」！もう1枚捨てる牌を選んでください。";
        } else if (pa.type === 'nanawatashi') {
            infoEl.textContent = "「7わたし」！渡す牌と相手を選んでください。";
        }
        return;
    }

    if (gameState.waitingForAction && gameState.waitingForAction.possibleActions[myPlayerIndex]) {
        infoEl.textContent = "アクションを選択してください。";
        return;
    }
    if (gameState.turnIndex === myPlayerIndex) {
        if(gameState.turnActions?.isDeclaringRiichi){
            infoEl.textContent = "捨てる牌を選んでください（リーチ）";
        } else if (gameState.isRiichi[myPlayerIndex]) {
            infoEl.textContent = "あなたのターンです。（リーチ中）";
        } else if (gameState.drawnTile) { // If a tile is drawn, it's time to discard.
             infoEl.textContent = "あなたのターンです。捨てる牌を選んでください。";
        } else { // After a call (pon, chi, etc.), no tile is drawn, but it's time to discard.
             infoEl.textContent = "あなたのターンです。鳴いた後、捨てる牌を選んでください。";
        }
    } else {
        const turnPlayerName = `P${gameState.turnIndex + 1}`;
        infoEl.textContent = `${turnPlayerName} のターンです。`;
    }
}

function handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb) {
    hideActionButtons();
    if (!gameState) return;
    
    if (gameState.pendingSpecialAction && gameState.pendingSpecialAction.playerIndex === myPlayerIndex) {
        actionButtonsContainer.style.display = 'none';
        return;
    }

    const myTurnActions = gameState.turnIndex === myPlayerIndex && gameState.turnActions;
    const myWaitingActions = gameState.waitingForAction && gameState.waitingForAction.possibleActions[myPlayerIndex];
    const isMyTurnAndRiichi = gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex];
    let actionsToShow = {};

    if (!myTurnActions && !myWaitingActions) {
         if (isMyTurnAndRiichi && gameState.drawnTile) {
            const tempHand = [...gameState.hands[myPlayerIndex]];
            const winForm = getWinningForm(tempHand, gameState.furos[myPlayerIndex]);
             if (winForm) {
                 const winContext = { hand: tempHand, furo: gameState.furos[myPlayerIndex], winTile: gameState.drawnTile, isTsumo: true, isRiichi: true, isIppatsu: gameState.isIppatsu[myPlayerIndex], isRinshan: !!gameState.lastKanContext, isChankan: false, dora: gameState.dora, uraDora: [], bakaze: gameState.bakaze, jikaze: gameState.jikazes[myPlayerIndex] };
                 if (checkYaku(winContext).totalHan > 0) {
                     actionsToShow.ron = { type: 'ツモ', handler: () => sendActionCb({ type: 'tsumo' }) };
                 }
             }
         } else {
            actionButtonsContainer.style.display = 'none';
            return;
         }
    }
    
    actionButtonsContainer.style.display = 'flex';
    
    if (myTurnActions) {
        if(myTurnActions.canTsumo) actionsToShow.ron = { type: 'ツモ', handler: () => sendActionCb({ type: 'tsumo' }) };
        if(myTurnActions.canRiichi && !myTurnActions.isDeclaringRiichi) actionsToShow.riichi = { type: 'リーチ', handler: () => sendActionCb({ type: 'riichi' }) };
        if(myTurnActions.canKyuKyu) actionsToShow.kyukyu = { type: '九種九牌', handler: () => sendActionCb({ type: 'kyukyu' }) };

        const kanChoices = [
            ...myTurnActions.canAnkan.map(t => ({ tile: t, kanType: 'ankan' })),
            ...myTurnActions.canKakan.map(t => ({ tile: t, kanType: 'kakan' }))
        ];
        if (kanChoices.length === 1) {
            actionsToShow.kan = { type: 'カン', handler: () => sendActionCb({ type: 'kan', ...kanChoices[0] }) };
        } else if (kanChoices.length > 1) {
            actionsToShow.kan = { type: 'カン', handler: () => showChoiceModal('カン', kanChoices.map(c => ({ meld: [c.tile, c.tile, c.tile, c.tile], ...c })), choice => sendActionCb({ type: 'kan', ...choice })) };
        }
    }

    if (myWaitingActions) {
        if(myWaitingActions.canRon) actionsToShow.ron = { type: 'ロン', handler: () => sendActionCb({ type: 'ron' }) };
        if(myWaitingActions.canPon) actionsToShow.pon = { type: 'ポン', handler: () => sendActionCb({ type: 'pon' }) };
        if(myWaitingActions.canDaiminkan) actionsToShow.kan = { type: 'カン', handler: () => sendActionCb({ type: 'daiminkan' }) };
        if(myWaitingActions.canChi.length === 1) {
             actionsToShow.chi = { type: 'チー', handler: () => sendActionCb({ type: 'chi', tiles: myWaitingActions.canChi[0] }) };
        } else if (myWaitingActions.canChi.length > 1) {
            actionsToShow.chi = { type: 'チー', handler: () => showChoiceModal('チー', myWaitingActions.canChi.map(c => ({ meld: c, tiles: c })), choice => sendActionCb({ type: 'chi', tiles: choice.tiles })) };
        }

        if (Object.keys(actionsToShow).length > 0) {
            actionsToShow.skip = { type: 'スキップ', handler: () => sendActionCb({ type: 'skip' }) };
        }
    }
    
    showActionButtons(actionsToShow);

    const hasDrawnTile = gameState.drawnTile !== null;
    if (isMyTurnAndRiichi && hasDrawnTile && !actionsToShow.ron && !actionsToShow.kan) {
        hideActionButtons();
        setTimeout(() => {
            if (gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex] && gameState.drawnTile) {
                console.log(`Auto-discarding ${gameState.drawnTile} due to Riichi.`);
                sendDiscardCb(gameState.drawnTile);
            }
        }, 800);
    }
}

function handleSpecialActions(gameState, myPlayerIndex, sendActionCb) {
    const pa = gameState.pendingSpecialAction;
    const existingModal = document.getElementById('special-action-modal');

    if (!pa || pa.playerIndex !== myPlayerIndex) {
        if (existingModal) existingModal.remove();
        return;
    }
    
    if (pa.type === 'nanawatashi') {
        if (!existingModal) showNanaWatashiModal(gameState, myPlayerIndex, sendActionCb);
    } else {
        if (existingModal) existingModal.remove();
    }
}


function showNanaWatashiModal(gameState, myPlayerIndex, sendActionCb) {
    const modal = document.createElement('div');
    modal.id = 'special-action-modal';
    modal.className = 'modal-overlay';
    
    const content = document.createElement('div');
    content.className = 'modal-content';
    
    let selectedTile = null;
    let selectedTarget = null;

    const header = document.createElement('h3');
    header.textContent = '7わたし：渡す牌と相手を選択';
    content.appendChild(header);

    const handContainer = document.createElement('div');
    handContainer.innerHTML = '<h4>渡す牌を選んでください</h4>';
    const handTilesDiv = document.createElement('div');
    handTilesDiv.style.display = 'flex';
    handTilesDiv.style.flexWrap = 'wrap';
    handTilesDiv.style.gap = '5px';
    
    // Sort unique tiles from hand for consistent display
    [...new Set(gameState.hands[myPlayerIndex])].sort(tileSort).forEach(tile => {
        const img = createTileImage(tile, () => {
            selectedTile = tile;
            Array.from(handTilesDiv.children).forEach(c => c.style.border = '2px solid transparent');
            img.style.border = '2px solid #ffdd00';
            img.style.boxShadow = '0 0 8px #ffdd00';
        });
        img.style.cursor = 'pointer';
        img.style.border = '2px solid transparent';
        handTilesDiv.appendChild(img);
    });
    handContainer.appendChild(handTilesDiv);

    const playerContainer = document.createElement('div');
    playerContainer.innerHTML = '<h4 style="margin-top: 15px;">渡す相手を選んでください</h4>';
    const playerButtonsDiv = document.createElement('div');
    playerButtonsDiv.style.display = 'flex';
    playerButtonsDiv.style.gap = '10px';
    playerButtonsDiv.style.marginTop = '5px';

    for(let i=0; i<4; i++){
        if (i === myPlayerIndex) continue;
        if (gameState.isRiichi[i]) continue; // Cannot give to a player in Riichi

        const btn = document.createElement('button');
        btn.textContent = `Player ${i+1}`;
        btn.onclick = () => {
            selectedTarget = i;
            Array.from(playerButtonsDiv.children).forEach(c => c.style.backgroundColor = '');
            btn.style.backgroundColor = '#ffdd00';
        };
        playerButtonsDiv.appendChild(btn);
    }
    playerContainer.appendChild(playerButtonsDiv);

    const actionArea = document.createElement('div');
    actionArea.style.marginTop = '20px';
    actionArea.style.textAlign = 'center';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '決定';
    confirmBtn.style.padding = '8px 16px';
    confirmBtn.onclick = () => {
        if (selectedTile && selectedTarget !== null) {
            sendActionCb({
                type: 'nanawatashi_select',
                tileToGive: selectedTile,
                targetPlayerIndex: selectedTarget
            });
            modal.remove();
        } else {
            alert('渡す牌と相手を選んでください。');
        }
    };

    // No cancel button to prevent accidental game state lock. Player must choose or time out.
    
    actionArea.appendChild(confirmBtn);

    content.appendChild(handContainer);
    content.appendChild(playerContainer);
    content.appendChild(actionArea);
    modal.appendChild(content);
    document.body.appendChild(modal);
}



function displayRoundResult(result, myPlayerIndex) {
    yakuResultContentEl.innerHTML = '';
    let contentHTML = '';

    if (result.type === 'win') {
        const { winnerIndex, fromIndex, winTile, isTsumo, hand, furo, yakuList, fu, han, scoreResult, doraIndicators, uraDoraIndicators, isRevolution, originalHan } = result;
        const winnerName = winnerIndex === myPlayerIndex ? 'あなた' : 'P' + (winnerIndex + 1);
        const fromPlayerName = fromIndex === winnerIndex ? '' : (fromIndex === myPlayerIndex ? 'あなた' : 'P' + (fromIndex + 1));
        const titleText = isTsumo ? `${winnerName} のツモ和了` : `${winnerName} のロン和了 (放銃: ${fromPlayerName})`;

        contentHTML += `<h3>${titleText}</h3>`;
        if (isRevolution) {
            contentHTML += `<h4 style="color: #ff00ff; text-align: center;">革命適用！</h4>`;
        }
        contentHTML += '<div>';
        hand.forEach(t => {
            const img = createTileImage(t, null, true);
            if (t === winTile) img.style.border = '2px solid red';
            contentHTML += img.outerHTML;
        });
        furo.forEach(f => {
           contentHTML += '<span style="margin-left: 10px;">';
           f.tiles.forEach(t => contentHTML += createTileImage(t,null,true).outerHTML);
           contentHTML += '</span>';
        });
        contentHTML += '</div>';

        contentHTML += '<div><hr><span>ドラ: </span>';
        doraIndicators.forEach(d => contentHTML += createTileImage(d,null,true).outerHTML);
        if(uraDoraIndicators && uraDoraIndicators.length > 0){
            contentHTML += '<br><span>裏ドラ: </span>';
            uraDoraIndicators.forEach(d => contentHTML += createTileImage(d,null,true).outerHTML);
        }
        contentHTML += '</div><hr>';

        contentHTML += '<table class="yaku-table">';
        yakuList.forEach(yaku => {
            if(yaku.name === 'ドラ') return;
            contentHTML += `<tr><td>${yaku.name}</td><td>${yaku.han}翻</td></tr>`;
        });
        const doraYaku = yakuList.find(y => y.name === 'ドラ');
        if(doraYaku){
            contentHTML += `<tr><td>ドラ</td><td>${doraYaku.han}翻</td></tr>`;
        }
        contentHTML += '</table><hr>';
        const scoreName = scoreResult.name ? ` (${scoreResult.name})` : '';
        if (isRevolution && !scoreResult.name?.includes("役満")) {
            contentHTML += `<div class="total-score"><s>${originalHan}翻</s> → ${han}翻 ${fu}符 <b>${scoreResult.total}点</b>${scoreName}</div>`;
        } else {
            contentHTML += `<div class="total-score">${han}翻 ${fu}符 <b>${scoreResult.total}点</b>${scoreName}</div>`;
        }
        if (scoreResult.breakdown) {
             contentHTML += `<div class="score-breakdown">(${scoreResult.breakdown})</div>`;
        }
    } else if (result.type === 'draw') {
        const drawReasonMap = { 
            exhaustive: "荒牌平局 (流局)", 
            kyuushuu_kyuuhai: "九種九牌", 
            suucha_riichi: "四家立直", 
            suukaikan: "四開槓", 
            suufon_renda: "四風連打",
            sancha_ho: "三家和 (流局)"
        };
        contentHTML += `<h3>${drawReasonMap[result.drawType] || '途中流局'}</h3>`;
        
        if (result.drawType === 'exhaustive') {
            const tenpaiNames = result.tenpaiPlayers.map(pIdx => pIdx === myPlayerIndex ? 'あなた' : `P ${pIdx + 1}`);
            if (tenpaiNames.length > 0) {
                 contentHTML += `<p>聴牌者: ${tenpaiNames.join(', ')}</p>`;
            } else {
                 contentHTML += `<p>全員ノーテン</p>`;
            }
        }
    }
    
    yakuResultContentEl.innerHTML = contentHTML;
    resultModalEl.style.display = 'flex';
    
    result.finalScores.forEach((score, idx) => {
        const displayIdx = (idx - myPlayerIndex + 4) % 4;
        playerInfoDivs[displayIdx].querySelector('.player-score').textContent = score;
    });
}


// --- UI Helper Functions ---
function createTileImage(tile, onClickFn = null, isSmall = false) {
    const img = document.createElement("img");
    img.className = isSmall ? "tile-small" : "tile";
    img.src = tileToImageSrc(tile);
    img.draggable = false;
    
    if (onClickFn) {
        img.onclick = onClickFn;
        img.style.cursor = 'pointer';
    } else {
        img.style.cursor = 'default';
    }
    return img;
}

function hideActionButtons() {
    actionButtonsContainer.style.display = 'none';
    Object.values(actionButtons).forEach(btn => {
        btn.style.display = 'none';
        btn.onclick = null;
        const preview = btn.querySelector('.action-preview');
        if (preview) preview.remove();
        if(btn.id === 'ron') btn.textContent = 'ロン';
    });
    const choiceDiv = document.querySelector(".choice-modal");
    if (choiceDiv) choiceDiv.remove();
}

function showActionButtons(actions) {
    let hasAction = false;
    for (const actionKey in actions) {
        if (actionButtons[actionKey] && actions[actionKey].type) {
            const btn = actionButtons[actionKey];
            btn.style.display = 'inline-block';
            
            let buttonContent = `<span>${actions[actionKey].type}</span>`;
            if (actions[actionKey].previews) {
                const previewContainer = document.createElement('div');
                previewContainer.className = 'action-preview';
                actions[actionKey].previews.forEach(tile => {
                    previewContainer.appendChild(createTileImage(tile, null, true));
                });
                buttonContent += previewContainer.outerHTML;
            }
            btn.innerHTML = buttonContent;

            btn.onclick = actions[actionKey].handler;
            hasAction = true;
        }
    }
    
    if (hasAction) {
        actionButtonsContainer.style.display = 'flex';
    }
}


function showChoiceModal(type, choices, callback) {
    const modal = document.createElement('div');
    modal.className = 'choice-modal';

    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.className = 'choice-button';

        const meld = choice.meld;
        const choiceContainer = document.createElement('div');
        choiceContainer.className = 'action-preview';

        meld.forEach(tile => {
            choiceContainer.appendChild(createTileImage(tile, null, true));
        });
        
        btn.appendChild(choiceContainer);
        btn.onclick = (e) => {
            e.stopPropagation();
            callback(choice);
            modal.remove();
            hideActionButtons(); 
        };
        modal.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.className = 'choice-cancel-button';
    cancelBtn.onclick = (e) => {
        e.stopPropagation();
        modal.remove();
        // Skip is handled by timeout on server, or user can click skip button again
    };
    modal.appendChild(cancelBtn);
    
    actionButtonsContainer.appendChild(modal);
}

function showNanaWatashiNotification(event, myPlayerIndex) {
    let notificationEl = document.getElementById('nanawatashi-notification');
    if (!notificationEl) {
        notificationEl = document.createElement('div');
        notificationEl.id = 'nanawatashi-notification';
        document.body.appendChild(notificationEl);
    }

    const { from, to, tile } = event;
    let message = '';

    if (to === myPlayerIndex) {
        message = `P${from + 1} から牌を受け取りました`;
    } else {
        message = `P${from + 1} が P${to + 1} に牌を渡しました`;
    }
    
    notificationEl.innerHTML = ''; // Clear previous content
    const textNode = document.createElement('div');
    textNode.textContent = message;
    
    // Only show the actual tile to the receiver
    if (to === myPlayerIndex) {
        const tileImg = createTileImage(tile, null, true);
        notificationEl.appendChild(tileImg);
    }
    
    notificationEl.insertBefore(textNode, notificationEl.firstChild);

    notificationEl.style.display = 'flex';

    setTimeout(() => {
        notificationEl.style.display = 'none';
    }, 2500); // Show for 2.5 seconds
}