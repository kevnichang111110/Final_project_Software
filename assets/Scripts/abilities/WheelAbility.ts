// abilities/WheelAbility.ts
//（第 4 點）讓輪子有特殊功能。把這個組件掛到輪子 prefab 上，選一種能力：
//   Normal  一般輪子
//   Jet     噴射：玩家按 boost 鍵（預設 W / ↑）時持續向上噴
//   Bounce  彈跳：把碰撞器的反彈係數調高，落地會彈起來
//
// 要再加新能力（例如「衝刺」「磁吸」）就在 enum 加一項，再到對應的觸發點處理即可。

import { ABILITY } from "../core/GameConstants";

export enum WheelAbilityType {
    Normal = 0,
    Jet = 1,
    Bounce = 2,
}
cc.Enum(WheelAbilityType);

const { ccclass, property } = cc._decorator;

@ccclass
export default class WheelAbility extends cc.Component {
    @property({ type: cc.Enum(WheelAbilityType) })
    type: WheelAbilityType = WheelAbilityType.Normal;

    @property({ tooltip: "噴射推力（Jet 用）" })
    jetForce: number = ABILITY.JET_FORCE;

    @property({ tooltip: "反彈係數（Bounce 用），1 以上才會明顯彈" })
    bounceRestitution: number = ABILITY.BOUNCE_RESTITUTION;

    onLoad() {
        if (this.type === WheelAbilityType.Bounce) {
            // 把所有實體碰撞器設成高反彈
            const colliders = this.getComponents(cc.PhysicsCollider) as cc.PhysicsCollider[];
            colliders.forEach(c => { c.restitution = this.bounceRestitution; });
        }
    }

    // 由 BattleManager 在玩家按住 boost 時每幀呼叫
    applyJet(): boolean {
        if (this.type !== WheelAbilityType.Jet) return false;
        const rb = this.getComponent(cc.RigidBody);
        if (!rb) return false;
        rb.applyForceToCenter(cc.v2(0, this.jetForce), true);

        const audio = this.getComponent("PartAudio") as any;
        if (audio && audio.playAbility) audio.playAbility();
        return true;
    }
}
