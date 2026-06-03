// Bullet.ts
// 變更：移除原本「import Health」這條未使用的匯入 —— 它與 HealthManager 互相 import
//       形成循環依賴。子彈對人的傷害本來就由 HealthManager 處理，Bullet 不需要 Health。
//       分組字串改用 GameConstants 的 GROUP。

import { GROUP } from "./core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class Bullet extends cc.Component {
    @property
    damage: number = 20;

    @property
    lifeTime: number = 3;

    public ownerSide: "PLAYER" | "BOT" = "PLAYER";

    private hasExploded: boolean = false;

    onLoad() {
        const rb = this.getComponent(cc.RigidBody);
        if (rb) {
            rb.enabledContactListener = true;
        }
        this.scheduleOnce(() => {
            this.explode();
        }, this.lifeTime);
    }

    onBeginContact(contact: cc.PhysicsContact, self: cc.PhysicsCollider, other: cc.PhysicsCollider) {
        if (this.hasExploded) return;

        // 撞到地板(default)或邊界(boundary)時自己爆。
        // 撞到人的扣血邏輯交給 HealthManager 處理。
        if (other.node.group === GROUP.DEFAULT || other.node.group === GROUP.BOUNDARY) {
            this.explode();
        }
    }

    explode() {
        if (this.hasExploded) return;
        this.hasExploded = true;

        this.unscheduleAllCallbacks();
        if (this.node && this.node.isValid) {
            this.node.destroy();
        }
    }
}
