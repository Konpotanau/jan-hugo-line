/**
 * 和了形（n面子1雀頭 or n対子 or 国士無双）か判定する
 * @param {string[]} tiles - 手牌（和了牌を含む）
 * @param {string[][]} furo - 副露（鳴いた面子）の配列
 * @returns {object|null} 和了形ならその構成、でなければnull
 */
// ★ 追加: Node.js環境とブラウザ環境の互換性対応
if (typeof module !== 'undefined' && module.exports) {
    var { tileSort } = require('./constants.js');
}

// --- Helper Functions (for Red Dora) ---
const normalizeTile = (tile) => (tile && tile.startsWith('r5')) ? `5${tile[2]}` : tile;
const isJi = (t) => t && ["東", "南", "西", "北", "白", "発", "中"].includes(t);
const isNumberTile = (t) => t && (t.match(/^\d[mps]$/) || t.match(/^r5[mps]$/));
const isYaochu = (t) => { if (!t) return false; if (isJi(t)) return true; if (!isNumberTile(t)) return false; const num = normalizeTile(t)[0]; return num === '1' || num === '9'; };


function getWinningForm(tiles, furo = []) {
    const counts = tiles.reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
    const handLength = tiles.length;

    // --- 特殊形から判定 ---
    // 国士無双
    if (furo.length === 0) {
        const yaochuhai = ["1m", "9m", "1p", "9p", "1s", "9s", "東", "南", "西", "北", "白", "発", "中"];
        const uniqueNormYaochuInHand = new Set(tiles.filter(isYaochu).map(normalizeTile));
        
        // 13枚以上ある場合、13種すべて揃っていれば国士無双
        if (handLength >= 13) {
            if (uniqueNormYaochuInHand.size === 13) {
                const normCounts = tiles.map(normalizeTile).reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
                const jantoNorm = yaochuhai.find(t => normCounts[t] >= 2);
                const janto = tiles.find(t => normalizeTile(t) === jantoNorm);
                return { form: "国士無双", janto: janto || null };
            }
        // 13枚未満の場合(テンパイ判定)、全ての牌が重複のないヤオチュー牌であれば国士無双テンパイとみなす
        } else { 
            if (uniqueNormYaochuInHand.size === handLength && tiles.every(isYaochu)) {
                return { form: "国士無双", janto: null }; // テンパイ形なので雀頭はまだない
            }
        }
    }

    // n対子 (七対子の拡張)
    if (furo.length === 0 && handLength > 0 && handLength % 2 === 0) {
        const normCounts = tiles.map(normalizeTile).reduce((acc, t) => { acc[t] = (acc[t] || 0) + 1; return acc; }, {});
        const isAllPairs = Object.values(normCounts).every(c => c === 2);
        
        if (isAllPairs) {
            const numPairs = handLength / 2;
            const pairs = Object.keys(normCounts).map(normTile => tiles.find(t => normalizeTile(t) === normTile));
            return { form: "n対子", pairs: pairs.sort(tileSort), numPairs: numPairs };
        }
    }
    
    // --- n面子1雀頭 ---
    const uniqueTiles = [...new Set(tiles)];
    for (const jantoCandidate of uniqueTiles) {
        if (counts[jantoCandidate] >= 2) {
            const tempHand = [...tiles];
            // 雀頭候補を2枚取り除く
            tempHand.splice(tempHand.indexOf(jantoCandidate), 1);
            tempHand.splice(tempHand.indexOf(jantoCandidate), 1);
            
            // 残りが3の倍数でなければならない
            if (tempHand.length % 3 !== 0) continue;

            const melds = findMelds(tempHand.sort(tileSort));
            if (melds !== null) {
                const totalMeldCount = melds.length + furo.length;
                return { form: "n面子1雀頭", melds, janto: jantoCandidate, numMelds: totalMeldCount };
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
    if (tiles.length % 3 !== 0) return null; // 3の倍数でなければ失敗

    const t1 = tiles[0];
    const norm_t1 = normalizeTile(t1);

    // --- Path 1: 刻子として切り出す試み ---
    const kotsuCandidates = tiles.filter(t => normalizeTile(t) === norm_t1);
    if (kotsuCandidates.length >= 3) {
        const meld = kotsuCandidates.slice(0, 3);
        const nextTiles = [...tiles];
        meld.forEach(tileToRemove => {
            const index = nextTiles.findIndex(t => t === tileToRemove);
            if(index > -1) nextTiles.splice(index, 1);
        });

        const result = findMelds(nextTiles);
        if (result !== null) {
            return [meld.sort(tileSort), ...result];
        }
    }

    // --- Path 2: 順子として切り出す試み ---
    if (isNumberTile(t1)) {
        const n = parseInt(norm_t1[0]);
        const s = norm_t1[1];
        if (n <= 7) {
            const norm_t2 = `${n + 1}${s}`;
            const norm_t3 = `${n + 2}${s}`;
            
            const nextTilesForShuntsu = [...tiles];
            
            // findIndex and splice one by one to handle red fives correctly
            const t1_real_index = nextTilesForShuntsu.findIndex(t => t === t1);
            const t1_real = nextTilesForShuntsu.splice(t1_real_index, 1)[0];

            const t2_index = nextTilesForShuntsu.findIndex(t => normalizeTile(t) === norm_t2);
            if (t2_index > -1) {
                const t2_real = nextTilesForShuntsu.splice(t2_index, 1)[0];
                const t3_index = nextTilesForShuntsu.findIndex(t => normalizeTile(t) === norm_t3);
                
                if (t3_index > -1) {
                    const t3_real = nextTilesForShuntsu.splice(t3_index, 1)[0];
                    const meld = [t1_real, t2_real, t3_real];
                    const result = findMelds(nextTilesForShuntsu);
                    if (result !== null) {
                        return [meld.sort(tileSort), ...result];
                    }
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

    const allTiles = [...hand, ...furo.flatMap(f => f.tiles)];
    const isRoutouhai = (t) => isNumberTile(t) && (normalizeTile(t)[0] === "1" || normalizeTile(t)[0] === "9");

    // 構成役満 (和了形を問わない役) を最初に判定
    if (allTiles.every(isJi)) {
        yaku.push({ name: "字一色", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    if (allTiles.every(isRoutouhai)) {
        yaku.push({ name: "清老頭", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    if (allTiles.every(t => isYaochu(t) && !isJi(t)) === false && allTiles.every(t => isYaochu(t))) {
         yaku.push({ name: "混老頭", han: 2 });
    }
    const greenTiles = ["2s", "3s", "4s", "6s", "8s", "発"];
    if (allTiles.every(t => greenTiles.includes(normalizeTile(t)))) {
        yaku.push({ name: "緑一色", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }

    if (yakumanHan > 0) {
        let doraCount = 0;
        allTiles.forEach(tileInHand => {
            if (tileInHand.startsWith('r5')) doraCount++;
            dora.forEach(doraValue => {
                if (normalizeTile(tileInHand) === getDoraTile(doraValue)) doraCount++;
            });
            if (isRiichi && uraDora) {
                uraDora.forEach(doraValue => {
                    if (normalizeTile(tileInHand) === getDoraTile(doraValue)) doraCount++;
                });
            }
        });
        if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });
        return { yakuList: yaku, totalHan: yakumanHan + doraCount, isYakuman: true };
    }


    const winForm = getWinningForm(hand, furo);
    if (!winForm) return { yakuList: [], totalHan: 0, isYakuman: false };
    
    const allMelds = (winForm.melds || []).map(m => ({ tiles: m, type: 'anko' })).concat(furo);
    
    // --- Yakuman (面子構成に依存するもの) ---
    if (winForm.form === "国士無双") {
        yaku.push({ name: "国士無双", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    const ankoMelds = allMelds.filter(m => isAnko(m, winContext));
    if (ankoMelds.length === 4 && winForm.numMelds >= 4) {
        const isTanki = winForm.janto === winTile;
        if (isTanki) {
             yaku.push({ name: "四暗刻単騎", han: 26, type: "yakuman" });
             yakumanHan += 26;
        } else {
             yaku.push({ name: "四暗刻", han: 13, type: "yakuman" });
             yakumanHan += 13;
        }
    }

    const kotsuKanMelds = allMelds.filter(m => isKotsu(m.tiles) || (m.type && m.type.includes('kan')));
    
    const dragonKotsu = kotsuKanMelds.filter(m => ["白", "発", "中"].includes(normalizeTile(m.tiles[0])));
    if (dragonKotsu.length === 3 && winForm.numMelds >= 3) {
        yaku.push({ name: "大三元", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
            
    const kanCount = furo.filter(f => f.type && f.type.includes('kan')).length;
    if (kanCount === 4) {
        yaku.push({ name: "四槓子", han: 13, type: "yakuman" });
        yakumanHan += 13;
    }
    
    const windKotsu = kotsuKanMelds.filter(m => ["東", "南", "西", "北"].includes(normalizeTile(m.tiles[0])));
    if (winForm.janto) {
        const jantoIsWind = ["東", "南", "西", "北"].includes(normalizeTile(winForm.janto));
        if (windKotsu.length === 4 && winForm.numMelds >= 4) {
             yaku.push({ name: "大四喜", han: 26, type: "yakuman" });
             yakumanHan += 26;
        } else if (windKotsu.length === 3 && jantoIsWind && winForm.numMelds >= 3) {
             yaku.push({ name: "小四喜", han: 13, type: "yakuman" });
             yakumanHan += 13;
        }
    }


    if (yakumanHan > 0) {
        yaku = yaku.filter(y => y.type === "yakuman");
        let doraCount = 0;
        allTiles.forEach(tileInHand => {
            if (tileInHand.startsWith('r5')) doraCount++;
            const doraTiles = dora.map(getDoraTile);
            doraTiles.forEach(d => {
                if (normalizeTile(tileInHand) === d) doraCount++;
            });
            if (isRiichi && uraDora) {
                const uraDoraTiles = uraDora.map(getDoraTile);
                uraDoraTiles.forEach(d => {
                    if (normalizeTile(tileInHand) === d) doraCount++;
                });
            }
        });
        if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });
        return { yakuList: yaku, totalHan: yakumanHan + doraCount, isYakuman: true };
    }
    
    // --- Standard Yaku ---
    if (isRiichi) yaku.push({ name: "立直", han: 1 });
    if (isIppatsu) yaku.push({ name: "一発", han: 1 });
    if (isMenzen && isTsumo) yaku.push({ name: "門前清自摸和", han: 1 });
    if (isRinshan) yaku.push({ name: "嶺上開花", han: 1 });
    if (isChankan) yaku.push({ name: "搶槓", han: 1 });
    if (allTiles.every(t => !isYaochu(t))) yaku.push({ name: "断么九", han: 1 });
    
    if (winForm.form === "n面子1雀頭") {
        const shuntsuInHand = (winForm.melds || []).filter(m => isShuntsu(m));
        if (isMenzen && winForm.numMelds >= 2 && shuntsuInHand.length === winForm.numMelds && !isYakuhai(winForm.janto, bakaze, jikaze) && isRyanmenWait(winForm, winTile)) {
            yaku.push({ name: "平和", han: 1 });
        }
        
        if (isMenzen) {
            const shuntsuMeldsNorm = (winForm.melds || []).filter(isShuntsu).map(m => m.map(normalizeTile).sort().join(','));
            const shuntsuCounts = shuntsuMeldsNorm.reduce((acc, m) => { acc[m] = (acc[m] || 0) + 1; return acc; }, {});
            const iipeikouSets = Object.values(shuntsuCounts).filter(c => c >= 2).length;
            if (iipeikouSets === 2 && winForm.numMelds >= 4) { // 2盃口は4面子必要
                 yaku.push({ name: "二盃口", han: 3 });
            } else if (iipeikouSets === 1 && winForm.numMelds >= 2) { // 1盃口は2面子以上必要
                 yaku.push({ name: "一盃口", han: 1 });
            }
        }
    }
    if (winForm.form === "n対子" && winForm.numPairs >= 2) {
        yaku = yaku.filter(y => y.name !== "二盃口" && y.name !== "一盃口");
        yaku.push({ name: `${winForm.numPairs}対子`, han: 2 });
    }
    
    const yakuhaiTiles = ["白", "発", "中"]; 
    kotsuKanMelds.forEach(m => {
        const tile = normalizeTile(m.tiles[0]);
        if (yakuhaiTiles.includes(tile)) yaku.push({ name: `役牌 (${tile})`, han: 1 });
        if (tile === bakaze) yaku.push({ name: `役牌 (場風)`, han: 1 });
        if (tile === jikaze) yaku.push({ name: `役牌 (自風)`, han: 1 });
    });

    const numberTilesOnly = allTiles.filter(isNumberTile);
    const suits = new Set(numberTilesOnly.map(t => normalizeTile(t)[1]));
    const hasJi = allTiles.some(isJi);
    if (suits.size === 1) {
        if (hasJi) yaku.push({ name: "混一色", han: isMenzen ? 3 : 2 });
        else if (numberTilesOnly.length === allTiles.length) yaku.push({ name: "清一色", han: isMenzen ? 6 : 5 });
    }
    
    // 混老頭は構成役満としてチェック済み
    
    if (winForm.form === "n面子1雀頭") {
        const isChanta = allMelds.every(m => m.tiles.some(isYaochu)) && winForm.janto && isYaochu(winForm.janto);
        if (isChanta) {
            const isJunchan = allTiles.every(t => isRoutouhai(t) || isJi(t) === false);
            if (isJunchan) {
                yaku.push({ name: "純全帯么九", han: isMenzen ? 3 : 2 });
            } else {
                yaku.push({ name: "混全帯么九", han: isMenzen ? 2 : 1 });
            }
        }
        
        const shuntsuMelds = allMelds.filter(m => isShuntsu(m.tiles));
        if (winForm.numMelds >= 3) { // 最低3面子必要
            const suitsInShuntsu = new Set(shuntsuMelds.map(m => normalizeTile(m.tiles[0])[1]));
            for (const s of suitsInShuntsu) {
                const suitShuntsu = shuntsuMelds.filter(m => normalizeTile(m.tiles[0])[1] === s);
                const starts = new Set(suitShuntsu.map(m => parseInt(normalizeTile(m.tiles.sort(tileSort)[0])[0])));
                if (starts.has(1) && starts.has(4) && starts.has(7)) {
                    yaku.push({ name: "一気通貫", han: isMenzen ? 2 : 1 });
                    break;
                }
            }
            
            const shuntsuGroups = shuntsuMelds.reduce((acc, m) => {
                const startNum = normalizeTile(m.tiles.sort(tileSort)[0])[0];
                if (!acc[startNum]) acc[startNum] = new Set();
                acc[startNum].add(normalizeTile(m.tiles[0])[1]);
                return acc;
            }, {});
            for (const num in shuntsuGroups) {
                if (shuntsuGroups[num].size === 3) {
                    yaku.push({ name: "三色同順", han: isMenzen ? 2 : 1 });
                    break;
                }
            }
        }
    }
    
    if (winForm.numMelds >= 3) { // 最低3面子必要
        const kotsuGroups = kotsuKanMelds.reduce((acc, m) => {
            const tile = m.tiles[0];
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
    }
    
    if (dragonKotsu.length === 2 && winForm.janto && ["白", "発", "中"].includes(normalizeTile(winForm.janto)) && winForm.numMelds >=2) {
        yaku.push({ name: "小三元", han: 2 });
    }

    if (kotsuKanMelds.length === winForm.numMelds && winForm.numMelds > 0) yaku.push({ name: "対々和", han: 2 });
    if (ankoMelds.length === 3 && winForm.numMelds >= 3) yaku.push({ name: "三暗刻", han: 2 });
    if (kanCount === 3 && winForm.numMelds >= 3) yaku.push({ name: "三槓子", han: 2 });
    
    let uniqueYaku = [];
    const yakuNames = new Set();
    yaku.forEach(y => {
        if (!yakuNames.has(y.name)) {
            uniqueYaku.push(y);
            yakuNames.add(y.name);
        } else if (y.name.startsWith("役牌")) { 
             uniqueYaku.push(y);
        }
    });
    yaku = uniqueYaku;
    
    let doraCount = 0;
    allTiles.forEach(tileInHand => {
        if (tileInHand.startsWith('r5')) doraCount++;
        const doraTiles = dora.map(getDoraTile);
        doraTiles.forEach(d => {
            if (normalizeTile(tileInHand) === d) doraCount++;
        });
        if (isRiichi && uraDora) {
             const uraDoraTiles = uraDora.map(getDoraTile);
             uraDoraTiles.forEach(d => {
                if (normalizeTile(tileInHand) === d) doraCount++;
            });
        }
    });

    if (doraCount > 0) yaku.push({ name: "ドラ", han: doraCount });

    if (!hasValidYaku(yaku)) return { yakuList: [], totalHan: 0, isYakuman: false };
    
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
    if (!winForm || winForm.form === "国士無双") return 0;
    if (winForm.form === "n対子") return 25;
    
    const hasPinfu = yakuList.some(y => y.name === "平和");
    if (hasPinfu && winContext.isTsumo) {
        return 20;
    }
    if (hasPinfu && !winContext.isTsumo) {
        return 30; 
    }

    let fu = 20;

    if (winContext.isTsumo && !hasPinfu) {
        fu += 2;
    }
    if (!winContext.isTsumo && winContext.furo.length === 0) {
         fu += 10;
    }

    const allMelds = [...(winForm.melds || []).map(m => ({tiles: m, type:'anko'})), ...winContext.furo];
    allMelds.forEach(meld => {
        const meldTiles = meld.tiles;
        const tile = meldTiles[0];
        const isYao = isYaochu(tile);
        
        if (isKotsu(meldTiles)) {
            const anko = isAnko(meld, winContext);
            fu += (anko ? 8 : 4) * (isYao ? 2 : 1);
        } else if (meld.type && meld.type.includes('kan')) {
            const isAnKan = meld.type === 'ankan';
            fu += (isAnKan ? 32 : 16) * (isYao ? 2 : 1);
        }
    });

    if (winForm.janto) {
        const jantoNorm = normalizeTile(winForm.janto);
        if (isYakuhai(jantoNorm, winContext.bakaze, winContext.jikaze)) fu += 2;
        if (jantoNorm === winContext.bakaze && jantoNorm === winContext.jikaze) fu += 2; // 連風対子
        
        const winTileNorm = normalizeTile(winContext.winTile);
        if (jantoNorm === winTileNorm) {
            fu += 2; // 単騎待ち
        } else {
            const waitMeld = (winForm.melds || []).find(m => m.some(t => normalizeTile(t) === winTileNorm));
            if (waitMeld) {
                if (isShuntsu(waitMeld)) {
                    const sorted = waitMeld.map(normalizeTile).sort(tileSort);
                    if (sorted[1] === winTileNorm) fu += 2; // 嵌張
                    else if ((parseInt(sorted[0][0]) === 1 && winTileNorm === sorted[2]) || (parseInt(sorted[2][0]) === 9 && winTileNorm === sorted[0])) {
                        fu += 2; // 辺張
                    }
                }
            }
        }
    }
    
    if (winContext.furo.length > 0 && fu === 20) {
        return 30;
    }
    
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
        const payments = isTsumo ? (isDealer ? [total / 3] : [singleYakuman * yakumanCount / 2, singleYakuman * yakumanCount / 4]) : [total];
        return { total, payments: payments.map(p => Math.ceil(p / 100) * 100), name };
    }
    if (han >= 11) return isDealer ? { total: 36000, payments: isTsumo ? [12000] : [36000], name: "三倍満", breakdown: isTsumo ? "12000オール" : "" } : { total: 24000, payments: isTsumo ? [12000, 6000] : [24000], name: "三倍満", breakdown: isTsumo ? "6000/12000" : "" };
    if (han >= 8) return isDealer ? { total: 24000, payments: isTsumo ? [8000] : [24000], name: "倍満", breakdown: isTsumo ? "8000オール" : "" } : { total: 16000, payments: isTsumo ? [8000, 4000] : [16000], name: "倍満", breakdown: isTsumo ? "4000/8000" : "" };
    if (han >= 6) return isDealer ? { total: 18000, payments: isTsumo ? [6000] : [18000], name: "跳満", breakdown: isTsumo ? "6000オール" : "" } : { total: 12000, payments: isTsumo ? [6000, 3000] : [12000], name: "跳満", breakdown: isTsumo ? "3000/6000" : "" };
    
    let basePoint = fu * Math.pow(2, 2 + han);
    
    if (basePoint > 2000 || han === 5) {
        basePoint = 2000; // 満貫
        const name = "満貫";
        if (isDealer) {
            const total = 12000;
            return { total, payments: isTsumo ? [total/3] : [total], name, breakdown: isTsumo ? "4000オール" : "" };
        } else {
            const total = 8000;
            return { total, payments: isTsumo ? [total/2, total/4] : [total], name, breakdown: isTsumo ? "2000/4000" : "" };
        }
    }
    
    const ceilTo100 = (p) => Math.ceil(p / 100) * 100;

    if (isDealer) { // 親
        if (isTsumo) {
            const payment = ceilTo100(basePoint * 2);
            return { total: payment * 3, payments: [payment, payment], breakdown: `${payment}オール` };
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
    
    if (meld.type === 'ankan') return true;
    if (meld.type === 'kakan' && winContext.isChankan) return false;
    if (meld.type === 'pon' || meld.type === 'daiminkan' || meld.type === 'chi') return false;

    const meldTiles = meld.tiles;
    if (!meldTiles) return false;

    if (!isKotsu(meldTiles)) return false;
    if (isTsumo) return true;
    
    const normWinTile = normalizeTile(winTile);
    const normMeldTiles = meldTiles.map(normalizeTile);
    return !normMeldTiles.includes(normWinTile);
}

function hasValidYaku(yakuList) {
    return yakuList.some(y => y.name !== "ドラ");
}
function isKotsu(m){ if(!m || m.length<3) return false; const normTiles = m.map(normalizeTile); return normTiles[0]===normTiles[1]&&normTiles[1]===normTiles[2]}
function isShuntsu(m){if(!m || m.length!==3) return false; const norm = m.map(normalizeTile).sort(tileSort); if(!isNumberTile(norm[0])) return false; const e=parseInt(norm[0][0]),n=parseInt(norm[1][0]),s=parseInt(norm[2][0]),i=norm[0][1];return n===e+1&&s===e+2&&norm[1][1]===i&&norm[2][1]===i}
function isKan(m){return m && m.length===4&&normalizeTile(m[0])===normalizeTile(m[1])&&normalizeTile(m[1])===normalizeTile(m[2])&&normalizeTile(m[2])===normalizeTile(m[3])}
function isYakuhai(t,e,n){if(!t) return false; const norm_t = normalizeTile(t); const yakuhaiFanpai = ["白","発","中"]; return yakuhaiFanpai.includes(norm_t) || norm_t === e || norm_t === n; }
function isRyanmenWait(winForm,winTile){if(!winForm||winForm.form!=="n面子1雀頭"||!winForm.janto||winForm.janto===winTile)return!1;const targetMeld=(winForm.melds || []).find(m=>isShuntsu(m)&&m.some(t => normalizeTile(t) === normalizeTile(winTile)));if(!targetMeld)return!1;const sortedNormMeld=[...targetMeld].map(normalizeTile).sort(tileSort);const normWinTile = normalizeTile(winTile);const firstNum = parseInt(sortedNormMeld[0][0]); return (normWinTile===sortedNormMeld[0]&&firstNum<7)||(normWinTile===sortedNormMeld[2]&&firstNum>1)}

function getDoraTile(indicator){if(!indicator)return null; const normIndicator = normalizeTile(indicator); if(!isNumberTile(normIndicator)){const order=["東","南","西","北","東"];const jiOrder=["白","発","中","白"];if(order.includes(normIndicator))return order[order.indexOf(normIndicator)+1];if(jiOrder.includes(normIndicator))return jiOrder[jiOrder.indexOf(normIndicator)+1];return null}const num=parseInt(normIndicator[0]);const suit=normIndicator[1];return(num===9?1:num+1)+suit}

function getWaits(hand, furo = []) {
    if (hand.length === 0 && furo.length === 0) return [];
    
    // 全てのユニークな牌のリストを作成 (赤ドラはノーマルとして扱う)
    const allPossibleTilesNorm = ["1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p","5p","6p","7p","8p","9p","1s","2s","3s","4s","5s","6s","7s","8s","9s","東","南","西","北","白","発","中"];
    const waits = new Set();
    
    for (const tile of allPossibleTilesNorm) {
        const tempHand = [...hand, tile];
        if (getWinningForm(tempHand, furo)) {
            waits.add(tile);
        }
    }
    return Array.from(waits).sort(tileSort);
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeTile, getWinningForm, findMelds, checkYaku, calculateFu, calculateScore, getWaits, hasValidYaku, isNumberTile, isYaochu, isJi, isKotsu, isShuntsu, isKan, isYakuhai, isRyanmenWait, isAnko, getDoraTile };
}