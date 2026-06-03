// scramble/ScrambleGrabber.ts
// 搶奪階段的「競爭者」：一個會左右移動、能跳的方塊。
// 輸入由 ScrambleManager 統一餵（玩家鍵盤或 Bot AI），這裡只負責把輸入變成物理運動。

import { SCRAMBLE } from "../core/GameConstants";

const { ccclass } = cc._decorator;

@ccclass
export default class ScrambleGrabber extends cc.Component {
    public side: "P1" | "P2" | "BOT" = "P1";
    public moveSpeed: number = SCRAMBLE.MOVE_SPEED;
    public jumpImpulse: number = SCRAMBLE.JUMP_IMPULSE;

    private rb: cc.RigidBody | null = null;
    private inputDir: number = 0;
    private jumpQueued: boolean = false;

    onLoad() {
        this.rb = this.getComponent(cc.RigidBody);
    }

    setInput(dir: number) { this.inputDir = dir; }
    queueJump() { this.jumpQueued = true; }

    update() {
        if (!this.rb) return;

        const v = this.rb.linearVelocity;
        this.rb.linearVelocity = cc.v2(this.inputDir * this.moveSpeed, v.y);

        // 接近落地（垂直速度很小）才允許跳，避免在空中連跳
        if (this.jumpQueued && Math.abs(v.y) < 40) {
            this.rb.applyLinearImpulse(cc.v2(0, this.jumpImpulse), this.rb.getWorldCenter(), true);
        }
        this.jumpQueued = false;
    }
}
