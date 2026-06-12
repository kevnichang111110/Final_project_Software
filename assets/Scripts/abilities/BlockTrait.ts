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

    private healTargets: any[] = [];   
    private scanned = false;
    private fxTimer = 0;               

    private scanNeighbors() {
        this.scanned = true;
        this.healTargets = [];

        const root = this.node.parent;
        if (!root) {
            console.error(`[BlockTrait] ${this.node.name} 找不到 parent，無法掃描鄰居`);
            return;
        }

        console.log(`[BlockTrait] ${this.node.name} 開始掃描鄰居... 父節點是: ${root.name}`);

        // 自己也回
        const selfHp = this.getComponent("Health") as any;
        if (selfHp) {
            this.healTargets.push(selfHp);
            console.log(`[BlockTrait] ${this.node.name} 已將自己加入回血清單`);
        } else {
            console.warn(`[BlockTrait] ${this.node.name} 本身沒有 Health 組件！`);
        }

        const maxDist = GRID.CELL_SIZE * 1.25;
        console.log(`[BlockTrait] 設定的格點距離門檻為: ${maxDist} (CELL_SIZE=${GRID.CELL_SIZE})`);

        for (const sib of root.children) {
            if (sib === this.node || !sib.isValid) continue;

            const hp = sib.getComponent("Health") as any;
            if (!hp) {
                // console.log(`[BlockTrait] 忽略 ${sib.name}: 沒有 Health 組件`);
                continue;
            }

            // 計算距離
            const dx = sib.x - this.node.x;
            const dy = sib.y - this.node.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= maxDist) {
                this.healTargets.push(hp);
                console.log(`[BlockTrait] ✅ 找到鄰居: ${sib.name}, 距離: ${dist.toFixed(2)}`);
            } else {
                // 如果你覺得應該是鄰居但沒掃到，看這裡的 log
                console.log(`[BlockTrait] ❌ 距離太遠: ${sib.name}, 距離: ${dist.toFixed(2)}`);
            }
        }

        console.log(`[BlockTrait] 掃描結束。${this.node.name} 的回血總目標數: ${this.healTargets.length}`);
    }

    update(dt: number) {
        // 1. 檢查是否有設定回血數值
        if (this.regenPerSecond <= 0) return;

        // 2. 檢查戰鬥狀態 (這最常出錯)
        if (!Health.activeInBattle) {
            // 如果你一直沒看到上面的 log，很可能是因為 Health.activeInBattle 沒被設為 true
            console.log("[BlockTrait] 戰鬥尚未激活 (Health.activeInBattle 為 false)");
            return;
        }

        // 3. 第一次進入執行掃描
        if (!this.scanned) {
            this.scanNeighbors();
        }

        if (this.healTargets.length === 0) return;

        this.fxTimer -= dt;
        const emit = this.fxTimer <= 0;
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

                if (emit && root && root.isValid) {
                    const wp = hp.node.convertToWorldSpaceAR(cc.v2(0, 0));
                    const size = Math.max(hp.node.width, hp.node.height) || 40;
                    HealGlow.spawn(root, wp, size);
                }
            }
        }

        if (emit) {
            if (!hasHealedAny) {
                // console.log(`[BlockTrait] ${this.node.name} 掃描了目標但沒有人需要回血 (可能大家都滿血)`);
            }
            this.fxTimer = HEALFX.EMIT_INTERVAL;
        }
    }
}
