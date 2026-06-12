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

        // 【核心修正】因為檔名為 HealthManager.ts，Cocos 底層組件註冊名實為 "HealthManager"
        // 這裡採用雙重相容性檢查，確保絕對能正確抓到血量組件
        let hp = this.getComponent("HealthManager") as any;
        if (!hp) {
            hp = this.getComponent("Health") as any;
        }

        if (hp && hp.currentHP > 0 && hp.currentHP < hp.maxHP) {
            // 【修改】透過呼叫 heal 函式來回血，觸發血條顯示，不再直接硬改 currentHP 數值
            if (hp.heal) {
                hp.heal(this.regenPerSecond * dt);
            } else {
                hp.currentHP = Math.min(hp.maxHP, hp.currentHP + this.regenPerSecond * dt);
            }
        }
    }
}