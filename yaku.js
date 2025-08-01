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
        if (pairCount === 7 && Object.keys(counts).length === 7) {
            return { form: "七対子", pairs: Object.keys(counts).filter(t => counts[t] === 2) };
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
    const uniqueTiles = Object.keys(counts).sort(tileSort);
    const t1 = uniqueTiles[0];

    // --- Path 1: 刻子として切り出す試み ---
    if (counts[t1] >= 3) {
        const nextTilesArray = [...tiles];
        nextTilesArray.splice(nextTilesArray.indexOf(t1), 3);

        const result = findMelds(nextTilesArray.sort(tileSort));
        if (result !== null) {
            return [[t1, t1, t1], ...result];
        }
    }

    // --- Path 2: 順子として切り出す試み ---
    if (isNumberTile(t1)) {
        const n = parseInt(t1[0]);
        const s = t1[1];
        if (n <= 7) { // 7までしか順子の始点になれない
            const t2 = `${n + 1}${s}`;
            const t3 = `${n + 2}${s}`;

            if (counts[t2] >= 1 && counts[t3] >= 1) {
                const nextTilesArray = [...tiles];
                nextTilesArray.splice(nextTilesArray.indexOf(t1), 1);
                nextTilesArray.splice(nextTilesArray.indexOf(t2), 1);
                nextTilesArray.splice(nextTilesArray.indexOf(t3), 1);
                
                const result = findMelds(nextTilesArray.sort(tileSort));
                if (result !== null) {
                    return [[t1, t2, t3].sort(tileSort), ...result];
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
    const { hand, furo, winTile, isTsumo, isRiichi, isIppatsu, isRinshan, dora, uraDora, bakaze, jikaze } = winContext; 
    const isMenzen = furo.length === 0;
    let yaku = [];
    let hanSoFar = 0; // 役満チェック用

    const winForm = getWinningForm(hand, furo);
    if (!winForm) return { yakuList: [], totalHan: 0 };

    // --- Yakuman ---
    if (winForm.form === "国士無双") {
        yaku.push({ name: "国士無双", han: 13, type: "yakuman" });
        hanSoFar += 13;
    }
    
    // 他の役満... (四暗刻など)

    if (hanSoFar > 0) {
        return { yakuList: yaku, totalHan: hanSoFar, isYakuman: true };
    }
    
    // --- Standard Hand ---
    if (winForm.form === "七対子") {
        yaku.push({ name: "七対子", han: 2 });
    }

    if (winForm.form === "4面子1雀頭") {
        const allMelds = [...(winForm.melds || []), ...furo.map(f => f)];
        const allHandTiles = [...hand, ...furo.flatMap(f => f.tiles)];
        
        // --- Situation Yaku ---
        if (isRiichi) yaku.push({ name: "立直", han: 1 });
        if (isIppatsu) yaku.push({ name: "一発", han: 1 });
        if (isMenzen && isTsumo) yaku.push({ name: "門前清自摸和", han: 1 });
        if (isRinshan) yaku.push({ name: "嶺上開花", han: 1 });
        
        // --- Hand Yaku ---
        if (allHandTiles.every(t => !isYaochu(t))) yaku.push({ name: "断么九", han: 1 });

        if (isMenzen && allMelds.every(m => isShuntsu(Array.isArray(m) ? m : m.tiles)) && !isYakuhai(winForm.janto, bakaze, jikaze) && isRyanmenWait(winForm, winTile)) {
            yaku.push({ name: "平和", han: 1 });
        }
        
        if (isMenzen) {
            const shuntsuMelds = winForm.melds.filter(isShuntsu).map(m => m.sort().join(','));
            const shuntsuCounts = shuntsuMelds.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
            const iipeikouSets = Object.values(shuntsuCounts).filter(c => c >= 2).length;
            if (iipeikouSets === 2) yaku.push({ name: "二盃口", han: 3 });
            else if (iipeikouSets === 1) yaku.push({ name: "一盃口", han: 1 });
        }
        
        const yakuhaiTiles = ["白", "発", "中"]; 
        const countedYakuhai = new Set();
        allMelds.forEach(m => {
            const meldTiles = Array.isArray(m) ? m : m.tiles;
            if (isKotsu(meldTiles) || isKan(meldTiles)) {
                const tile = meldTiles[0];
                if (yakuhaiTiles.includes(tile) && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (飜牌)`, han: 1 }); countedYakuhai.add(tile); }
                if (tile === bakaze && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (場風)`, han: 1 }); countedYakuhai.add(tile); }
                if (tile === jikaze && !countedYakuhai.has(tile)) { yaku.push({ name: `役牌 (自風)`, han: 1 }); countedYakuhai.add(tile); }
            }
        });

        const numberTiles = allHandTiles.filter(isNumberTile);
        const suits = new Set(numberTiles.map(t => t[1]));
        const hasJi = allHandTiles.some(isJi);
        if (suits.size === 1) {
            if (hasJi) yaku.push({ name: "混一色", han: isMenzen ? 3 : 2 });
            else yaku.push({ name: "清一色", han: isMenzen ? 6 : 5 });
        }

        const kotsuKanMelds = allMelds.filter(m => {
            const tiles = Array.isArray(m) ? m : m.tiles;
            return isKotsu(tiles) || isKan(tiles);
        });

        if (kotsuKanMelds.length === 4) yaku.push({ name: "対々和", han: 2 });
        
        const ankoCount = kotsuKanMelds.filter(m => isAnko(m, winContext)).length;
        if (ankoCount === 3) yaku.push({ name: "三暗刻", han: 2 });

        const kanCount = allMelds.filter(m => {
            const tiles = Array.isArray(m) ? m : m.tiles;
            return isKan(tiles);
        }).length;
        if (kanCount === 3) yaku.push({ name: "三槓子", han: 2 });
        if (kanCount === 4) yaku.push({ name: "四槓子", han: 13, type: "yakuman" }); // 役満
    }
    
    // 役満が成立していたら他の役は計算しない
    if (yaku.some(y => y.type === 'yakuman')) {
        const yakumanYaku = yaku.filter(y => y.type === 'yakuman');
        return { yakuList: yakumanYaku, totalHan: yakumanYaku.reduce((s, y) => s + y.han, 0), isYakuman: true };
    }
    
    // ドラ計算
    let doraCount = 0;
    const allWinTiles = [...hand, ...furo.flatMap(f=>f.tiles)];
    
    // ドラ
    allWinTiles.forEach(tile => {
        doraCount += dora.filter(d => d === tile).length;
    });

    // 裏ドラ (リーチ時のみ)
    if (isRiichi && uraDora) {
        allWinTiles.forEach(tile => {
            doraCount += uraDora.filter(d => d === tile).length;
        });
    }
    
    if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });

    const totalHan = yaku.reduce((sum, current) => sum + current.han, 0);
    
    // 役がない場合は和了れない（ドラのみは不可）
    if (!hasValidYaku(yaku)) return { yakuList: [], totalHan: 0 };
    
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
    if (hasPinfu) {
        return winContext.isTsumo ? 20 : 30;
    }
    
    let fu = 20; // 副底

    // 和了方による符
    if (winContext.isTsumo) fu += 2;
    else if (winContext.furo.length === 0) fu += 10; // 門前ロン

    // 面子による符
    const allMelds = [...(winForm.melds || []), ...winContext.furo];
    allMelds.forEach(meld => {
        const isAn = isAnko(meld, winContext);
        const meldTiles = Array.isArray(meld) ? meld.tiles || meld : meld.tiles;
        const tile = meldTiles[0];
        const isYao = isYaochu(tile);
        
        if (isKotsu(meldTiles)) {
            fu += (isAn ? 4 : 2) * (isYao ? 2 : 1);
        } else if (isKan(meldTiles)) {
            const type = meld.type; // 'ankan', 'kakan', 'daiminkan'
            const isAnKan = type === 'ankan';
            fu += (isAnKan ? 16 : 8) * (isYao ? 2 : 1);
        }
    });

    // 雀頭による符
    if (isYakuhai(winForm.janto, winContext.bakaze, winContext.jikaze)) fu += 2;
    if (["白", "発", "中"].includes(winForm.janto) && winForm.janto !== winContext.bakaze && winForm.janto !== winContext.jikaze) {
        fu += 2;
    }


    // 待ちの符（ペンチャン、カンチャン、単騎待ち）
    if (winForm.janto === winContext.winTile) { // 単騎待ち
        fu += 2;
    } else {
        const waitMeld = winForm.melds.find(m => m.includes(winContext.winTile));
        if (waitMeld && isShuntsu(waitMeld)) {
            const sorted = waitMeld.sort(tileSort);
            const n = parseInt(sorted[0][0]);
            // カンチャン待ち
            if (sorted[1] === winContext.winTile) fu += 2;
            // ペンチャン待ち
            if ((n === 1 && sorted[2] === winContext.winTile) || (n === 7 && sorted[0] === winContext.winTile)) fu += 2;
        }
    }
    
    // 食い平和形でツモ和了の場合、符がなければ30符にする
    if (winContext.furo.length > 0 && fu === 22) return 30;

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
    if (han >= 13) return isDealer ? { total: 48000, payments: [16000], name: "役満" } : { total: 32000, payments: [16000, 8000], name: "役満" };
    if (han >= 11) return isDealer ? { total: 36000, payments: [12000], name: "三倍満" } : { total: 24000, payments: [12000, 6000], name: "三倍満" };
    if (han >= 8) return isDealer ? { total: 24000, payments: [8000], name: "倍満" } : { total: 16000, payments: [8000, 4000], name: "倍満" };
    if (han >= 6) return isDealer ? { total: 18000, payments: [6000], name: "跳満" } : { total: 12000, payments: [6000, 3000], name: "跳満" };
    
    let basePoint = fu * Math.pow(2, 2 + han);
    if (han === 5 || basePoint > 2000) {
        basePoint = 2000; // 満貫
        const name = "満貫";
        if (isDealer) {
            return isTsumo 
                ? { total: 12000, payments: [4000], name, breakdown: "4000オール" }
                : { total: 12000, payments: [12000], name };
        } else {
             return isTsumo 
                ? { total: 8000, payments: [4000, 2000], name, breakdown: "4000/2000" } 
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
            return { total: dealerPayment + otherPayment * 2, payments: [dealerPayment, otherPayment], breakdown: `${dealerPayment}/${otherPayment}` };
        } else { // ロン
            const payment = ceilTo100(basePoint * 4);
            return { total: payment, payments: [payment] };
        }
    }
}

// --- Helper Functions ---
function isAnko(meld, winContext) {
    if (Array.isArray(meld)) { // 手牌内の面子
        const tiles = meld;
        // ロン牌で作った刻子は明刻扱い
        if (!winContext.isTsumo && isKotsu(tiles) && tiles.includes(winContext.winTile)) return false;
        return true;
    } else { // 副露
        return meld.type === 'ankan';
    }
}
function hasValidYaku(yakuList) {
    return yakuList.some(y => y.name !== "ドラ");
}
function isNumberTile(t){return t && /^[1-9][mps]$/.test(t)}
function isJi(t){return t && ["東","南","西","北","白","発","中"].includes(t)}
function isYaochu(t){return isJi(t)||isNumberTile(t)&&(t.startsWith("1")||t.startsWith("9"))}
function isKotsu(m){return m.length===3&&m[0]===m[1]&&m[1]===m[2]}
function isShuntsu(m){if(m.length!==3||!isNumberTile(m[0]))return!1;const t=[...m].sort(tileSort),e=parseInt(t[0][0]),n=parseInt(t[1][0]),s=parseInt(t[2][0]),i=t[0][1];return n===e+1&&s===e+2&&t[1][1]===i&&t[2][1]===i}
function isKan(m){return m.length===4&&m[0]===m[1]&&m[1]===m[2]&&m[2]===m[3]}
function isYakuhai(t,e,n){const yakuhaiFanpai = ["白","発","中"]; return yakuhaiFanpai.includes(t) || t === e || t === n; }
function isRyanmenWait(winForm,winTile){if(!winForm||winForm.form!=="4面子1雀頭"||winForm.janto===winTile)return!1;const targetMeld=winForm.melds.find(m=>isShuntsu(m)&&m.includes(winTile));if(!targetMeld)return!1;const sortedMeld=[...targetMeld].sort(tileSort);const n=parseInt(sortedMeld[0][0]);return(winTile===sortedMeld[0]&&n>=2&&n<=7)||(winTile===sortedMeld[2]&&n>=1&&n<=6)}

function getDoraTile(indicator){if(!indicator)return null;if(!isNumberTile(indicator)){const order=["東","南","西","北","東"];const jiOrder=["白","発","中","白"];if(order.includes(indicator))return order[order.indexOf(indicator)+1];if(jiOrder.includes(indicator))return jiOrder[jiOrder.indexOf(indicator)+1];return null}const num=parseInt(indicator[0]);const suit=indicator[1];return(num===9?1:num+1)+suit}

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

    for (const tile of allPossibleTiles) {
        const totalCount = (handCounts[tile] || 0) + furo.flatMap(f => f.tiles).filter(t => t === tile).length;
        if (totalCount >= 4) continue;
        
        const tempHand = [...hand, tile];
        if (getWinningForm(tempHand, furo)) {
            waits.add(tile);
        }
    }
    return Array.from(waits).sort(tileSort);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getWinningForm, findMelds, checkYaku, calculateFu, calculateScore, getWaits, hasValidYaku, isNumberTile, isYaochu, isKotsu, isShuntsu, isKan, isYakuhai, isRyanmenWait, isAnko, getDoraTile };
}