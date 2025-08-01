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
const actionButtonsContainer = document.getElementById("action-buttons");
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

/**
 * ゲーム状態に基づいて画面全体を再描画する
 * @param {object} gameState - 最新のゲーム状態
 * @param {number} myPlayerIndex - このクライアントのプレイヤーインデックス
 * @param {function} sendDiscardCb - サーバーに打牌を送信するコールバック関数
 * @param {function} sendActionCb - サーバーにアクションを送信するコールバック関数
 */
function renderAll(gameState, myPlayerIndex, sendDiscardCb, sendActionCb) {
    if (!gameState || myPlayerIndex === -1) return;

    const playerPositions = [ myPlayerIndex, (myPlayerIndex + 1) % 4, (myPlayerIndex + 2) % 4, (myPlayerIndex + 3) % 4 ];
    playerPositions.forEach((playerIdx, displayIdx) => {
        renderHand(gameState, myPlayerIndex, playerIdx, displayIdx, sendDiscardCb);
        renderDiscards(gameState, playerIdx, displayIdx);
        renderFuro(gameState, playerIdx, displayIdx);
        renderPlayerInfo(gameState, myPlayerIndex, playerIdx, displayIdx);
    });
    renderCommonInfo(gameState);
    updateInfoText(gameState, myPlayerIndex);
    handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb);
}

function renderHand(gameState, myPlayerIndex, playerIdx, displayIdx, sendDiscardCb) {
    const container = handContainers[displayIdx];
    container.innerHTML = "";
    
    const hand = gameState.hands[playerIdx];
    const isMyTurn = gameState.turnIndex === playerIdx && playerIdx === myPlayerIndex;
    const canDiscard = isMyTurn && hand.length % 3 === 2;

    if (playerIdx === myPlayerIndex) {
        let handToDisplay = [...hand];
        let drawnTile = null;

        if (canDiscard && gameState.drawnTile) {
            const drawnTileIndex = handToDisplay.lastIndexOf(gameState.drawnTile);
            if (drawnTileIndex > -1) {
                [drawnTile] = handToDisplay.splice(drawnTileIndex, 1);
            } else {
                 console.warn("Drawn tile not found in hand, taking last tile as fallback.");
                 drawnTile = handToDisplay.pop();
            }
        }
        
        handToDisplay.sort(tileSort).forEach(tile => {
            const isMyRiichi = gameState.isRiichi[myPlayerIndex];
            const isDeclaringRiichi = gameState.turnActions?.isDeclaringRiichi;
            const canClick = canDiscard && (isDeclaringRiichi || !isMyRiichi);
            const clickHandler = canClick ? () => sendDiscardCb(tile) : null;
            container.appendChild(createTileImage(tile, clickHandler));
        });

        if (drawnTile) {
            const clickHandler = canDiscard ? () => sendDiscardCb(drawnTile) : null;
            const tileImg = createTileImage(drawnTile, clickHandler);
            tileImg.style.marginLeft = "15px";
            container.appendChild(tileImg);
        }

    } else {
        hand.forEach(() => container.appendChild(createTileImage('back')));
    }
}

function renderDiscards(gameState, playerIdx, displayIdx) {
    const container = discardContainers[displayIdx];
    container.innerHTML = "";
    
    let latestDiscardInfo = { player: -1, index: -1 };
    let maxTurn = -1;
    let turnCounter = 0;
    gameState.discards.forEach((discards, pIdx) => {
        discards.forEach((d, dIdx) => {
            turnCounter++;
            if (turnCounter > maxTurn) {
                maxTurn = turnCounter;
                latestDiscardInfo = { player: pIdx, index: dIdx };
            }
        });
    });

    gameState.discards[playerIdx].forEach((discard, index) => {
        const img = createTileImage(discard.tile);
        if (discard.isRiichi) {
            img.classList.add("riichi-discard");
        }
        if (playerIdx === latestDiscardInfo.player && index === latestDiscardInfo.index) {
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
        let tilesToRender = [...set.tiles];

        if (set.type === 'ankan') {
            group.appendChild(createTileImage('back', null, true));
            group.appendChild(createTileImage(tilesToRender[1], null, true));
            group.appendChild(createTileImage(tilesToRender[2], null, true));
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
            let rotatedIndex;
            if (set.type === 'pon' || set.type === 'daiminkan') {
                rotatedIndex = fromWho === 1 ? 2 : (fromWho === 2 ? 1 : 0);
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
    div.querySelector('span:first-child').textContent = `${playerIdx === myPlayerIndex ? 'あなた' : 'P' + (playerIdx + 1)} (${jikazeChar}${isOya ? '家' : ''}) `;
    div.querySelector('.player-score').textContent = gameState.scores[playerIdx];
    div.classList.toggle('is-turn', gameState.turnIndex === playerIdx);
}

function renderCommonInfo(gameState) {
    yamaCountEl.textContent = `牌山残り: ${gameState.yamaLength}枚`;
    doraDisplayEl.innerHTML = "";
    gameState.doraIndicators.forEach(d => doraDisplayEl.appendChild(createTileImage(d, null, true)));
    roundInfoEl.innerHTML = `${gameState.bakaze}${gameState.kyoku}局 ${gameState.honba}本場`;
    riichiSticksEl.textContent = `供託: ${gameState.riichiSticks}本`;
}

function updateInfoText(gameState, myPlayerIndex) {
    if (!gameState || !gameState.gameStarted) return;
    if (gameState.waitingForAction && gameState.waitingForAction.possibleActions[myPlayerIndex]) {
        infoEl.textContent = "アクションを選択してください。";
        return;
    }
    if (gameState.turnIndex === myPlayerIndex) {
        if(gameState.turnActions?.isDeclaringRiichi){
            infoEl.textContent = "捨てる牌を選んでください（リーチ）";
        } else if (gameState.isRiichi[myPlayerIndex]) {
            infoEl.textContent = "あなたのターンです。（リーチ中）";
        } else if (gameState.drawnTile) {
             infoEl.textContent = "あなたのターンです。捨てる牌を選んでください。";
        } else {
             infoEl.textContent = "あなたのターンです。鳴いた後、捨てる牌を選んでください。";
        }
    } else {
        const turnPlayerName = `Player ${gameState.turnIndex + 1}`;
        infoEl.textContent = `${turnPlayerName} のターンです。`;
    }
}

function handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb) {
    hideActionButtons();
    if (!gameState) return;
    
    const actionsToShow = {};

    if (gameState.turnIndex === myPlayerIndex && gameState.turnActions) {
        const turnActions = gameState.turnActions;
        
        if (turnActions.isDeclaringRiichi) {
             infoEl.textContent = "捨てる牌を選んでください（リーチ）";
             return;
        }
        
        if (turnActions.canTsumo) {
            actionButtons.ron.textContent = 'ツモ';
            actionsToShow.ron = { can: true, handler: () => sendActionCb({ type: 'tsumo' }) };
        }
        if (turnActions.canRiichi) {
            actionsToShow.riichi = { can: true, handler: () => sendActionCb({ type: 'riichi' }) };
        }
        if (turnActions.canKyuKyu) {
            actionsToShow.kyukyu = { can: true, handler: () => sendActionCb({ type: 'kyukyu' }) };
        }
        
        const kanChoices = [...(turnActions.canAnkan || []).map(tile => ({ tile, kanType: 'ankan' })), ...(turnActions.canKakan || []).map(tile => ({ tile, kanType: 'kakan' }))];
        if (kanChoices.length > 0) {
            actionsToShow.kan = {
                can: true,
                handler: () => {
                    if (kanChoices.length === 1) {
                        sendActionCb({ type: 'kan', ...kanChoices[0] });
                    } else {
                        showChoiceModal('kan', kanChoices, (selectedChoice) => {
                            sendActionCb({ type: 'kan', ...selectedChoice });
                        }, () => handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb));
                    }
                }
            };
        }
        
        if (turnActions.canTsumo || turnActions.canRiichi || kanChoices.length > 0 || turnActions.canKyuKyu) {
            actionsToShow.skip = { can: true, handler: () => { if (gameState.drawnTile) sendDiscardCb(gameState.drawnTile); } };
        }
    }

    if (gameState.waitingForAction && gameState.waitingForAction.possibleActions[myPlayerIndex]) {
        const possible = gameState.waitingForAction.possibleActions[myPlayerIndex];
        actionButtons.ron.textContent = 'ロン';
        
        if (possible.canRon) actionsToShow.ron = { can: true, handler: () => sendActionCb({ type: 'ron' }) };
        if (possible.canPon) actionsToShow.pon = { can: true, handler: () => sendActionCb({ type: 'pon' }) };
        if (possible.canDaiminkan) actionsToShow.kan = { can: true, handler: () => sendActionCb({ type: 'daiminkan' }) };
        if (possible.canChi && possible.canChi.length > 0) {
            actionsToShow.chi = {
                can: true,
                handler: () => {
                    if (possible.canChi.length === 1) {
                        sendActionCb({ type: 'chi', tiles: possible.canChi[0] });
                    } else {
                        showChoiceModal('chi', possible.canChi, (selectedTiles) => {
                            sendActionCb({ type: 'chi', tiles: selectedTiles });
                        }, () => handleActionButtons(gameState, myPlayerIndex, sendActionCb, sendDiscardCb));
                    }
                }
            };
        }
        actionsToShow.skip = { can: true, handler: () => sendActionCb({ type: 'skip' }) };
    }

    const hasPlayerActions = showActionButtons(actionsToShow);

    // リーチ後の自動打牌ロジック
    const isMyTurn = gameState.turnIndex === myPlayerIndex;
    const isMyRiichi = gameState.isRiichi[myPlayerIndex];
    const hasDrawnTile = gameState.drawnTile !== null;

    if (isMyTurn && isMyRiichi && hasDrawnTile && !hasPlayerActions) {
        setTimeout(() => {
            // タイムアウト後に再度チェック
            if (gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex] && gameState.drawnTile) {
                sendDiscardCb(gameState.drawnTile);
            }
        }, 500);
    }
}

function displayRoundResult(result, myPlayerIndex) {
    yakuResultContentEl.innerHTML = '';
    let contentHTML = '';

    if (result.type === 'win') {
        const { winnerIndex, fromIndex, winTile, isTsumo, hand, furo, yakuList, fu, han, scoreResult, doraIndicators, uraDoraIndicators } = result;
        const winnerName = winnerIndex === myPlayerIndex ? 'あなた' : 'Player ' + (winnerIndex + 1);
        const fromPlayerName = fromIndex === winnerIndex ? '' : (fromIndex === myPlayerIndex ? 'あなた' : 'Player ' + (fromIndex + 1));
        const titleText = isTsumo ? `${winnerName} のツモ和了` : `${winnerName} のロン和了 (放銃: ${fromPlayerName})`;

        contentHTML += `<h3>${titleText}</h3>`;
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
        contentHTML += `<div class="total-score">${han}翻 ${fu}符 <b>${scoreResult.total}点</b>${scoreName}</div>`;
        if (scoreResult.breakdown) {
             contentHTML += `<div class="score-breakdown">(${scoreResult.breakdown})</div>`;
        }
    } else if (result.type === 'draw') {
        const drawReasonMap = { exhaustive: "荒牌平局 (流局)", kyuushuu_kyuuhai: "九種九牌", suucha_riichi: "四家立直", suukaikan: "四開槓", suufon_renda: "四風連打" };
        contentHTML += `<h3>${drawReasonMap[result.drawType]}</h3>`;
        
        if (result.drawType === 'exhaustive') {
            const tenpaiNames = result.tenpaiPlayers.map(pIdx => pIdx === myPlayerIndex ? 'あなた' : `Player ${pIdx + 1}`);
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
    Object.values(actionButtons).forEach(btn => {
        btn.style.display = 'none';
        btn.onclick = null;
    });
    const choiceDiv = actionButtonsContainer.querySelector(".choice-div");
    if (choiceDiv) choiceDiv.remove();
}

function showActionButtons(actions) {
    hideActionButtons();
    let hasAction = false;
    for (const actionKey in actions) {
        if (actionButtons[actionKey] && actions[actionKey].can) {
            actionButtons[actionKey].style.display = 'inline-block';
            actionButtons[actionKey].onclick = actions[actionKey].handler;
            hasAction = true;
        }
    }
    return hasAction;
}

function showChoiceModal(type, choices, callback, cancelCallback) {
    hideActionButtons();
    const choiceDiv = document.createElement('div');
    choiceDiv.className = 'choice-div';

    choices.forEach(choice => {
        const btn = document.createElement('button');
        const choiceContainer = document.createElement('span');
        
        const items = Array.isArray(choice) ? choice : [choice.tile]; // チーは配列、カンはオブジェクト
        items.forEach(item => choiceContainer.appendChild(createTileImage(item, null, true)));
        
        btn.appendChild(choiceContainer);
        btn.onclick = () => {
            callback(choice);
            choiceDiv.remove();
        };
        choiceDiv.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'キャンセル';
    cancelBtn.onclick = () => {
        choiceDiv.remove();
        if (cancelCallback) cancelCallback();
    };
    choiceDiv.appendChild(cancelBtn);

    actionButtonsContainer.appendChild(choiceDiv);
}