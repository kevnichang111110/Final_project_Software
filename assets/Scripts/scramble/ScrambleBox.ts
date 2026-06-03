// scramble/ScrambleBox.ts
// 搶奪階段的道具箱。用感測碰撞器(sensor)，競爭者一碰到就被搶走，先碰到的人贏。

const { ccclass } = cc._decorator;

@ccclass
export default class ScrambleBox extends cc.Component {
    public toolName: string = "";
    public claimed: boolean = false;
    private mgr: any = null;

    init(mgr: any, toolName: string) {
        this.mgr = mgr;
        this.toolName = toolName;
    }

    onBeginContact(contact: cc.PhysicsContact, self: cc.PhysicsCollider, other: cc.PhysicsCollider) {
        if (this.claimed) return;
        const grab = other.node.getComponent("ScrambleGrabber") as any;
        if (grab && grab.side) {
            this.claimed = true;
            if (this.mgr && this.mgr.onBoxClaimed) this.mgr.onBoxClaimed(this, grab.side);
        }
    }
}
