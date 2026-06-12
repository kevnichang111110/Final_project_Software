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

    // 地圖邊界多邊形（≈世界座標），由 BattleManager 載圖後傳入，用來把車夾在場內、避免飛出地圖。
    private boundary: cc.Vec2[] = [];
    setBoundary(pts: cc.Vec2[]) { this.boundary = pts || []; }

    private pointInPolygon(x: number, y: number): boolean {
        const b = this.boundary;
        let inside = false;
        for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
            const xi = b[i].x, yi = b[i].y, xj = b[j].x, yj = b[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    // 候選質心 (candX,candY) 是否會撞到障礙物或衝出地圖邊界。
    // fromX,fromY = 移動前質心（掃掠射線起點），cos/sin = 當前車身旋轉。
    // 逐零件：先看候選位置是否出界，再從「移動前 → 候選」掃一條射線並多延伸半個零件尺寸，
    // 讓零件「邊緣」停在障礙表面外，而不是中心點直接穿進去。只攔地面/邊界群組，無視子彈與另一台車。
    private blocked(candX: number, candY: number, fromX: number, fromY: number, cos: number, sin: number): boolean {
        const pm = cc.director.getPhysicsManager();
        for (const rb of this.livingBodies()) {
            const p = this.parts.get(rb.node);
            if (!p) continue;
            const rx = p.ox * cos - p.oy * sin;
            const ry = p.ox * sin + p.oy * cos;

            // 出界：候選位置跑到場外
            if (this.boundary.length >= 3 && !this.pointInPolygon(candX + rx, candY + ry)) return true;

            // 障礙物掃掠
            const from = cc.v2(fromX + rx, fromY + ry);
            const to = cc.v2(candX + rx, candY + ry);
            const d = to.sub(from);
            const dist = d.mag();
            if (dist <= 0.0001) continue;   // 該軸沒位移就不用掃
            const half = Math.max(rb.node.width, rb.node.height, 40) * 0.5;
            const end = from.add(d.mul((dist + half) / dist));   // 多延伸半個零件尺寸
            const results = pm.rayCast(from, end, cc.RayCastType.All);
            for (const r of results) {
                const g = r.collider.node.group;
                if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) return true;
            }
        }
        return false;
    }

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

        const rad = this.rot * DEG2RAD;
        const cos = Math.cos(rad), sin = Math.sin(rad);

        // 下落：自由落體 + 逐軸碰撞解析（先 Y 後 X）。
        // 之前只夾「地圖邊界」，沒擋障礙物 → Kinematic 零件被 setPosition 直接擺位、
        // Box2D 無法阻擋 → 穿過障礙物，落地時又卡在物件裡。這裡改成移動前先掃掠射線，
        // 撞到障礙/出界就停在該軸原地（會貼著障礙表面），讓落地交接乾淨。
        let velX = this.comVel.x;
        let velY = this.comVel.y + AIRPHYS.GRAVITY_Y * dt;

        // Y 軸：先試垂直移動，撞到就停在障礙頂端（或底面），該軸速度歸零
        let comY = this.com.y + velY * dt;
        if (this.blocked(this.com.x, comY, this.com.x, this.com.y, cos, sin)) {
            comY = this.com.y; velY = 0;
        }
        // X 軸：用已解析的 Y 再試水平移動 → 沿障礙表面滑動，不會整台凍在半空
        let comX = this.com.x + velX * dt;
        if (this.blocked(comX, comY, this.com.x, comY, cos, sin)) {
            comX = this.com.x; velX = 0;
        }

        this.com.x = comX; this.com.y = comY;
        this.comVel.x = velX; this.comVel.y = velY;

        // 剛體擺放：整車繞質心旋轉 rot 度（零件為 Kinematic，只跟著 transform 走）
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

            // 如果該零件群組已經不是車體不要再把它當作車體的一部分還原
            if (nd.group !== this.partGroup) return;

            const rb = nd.getComponent(cc.RigidBody);
            if (!rb) return;

            const rx = p.ox * cos - p.oy * sin;
            const ry = p.ox * sin + p.oy * cos;

            rb.type = p.type0;
            rb.enabledContactListener = true;
            rb.linearVelocity = cc.v2(this.comVel.x - omegaRad * ry, this.comVel.y + omegaRad * rx);
            rb.angularVelocity = this.omega;
            rb.awake = true;
        });

        this.parts.clear();
        this.active = false;
    }
}
