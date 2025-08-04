// constants.js

/**
 * すべての牌（136枚）の配列を作成する
 * @param {number} sets - 各牌のセット数 (通常は4)
 * @returns {string[]} 全ての牌の配列
 */
function createAllTiles(sets = 4) {
    const tiles = [];
    const suits = ["m", "p", "s"];
    const honors = ["東", "南", "西", "北", "白", "発", "中"];

    // 4枚ずつ各種牌を生成
    for (let i = 0; i < sets; i++) {
        for (const suit of suits) {
            for (let n = 1; n <= 9; n++) {
                tiles.push(`${n}${suit}`);
            }
        }
        for (const honor of honors) {
            tiles.push(honor);
        }
    }

    // 各色の5を1枚ずつ赤ドラに置き換える
    for (const suit of suits) {
        const normalFive = `5${suit}`;
        const redFive = `r5${suit}`;
        const index = tiles.indexOf(normalFive);
        if (index !== -1) {
            tiles[index] = redFive;
        }
    }
    
    return tiles;
}

/**
 * 配列をランダムにシャッフルする（Fisher-Yatesアルゴリズム）
 * @param {any[]} array - シャッフルする配列
 */
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * 牌の文字列から画像ファイルのパスを生成する
 * @param {string} tile - 牌の文字列 (e.g., "1m", "東", "r5m", "back")
 * @returns {string} 画像へのパス
 */
function tileToImageSrc(tile) {
    if (!tile || tile === 'back') return "hai/back.gif";
    
    const suitsMap = { m: "ms", p: "ps", s: "ss" };

    // 赤ドラの処理
    if (tile.startsWith('r5')) {
        const suit = tile[2]; // 'm', 'p', or 's'
        return `hai/p_${suitsMap[suit]}5_1_red.gif`;
    }

    // 通常の数牌の処理
    if (/^\d[mps]$/.test(tile)) {
        return `hai/p_${suitsMap[tile[1]]}${tile[0]}_1.gif`;
    }
    
    // 字牌の処理
    const jiMap = { "東": "ji_e", "南": "ji_s", "西": "ji_w", "北": "ji_n", "白": "ji_no", "発": "ji_f", "中": "ji_c" };
    if (jiMap[tile]) {
        return `hai/p_${jiMap[tile]}_1.gif`;
    }
    
    return "hai/back.gif"; // Fallback for any invalid tile string
}

/**
 * 麻雀牌をソートするための比較関数
 */
function tileSort(a,b){
    // 赤ドラを通常の5と同じ位置にソートするための正規化
    const normalize = (tile) => {
        if (tile && tile.startsWith('r5')) {
            return `5${tile[2]}`;
        }
        return tile;
    };
    const order="1m,2m,3m,4m,5m,6m,7m,8m,9m,1p,2p,3p,4p,5p,6p,7p,8p,9p,1s,2s,3s,4s,5s,6s,7s,8s,9s,東,南,西,北,白,発,中".split(",");
    return order.indexOf(normalize(a)) - order.indexOf(normalize(b));
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createAllTiles, shuffle, tileToImageSrc, tileSort };
}