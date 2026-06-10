// battle/AirPhysics.ts
// 玩家車「完全騰空」時接管的客製化剛體積分器（取代 Box2D 的空中行為）。
// 規則：
//   - 整車當一個剛體，質心 = 各活零件世界座標平均（每個權重 1），繞質心旋轉。
//   - 旋轉只由「剛離地當下的角速度」起始；有阻尼會越轉越慢；按住 A/D 持續加正/負角速度。
//   - 下落為自由落體（質心只受重力，水平速度維持離地當下的值）。
//   - 落地（任一零件接觸到東西）時交回 Box2D；積分中已逐幀把剛體速度場灌回各零件，銜接平順。
//
// 擺放手法沿用 StuckRescue.relocate：設 node transform 後呼叫 syncPosition/syncRotation 推進 Box2D。
// 由 BattleManager 每幀呼叫 update(dt, moveDir, touching)，回傳是否正在接管（active）。

import { PHYSICS, AIRPHYS } from "../core/GameConstants";
import { BuiltCar } from "./CarBuilder";

const DEG2RAD = Math.PI / 180;

export default class AirPhysics {
    private root: cc.Node;
    private partGroup: string;
    private coreNode: cc.Node | null;

    private active = false;
    private com = cc.v2(0, 0);        // 質心（世界）
    private comVel = cc.v2(0, 0);     // 質心線速度
    private omega = 0;                // 角速度（度/秒）
    private rot = 0;                  // 自進入空中以來累積旋轉（度）

    // 進入空中時記下每個零件相對質心的初始位移與初始角度
    private offsets = new Map<cc.Node, { ox: number; oy: number; angle0: number }>();

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    isActive(): boolean { return this.active; }

    // 回傳是否正在接管空中物理
    update(dt: number, moveDir: number, touching: boolean): boolean {
        const core = this.coreNode;
        if (!core || !core.isValid) { this.active = false; return false; }

        if (touching) {                 // 有接觸 → 交給 Box2D
            this.active = false;
            return false;
        }

        if (!this.active) this.enterAir();   // 剛離地：擷取初始狀態
        if (!this.active) return false;       // 沒有活零件等 → 放棄接管

        this.integrate(dt, moveDir);
        return true;
    }

    // 目前車上仍屬於本車的零件剛體
    private livingBodies(): cc.RigidBody[] {
        const out: cc.RigidBody[] = [];
        if (!this.root || !this.root.isValid) return out;
        this.root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            if (rb.node && rb.node.isValid && rb.node.group === this.partGroup) out.push(rb);
        });
        return out;
    }

    private enterAir() {
        const bodies = this.livingBodies();
        if (bodies.length === 0) { this.active = false; return; }

        // 質心 = 各零件世界座標平均；質心速度 = 各零件線速度平均（權重都 1）
        let cx = 0, cy = 0, vx = 0, vy = 0;
        const worlds: cc.Vec2[] = [];
        for (const rb of bodies) {
            const w = rb.node.convertToWorldSpaceAR(cc.v2(0, 0));
            worlds.push(w);
            cx += w.x; cy += w.y;
            const v = rb.linearVelocity;
            vx += v.x; vy += v.y;
        }
        const n = bodies.length;
        this.com = cc.v2(cx / n, cy / n);
        this.comVel = cc.v2(vx / n, vy / n);

        // 初始旋轉量 = 核心當下角速度（度/秒）
        const coreRb = this.coreNode!.getComponent(cc.RigidBody);
        this.omega = coreRb ? coreRb.angularVelocity : 0;
        this.rot = 0;

        // 記下每個零件相對質心的位移與初始角度
        this.offsets.clear();
        for (let i = 0; i < bodies.length; i++) {
            const nd = bodies[i].node;
            this.offsets.set(nd, { ox: worlds[i].x - this.com.x, oy: worlds[i].y - this.com.y, angle0: nd.angle });
        }

        this.active = true;
    }

    private integrate(dt: number, moveDir: number) {
        // 旋轉：按住 A/D 持續加速（含上限）→ 阻尼 → 積分
        this.omega += AIRPHYS.ROT_INPUT * moveDir * dt;
        this.omega = cc.misc.clampf(this.omega, -AIRPHYS.MAX_SPIN, AIRPHYS.MAX_SPIN);
        this.omega *= Math.max(0, 1 - AIRPHYS.SPIN_DAMP * dt);
        this.rot += this.omega * dt;

        // 下落：自由落體（只受重力，水平速度不變）
        this.comVel.y += PHYSICS.GRAVITY_Y * dt;
        this.com.x += this.comVel.x * dt;
        this.com.y += this.comVel.y * dt;

        // 剛體擺放：整車繞質心旋轉 rot 度
        const rad = this.rot * DEG2RAD;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const omegaRad = this.omega * DEG2RAD;

        for (const rb of this.livingBodies()) {
            const nd = rb.node;
            const off = this.offsets.get(nd);
            if (!off) continue;   // 中途新增（理論上不會）或無紀錄者跳過

            // 旋轉後的相對位移
            const rx = off.ox * cos - off.oy * sin;
            const ry = off.ox * sin + off.oy * cos;
            const world = cc.v2(this.com.x + rx, this.com.y + ry);

            const parent = nd.parent || this.root;
            nd.setPosition(parent.convertToNodeSpaceAR(world));
            nd.angle = off.angle0 + this.rot;

            // 剛體速度場：v = comVel + ω × r（2D：ω*(-ry, rx)）→ 落地當幀速度已正確、銜接平順
            rb.linearVelocity = cc.v2(this.comVel.x - omegaRad * ry, this.comVel.y + omegaRad * rx);
            rb.angularVelocity = this.omega;

            const anyRb = rb as any;
            if (anyRb.syncPosition) anyRb.syncPosition(false);
            if (anyRb.syncRotation) anyRb.syncRotation(false);
            rb.awake = true;
        }
    }
}
