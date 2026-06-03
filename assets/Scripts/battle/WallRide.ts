// battle/WallRide.ts
// 讓車子能爬牆、繞封閉軌道一圈，並能從牆上脫離翻進空中。
// 做法：每幀從核心往「車底」打射線找地面 → 把淨重力重導向到壓向該地面 → 對齊車身 → 處理脫離。
//
// 這是「相對地面重力」的第一版，務必到場景裡實測並調 GameConstants.WALLRIDE 的參數。
// 由 BattleManager 在建好玩家車後 new 一個，並每幀呼叫 update。

import { GROUP, WALLRIDE } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";

export default class WallRide {
    private root: cc.Node;
    private partGroup: string;
    private coreNode: cc.Node | null;
    private detachTimer = 0;
    private stuck = false;
    private smoothUp = cc.v2(0, 1);   // 平滑後的地面法線

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    // 是否正吸附在某個面上（BattleManager 用它判斷要不要停用空中旋轉，避免兩者打架）
    isStuck(): boolean { return this.stuck; }

    update(dt: number, detachPressed: boolean) {
        this.stuck = false;

        const core = this.coreNode;
        if (!core || !core.isValid) return;
        const coreRb = core.getComponent(cc.RigidBody);
        if (!coreRb) return;

        // 脫離中：完全交給世界重力（自由飛 + 翻滾）
        if (this.detachTimer > 0) { this.detachTimer -= dt; return; }

        const pm = cc.director.getPhysicsManager();

        // 車底方向（由核心目前角度決定）
        const angRad = core.angle * Math.PI / 180;
        const carUp = cc.v2(-Math.sin(angRad), Math.cos(angRad));
        const carDown = cc.v2(-carUp.x, -carUp.y);

        const origin = core.convertToWorldSpaceAR(cc.v2(0, 0));
        const end = cc.v2(origin.x + carDown.x * WALLRIDE.PROBE, origin.y + carDown.y * WALLRIDE.PROBE);
        const results = pm.rayCast(origin, end, cc.RayCastType.Closest);

        let surfaceUp: cc.Vec2 | null = null;
        for (const r of results) {
            const g = r.collider.node.group;
            if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) {
                surfaceUp = cc.v2(r.normal.x, r.normal.y);
                break;
            }
        }

        if (!surfaceUp) return;   // 空中：世界重力自然下墜

        // 平滑地面法線，抗顛簸（單幀凹凸不會讓方向亂跳）
        const s = WALLRIDE.NORMAL_SMOOTH;
        this.smoothUp.x += (surfaceUp.x - this.smoothUp.x) * s;
        this.smoothUp.y += (surfaceUp.y - this.smoothUp.y) * s;
        const um = Math.hypot(this.smoothUp.x, this.smoothUp.y) || 1;
        const up = cc.v2(this.smoothUp.x / um, this.smoothUp.y / um);

        // 介入程度 blend：依坡度漸進。平地(tilt≈0)與小顛簸 → blend=0 → 完全不介入；牆/天花板 → blend=1
        const tilt = (1 - up.y) * 0.5;            // 平地=0、牆=0.5、天花板=1
        const blend = cc.misc.clampf(
            (tilt - WALLRIDE.ENGAGE_LO) / (WALLRIDE.ENGAGE_HI - WALLRIDE.ENGAGE_LO), 0, 1);
        this.stuck = blend > 0.5;                 // 夠陡才算吸附中（讓 BattleManager 停用空中旋轉）

        if (blend <= 0.001) return;               // 平地 / 小顛簸：交給一般物理，完全不介入 → 不會亂彈

        // 1) 重力重導向（依 blend 漸進）：抵銷世界重力、改壓向地面，再加貼附力
        const wg = pm.gravity;
        const gMag = wg.mag() || 960;
        const targetX = -up.x * gMag * (1 + WALLRIDE.STICK * blend);
        const targetY = -up.y * gMag * (1 + WALLRIDE.STICK * blend);
        const ax = (targetX - wg.x) * blend;      // 額外加速度 = (目標 - 世界) × 介入程度
        const ay = (targetY - wg.y) * blend;

        const bodies = this.livingBodies();
        for (const rb of bodies) {
            const m = rb.getMass();
            rb.applyForceToCenter(cc.v2(ax * m, ay * m), true);
        }

        // 2) 對齊（依 blend 漸進）：把車頂轉向地面法線
        const diff = this.signedAngle(carUp, up);
        let torque = (diff * WALLRIDE.ALIGN_GAIN - coreRb.angularVelocity * WALLRIDE.ALIGN_DAMP) * blend;
        torque = cc.misc.clampf(torque, -WALLRIDE.ALIGN_MAX, WALLRIDE.ALIGN_MAX);
        (coreRb as any).applyTorque(torque, true);

        // 3) 脫離：在牆上（法線偏水平）按脫離鍵 → 往牆外彈 + 翻轉
        if (detachPressed && Math.abs(up.x) > WALLRIDE.WALL_THRESHOLD) {
            this.detachTimer = WALLRIDE.DETACH_TIME;
            this.stuck = false;
            const center = coreRb.getWorldCenter();
            coreRb.applyLinearImpulse(
                cc.v2(up.x * WALLRIDE.DETACH_IMPULSE, up.y * WALLRIDE.DETACH_IMPULSE),
                center, true
            );
            (coreRb as any).applyAngularImpulse((up.x >= 0 ? -1 : 1) * WALLRIDE.DETACH_SPIN, true);
        }
    }

    // 目前車上「還活著」的零件剛體（已脫落的碎片 group 變成 default，會被排除，照世界重力掉落）
    private livingBodies(): cc.RigidBody[] {
        const out: cc.RigidBody[] = [];
        if (!this.root || !this.root.isValid) return out;
        this.root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            if (rb.node && rb.node.isValid && rb.node.group === this.partGroup) out.push(rb);
        });
        return out;
    }

    private signedAngle(from: cc.Vec2, to: cc.Vec2): number {
        let d = (Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x)) * 180 / Math.PI;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
    }
}