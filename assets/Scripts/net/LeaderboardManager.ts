// net/LeaderboardManager.ts
import FirebaseService, { LeaderRow } from "./FirebaseService";

const { ccclass, property } = cc._decorator;

@ccclass
export default class LeaderboardManager extends cc.Component {
    @property({ type: cc.Node, tooltip: "列的容器（建議掛 Layout 自動排版）" })
    content: cc.Node = null;
    
    @property({ type: cc.Prefab, tooltip: "每一列的 prefab（底下需有 rank/name/wins/score/avatar）" })
    rowPrefab: cc.Prefab = null;
    
    @property({ type: cc.Label, tooltip: "沒有 rowPrefab 時，用這個多行 Label 顯示整份排行榜" })
    fallbackLabel: cc.Label = null;
    
    @property({ tooltip: "顯示前幾名" })
    topN: number = 20;
    
    @property({ type: [cc.SpriteFrame], tooltip: "頭像素材 (須與 ProfileManager 順序一致)" })
    avatarFrames: cc.SpriteFrame[] = [];

    onEnable() {
        console.log("====== 🏆 排行榜面板被打開了！ ======");
        FirebaseService.init();
        this.refresh();
    }

    refresh() {
        if (this.fallbackLabel) this.fallbackLabel.string = "載入中… ⏳";
        
        FirebaseService.getLeaderboard(this.topN)
            .then((rows) => {
                this.render(rows);
            })
            .catch((e) => {
                console.error("❌ 抓取排行榜失敗:", e);
                if (this.fallbackLabel) this.fallbackLabel.string = "排行榜載入失敗 📡";
            });
    }

    onCloseButtonClick() {
        this.node.active = false;
    }

    private render(rows: LeaderRow[]) {
        if (this.rowPrefab && this.content) {
            this.content.removeAllChildren();
            
            rows.forEach((r, i) => {
                const node = cc.instantiate(this.rowPrefab);
                node.parent = this.content;
                
                // 設定基本文字
                this.setChildLabel(node, "rank", `${i + 1}`);
                this.setChildLabel(node, "name", r.name || "未命名");
                
                // 【戰績更新】將 wins 節點作為「當前連勝」顯示
                this.setChildLabel(node, "wins", `${r.winRate || 0}%`);
                
                // 【戰績更新】將 score 節點作為「勝率與最高連勝」顯示
                this.setChildLabel(node, "score", `${r.currentStreak || 0} (${r.maxStreak || 0})`);
                
                // 設定頭像
                const avatarNode = node.getChildByName("avatar");
                if (avatarNode && this.avatarFrames.length > 0) {
                    const sprite = avatarNode.getComponent(cc.Sprite);
                    const safeId = (r.avatarId >= 0 && r.avatarId < this.avatarFrames.length) ? r.avatarId : 0;
                    if (sprite) sprite.spriteFrame = this.avatarFrames[safeId];
                }
            });
            return;
        }

        // 純文字備用方案更新
        if (this.fallbackLabel) {
            if (!rows.length) { 
                this.fallbackLabel.string = "目前還沒有紀錄"; 
                return; 
            }
            let s = "🏆 勝率排行榜 🏆\n\n";
            rows.forEach((r, i) => {
                s += `${i + 1}. ${r.name} ｜ 勝率 ${r.winRate}% ｜ 最高連勝 ${r.maxStreak}\n`;
            });
            this.fallbackLabel.string = s;
        }
    }

    private setChildLabel(node: cc.Node, childName: string, text: string) {
        const c = node.getChildByName(childName);
        if (c) { 
            const lb = c.getComponent(cc.Label); 
            if (lb) lb.string = text; 
        } else {
            cc.warn(`[Leaderboard] 找不到名為 ${childName} 的節點，請檢查 Prefab！`);
        }
    }
}