// map/RingTrackGenerator.ts
// 用程式鋪出一條「封閉環形」碰撞邊界，不用手點幾百個點。
// 掛在一個空節點（你的「Track」節點）上，遊戲開始時自動生成：
//   - 外圈一條封閉 PhysicsChainCollider（車繞著它的內側跑）
//   - 內圈一條封閉 PhysicsChainCollider（中央障礙/通道內壁，可關閉）
// 形狀用橢圓 (radiusX, radiusY)：兩者相等就是正圓，不等就是橢圓跑道。
//
// 搭配 WallRide：此節點的 group 要是 "default" 或你的 BOUNDARY 群組，車才吸得上、繞得了一圈。

const { ccclass, property } = cc._decorator;

@ccclass
export default class RingTrackGenerator extends cc.Component {
    @property({ tooltip: "外圈水平半徑" })
    outerRadiusX: number = 700;
    @property({ tooltip: "外圈垂直半徑（與水平相等＝正圓）" })
    outerRadiusY: number = 450;

    @property({ tooltip: "是否也生成內圈" })
    buildInnerRing: boolean = true;
    @property({ tooltip: "環道寬度：內圈半徑 = 外圈 - 此值" })
    thickness: number = 220;

    @property({ tooltip: "每圈的點數（越多越平滑，越吃效能）" })
    segments: number = 72;

    @property({ tooltip: "碰撞群組名稱（WallRide 認得 default / BOUNDARY）" })
    group: string = "default";

    @property({ tooltip: "是否畫出環的輪廓（方便測試時看到碰撞邊界）" })
    debugDraw: boolean = true;

    start() {
        // 靜態剛體 + 群組
        let rb = this.getComponent(cc.RigidBody) || this.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        if (this.group) this.node.group = this.group;

        // 外圈
        this.addRing(this.outerRadiusX, this.outerRadiusY);

        // 內圈
        if (this.buildInnerRing) {
            const inX = this.outerRadiusX - this.thickness;
            const inY = this.outerRadiusY - this.thickness;
            if (inX > 10 && inY > 10) this.addRing(inX, inY);
        }

        if (this.debugDraw) this.drawDebug();
    }

    private addRing(rx: number, ry: number) {
        const collider = this.addComponent(cc.PhysicsChainCollider);
        collider.loop = true;                 // 首尾相接＝封閉
        collider.points = this.ellipsePoints(rx, ry, this.segments);
        (collider as any).apply();            // 重新套用，產生實際碰撞（型別定義缺，故 as any）
    }

    private ellipsePoints(rx: number, ry: number, n: number): cc.Vec2[] {
        const pts: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            pts.push(cc.v2(Math.cos(a) * rx, Math.sin(a) * ry));
        }
        return pts;
    }

    private drawDebug() {
        const n = new cc.Node("ringDebug");
        n.parent = this.node;
        n.setPosition(0, 0);
        const g = n.addComponent(cc.Graphics);
        g.lineWidth = 4;
        g.strokeColor = cc.color(120, 200, 255, 200);
        this.strokeEllipse(g, this.outerRadiusX, this.outerRadiusY, this.segments);
        if (this.buildInnerRing) {
            const inX = this.outerRadiusX - this.thickness;
            const inY = this.outerRadiusY - this.thickness;
            if (inX > 10 && inY > 10) this.strokeEllipse(g, inX, inY, this.segments);
        }
    }

    private strokeEllipse(g: cc.Graphics, rx: number, ry: number, n: number) {
        for (let i = 0; i <= n; i++) {
            const a = (i / n) * Math.PI * 2;
            const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
            if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
    }
}