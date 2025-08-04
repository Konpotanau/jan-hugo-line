/**
 * 和了形（4面子1雀頭 or 七対子 or 国士無双）か判定する
 * @param {string[]} tiles - 手牌（和了牌を含む）
 * @param {string[][]} furo - 副露（鳴いた面子）の配列
 * @returns {object|null} 和了形ならその構成、でなければnull
 */
// ★ 追加: Node.js環境とブラウザ環境の互換性対応
// Node.js環境（サーバーサイド）で実行されている場合、`require`を使って依存モジュールを読み込む
// ブラウザ環境では、<script>タグで先に読み込まれたグローバルスコープの関数が使われる
if (typeof module !== 'undefined' && module.exports) {
    var { createAllTiles, tileSort } = require('./constants.js');
}

// --- Helper Functions (for Red Dora) ---
const normalizeTile = (tile) => (tile && tile.startsWith('r5')) ? `5${tile[2]}` : tile;

function getWinningForm(tiles, furo = []) {
    const counts = tiles.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});

    // 鳴いている場合は国士無双と七対子にはならない
    if (furo.length > 0) {
        // --- 4面子1雀頭 (鳴きあり) ---
        const sortedTiles = [...tiles].sort(tileSort);
        // 雀頭候補を探す
        for (const tile in counts) {
            if (counts[tile] >= 2) { 
                const tempCounts = { ...counts };
                tempCounts[tile] -= 2; // 雀頭を仮に抜く
                
                const remainingTilesArray = [];
                for (const t in tempCounts) {
                    for (let i = 0; i < tempCounts[t]; i++) {
                        remainingTilesArray.push(t);
                    }
                }
                
                // 残りの手牌で面子を探索
                const meldsInHand = findMelds(remainingTilesArray.sort(tileSort));
                if (meldsInHand !== null && (meldsInHand.length + furo.length === 4)) {
                    return { form: "4面子1雀頭", melds: meldsInHand, janto: tile };
                }
            }
        }
        return null; // 4面子1雀頭が成立しない
    }

    // --- 以下、門前のみの判定 ---
    // 門前の場合、手牌は14枚のはず (getWaitsから呼ばれる場合は13枚)
    if (tiles.length !== 14 && tiles.length !== 13) return null;

    // 国士無双
    if (tiles.length === 14) {
        const yaochuhai = ["1m", "9m", "1p", "9p", "1s", "9s", "東", "南", "西", "北", "白", "発", "中"];
        const isKokushi = yaochuhai.every(t => (counts[t] || 0) >= 1);
        if (isKokushi) {
            const pair = Object.keys(counts).find(t => counts[t] === 2);
            if (pair && Object.keys(counts).length === 13) return { form: "国士無双", janto: pair };
        }
    }

    // 七対子
    if (tiles.length === 14) {
        const pairCount = Object.values(counts).filter(c => c === 2).length;
        // 赤ドラは別の牌としてカウントされるため、種類数のチェックを修正
        const uniqueNormalizedTiles = new Set(tiles.map(normalizeTile));
        if (pairCount === 7 && uniqueNormalizedTiles.size === 7) {
            const pairs = Object.keys(counts).filter(t => counts[t] === 2);
            return { form: "七対子", pairs: pairs.sort(tileSort) };
        }
    }

    // 4面子1雀頭 (門前)
    const sortedTiles = [...tiles].sort(tileSort);
    for (const tile in counts) {
        if (counts[tile] >= 2) {
            const tempCounts = { ...counts };
            tempCounts[tile] -= 2;
            
            const remainingTilesArray = [];
            for (const t in tempCounts) {
                for (let i = 0; i < tempCounts[t]; i++) {
                    remainingTilesArray.push(t);
                }
            }
            
            const melds = findMelds(remainingTilesArray.sort(tileSort));
            if (melds && melds.length + furo.length === Math.floor((tiles.length-2)/3)) {
                return { form: "4面子1雀頭", melds, janto: tile };
            }
        }
    }

    return null;
}

/**
 * 残りの牌で面子（刻子 or 順子）を作れるか再帰的に探索
 * @param {string[]} tiles - 判定対象の牌
 * @returns {string[][]|null} 面子構成の配列、作れなければnull
 */
function findMelds(tiles) {
    if (tiles.length === 0) return []; // 全て面子にできたら成功

    const counts = tiles.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    const t1 = tiles[0];

    // --- Path 1: 刻子として切り出す試み ---
    const norm_t1 = normalizeTile(t1);
    const kotsuCandidates = tiles.filter(t => normalizeTile(t) === norm_t1);
    if (kotsuCandidates.length >= 3) {
        const meld = kotsuCandidates.slice(0, 3);
        const nextTiles = [...tiles];
        meld.forEach(tile => {
            nextTiles.splice(nextTiles.indexOf(tile), 1);
        });

        const result = findMelds(nextTiles);
        if (result !== null) {
            return [meld, ...result];
        }
    }

    // --- Path 2: 順子として切り出す試み ---
    if (isNumberTile(t1)) {
        const n = parseInt(norm_t1[0]);
        const s = norm_t1[1];
        if (n <= 7) {
            const norm_t2 = `${n + 1}${s}`;
            const norm_t3 = `${n + 2}${s}`;
            
            const t2 = tiles.find(t => normalizeTile(t) === norm_t2);
            let t3 = null;
            if (t2) {
                const tempTiles = [...tiles];
                tempTiles.splice(tempTiles.indexOf(t2), 1);
                t3 = tempTiles.find(t => normalizeTile(t) === norm_t3);
            }

            if (t2 && t3) {
                const meld = [t1, t2, t3];
                const nextTiles = [...tiles];
                 meld.forEach(tile => {
                    nextTiles.splice(nextTiles.indexOf(tile), 1);
                });

                const result = findMelds(nextTiles);
                if (result !== null) {
                    return [meld.sort(tileSort), ...result];
                }
            }
        }
    }
    return null;
}


/**
 * 成立している役を判定する
 * @param {object} winContext - 和了時の状況
 * @returns {{yakuList: object[], totalHan: number}}
 */
function checkYaku(winContext) {
    const { hand, furo, winTile, isTsumo, isRiichi, isIppatsu, isRinshan, isChankan, dora, uraDora, bakaze, jikaze } = winContext; 
    const isMenzen = furo.length === 0;
    let yaku = [];
    let yakumanHan = 0;

    const winForm = getWinningForm(hand, furo);
    if (!winForm) return { yakuList: [], totalHan: 0 };
    
    const allMelds = winForm.form === "4面子1雀頭" ? [...(winForm.melds || []), ...furo] : [];
    const allTiles = [...hand, ...furo.flatMap(f => f.tiles)];
    const counts = allTiles.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});

    // --- Yakuman ---
    // 国士無双
    if (winForm.form === "国士無双") {
        yaku.push({ name: "国士無双", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    // 四暗刻
    const ankoMelds = allMelds.filter(m => isAnko(m, winContext));
    if (ankoMelds.length === 4) {
        // ロン和了の場合、待ちの形で単騎待ちか判定
        const isTanki = winForm.janto === winTile;
        if (isTsumo || isTanki) {
             yaku.push({ name: "四暗刻", han: 13, type: "yakuman" });
        } else {
             yaku.push({ name: "四暗刻 (単騎待ち)", han: 26, type: "yakuman" }); // ダブル役満
        }
        yakumanHan += isTsumo || isTanki ? 13 : 26;
    }

    const kotsuKanMelds = allMelds.filter(m => isKotsu(m.tiles || m) || isKan(m.tiles || m));
    
    // 大三元
    const dragonKotsu = kotsuKanMelds.filter(m => ["白", "発", "中"].includes(normalizeTile((m.tiles || m)[0])));
    if (dragonKotsu.length === 3) {
        yaku.push({ name: "大三元", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    // 字一色
    if (allTiles.every(isJi)) {
        yaku.push({ name: "字一色", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    // 清老頭
    if (allTiles.every(isRoutouhai)) {
        yaku.push({ name: "清老頭", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }

    // 緑一色
    const isRyuuiisou = allTiles.every(t => ["2s", "3s", "4s", "6s", "8s", "発", "r5s"].includes(t));
    if (isRyuuiisou) {
        yaku.push({ name: "緑一色", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    // 九蓮宝燈
    if (isMenzen && winForm.form === "4面子1雀頭") {
        const numberTiles = allTiles.filter(isNumberTile);
        const suits = new Set(numberTiles.map(t => normalizeTile(t)[1]));
        if (suits.size === 1 && numberTiles.length === 14) {
             const suit = suits.values().next().value;
             const needed = ['1','1','1','2','3','4','5','6','7','8','9','9','9'];
             const handNumbers = numberTiles.map(t => normalizeTile(t)[0]).sort();
             let isChuuren = true;
             let extraTile = null;
             
             const handCounts = handNumbers.reduce((a,c) => (a[c]=(a[c]||0)+1,a),{});
             const neededCounts = needed.reduce((a,c) => (a[c]=(a[c]||0)+1,a),{});
             
             for(let i=1; i<=9; i++){
                 const num = String(i);
                 if ((handCounts[num]||0) < (neededCounts[num]||0)) {
                     isChuuren = false;
                     break;
                 }
                 if ((handCounts[num]||0) > (neededCounts[num]||0)) {
                     if(extraTile !== null) { // 2種類以上多い牌がある
                          isChuuren = false;
                          break;
                     }
                     extraTile = num;
                 }
             }

             if(isChuuren && extraTile !== null) {
                const isJunsei = ['1','9'].includes(extraTile) ? handCounts[extraTile] === 4 : handCounts[extraTile] === 2;
                if (isJunsei) {
                     yaku.push({ name: "純正九蓮宝燈", han: 26, type: "yakuman" }); // ダブル
                     yakumanHan += 26;
                } else {
                     yaku.push({ name: "九蓮宝燈", han: 13, type: "yakuman" });
                     yakumanHan += 13;
                }
             }
        }
    }
    
    // 四槓子
    const kanCount = allMelds.filter(m => m.type && m.type.includes('kan')).length;
    if (kanCount === 4) {
        yaku.push({ name: "四槓子", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }

    if (yakumanHan > 0) {
        // 役満が成立した場合、通常役は含めずにドラのみ加算する
        let doraCount = 0;
        // 赤ドラ
        doraCount += allTiles.filter(t => t.startsWith('r5')).length;
        // 指示牌ドラ
        dora.forEach(doraValue => {
            allTiles.forEach(tileInHand => {
                if (normalizeTile(tileInHand) === doraValue) {
                    doraCount++;
                }
            });
        });
        // 裏ドラ
        if (isRiichi && uraDora) {
             uraDora.forEach(doraValue => {
                allTiles.forEach(tileInHand => {
                    if (normalizeTile(tileInHand) === doraValue) {
                        doraCount++;
                    }
                });
            });
        }
        if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });
        return { yakuList: yaku, totalHan: yakumanHan + doraCount, isYakuman: true };
    }
    
    // --- Standard Hand ---
    // Situation Yaku
    if (isRiichi) yaku.push({ name: "立直", han: 1 });
    if (isIppatsu) yaku.push({ name: "一発", han: 1 });
    if (isMenzen && isTsumo) yaku.push({ name: "門前清自摸和", han: 1 });
    if (isRinshan) yaku.push({ name: "嶺上開花", han: 1 });
    if (isChankan) yaku.push({ name: "搶槓", han: 1 });

    // Hand Yaku
    if (allTiles.every(t => !isYaochu(t))) yaku.push({ name: "断么九", han: 1 });

    if (winForm.form === "4面子1雀頭") {
        if (isMenzen && allMelds.every(m => isShuntsu(Array.isArray(m) ? m : m.tiles)) && !isYakuhai(winForm.janto, bakaze, jikaze) && isRyanmenWait(winForm, winTile)) {
            yaku.push({ name: "平和", han: 1 });
        }
        
        if (isMenzen) {
            const shuntsuMelds = winForm.melds.filter(isShuntsu).map(m => m.map(normalizeTile).sort().join(','));
            const shuntsuCounts = shuntsuMelds.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
            const iipeikouSets = Object.values(shuntsuCounts).filter(c => c >= 2).length;
            if (iipeikouSets === 2) {
                 // 七対子と二盃口は複合しない。二盃口を優先
                 yaku = yaku.filter(y => y.name !== "七対子");
                 yaku.push({ name: "二盃口", han: 3 });
            } else if (iipeikouSets === 1) {
                 yaku.push({ name: "一盃口", han: 1 });
            }
        }
    }
    if (winForm.form === "七対子") {
        yaku.push({ name: "七対子", han: 2 });
    }
    
    const yakuhaiTiles = ["白", "発", "中"]; 
    const countedYakuhai = new Set();
    kotsuKanMelds.forEach(m => {
        const tile = normalizeTile((m.tiles || m)[0]);
        if (yakuhaiTiles.includes(tile) && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (飜牌)`, han: 1 }); countedYakuhai.add(tile); }
        if (tile === bakaze && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (場風)`, han: 1 }); countedYakuhai.add(tile); }
        if (tile === jikaze && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (自風)`, han: 1 }); countedYakuhai.add(tile); }
    });

    const numberTilesOnly = allTiles.filter(isNumberTile);
    const suits = new Set(numberTilesOnly.map(t => normalizeTile(t)[1]));
    const hasJi = allTiles.some(isJi);
    if (suits.size === 1) {
        if (hasJi) yaku.push({ name: "混一色", han: isMenzen ? 3 : 2 });
        else if (numberTilesOnly.length === allTiles.length) yaku.push({ name: "清一色", han: isMenzen ? 6 : 5 });
    }
    
    if (allTiles.every(isYaochu)) {
        // 清老頭は役満で判定済み
        yaku.push({ name: "混老頭", han: 2 });
    }
    
    if (winForm.form === "4面子1雀頭") {
        const shuntsuMelds = allMelds.filter(m => isShuntsu(m.tiles || m));
        
        // チャンタ / 純チャン
        const isChanta = allMelds.every(m => (m.tiles || m).some(isYaochu)) && isYaochu(winForm.janto);
        if (isChanta) {
            const isJunchan = allMelds.every(m => (m.tiles || m).some(isRoutouhai)) && isRoutouhai(winForm.janto);
            if (isJunchan) {
                yaku.push({ name: "純全帯么九", han: isMenzen ? 3 : 2 });
            } else {
                yaku.push({ name: "混全帯么九", han: isMenzen ? 2 : 1 });
            }
        }

        // 一気通貫
        const suitsInShuntsu = new Set(shuntsuMelds.map(m => normalizeTile((m.tiles || m)[0])[1]));
        for (const s of suitsInShuntsu) {
            const suitShuntsu = shuntsuMelds.filter(m => normalizeTile((m.tiles || m)[0])[1] === s);
            const starts = new Set(suitShuntsu.map(m => normalizeTile((m.tiles || m)[0])[0]));
            if (starts.has('1') && starts.has('4') && starts.has('7')) {
                yaku.push({ name: "一気通貫", han: isMenzen ? 2 : 1 });
                break;
            }
        }
        
        // 三色同順
        const shuntsuGroups = shuntsuMelds.reduce((acc, m) => {
            const meldTiles = m.tiles || m;
            const startNum = normalizeTile(meldTiles.sort(tileSort)[0])[0];
            if (!acc[startNum]) acc[startNum] = new Set();
            acc[startNum].add(normalizeTile(meldTiles[0])[1]);
            return acc;
        }, {});
        for (const num in shuntsuGroups) {
            if (shuntsuGroups[num].size === 3) {
                yaku.push({ name: "三色同順", han: isMenzen ? 2 : 1 });
                break;
            }
        }
    }
    
    // 三色同刻
    const kotsuGroups = kotsuKanMelds.reduce((acc, m) => {
        const tile = (m.tiles || m)[0];
        if (isNumberTile(tile)) {
            const norm_tile = normalizeTile(tile);
            const num = norm_tile[0];
            if (!acc[num]) acc[num] = new Set();
            acc[num].add(norm_tile[1]);
        }
        return acc;
    }, {});
    for (const num in kotsuGroups) {
        if (kotsuGroups[num].size === 3) {
            yaku.push({ name: "三色同刻", han: 2 });
            break;
        }
    }
    
    // 小三元
    const dragonJanto = ["白", "発", "中"].includes(normalizeTile(winForm.janto));
    if (dragonKotsu.length === 2 && dragonJanto) {
        yaku.push({ name: "小三元", han: 2 });
    }

    if (kotsuKanMelds.length === 4) yaku.push({ name: "対々和", han: 2 });
    if (ankoMelds.length === 3) yaku.push({ name: "三暗刻", han: 2 });
    if (kanCount === 3) yaku.push({ name: "三槓子", han: 2 });
    
    // --- Final Calculation ---
    // 役満が成立していたら他の役は計算しない (再チェック)
    if (yaku.some(y => y.type === 'yakuman')) {
        const yakumanYaku = yaku.filter(y => y.type === 'yakuman');
        return { yakuList: yakumanYaku, totalHan: yakumanYaku.reduce((s, y) => s + y.han, 0), isYakuman: true };
    }
    
    // ドラ計算
    let doraCount = 0;
    // 赤ドラ
    doraCount += allTiles.filter(t => t.startsWith('r5')).length;
    // 指示牌ドラ
    dora.forEach(doraValue => {
        allTiles.forEach(tileInHand => {
            if (normalizeTile(tileInHand) === doraValue) {
                doraCount++;
            }
        });
    });
    // 裏ドラ
    if (isRiichi && uraDora) {
        uraDora.forEach(doraValue => {
            allTiles.forEach(tileInHand => {
                if (normalizeTile(tileInHand) === doraValue) {
                    doraCount++;
                }
            });
        });
    }

    if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });

    // 役がない場合は和了れない（ドラのみは不可）
    if (!hasValidYaku(yaku)) return { yakuList: [], totalHan: 0 };
    
    const totalHan = yaku.reduce((sum, current) => sum + current.han, 0);
    
    return { yakuList: yaku, totalHan: totalHan, isYakuman: false };
}


/**
 * 和了の符を計算する
 * @param {object} winForm - getWinningFormの返り値
 * @param {object[]} yakuList - 成立役のリスト
 * @param {object} winContext - 和了時の状況
 * @returns {number} 計算された符
 */
function calculateFu(winForm, yakuList, winContext) {
    if (!winForm) return 0;
    if (winForm.form === "七対子") return 25;
    
    const hasPinfu = yakuList.some(y => y.name === "平和");
    if (hasPinfu && winContext.isTsumo) {
        return 20;
    }
    if (hasPinfu && !winContext.isTsumo) { //ロン平和
        return 30; 
    }

    let fu = 20; // 副底

    // 和了方による符
    if (winContext.isTsumo) {
        if (!hasPinfu) fu += 2;
    }
    else if (winContext.furo.length === 0) fu += 10; // 門前ロン

    // 面子による符
    const allMelds = [...(winForm.melds || []), ...winContext.furo];
    allMelds.forEach(meld => {
        const meldTiles = Array.isArray(meld) ? meld : meld.tiles;
        const tile = meldTiles[0];
        const isYao = isYaochu(tile);
        
        if (isKotsu(meldTiles)) {
            const isAn = isAnko(meld, winContext);
            fu += (isAn ? 8 : 4) * (isYao ? 2 : 1);
        } else if (meld.type && meld.type.includes('kan')) {
            const isAnKan = meld.type === 'ankan';
             // 搶槓された加槓は明槓扱い
            const isStolenKakan = winContext.isChankan && meld.type === 'kakan';
            fu += (isAnKan && !isStolenKakan ? 32 : 16) * (isYao ? 2 : 1);
        }
    });

    // 雀頭による符
    if (isYakuhai(winForm.janto, winContext.bakaze, winContext.jikaze)) {
         fu += 2;
         // 連風牌
         if (winContext.bakaze === winContext.jikaze && normalizeTile(winForm.janto) === winContext.bakaze) {
            fu += 2;
         }
    } else if (["白", "発", "中"].includes(normalizeTile(winForm.janto))) {
        fu += 2;
    }


    // 待ちの符（ペンチャン、カンチャン、単騎待ち）
    if (winForm.janto === winContext.winTile) { // 単騎待ち
        fu += 2;
    } else {
        const waitMeld = winForm.melds.find(m => m.includes(winContext.winTile));
        if (waitMeld && isShuntsu(waitMeld)) {
            const sorted = waitMeld.map(normalizeTile).sort(tileSort);
            const firstNum = parseInt(sorted[0][0]);
            const winNum = parseInt(normalizeTile(winContext.winTile)[0]);

            // カンチャン待ち: 和了牌が真ん中
            if (sorted[1] === normalizeTile(winContext.winTile)) fu += 2;
            // ペンチャン待ち: 3か7の和了
            else if ((firstNum === 1 && winNum === 3) || (firstNum === 7 && winNum === 7)) fu += 2;
        }
    }
    
    // 食い平和形で符がない場合
    if (winContext.furo.length > 0 && fu === 20) {
        return 30;
    }
    
    // 符が0になることはない
    if (fu === 20 && !winContext.isTsumo) return 30; // 門前ロン平和は30符
    if (fu === 22) return 30; // ツモのみの2符は切り上げ

    return Math.ceil(fu / 10) * 10;
}

/**
 * 点数を計算する
 * @param {number} han - 翻数
 * @param {number} fu - 符
 * @param {boolean} isDealer - 親かどうか
 * @param {boolean} isTsumo - ツモ和了かどうか
 * @returns {object} { total: number, payments: number[], breakdown: string }
 */
function calculateScore(han, fu, isDealer, isTsumo) {
    if (han >= 13) {
        const yakumanCount = Math.floor(han / 13);
        const name = yakumanCount > 1 ? `${yakumanCount}倍役満` : "役満";
        const singleYakuman = isDealer ? 48000 : 32000;
        const total = singleYakuman * yakumanCount;
        const payments = isDealer ? [total / 3] : [singleYakuman * yakumanCount / 2, singleYakuman * yakumanCount / 4];
        return { total, payments, name };
    }
    if (han >= 11) return isDealer ? { total: 36000, payments: [12000], name: "三倍満", breakdown: "12000オール" } : { total: 24000, payments: [12000, 6000], name: "三倍満", breakdown: "6000/12000" };
    if (han >= 8) return isDealer ? { total: 24000, payments: [8000], name: "倍満", breakdown: "8000オール" } : { total: 16000, payments: [8000, 4000], name: "倍満", breakdown: "4000/8000" };
    if (han >= 6) return isDealer ? { total: 18000, payments: [6000], name: "跳満", breakdown: "6000オール" } : { total: 12000, payments: [6000, 3000], name: "跳満", breakdown: "3000/6000" };
    
    let basePoint = fu * Math.pow(2, 2 + han);
    
    if (basePoint > 2000 || han === 5) {
        basePoint = 2000; // 満貫
        const name = "満貫";
        if (isDealer) {
            return isTsumo 
                ? { total: 12000, payments: [4000], name, breakdown: "4000オール" }
                : { total: 12000, payments: [12000], name };
        } else {
             return isTsumo 
                ? { total: 8000, payments: [4000, 2000], name, breakdown: "2000/4000" } 
                : { total: 8000, payments: [8000], name };
        }
    }
    
    const ceilTo100 = (p) => Math.ceil(p / 100) * 100;

    if (isDealer) { // 親
        if (isTsumo) {
            const payment = ceilTo100(basePoint * 2);
            return { total: payment * 3, payments: [payment], breakdown: `${payment}オール` };
        } else { //ロン
            const payment = ceilTo100(basePoint * 6);
            return { total: payment, payments: [payment] };
        }
    } else { // 子
        if (isTsumo) {
            const dealerPayment = ceilTo100(basePoint * 2);
            const otherPayment = ceilTo100(basePoint * 1);
            return { total: dealerPayment + otherPayment * 2, payments: [dealerPayment, otherPayment], breakdown: `${otherPayment}/${dealerPayment}` };
        } else { // ロン
            const payment = ceilTo100(basePoint * 4);
            return { total: payment, payments: [payment] };
        }
    }
}

// --- Helper Functions ---
function isAnko(meld, winContext) {
    if (!meld) return false;
    const { isTsumo, winTile } = winContext;
    
    // 副露の場合
    if (meld.type) {
        if (meld.type === 'ankan') return true;
        // 搶槓された加槓は明槓扱い
        if (winContext.isChankan && meld.type === 'kakan') return false;
        return false;
    }

    // 手牌内の面子の場合 (配列)
    const meldTiles = meld;
    if (!isKotsu(meldTiles)) return false;
    // ツモ和了なら、全ての刻子は暗刻
    if (isTsumo) return true;
    // ロン和了の場合、和了牌を含まない刻子は暗刻
    return !meldTiles.includes(winTile);
}

function hasValidYaku(yakuList) {
    // ドラ以外の役が1つでもあればOK
    return yakuList.some(y => y.name !== "ドラ" && y.type !== "yakuman_part");
}
function isNumberTile(t){return t && (t.match(/^\d[mps]$/) || t.match(/^r5[mps]$/))}
function isJi(t){return t && ["東","南","西","北","白","発","中"].includes(t)}
function isYaochu(t){if(isJi(t)) return true; if(!isNumberTile(t)) return false; const num = normalizeTile(t)[0]; return num === '1' || num === '9'}
function isRoutouhai(t) { return isNumberTile(t) && (normalizeTile(t)[0] === "1" || normalizeTile(t)[0] === "9"); }
function isKotsu(m){return m.length===3&&normalizeTile(m[0])===normalizeTile(m[1])&&normalizeTile(m[1])===normalizeTile(m[2])}
function isShuntsu(m){if(m.length!==3) return false; const norm = m.map(normalizeTile).sort(tileSort); if(!isNumberTile(norm[0])) return false; const e=parseInt(norm[0][0]),n=parseInt(norm[1][0]),s=parseInt(norm[2][0]),i=norm[0][1];return n===e+1&&s===e+2&&norm[1][1]===i&&norm[2][1]===i}
function isKan(m){return m.length===4&&normalizeTile(m[0])===normalizeTile(m[1])&&normalizeTile(m[1])===normalizeTile(m[2])&&normalizeTile(m[2])===normalizeTile(m[3])}
function isYakuhai(t,e,n){const norm_t = normalizeTile(t); const yakuhaiFanpai = ["白","発","中"]; return yakuhaiFanpai.includes(norm_t) || norm_t === e || norm_t === n; }
function isRyanmenWait(winForm,winTile){if(!winForm||winForm.form!=="4面子1雀頭"||winForm.janto===winTile)return!1;const targetMeld=winForm.melds.find(m=>isShuntsu(m)&&m.includes(winTile));if(!targetMeld)return!1;const sortedNormMeld=[...targetMeld].map(normalizeTile).sort(tileSort);const normWinTile = normalizeTile(winTile);const firstNum = parseInt(sortedNormMeld[0][0]); return (normWinTile===sortedNormMeld[0]&&firstNum<8)||(normWinTile===sortedNormMeld[2]&&firstNum>1)}

function getDoraTile(indicator){if(!indicator)return null; const normIndicator = normalizeTile(indicator); if(!isNumberTile(normIndicator)){const order=["東","南","西","北","東"];const jiOrder=["白","発","中","白"];if(order.includes(normIndicator))return order[order.indexOf(normIndicator)+1];if(jiOrder.includes(normIndicator))return jiOrder[jiOrder.indexOf(normIndicator)+1];return null}const num=parseInt(normIndicator[0]);const suit=normIndicator[1];return(num===9?1:num+1)+suit}

/**
 * 聴牌の待ち牌を返す (リーチ判定用)
 * @param {string[]} hand - 手牌 (13枚)
 * @param {object[]} furo - 副露
 * @returns {string[]} 待ち牌の配列
 */
function getWaits(hand, furo = []) {
    if (hand.length % 3 !== 1) return [];
    
    // ブラウザ環境ではグローバルスコープのcreateAllTilesを、Node.jsでは上でrequireしたものを参照
    const allPossibleTiles = (typeof createAllTiles !== 'undefined' ? createAllTiles(1) : require('./constants.js').createAllTiles(1)).filter((v, i, a) => a.indexOf(v) === i); 
    const waits = new Set();
    const handCounts = hand.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    const furoTiles = furo.flatMap(f => f.tiles);

    for (const tile of allPossibleTiles) {
        // 既に4枚見えている牌は待てない
        const totalInGameNorm = normalizeTile(tile);
        let totalCountInGame = 0;
        hand.forEach(h => { if(normalizeTile(h) === totalInGameNorm) totalCountInGame++; });
        furoTiles.forEach(f => { if(normalizeTile(f) === totalInGameNorm) totalCountInGame++; });
        
        if (totalCountInGame >= 4) continue;
        
        const tempHand = [...hand, tile];
        if (getWinningForm(tempHand, furo)) {
            waits.add(tile);
        }
    }
    return Array.from(waits).sort(tileSort);
}

// Node.jsのモジュールとしてエクスポート
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getWinningForm, findMelds, checkYaku, calculateFu, calculateScore, getWaits, hasValidYaku, isNumberTile, isYaochu, isKotsu, isShuntsu, isKan, isYakuhai, isRyanmenWait, isAnko, getDoraTile };
}