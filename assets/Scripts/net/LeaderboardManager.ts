// net/LeaderboardManager.ts
// 掛在排行榜場景（或選單上的排行榜面板）的一個節點上，onLoad 自動抓取並顯示。
// 兩種顯示方式擇一：
//   A) 指定 rowPrefab + content：每名玩家生成一列（prefab 底下放名為 rank / name / wins / score 的 Label）。
//   B) 只指定 fallbackLabel：用單一多行 Label 印出整個排行榜（最省事）。

import FirebaseService, { LeaderRow } from "./FirebaseService";

const { ccclass, property } = cc._decorator;

@ccclass
export default class LeaderboardManager extends cc.Component {
    @property({ type: cc.Node, tooltip: "列的容器（建議掛 Layout 自動排版）" })
    content: cc.Node = null;
    @property({ type: cc.Prefab, tooltip: "每一列的 prefab（底下可有 rank/name/wins/score 等 Label）" })
    rowPrefab: cc.Prefab = null;
    @property({ type: cc.Label, tooltip: "沒有 rowPrefab 時，用這個多行 Label 顯示整份排行榜" })
    fallbackLabel: cc.Label = null;
    @property({ tooltip: "顯示前幾名" })
    topN: number = 20;
    @property({ type: [cc.SpriteFrame], tooltip: "8個頭像素材" })
    avatarFrames: cc.SpriteFrame[] = [];
    onEnable() {
        console.log("====== 排行榜面板被打開了！ ======");
        FirebaseService.init();
        this.refresh();
    }

    refresh() {
        console.log("【追蹤 1】refresh() 開始執行");
        console.log("【追蹤 2】Firebase 就緒狀態:", FirebaseService.isReady());
        
        if (this.fallbackLabel) this.fallbackLabel.string = "載入中…";
        
        FirebaseService.getLeaderboard(this.topN)
            .then((rows) => {
                console.log("【追蹤 3】成功取得資料！資料筆數:", rows.length);
                console.log("【追蹤 4】檢查編輯器綁定 -> Content 節點有嗎:", !!this.content, " / Prefab有嗎:", !!this.rowPrefab);
                this.render(rows);
            })
            .catch((e) => {
                console.error("【追蹤 3 錯誤】抓取排行榜失敗:", e);
                if (this.fallbackLabel) this.fallbackLabel.string = "排行榜載入失敗";
            });
    }
    onCloseButtonClick() {
        this.node.active = false;
    }

    private render(rows: LeaderRow[]) {
        console.log("抓到的排行榜資料：", rows);
        if (this.rowPrefab && this.content) {
            this.content.removeAllChildren();
            rows.forEach((r, i) => {
                const node = cc.instantiate(this.rowPrefab);
                node.parent = this.content;
                this.setChildLabel(node, "rank", `${i + 1}`);
                this.setChildLabel(node, "name", r.name);
                
                // 【修改 1】原本塞 wins 的地方，改成顯示「當前連勝」
                this.setChildLabel(node, "wins", `${r.winRate}%`);
                
                // 【修改 2】原本塞 bestScore 的地方，改成顯示「勝率與最高連勝」
                this.setChildLabel(node, "score", `${r.currentStreak}`);
                
                // 頭像處理邏輯維持不變
                const avatarNode = node.getChildByName("avatar");
                if (avatarNode && this.avatarFrames.length > 0) {
                    const sprite = avatarNode.getComponent(cc.Sprite);
                    // 確保 ID 不會超出陣列範圍 (防呆)
                    const safeId = (r.avatarId >= 0 && r.avatarId < this.avatarFrames.length) ? r.avatarId : 0;
                    if (sprite) sprite.spriteFrame = this.avatarFrames[safeId];
                }
            });
            return;
        }

        // 【修改 3】如果有使用 fallbackLabel (純文字版排行榜)，也要一併更新排版格式
        if (this.fallbackLabel) {
            if (!rows.length) { this.fallbackLabel.string = "目前還沒有紀錄"; return; }
            let s = "🏆 勝率排行榜 🏆\n";
            rows.forEach((r, i) => {
                s += `${i + 1}. ${r.name} 勝率 ${r.winRate}% 最高連勝 ${r.maxStreak}\n`;
            });
            this.fallbackLabel.string = s;
        }
    }

    private setChildLabel(node: cc.Node, childName: string, text: string) {
        const c = node.getChildByName(childName);
        if (c) { const lb = c.getComponent(cc.Label); if (lb) lb.string = text; }
    }
}