// abilities/BlockTrait.ts
//（第 6 點）給方塊特殊功能。掛在方塊 prefab 上：
//   damageMultiplier < 1  → 高防禦（受到的傷害打折，例如 0.5 = 只受一半傷）
//   regenPerSecond  > 0   → 回血方塊：每秒幫「自己與相鄰方塊」回血
//
// 相鄰判定：第一次戰鬥 update 時（車子已建好）以「同車身 root 下、局部座標距離 ≈ 1 格」
//          找出自己＋上下左右鄰居，快取其 Health。每格中心相隔 GRID.CELL_SIZE(40px)，
//          對角線 ~56.6px，用 1.25 格(~50px) 當門檻：抓得到正向鄰居、排除對角。
// 改用「第一次 update 才掃」而非 start()，確保所有零件都已生成、避免生命週期時序問題。

import HealGlow from "../fx/HealGlow";
import Health from "../HealthManager";
import { GRID, HEALFX } from "../core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BlockTrait extends cc.Component {
    @property({ tooltip: "受到傷害的倍率，<1 代表高防禦（0.5 = 只受一半傷）" })
    damageMultiplier: number = 0.5;

    @property({ tooltip: "每秒幫自己與相鄰方塊回血的量，0 = 不回血" })
    regenPerSecond: number = 0;

    private healTargets: any[] = [];   // 自己＋相鄰方塊的 Health（第一次戰鬥 update 找一次）
    private scanned = false;
    private fxTimer = 0;               // 綠光節流計時

    private scanNeighbors() {
        this.scanned = true;
        this.healTargets = [];

        const root = this.node.parent;
        if (!root) {
            console.error(`[BlockTrait] ${this.node.name} 找不到 parent，無法掃描鄰居`);
            return;
        }

        const myLocal = this.node.getPosition();
        const threshold = GRID.CELL_SIZE * 1.25;  // ~50px：抓得到正向鄰居（40px）、排除對角（~56px）

        const candidates: Health[] = [];
        root.getComponentsInChildren(Health).forEach(hp => {
            if (!hp || !hp.node || !hp.node.isValid) return;
            candidates.push(hp);
        });

        for (const hp of candidates) {
            if (!hp || !hp.node || !hp.node.isValid) continue;

            const otherLocal = hp.node.getPosition();
            const dx = otherLocal.x - myLocal.x;
            const dy = otherLocal.y - myLocal.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= threshold) {
                this.healTargets.push(hp);
            }
        }

        cc.log(`[BlockTrait] ${this.node.name} regen=${this.regenPerSecond} → 回血對象 ${this.healTargets.length} 個`);
    }

    update(dt: number) {
        if (this.regenPerSecond <= 0) return;
        if (!Health.activeInBattle) return;          // 只在戰鬥中回血（商店不跑）
        if (!this.scanned) this.scanNeighbors();      // 第一次 update 時掃一次（車已建好）
        if (this.healTargets.length === 0) return;

        this.fxTimer -= dt;
        const emit = this.fxTimer <= 0;   // 這一幀是否冒綠光（節流）
        const root = this.node.parent;

        let hasHealedAny = false;

        for (const hp of this.healTargets) {
            if (!hp || !hp.node || !hp.node.isValid) continue;

            // 只有當前血量 > 0 (沒死) 且 小於最大血量時才回血
            if (hp.currentHP > 0 && hp.currentHP < hp.maxHP) {
                const oldHP = hp.currentHP;
                hp.currentHP = Math.min(hp.maxHP, hp.currentHP + this.regenPerSecond * dt);
                hasHealedAny = true;

                // 偶爾印出回血數值確認
                if (emit) {
                    console.log(`[BlockTrait] ${this.node.name} 正在幫 ${hp.node.name} 回血: ${oldHP.toFixed(1)} -> ${hp.currentHP.toFixed(1)}`);
                }

                // 在正在回血的對象身上冒綠光（掛 root，零件銷毀後特效仍在）。
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
