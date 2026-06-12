// map/Seesaw.ts
// 翹翹板：掛在「板子」節點上（板子需有 RigidBody=Dynamic + 一個 PhysicsBoxCollider）。
// 會自動在板子中心(或指定支點)建立一個靜態支點 + RevoluteJoint，讓板子能繞支點傾斜。
// 提供：角度上下限、自動回正到水平、限制回彈角速度（避免被車撞到瞬間轉飛）。
//
// 注意：板子的 collider group 建議設成 "default"（或你的 BOUNDARY 群組），
// 這樣車子才踩得上去、WallRide 也認得它當地面。

const { ccclass, property } = cc._decorator;

@ccclass
export default class Seesaw extends cc.Component {
    @property({ tooltip: "最大傾斜角度（度），左右各這麼多" })
    maxAngle: number = 25;

    @property({ tooltip: "是否自動回正到水平（關掉就是純自由翹翹板）" })
    autoReturn: boolean = true;

    @property({ tooltip: "回正力道（autoReturn 開啟時）。太大會太硬、太小回不來" })
    returnStrength: number = 30000;

    @property({ tooltip: "最大角速度（度/秒），避免被車撞到瞬間轉太快彈飛。0 = 不限制" })
    maxAngularSpeed: number = 150;

    @property({ tooltip: "角速度阻尼：越大搖晃/回彈越快靜下來" })
    angularDamp: number = 2;

    @property({ tooltip: "支點相對板子中心的位置（一般填 0,0；想做不對稱翹翹板可偏移）" })
    pivotOffset: cc.Vec2 = cc.v2(0, 0);

    @property({ type: cc.SpriteFrame, tooltip: "板子的圖（可留空。留空就用繪圖畫一個方塊）" })
    plankSprite: cc.SpriteFrame = null;
    @property({ type: cc.SpriteFrame, tooltip: "支點的圖（可留空。留空就畫一個小圓點）" })
    pivotSprite: cc.SpriteFrame = null;
    @property({ tooltip: "繪圖模式下板子的顏色" })
    plankColor: cc.Color = cc.color(180, 140, 90);
    @property({ tooltip: "支點圖示/圓點的半徑" })
    pivotRadius: number = 10;

    private rb: cc.RigidBody | null = null;
    private joint: cc.RevoluteJoint | null = null;
    private fixedPivotWorld: cc.Vec2 | null = null;   // 支點出生時的世界座標，update 每幀硬鎖回此點

    start() {
        this.buildVisual();

        this.rb = this.getComponent(cc.RigidBody);
        if (!this.rb) { cc.warn("[Seesaw] 板子需要 RigidBody(Dynamic)"); return; }
        this.rb.type = cc.RigidBodyType.Dynamic;
        this.rb.angularDamping = this.angularDamp;

        this.rb.bullet = true;

        if (!this.node.parent) { cc.warn("[Seesaw] 板子需要有父節點"); return; }

        // 1) 建立靜態支點節點，放在板子上的支點世界位置
        const pivot = new cc.Node("SeesawPivot");
        pivot.parent = this.node.parent;
        const pivotWorld = this.node.convertToWorldSpaceAR(this.pivotOffset);
        this.fixedPivotWorld = pivotWorld;   // 記錄支點世界座標，update 每幀把板子硬鎖回此點
        pivot.setPosition(this.node.parent.convertToNodeSpaceAR(pivotWorld));
        const prb = pivot.addComponent(cc.RigidBody);
        prb.type = cc.RigidBodyType.Static;

        // 2) 在支點上加旋轉關節，連到板子
        this.joint = pivot.addComponent(cc.RevoluteJoint);
        this.joint.connectedBody = this.rb;
        this.joint.anchor = cc.v2(0, 0);                 // 支點本地中心
        this.joint.connectedAnchor = this.pivotOffset;   // 板子上的支點位置
        this.joint.enableLimit = true;
        this.joint.lowerAngle = -this.maxAngle;
        this.joint.upperAngle = this.maxAngle;
    }

    // 建立可見的板子與中心支點。優先用使用者給的 sprite，沒有就用繪圖工具畫。
    private buildVisual() {
        // 板子大小：優先抓 PhysicsBoxCollider 的 size/offset，沒有就用節點內容大小或預設
        let w = 200, h = 30, ox = 0, oy = 0;
        const box = this.getComponent(cc.PhysicsBoxCollider);
        if (box) {
            w = box.size.width; h = box.size.height;
            ox = box.offset.x; oy = box.offset.y;
        } else {
            const cs = this.node.getContentSize();
            if (cs.width > 0 && cs.height > 0) { w = cs.width; h = cs.height; }
        }

        // ---- 板子 ----
        const plank = new cc.Node("plankVisual");
        plank.parent = this.node;
        plank.zIndex = -1;
        if (this.plankSprite) {
            plank.setPosition(ox, oy);
            const sp = plank.addComponent(cc.Sprite);
            sp.spriteFrame = this.plankSprite;
            sp.type = cc.Sprite.Type.SIMPLE;
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            plank.setContentSize(w, h);
        } else {
            plank.setPosition(0, 0);
            const g = plank.addComponent(cc.Graphics);
            g.fillColor = this.plankColor;
            g.strokeColor = cc.color(60, 45, 30);
            g.lineWidth = 3;
            g.rect(ox - w / 2, oy - h / 2, w, h);
            g.fill();
            g.stroke();
        }

        // ---- 中心支點 ----
        const pivot = new cc.Node("pivotVisual");
        pivot.parent = this.node;
        pivot.zIndex = 1;
        if (this.pivotSprite) {
            pivot.setPosition(this.pivotOffset);
            const sp = pivot.addComponent(cc.Sprite);
            sp.spriteFrame = this.pivotSprite;
            sp.type = cc.Sprite.Type.SIMPLE;
            sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            pivot.setContentSize(this.pivotRadius * 2, this.pivotRadius * 2);
        } else {
            pivot.setPosition(0, 0);
            const g = pivot.addComponent(cc.Graphics);
            g.fillColor = cc.color(50, 50, 50);
            g.strokeColor = cc.color(230, 200, 80);
            g.lineWidth = 3;
            g.circle(this.pivotOffset.x, this.pivotOffset.y, this.pivotRadius);
            g.fill();
            g.stroke();
        }
    }

    update(dt: number) {
        if (!this.rb || !this.joint) return;

        // 限制角速度，避免被撞到轉太快彈飛
        if (this.maxAngularSpeed > 0) {
            const w = this.rb.angularVelocity;
            if (w > this.maxAngularSpeed) this.rb.angularVelocity = this.maxAngularSpeed;
            else if (w < -this.maxAngularSpeed) this.rb.angularVelocity = -this.maxAngularSpeed;
        }

        // 自動回正：朝水平(相對角度 0)施加回復扭矩 + 阻尼
        if (this.autoReturn) {
            const ang = this.joint.getJointAngle();   // 相對角度（度）
            const torque = -ang * this.returnStrength - this.rb.angularVelocity * (this.returnStrength * 0.02);
            (this.rb as any).applyTorque(torque, true);
        }

        // 嚴格固定支點：RevoluteJoint 是軟約束，被車重撞時支點可能產生微小位移漂移。
        // 翹翹板本來就不該平移，故每幀清掉線速度，並把支點硬鎖回出生世界座標（旋轉仍自由）。
        // if (this.fixedPivotWorld && this.node.parent) {
        //     this.rb.linearVelocity = cc.v2(0, 0);
        //     const cur = this.node.convertToWorldSpaceAR(this.pivotOffset);
        //     const dx = this.fixedPivotWorld.x - cur.x;
        //     const dy = this.fixedPivotWorld.y - cur.y;
        //     if (dx * dx + dy * dy > 1e-4) {
        //         const nodeWorld = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        //         const target = cc.v2(nodeWorld.x + dx, nodeWorld.y + dy);
        //         this.node.setPosition(this.node.parent.convertToNodeSpaceAR(target));
        //         // 把節點 transform 推進物理世界（Cocos 2.x：型別定義缺，故 as any）
        //         const anyRb = this.rb as any;
        //         if (anyRb.syncPosition) anyRb.syncPosition(false);
        //     }
        // }
    }
}
