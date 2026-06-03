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

    onLoad() {
        FirebaseService.init();
        this.refresh();
    }

    refresh() {
        if (this.fallbackLabel) this.fallbackLabel.string = "載入中…";
        FirebaseService.getLeaderboard(this.topN)
            .then((rows) => this.render(rows))
            .catch((e) => {
                cc.error("[Leaderboard]", e);
                if (this.fallbackLabel) this.fallbackLabel.string = "排行榜載入失敗";
            });
    }

    private render(rows: LeaderRow[]) {
        if (this.rowPrefab && this.content) {
            this.content.removeAllChildren();
            rows.forEach((r, i) => {
                const node = cc.instantiate(this.rowPrefab);
                node.parent = this.content;
                this.setChildLabel(node, "rank", `${i + 1}`);
                this.setChildLabel(node, "name", r.name);
                this.setChildLabel(node, "wins", `${r.wins}`);
                this.setChildLabel(node, "score", `${r.bestScore}`);
            });
            return;
        }
        if (this.fallbackLabel) {
            if (!rows.length) { this.fallbackLabel.string = "目前還沒有紀錄"; return; }
            let s = "排行榜（勝場）\n";
            rows.forEach((r, i) => {
                s += `${i + 1}. ${r.name}　勝 ${r.wins}　分 ${r.bestScore}\n`;
            });
            this.fallbackLabel.string = s;
        }
    }

    private setChildLabel(node: cc.Node, childName: string, text: string) {
        const c = node.getChildByName(childName);
        if (c) { const lb = c.getComponent(cc.Label); if (lb) lb.string = text; }
    }
}