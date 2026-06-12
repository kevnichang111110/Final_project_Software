// WordBuilder.ts
const { ccclass, property } = cc._decorator;

const LETTERS = {
    'C': [" ### ", "#   #", "#    ", "#   #", " ### "],
    'A': ["  #  ", " # # ", "#####", "#   #", "#   #"],
    'R': ["#### ", "#   #", "#### ", "#  # ", "#   #"],
    'S': [" ####", "#    ", " ### ", "    #", "#### "],
    'H': ["#   #", "#   #", "#####", "#   #", "#   #"],
    ' ': ["     ", "     ", "     ", "     ", "     "]
};

@ccclass
export default class WordBuilder extends cc.Component {
    @property(cc.Prefab)
    blockPrefab: cc.Prefab = null;

    @property(cc.Float)
    cellSize: number = 20; // 目標：20x20

    @property(cc.Float)
    letterSpacing: number = 15; // 字母間距

    @property(cc.Float)
    lineSpacing: number = 40; // 行間距

    @property(cc.Float)
    blockScale: number = 0.5; // 如果原始 Body 是 40x40，縮小成 0.5 配合 20 的間距

    start() {
        // 第一行 CAR，Y 座標設在上方
        this.buildLine("CAR", this.lineSpacing / 2);
        // 第二行 CRASH，Y 座標設在下方
        this.buildLine("CRASH", -this.lineSpacing / 2 - (5 * this.cellSize));
    }

    /**
     * 繪製單行並自動水平置中
     * @param text 文字內容
     * @param yOffset 該行的起始 Y 座標
     */
    buildLine(text: string, yOffset: number) {
        // 1. 先計算這行字總共多寬
        let totalWidth = 0;
        for (let char of text.toUpperCase()) {
            totalWidth += 5 * this.cellSize + this.letterSpacing;
        }
        totalWidth -= this.letterSpacing; // 扣掉最後一個字母多算的間距

        // 2. 計算起始 X 座標，使其置中 (負的一半)
        let startX = -totalWidth / 2;
        let cursorX = startX;

        // 3. 開始繪製每個字母
        for (let char of text.toUpperCase()) {
            const matrix = (LETTERS as any)[char];
            if (matrix) {
                this.drawMatrix(matrix, cursorX, yOffset);
                cursorX += 5 * this.cellSize + this.letterSpacing;
            } else {
                cursorX += 3 * this.cellSize;
            }
        }
    }

    private drawMatrix(matrix: string[], startX: number, startY: number) {
        for (let row = 0; row < matrix.length; row++) {
            for (let col = 0; col < matrix[row].length; col++) {
                if (matrix[row][col] === "#") {
                    const block = cc.instantiate(this.blockPrefab);
                    block.parent = this.node;
                    
                    // 設定縮放
                    block.scale = this.blockScale;

                    // 計算位置
                    const px = startX + col * this.cellSize;
                    const py = startY - row * this.cellSize;
                    
                    block.setPosition(px, py);
                }
            }
        }
    }
}