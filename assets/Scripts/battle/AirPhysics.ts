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
// 由 BattleManager 每幀呼叫 update(dt, moveDir, touching)，回傳是否正在接管（active）。

import { AIRPHYS, GROUP } from "../core/GameConstants";
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

    constructor(car: BuiltCar, root: cc.Node, partGroup: string) {
        this.root = root;
        this.partGroup = partGroup;
        this.coreNode = car.coreNode;
    }

    isActive(): boolean { return this.active; }

    // 回傳是否正在接管空中物理
    update(dt: number, moveDir: number, touching: boolean): boolean {
        const core = this.coreNode;
        if (!core || !core.isValid) { if (this.active) this.exitAir(); return false; }

        if (touching) {                 // 有接觸 → 交回 Box2D
            if (this.active) this.exitAir();
            return false;
        }

        if (!this.active) this.enterAir();   // 剛離地：擷取初始狀態、切 Kinematic
        if (!this.active) return false;       // 沒有活零件等 → 放棄接管

        return this.integrate(dt, moveDir);   // 撞牆時內部會 exitAir 並回傳 false
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

        // 初始旋轉量 = 核心當下角速度（度/秒），夾在上限內避免被彈飛打出超高速一直翻
        const coreRb = this.coreNode!.getComponent(cc.RigidBody);
        this.omega = cc.misc.clampf(coreRb ? coreRb.angularVelocity : 0, -AIRPHYS.MAX_SPIN, AIRPHYS.MAX_SPIN);
        this.rot = 0;

        // 記下各零件資訊並切成 Kinematic（Box2D 不再施力，純由本積分器擺放）
        this.parts.clear();
        for (let i = 0; i < bodies.length; i++) {
            const rb = bodies[i];
            const nd = rb.node;
            this.parts.set(nd, { ox: worlds[i].x - this.com.x, oy: worlds[i].y - this.com.y, angle0: nd.angle, type0: rb.type });
            rb.type = cc.RigidBodyType.Kinematic;
            rb.linearVelocity = cc.v2(0, 0);
            rb.angularVelocity = 0;
        }

        this.active = true;
    }

    // 回傳 true=已提交本幀擺放；false=偵測到要撞牆，已 exitAir 交回 Box2D
    private integrate(dt: number, moveDir: number): boolean {
        // 先算候選新狀態（先不寫進欄位）
        let newOmega = this.omega + AIRPHYS.ROT_INPUT * moveDir * dt;
        newOmega = cc.misc.clampf(newOmega, -AIRPHYS.MAX_SPIN, AIRPHYS.MAX_SPIN);
        newOmega *= Math.max(0, 1 - AIRPHYS.SPIN_DAMP * dt);
        const newRot = this.rot + newOmega * dt;

        // 下落：自由落體（只受空中重力，水平速度不變）
        const newComVel = cc.v2(this.comVel.x, this.comVel.y + AIRPHYS.GRAVITY_Y * dt);
        const newCom = cc.v2(this.com.x + newComVel.x * dt, this.com.y + newComVel.y * dt);

        const rad = newRot * DEG2RAD;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const pm = cc.director.getPhysicsManager();
        const bodies = this.livingBodies();

        // 掃掠檢查：任一零件 old→new 會穿過地板/邊界 → 交回 Box2D，不提交（避免穿模）
        for (const rb of bodies) {
            const nd = rb.node;
            const p = this.parts.get(nd);
            if (!p) continue;
            const oldW = nd.convertToWorldSpaceAR(cc.v2(0, 0));
            const rx = p.ox * cos - p.oy * sin;
            const ry = p.ox * sin + p.oy * cos;
            const newW = cc.v2(newCom.x + rx, newCom.y + ry);
            if (oldW.x === newW.x && oldW.y === newW.y) continue;
            const hits = pm.rayCast(oldW, newW, cc.RayCastType.All);
            for (const h of hits) {
                const g = h.collider.node.group;
                if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) { this.exitAir(); return false; }
            }
        }

        // 提交：寫欄位 + 逐幀剛體擺放（零件為 Kinematic，只跟著 transform 走）
        this.omega = newOmega;
        this.rot = newRot;
        this.comVel = newComVel;
        this.com = newCom;

        for (const rb of bodies) {
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
        return true;
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
            rb.linearVelocity = cc.v2(this.comVel.x - omegaRad * ry, this.comVel.y + omegaRad * rx);
            rb.angularVelocity = this.omega;
            rb.awake = true;
        });

        this.parts.clear();
        this.active = false;
    }
}
