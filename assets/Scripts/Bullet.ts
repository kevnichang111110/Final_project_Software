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

    // true 時為「無差別子彈」：不分敵我，打到任何方塊都會造成傷害（滑鼠砲用）
    public damagesAll: boolean = false;

    // 回收用：由 WeaponSystem 在發射時注入。設了就「收回池子」取代 destroy()。
    public recycler: ((node: cc.Node) => void) | null = null;

    public hasExploded: boolean = false;

    onLoad() {
        const rb = this.getComponent(cc.RigidBody);
        if (rb) {
            rb.enabledContactListener = true;
        }
        // 注意：存活倒數改在 arm() 設定（每次發射都要重新計時）。
        // onLoad 對「池子重用」的節點只會觸發一次，不能放在這裡。
    }

    // 每次發射時呼叫：重置「已爆」旗標並重新開始存活倒數。
    arm() {
        this.hasExploded = false;
        this.unscheduleAllCallbacks();
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
            // 有注入回收器就收回池子重用；否則退回原本的 destroy()。
            if (this.recycler) {
                this.recycler(this.node);
            } else {
                this.node.destroy();
            }
        }
    }
}
