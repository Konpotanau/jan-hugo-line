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
const timerDisplayEl = document.getElementById("timer-display"); // タイマー要素を取得
const actionButtonsContainer = document.getElementById("action-buttons");
const tenpaiInfoContainerEl = document.getElementById("tenpai-info-container");
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

let timerAnimationId = null; // タイマーのアニメーションIDを管理

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
    renderTenpaiInfo(gameState, myPlayerIndex); // ★ 聴牌情報表示の呼び出しを追加
    
    // タイマー情報を抽出して描画関数を呼び出す
    const timerInfo = gameState.turnTimer || gameState.waitingForAction?.timer;
    renderTimer(timerInfo);
}

/**
 * サーバーから受け取ったタイマー情報を基に、画面にカウントダウンを表示する
 * @param {object|null} timerInfo - サーバーから渡されたタイマー情報 (startTime, duration)
 */
function renderTimer(timerInfo) {
    // 既存のアニメーションループがあればキャンセル
    if (timerAnimationId) {
        cancelAnimationFrame(timerAnimationId);
        timerAnimationId = null;
    }

    // 有効なタイマー情報がある場合
    if (timerInfo && timerInfo.startTime && timerInfo.duration) {
        timerDisplayEl.style.opacity = '1'; // タイマーを表示

        const update = () => {
            const elapsedTime = Date.now() - timerInfo.startTime;
            const remainingTime = Math.max(0, timerInfo.duration - elapsedTime);
            const remainingSeconds = Math.ceil(remainingTime / 1000);
            
            timerDisplayEl.textContent = remainingSeconds;

            if (remainingTime > 0) {
                // 残り時間があれば次のフレームで再度更新
                timerAnimationId = requestAnimationFrame(update);
            } else {
                // 時間切れになったら非表示にする
                timerDisplayEl.style.opacity = '0';
                timerDisplayEl.textContent = '';
            }
        };
        update(); // 更新ループを開始
    } else {
        // タイマー情報がなければ非表示にする
        timerDisplayEl.style.opacity = '0';
        timerDisplayEl.textContent = '';
    }
}


/**
 * ★★★ NEW FUNCTION ★★★
 * 聴牌になる捨て牌とその待ち牌の情報を計算して表示する
 * @param {object} gameState - ゲーム状態
 * @param {number} myPlayerIndex - 自分のプレイヤーインデックス
 */
function renderTenpaiInfo(gameState, myPlayerIndex) {
    tenpaiInfoContainerEl.innerHTML = "";
    tenpaiInfoContainerEl.style.display = 'none';

    const isMyTurn = gameState.turnIndex === myPlayerIndex;
    const isMyRiichi = gameState.isRiichi[myPlayerIndex];
    const hand = gameState.hands[myPlayerIndex];
    const canDiscard = isMyTurn && hand.length % 3 === 2;

    // 自分のターンで、リーチしておらず、打牌可能な状態でのみ表示
    if (!canDiscard || isMyRiichi) {
        return;
    }

    const furo = gameState.furos[myPlayerIndex];
    const tenpaiDiscards = new Map(); // Map to store: discardTile -> [waits]

    // 手牌のユニークな牌それぞれについて、捨てた場合の待ちを確認
    const uniqueTiles = [...new Set(hand)];
    uniqueTiles.forEach(tileToDiscard => {
        const tempHand = [...hand];
        // 同じ牌が複数ある場合でも、1枚だけ取り除く
        tempHand.splice(tempHand.lastIndexOf(tileToDiscard), 1);
        const waits = getWaits(tempHand, furo);

        if (waits.length > 0) {
            tenpaiDiscards.set(tileToDiscard, waits);
        }
    });

    if (tenpaiDiscards.size === 0) {
        return; // 聴牌になる捨て牌がない場合は何もしない
    }
    
    tenpaiInfoContainerEl.style.display = 'flex';

    // 牌の種類順にソートして表示を安定させる
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
    const canDiscard = isMyTurn && hand.length % 3 === 2;

    if (playerIdx === myPlayerIndex) {
        // --- ★ NEW: 聴牌になる捨て牌を事前に計算 ---
        let tenpaiDiscardSet = new Set();
        if (canDiscard && !gameState.isRiichi[myPlayerIndex]) {
            const uniqueTilesInHand = [...new Set(hand)];
            uniqueTilesInHand.forEach(tileToDiscard => {
                const tempHand = [...hand];
                tempHand.splice(tempHand.lastIndexOf(tileToDiscard), 1);
                // yaku.jsのgetWaits関数を利用
                if (getWaits(tempHand, gameState.furos[myPlayerIndex]).length > 0) {
                    tenpaiDiscardSet.add(tileToDiscard);
                }
            });
        }
        // --- ★ END NEW ---

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
            const tileImg = createTileImage(tile, clickHandler);
            
            // ★ NEW: 計算結果に基づいてハイライト用クラスを追加
            if (tenpaiDiscardSet.has(tile)) {
                tileImg.classList.add('tile-tenpai-candidate');
            }

            container.appendChild(tileImg);
        });

        if (drawnTile) {
            const clickHandler = canDiscard ? () => sendDiscardCb(drawnTile) : null;
            const tileImg = createTileImage(drawnTile, clickHandler);
            tileImg.style.marginLeft = "15px";

            // ★ NEW: ツモ牌にもハイライト用クラスを追加
            if (tenpaiDiscardSet.has(drawnTile)) {
                tileImg.classList.add('tile-tenpai-candidate');
            }

            container.appendChild(tileImg);
        }

    } else {
        hand.forEach(() => container.appendChild(createTileImage('back')));
    }
}

function renderDiscards(gameState, playerIdx, displayIdx) {
    const container = discardContainers[displayIdx];
    container.innerHTML = "";
    
    // ★★★ 修正箇所: サーバーから送られてきた `lastDiscard` を直接使う ★★★
    const lastDiscardInfo = gameState.lastDiscard;

    gameState.discards[playerIdx].forEach((discard, index) => {
        const img = createTileImage(discard.tile);
        if (discard.isRiichi) {
            img.classList.add("riichi-discard");
        }
        // サーバーからの最新捨て牌情報と一致する場合にハイライトする
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

    // waitingForActionが存在し、かつ自分のアクションがあるかチェック
    const myTurnActions = gameState.turnIndex === myPlayerIndex && gameState.turnActions;
    const myWaitingActions = gameState.waitingForAction && gameState.waitingForAction.possibleActions[myPlayerIndex];

    // ★★★ ここからが修正箇所 ★★★
    const isMyTurnAndRiichi = gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex];

    // 表示すべきアクションが無く、かつリーチ中の自動ツモ切りの状況でもなければ、何もせずに関数を抜ける
    if (!myTurnActions && !myWaitingActions && !isMyTurnAndRiichi) {
        actionButtonsContainer.style.display = 'none'; // コンテナ自体を隠す
        return;
    }
    // ★★★ ここまでが修正箇所 ★★★
    
    actionButtonsContainer.style.display = 'flex'; // コンテナを表示
    const actionsToShow = {};

    // 自分のターンのアクション（ツモ、リーチ、カンなど）
    if (myTurnActions) {
        const turnActions = gameState.turnActions;
        
        if (turnActions.isDeclaringRiichi) {
             infoEl.textContent = "捨てる牌を選んでください（リーチ）";
             return;
        }
        
        if (turnActions.canTsumo) {
            actionsToShow.ron = { type: 'ツモ', handler: () => sendActionCb({ type: 'tsumo' }) };
        }
        if (turnActions.canRiichi) {
            actionsToShow.riichi = { type: 'リーチ', handler: () => sendActionCb({ type: 'riichi' }) };
        }
        if (turnActions.canKyuKyu) {
            actionsToShow.kyukyu = { type: '九種九牌', handler: () => sendActionCb({ type: 'kyukyu' }) };
        }
        
        const kanChoices = [
            ...(turnActions.canAnkan || []).map(tile => ({ tile, kanType: 'ankan', meld: [tile, tile, tile, tile] })),
            ...(turnActions.canKakan || []).map(tile => ({ tile, kanType: 'kakan', meld: [tile, tile, tile, tile] }))
        ];
        
        if (kanChoices.length > 0) {
            actionsToShow.kan = {
                type: 'カン',
                handler: () => {
                    if (kanChoices.length === 1) {
                        sendActionCb({ type: 'kan', ...kanChoices[0] });
                    } else {
                        showChoiceModal('kan', kanChoices, (selectedChoice) => {
                            sendActionCb({ type: 'kan', ...selectedChoice });
                        });
                    }
                },
                previews: kanChoices.length === 1 ? kanChoices[0].meld : null // 単一の場合のみ直接プレビュー
            };
        }
        
        // ★ リーチ中でない場合のみ、スキップ（ツモ切り）ボタンを表示
        if (Object.keys(actionsToShow).length > 0 && !gameState.isRiichi[myPlayerIndex]) {
            if (gameState.drawnTile) {
                 actionsToShow.skip = { type: 'スキップ', handler: () => sendDiscardCb(gameState.drawnTile) };
            }
        }
    }

    // 他家の捨て牌に対するアクション（ロン、ポン、チーなど）
    if (myWaitingActions) {
        const possible = myWaitingActions;
        const discardedTile = gameState.waitingForAction.tile;
        
        if (possible.canRon) actionsToShow.ron = { type: 'ロン', handler: () => sendActionCb({ type: 'ron' }) };
        
        if (possible.canPon) {
            actionsToShow.pon = {
                type: 'ポン',
                handler: () => sendActionCb({ type: 'pon' }),
                previews: [discardedTile, discardedTile, discardedTile]
            };
        }
        
        if (possible.canDaiminkan) {
            actionsToShow.kan = {
                type: 'カン',
                handler: () => sendActionCb({ type: 'daiminkan' }),
                previews: [discardedTile, discardedTile, discardedTile, discardedTile]
            };
        }
        
        if (possible.canChi && possible.canChi.length > 0) {
            const chiChoices = possible.canChi.map(choice => ({ tiles: choice, meld: [...choice, discardedTile].sort(tileSort) }));
            actionsToShow.chi = {
                type: 'チー',
                handler: () => {
                    if (chiChoices.length === 1) {
                        sendActionCb({ type: 'chi', tiles: chiChoices[0].tiles });
                    } else {
                        showChoiceModal('chi', chiChoices, (selected) => {
                            sendActionCb({ type: 'chi', tiles: selected.tiles });
                        });
                    }
                },
                previews: chiChoices.length === 1 ? chiChoices[0].meld : null // 単一の場合のみ直接プレビュー
            };
        }
        actionsToShow.skip = { type: 'スキップ', handler: () => sendActionCb({ type: 'skip' }) };
    }

    showActionButtons(actionsToShow);

    // リーチ後の自動打牌ロジック
    // const isMyTurnAndRiichi = gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex]; // (重複のためコメントアウト)
    const hasDrawnTile = gameState.drawnTile !== null;

    // 自分のターンでリーチ中、ツモ牌があり、かつ「ツモ」や「カン」のアクションがない場合
    if (isMyTurnAndRiichi && hasDrawnTile && !actionsToShow.ron && !actionsToShow.kan) {
        // 表示されているボタンを一旦すべて隠す
        hideActionButtons();
        // 0.5秒後にツモ牌を自動で捨てる
        setTimeout(() => {
            // タイムアウトまでの間に状況が変わっていないか再確認
            // (例: 非常に短い時間でサーバーから別の更新が来た場合など)
            if (gameState.turnIndex === myPlayerIndex && gameState.isRiichi[myPlayerIndex] && gameState.drawnTile) {
                console.log(`Auto-discarding ${gameState.drawnTile} due to Riichi.`);
                sendDiscardCb(gameState.drawnTile);
            }
        }, 500); // 500ミリ秒の遅延
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
    actionButtonsContainer.style.display = 'none'; // コンテナ自体を隠す
    Object.values(actionButtons).forEach(btn => {
        btn.style.display = 'none';
        btn.onclick = null;
        // プレビュー用の子要素をクリア
        const preview = btn.querySelector('.action-preview');
        if (preview) preview.remove();
        // ボタンのテキストを元に戻す（"ツモ"→"ロン"など）
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
            
            // ボタンのテキストとプレビューを設定
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

        // 'kan'や'chi'の meld プロパティを使ってプレビューを作成
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
        // スキップと同じ挙動をさせる
        sendAction({ type: 'skip' });
        hideActionButtons();
    };
    modal.appendChild(cancelBtn);
    
    // actionButtonsContainer の中にモーダルを追加
    actionButtonsContainer.appendChild(modal);
}