// battle/AirPhysics.ts
// 玩家車「完全騰空」時接管的客製化剛體積分器（取代 Box2D 的空中行為）。
// 規則：
//   - 整車當一個剛體，質心 = 各活零件世界座標平均（每個權重 1），繞質心旋轉。
//   - 旋轉只由「剛離地當下的角速度」起始（會夾在上限內）；有阻尼會越轉越慢；按住 A/D 持續加正/負角速度。
//   - 下落為自由落體（質心只受重力，水平速度維持離地當下的值）。
//   - 落地（任一零件接觸到東西）時把剛體速度場灌回各零件、交回 Box2D，銜接平順。
//
// 重點：接管期間把零件剛體切成 Kinematic，Box2D 就不會對它們施重力/關節力/碰撞反作用，
//       完全由本積分器逐幀擺放（不會被物理拉扯而散架、抽搐）。落地時再切回 Dynamic。
// 由 BattleManager 每幀呼叫 update(dt, moveDir, grounded, onWall)，回傳是否正在接管（active）。

import { AIRPHYS } from "../core/GameConstants";
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

    // 進入空中時記下每個零件：相對質心位移、初始角度、原本的 body type（落地還原用）
    private parts = new Map<cc.Node, { ox: number; oy: number; angle0: number; type0: number }>();

    // 建車當下的「標準版型」：每個零件相對核心的 local 座標與相對角度（旋轉不變、固定不變）。
    // 進空中時用它＋核心目前位姿重建剛體，避免把「被彈散的瞬間」當成版型而凍結散架。
    private canonical = new Map<cc.Node, { lx: number; ly: number; relAngle: number }>();

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
        this.captureCanonical();
    }

    // 在剛建好車、還沒被物理拉扯時擷取標準版型（相對核心）
    private captureCanonical() {
        const core = this.coreNode;
        if (!core || !core.isValid) return;
        const coreAngle = core.angle;
        for (const rb of this.livingBodies()) {
            const nd = rb.node;
            const w = nd.convertToWorldSpaceAR(cc.v2(0, 0));
            const local = core.convertToNodeSpaceAR(w);   // 核心 local 座標（旋轉不變）
            this.canonical.set(nd, { lx: local.x, ly: local.y, relAngle: nd.angle - coreAngle });
        }
    }

    isActive(): boolean { return this.active; }
    getCoM(): cc.Vec2 { return cc.v2(this.com.x, this.com.y); }

    // 回傳是否正在接管空中物理。grounded=著地、onWall=貼牆。
    // 黏著式：一旦接管，只有「著地」才交回 Box2D；貼牆/掠過都不打斷 → 整車當單一剛體穩定旋轉、不亂跳。
    update(dt: number, moveDir: number, grounded: boolean, onWall: boolean): boolean {
        const core = this.coreNode;
        if (!core || !core.isValid) { if (this.active) this.exitAir(); return false; }

        if (this.active) {
            if (grounded) { this.exitAir(); return false; }   // 著地 → 交回 Box2D
            this.integrate(dt, moveDir);
            return true;
        }

        // 尚未接管：只有「真正騰空（沒著地、也沒貼牆）」才接管
        if (grounded || onWall) return false;
        this.enterAir();
        if (!this.active) return false;
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
        const core = this.coreNode;
        const bodies = this.livingBodies();
        if (!core || !core.isValid || bodies.length === 0) { this.active = false; return; }

        // 用核心「目前位姿」+ 標準版型，重建每個零件的「正確（未散架）世界位置」。
        // 落地當下若被彈簧/受擊拉散，這裡會把它組裝回正確形狀，再以剛體旋轉。
        const coreWorld = core.convertToWorldSpaceAR(cc.v2(0, 0));
        const ca = core.angle * DEG2RAD;
        const cos = Math.cos(ca), sin = Math.sin(ca);

        let cx = 0, cy = 0, vx = 0, vy = 0;
        const proper = new Map<cc.Node, { wx: number; wy: number; ang: number }>();
        for (const rb of bodies) {
            const nd = rb.node;
            const cn = this.canonical.get(nd);
            // 沒有標準版型紀錄者（理論上不會）退回用目前世界座標
            let wx: number, wy: number, ang: number;
            if (cn) {
                wx = coreWorld.x + (cn.lx * cos - cn.ly * sin);
                wy = coreWorld.y + (cn.lx * sin + cn.ly * cos);
                ang = core.angle + cn.relAngle;
            } else {
                const w = nd.convertToWorldSpaceAR(cc.v2(0, 0));
                wx = w.x; wy = w.y; ang = nd.angle;
            }
            proper.set(nd, { wx, wy, ang });
            cx += wx; cy += wy;
            const v = rb.linearVelocity;
            vx += v.x; vy += v.y;
        }
        const n = bodies.length;
        this.com = cc.v2(cx / n, cy / n);
        this.comVel = cc.v2(vx / n, vy / n);   // 保留進空中當下的動量

        const coreRb = core.getComponent(cc.RigidBody);
        this.omega = cc.misc.clampf(coreRb ? coreRb.angularVelocity : 0, -AIRPHYS.MAX_SPIN, AIRPHYS.MAX_SPIN);
        this.rot = 0;

        // 記下「正確版型」相對質心的 offset/angle，並切成 Kinematic
        this.parts.clear();
        for (const rb of bodies) {
            const nd = rb.node;
            const pr = proper.get(nd)!;
            this.parts.set(nd, { ox: pr.wx - this.com.x, oy: pr.wy - this.com.y, angle0: pr.ang, type0: rb.type });
            rb.type = cc.RigidBodyType.Kinematic;
            rb.enabledContactListener = true;   // 切 type 會重置碰撞監聽，補開回來，否則出空中後就收不到傷害
            rb.linearVelocity = cc.v2(0, 0);
            rb.angularVelocity = 0;
        }

        this.active = true;
    }

    // 整車當「單一剛體」積分：輸入加速→阻尼→積分 omega/rot、自由落體 com，
    // 再用單一 (com, rot) 把所有零件剛體擺放（繞質心一起轉）。不做掃掠/中途交接 → 不亂跳。
    private integrate(dt: number, moveDir: number) {
        // 旋轉：按住 A/D 持續加速（含上限）→ 阻尼 → 積分
        this.omega += AIRPHYS.ROT_INPUT * moveDir * dt;
        this.omega = cc.misc.clampf(this.omega, -AIRPHYS.MAX_SPIN, AIRPHYS.MAX_SPIN);
        this.omega *= Math.max(0, 1 - AIRPHYS.SPIN_DAMP * dt);
        this.rot += this.omega * dt;

        // 下落：自由落體（只受空中重力，水平速度不變）
        this.comVel.y += AIRPHYS.GRAVITY_Y * dt;
        this.com.x += this.comVel.x * dt;
        this.com.y += this.comVel.y * dt;

        // 剛體擺放：整車繞質心旋轉 rot 度（零件為 Kinematic，只跟著 transform 走）
        const rad = this.rot * DEG2RAD;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        for (const rb of this.livingBodies()) {
            const nd = rb.node;
            const p = this.parts.get(nd);
            if (!p) continue;
            const rx = p.ox * cos - p.oy * sin;
            const ry = p.ox * sin + p.oy * cos;
            const world = cc.v2(this.com.x + rx, this.com.y + ry);

            const parent = nd.parent || this.root;
            nd.setPosition(parent.convertToNodeSpaceAR(world));
            nd.angle = p.angle0 + this.rot;

            const anyRb = rb as any;
            if (anyRb.syncPosition) anyRb.syncPosition(false);
            if (anyRb.syncRotation) anyRb.syncRotation(false);
        }
    }

    // 交回 Box2D：把零件切回原本 type，並灌入「剛體速度場」v = comVel + ω × r，落地銜接平順
    private exitAir() {
        const rad = this.rot * DEG2RAD;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const omegaRad = this.omega * DEG2RAD;

        this.parts.forEach((p, nd) => {
            if (!nd || !nd.isValid) return;
            const rb = nd.getComponent(cc.RigidBody);
            if (!rb) return;

            const rx = p.ox * cos - p.oy * sin;
            const ry = p.ox * sin + p.oy * cos;

            rb.type = p.type0;
            rb.enabledContactListener = true;   // 還原 Dynamic 後補開碰撞監聽，否則落地後收不到傷害
            rb.linearVelocity = cc.v2(this.comVel.x - omegaRad * ry, this.comVel.y + omegaRad * rx);
            rb.angularVelocity = this.omega;
            rb.awake = true;
        });

        this.parts.clear();
        this.active = false;
    }
}
