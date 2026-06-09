// map/SpringPad.ts
// 彈簧墊物件：當動態剛體（車子）踩到時，給予向上的巨大衝量彈飛。

import HitFeedback from "../fx/HitFeedback";

const { ccclass, property } = cc._decorator;

@ccclass
export default class SpringPad extends cc.Component {
    
    @property({ tooltip: "向上彈飛的衝量大小（需夠大才能推動整台車）" })
    bounceImpulse: number = 200; 

    @property({ type: cc.AudioClip, tooltip: "彈跳音效" })
    bounceSfx: cc.AudioClip | null = null;

    private isBouncing: boolean = false;

    onLoad() {
        // 確保剛體有開啟碰撞監聽，這樣 onBeginContact 才會觸發
        const rb = this.getComponent(cc.RigidBody);
        if (rb) rb.enabledContactListener = true;
    }

    onBeginContact(contact: cc.PhysicsContact, self: cc.PhysicsCollider, other: cc.PhysicsCollider) {
        // 取得撞到彈簧的剛體
        const otherRb = other.getComponent(cc.RigidBody);
        
        // 防呆：確認撞上來的是動態剛體（例如車子零件），而不是地圖的靜態牆壁，且彈簧目前沒有在冷卻中
        if (otherRb && otherRb.type === cc.RigidBodyType.Dynamic && !this.isBouncing) {

            // 1. 物理彈飛：對撞擊到的剛體施加向上的衝量
            otherRb.applyLinearImpulse(
                cc.v2(0, this.bounceImpulse), 
                otherRb.getWorldCenter(), 
                true
            );

            // 2. 視覺特效與音效
            this.playBounceAnimation();
            if (this.bounceSfx) {
                cc.audioEngine.playEffect(this.bounceSfx, false);
            }

            // 3. 打擊感回饋：彈跳給中等鏡頭晃動（低於 hitstop 門檻，不會慢動作）
            HitFeedback.trigger(8, otherRb.getWorldCenter());
        }
    }

    private playBounceAnimation() {
        this.isBouncing = true;
        this.node.stopAllActions(); // 中斷前一次可能的動畫
        this.node.scaleY = 1;

        // 利用 cc.tween 做出 Q 彈的「壓扁 → 伸長 → 回復」效果
        cc.tween(this.node)
            .to(0.05, { scaleY: 0.4 })                                // 瞬間壓扁
            .to(0.15, { scaleY: 1.3 }, { easing: "quadOut" })         // 快速向上拉伸
            .to(0.1, { scaleY: 1.0 }, { easing: "quadIn" })           // 回復原狀
            .call(() => { this.isBouncing = false; })                 // 動畫結束，解除冷卻
            .start();
    }
}