// battle/WallRide.ts
// 讓車子能爬牆、繞封閉軌道一圈，並以「反向輸入減速」沿牆滑下。
// 做法：每幀從核心往「車底」打射線找地面 → 把淨重力重導向到壓向該地面 → 對齊車身 →
//       貼牆時若玩家按與爬升相反的方向，吸附漸進鬆開、靠重力沿牆滑下。
//
// 這是「相對地面重力」的版本，務必到場景裡實測並調 GameConstants.WALLRIDE 的參數。
// 由 BattleManager 在建好玩家車後 new 一個，並每幀呼叫 update(dt, moveDir)。

import { GROUP, WALLRIDE } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";

export default class WallRide {
    private root: cc.Node;
    private partGroup: string;
    private coreNode: cc.Node | null;
    private stuck = false;
    private smoothUp = cc.v2(0, 1);   // 平滑後的地面法線

    // 反向減速下牆用的狀態
    private ascendDir = 0;            // 正在驅動「爬升」的輸入方向（moveDir 的 +1 / -1）
    private releaseRamp = 0;          // 鬆牆漸進量 0~1（1 = 完全鬆開、靠重力滑下）

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    // 是否正吸附在某個面上（保留給外部查詢用）
    isStuck(): boolean { return this.stuck; }

    update(dt: number, moveDir: number) {
        this.stuck = false;

        const core = this.coreNode;
        if (!core || !core.isValid) return;
        const coreRb = core.getComponent(cc.RigidBody);
        if (!coreRb) return;

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

        if (!surfaceUp) {         // 空中：世界重力自然下墜，重置下牆狀態
            this.ascendDir = 0;
            this.releaseRamp = 0;
            return;
        }

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
        this.stuck = blend > 0.5;                 // 夠陡才算吸附中

        if (blend <= 0.001) {                      // 平地 / 小顛簸：交給一般物理，完全不介入
            this.ascendDir = 0;
            this.releaseRamp = 0;
            return;
        }

        // === 反向減速下牆 ===
        // 切向（沿牆方向）與有號切向速度；判斷目前是否正往上爬，記錄「爬升輸入方向」。
        const tan = cc.v2(up.y, -up.x);
        const vel = coreRb.linearVelocity;
        const vTan = vel.x * tan.x + vel.y * tan.y;
        const uphillSign = tan.y >= 0 ? 1 : -1;    // tan * uphillSign 朝上
        const climbing = vTan * uphillSign;        // > 0 表示正在往上爬
        if (moveDir !== 0 && climbing > WALLRIDE.CLIMB_LOCK_SPEED) {
            this.ascendDir = moveDir;              // 鎖定「往上爬」對應的按鍵
        }
        // 按下與爬升相反的方向 → 漸進鬆牆；否則漸進回到吸附
        const reversing = this.ascendDir !== 0 && moveDir === -this.ascendDir;
        if (reversing) {
            this.releaseRamp = Math.min(1, this.releaseRamp + dt / WALLRIDE.RELEASE_TIME);
        } else {
            this.releaseRamp = Math.max(0, this.releaseRamp - dt / WALLRIDE.RELEASE_TIME);
        }
        // 有效介入：鬆牆時 eff→0 → 不再抵銷重力/對齊 → 靠重力沿牆滑下
        const eff = blend * (1 - this.releaseRamp);
        if (eff <= 0.001) return;

        // 1) 重力重導向（依 eff 漸進）：抵銷世界重力、改壓向地面，再加貼附力
        const wg = pm.gravity;
        const gMag = wg.mag() || 960;
        const targetX = -up.x * gMag * (1 + WALLRIDE.STICK * eff);
        const targetY = -up.y * gMag * (1 + WALLRIDE.STICK * eff);
        const ax = (targetX - wg.x) * eff;        // 額外加速度 = (目標 - 世界) × 有效介入
        const ay = (targetY - wg.y) * eff;

        const bodies = this.livingBodies();
        for (const rb of bodies) {
            const m = rb.getMass();
            rb.applyForceToCenter(cc.v2(ax * m, ay * m), true);
        }

        // 2) 對齊（依 eff 漸進）：把車頂轉向地面法線
        const diff = this.signedAngle(carUp, up);
        let torque = (diff * WALLRIDE.ALIGN_GAIN - coreRb.angularVelocity * WALLRIDE.ALIGN_DAMP) * eff;
        torque = cc.misc.clampf(torque, -WALLRIDE.ALIGN_MAX, WALLRIDE.ALIGN_MAX);
        (coreRb as any).applyTorque(torque, true);
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