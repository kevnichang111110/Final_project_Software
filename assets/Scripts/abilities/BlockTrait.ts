// abilities/BlockTrait.ts
//（第 6 點）給方塊特殊功能。掛在方塊 prefab 上：
//   damageMultiplier < 1  → 高防禦（受到的傷害打折，例如 0.5 = 只受一半傷）
//   regenPerSecond  > 0   → 每秒自動回血（自我修復方塊）
//
// Health 在計算傷害時會讀 damageMultiplier；回血在這裡自己跑。

const { ccclass, property } = cc._decorator;

@ccclass
export default class BlockTrait extends cc.Component {
    @property({ tooltip: "受到傷害的倍率，<1 代表高防禦（0.5 = 只受一半傷）" })
    damageMultiplier: number = 0.5;

    @property({ tooltip: "每秒自動回血量，0 = 不回血" })
    regenPerSecond: number = 0;

    update(dt: number) {
        if (this.regenPerSecond <= 0) return;

        const hp = this.getComponent("Health") as any;
        if (hp && hp.currentHP > 0 && hp.currentHP < hp.maxHP) {
            hp.currentHP = Math.min(hp.maxHP, hp.currentHP + this.regenPerSecond * dt);
        }
    }
}
