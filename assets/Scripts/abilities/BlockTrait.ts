// abilities/BlockTrait.ts
//（第 6 點）給方塊特殊功能。掛在方塊 prefab 上：
//   damageMultiplier < 1  → 高防禦（受到的傷害打折，例如 0.5 = 只受一半傷）
//   regenPerSecond  > 0   → 回血方塊：每秒幫「相鄰的方塊」回血（不回自己）
//
// Health 在計算傷害時會讀 damageMultiplier；回血在這裡自己跑。
// 相鄰判定：開戰時（start）以「同車身 root 下、局部座標距離 ≈ 1 格」找出上下左右的鄰居，
//          快取其 Health。每格中心相隔 GRID.CELL_SIZE(40px)，對角線 ~56.6px，
//          用 1.25 格(~50px)當門檻：抓得到正向鄰居、排除對角。

import HealGlow from "../fx/HealGlow";
import { GRID, HEALFX } from "../core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BlockTrait extends cc.Component {
    @property({ tooltip: "受到傷害的倍率，<1 代表高防禦（0.5 = 只受一半傷）" })
    damageMultiplier: number = 0.5;

    @property({ tooltip: "每秒幫相鄰方塊回血的量，0 = 不回血" })
    regenPerSecond: number = 0;

    private healTargets: any[] = [];   // 相鄰方塊的 Health（開戰時找一次）
    private fxTimer = 0;               // 綠光節流計時

    start() {
        if (this.regenPerSecond <= 0) return;
        const root = this.node.parent;
        if (!root) return;

        // 同 root 下的兄弟節點即同車零件；局部座標可直接比距離（玩家／鏡像 bot 都適用）。
        const maxDist = GRID.CELL_SIZE * 1.25;
        for (const sib of root.children) {
            if (sib === this.node || !sib.isValid) continue;
            const hp = sib.getComponent("Health") as any;
            if (!hp) continue;
            const dx = sib.x - this.node.x;
            const dy = sib.y - this.node.y;
            if (Math.sqrt(dx * dx + dy * dy) <= maxDist) this.healTargets.push(hp);
        }
    }

    update(dt: number) {
        if (this.regenPerSecond <= 0 || this.healTargets.length === 0) return;

        this.fxTimer -= dt;
        const emit = this.fxTimer <= 0;   // 這一幀是否冒綠光（節流）
        const root = this.node.parent;

        for (const hp of this.healTargets) {
            if (!hp || !hp.node || !hp.node.isValid) continue;        // 鄰居已被打掉就略過
            if (hp.currentHP > 0 && hp.currentHP < hp.maxHP) {        // 死掉(<=0)的不復活
                hp.currentHP = Math.min(hp.maxHP, hp.currentHP + this.regenPerSecond * dt);

                // 在正在回血的鄰居身上冒綠光（掛 root，零件銷毀後特效仍在）。
                if (emit && root && root.isValid) {
                    const wp = hp.node.convertToWorldSpaceAR(cc.v2(0, 0));
                    const size = Math.max(hp.node.width, hp.node.height) || 40;
                    HealGlow.spawn(root, wp, size);
                }
            }
        }

        if (emit) this.fxTimer = HEALFX.EMIT_INTERVAL;
    }
}
