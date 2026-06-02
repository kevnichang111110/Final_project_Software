const { ccclass, property } = cc._decorator;
import Health from "./HealthManager";

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

        // 只有在撞到 default（地板）或邊界時，由子彈自己觸發 explode
        // 撞到人（Health）的邏輯交給 HealthManager 處理，這樣比較不會有抓不到組件的問題
        if (other.node.group === "default" || other.node.group === "boundary") {
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
