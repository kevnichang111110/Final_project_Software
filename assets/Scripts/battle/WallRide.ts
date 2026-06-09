// battle/WallRide.ts
// 讓車子能爬牆、繞封閉軌道一圈。下牆採「重心模型」：車身越貼向牆面抓得越牢，
// 重心太靠外（車頂方向偏離牆面法線太多）抓地力就歸零、靠重力自然掉下來。
// 玩家在「空中的左右轉」就是在調整這個車身朝向（＝重心），決定貼上牆後抓不抓得住。
// 做法：每幀從核心往「車底」打射線找地面 → 依坡度與 lean 算抓地力 →
//       抵銷垂直牆面的重力分量＋往牆面壓（保留部分沿牆重力讓它能自然下滑）→ 對齊車身。
//
// 由 BattleManager 在建好玩家車後 new 一個，並每幀呼叫 update(dt)。

import { GROUP, WALLRIDE } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";

export default class WallRide {
    private root: cc.Node;
    private partGroup: string;
    private coreNode: cc.Node | null;
    private stuck = false;
    private engaged = false;          // 本幀是否真的抓住牆面（給自動翻正讓位判斷）
    private smoothUp = cc.v2(0, 1);   // 平滑後的地面法線

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    // 是否正吸附在某個面上（保留給外部查詢用）
    isStuck(): boolean { return this.stuck; }

    // 本幀是否真的抓住牆面。BattleManager 用它判斷「自動翻正」是否該讓位，避免兩套對齊力互打 → 亂彈。
    isEngaged(): boolean { return this.engaged; }

    update(dt: number) {
        this.stuck = false;
        this.engaged = false;

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
        this.stuck = blend > 0.5;                 // 夠陡才算吸附中

        if (blend <= 0.001) return;               // 平地 / 小顛簸：交給一般物理，完全不介入

        // === 重心模型：車身越貼向牆面抓得越牢；重心太靠外 → 抓地力歸零 → 自然下落 ===
        // lean = 車頂方向 · 牆面外法線：1 = 車頂正對牆外（貼牆）、越小代表車身越往外傾（重心外移）。
        const lean = carUp.x * up.x + carUp.y * up.y;
        const grip = cc.misc.clampf((lean - WALLRIDE.GRIP_LEAN_MIN) / (1 - WALLRIDE.GRIP_LEAN_MIN), 0, 1);
        const k = blend * grip;                    // 綜合抓地力（坡度 × 重心貼合度）
        this.engaged = k > 0.001;
        if (k <= 0.001) return;                    // 重心太靠外 → 不貼附 → 靠重力自然掉下牆

        // 1) 貼附：抵銷「垂直牆面方向」的重力分量並往牆面壓，但保留 SLIDE 比例的「沿牆方向」重力
        //    → 不主動爬時會自然沿牆下滑（不需反向鍵），可開回地面；重心太靠外則上面已歸零自然掉。
        const wg = pm.gravity;
        const gMag = wg.mag() || 960;
        const gPerp = wg.x * up.x + wg.y * up.y;   // 重力在法線方向的分量（有號）
        const wgTanX = wg.x - gPerp * up.x;        // 沿牆方向的重力分量
        const wgTanY = wg.y - gPerp * up.y;
        const targetX = WALLRIDE.SLIDE * wgTanX - up.x * gMag * WALLRIDE.STICK;
        const targetY = WALLRIDE.SLIDE * wgTanY - up.y * gMag * WALLRIDE.STICK;
        const ax = (targetX - wg.x) * k;
        const ay = (targetY - wg.y) * k;

        const bodies = this.livingBodies();
        for (const rb of bodies) {
            const m = rb.getMass();
            rb.applyForceToCenter(cc.v2(ax * m, ay * m), true);
        }

        // 2) 對齊（依 k 漸進）：把車頂轉向地面法線，讓輪子貼牆、視覺正確
        const diff = this.signedAngle(carUp, up);
        let torque = (diff * WALLRIDE.ALIGN_GAIN - coreRb.angularVelocity * WALLRIDE.ALIGN_DAMP) * k;
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