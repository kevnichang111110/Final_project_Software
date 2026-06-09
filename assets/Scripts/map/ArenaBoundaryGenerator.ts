// map/ArenaBoundaryGenerator.ts
// 隨機生成「封閉環形邊界場」：不是完美圓形，而是帶有數個向內突起 (bump) 的橢圓環。
// 突起是平滑的（升餘弦），像斜坡一樣，配合 WallRide 讓玩家可以開著車沿牆騎上去、繞圈。
//
// 視覺：
//   - 邊界牆本體 = 深灰色實心帶 (內緣 → 外緣，厚度 = wallThickness)
//   - 牆外的虛空   = 淺灰色實心帶 (外緣 → 更外圈)
//   - 牆內 = 玩家場地，保持透明 (顯示場景背景)
//
// 物理：
//   - 碰撞面 = 內緣這條封閉 PhysicsChainCollider (loop)，車子在它裡面跑、撞它、沿它爬牆。
//   - group 預設 "default"：本專案 group-list 並沒有註冊 "boundary"，且 WallRide 同時認得 default。
//
// 用法：掛在一個空節點（建議放在 (0,0)）上，遊戲開始 start() 時自動生成。
// 想真的爬牆：把 core/GameConstants.ts 的 FLOW.USE_WALLRIDE 設成 true。

import { GROUP } from "../core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ArenaBoundaryGenerator extends cc.Component {
    // ---- 基本場地尺寸（超橢圓：可在「橢圓 ↔ 長方形」之間調）----
    @property({ tooltip: "場地水平半寬" })
    baseRadiusX: number = 660;
    @property({ tooltip: "場地垂直半高" })
    baseRadiusY: number = 380;
    @property({ tooltip: "形狀方正度：2 = 橢圓；越大越像長方形（圓角矩形）。建議 3~6" })
    rectSharpness: number = 4;
    @property({ tooltip: "整圈點數：越多越平滑、越吃效能" })
    segments: number = 200;
    @property({ tooltip: "輪廓平滑次數：把突起磨成圓滑小土丘（0 = 不平滑）" })
    smoothPasses: number = 2;

    // ---- 隨機向內突起 (bump，小土丘) ----
    @property({ tooltip: "最少突起數" })
    minBumps: number = 2;
    @property({ tooltip: "最多突起數" })
    maxBumps: number = 4;
    @property({ tooltip: "突起向內凸出的最小深度 (px)" })
    bumpMinHeight: number = 25;
    @property({ tooltip: "突起向內凸出的最大深度 (px)，太大會吃掉中間遊玩空間" })
    bumpMaxHeight: number = 70;
    @property({ tooltip: "單個突起的最小角寬 (度)，越大土丘越寬越緩、越好騎" })
    bumpMinWidthDeg: number = 40;
    @property({ tooltip: "單個突起的最大角寬 (度)" })
    bumpMaxWidthDeg: number = 80;

    // ---- 視覺：牆與牆外虛空 ----
    @property({ tooltip: "邊界牆的視覺厚度 (深灰色帶)" })
    wallThickness: number = 22;
    @property({ tooltip: "牆外淺灰色虛空往外延伸多遠（要夠大才能蓋滿畫面外側）" })
    voidExtend: number = 2000;
    @property({ tooltip: "邊界牆顏色（深灰）" })
    boundaryColor: cc.Color = cc.color(58, 60, 66);
    @property({ tooltip: "牆外虛空顏色（灰）" })
    voidColor: cc.Color = cc.color(165, 172, 181);
    @property({ tooltip: "視覺節點的 zIndex（越小越在底層，避免擋住車子）" })
    visualZIndex: number = -10;

    // ---- 場內隨機物件（蹺蹺板 / 方塊 / 彈簧…）----
    @property({ type: [cc.Prefab], tooltip: "可生成的物件 prefab 池（蹺蹺板 / 彈簧 / 平台…）隨機挑。留空則用內建方塊" })
    objectPrefabs: cc.Prefab[] = [];
    @property({ tooltip: "最少生成幾個物件" })
    minObjects: number = 2;
    @property({ tooltip: "最多生成幾個物件" })
    maxObjects: number = 4;
    @property({ tooltip: "物件離牆面的最小安全距離（避免長在牆裡）" })
    spawnMargin: number = 120;
    @property({ tooltip: "物件之間的最小間距" })
    minSpacing: number = 220;
    @property({ tooltip: "名稱含 spring 的物件是否貼到場地底部（其餘物件就地放置）" })
    springToFloor: boolean = true;
    @property({ tooltip: "避免把物件生成在玩家 / 電腦車的上方或身上" })
    avoidCars: boolean = true;
    @property({ tooltip: "與車的淨空半徑（物件中心要離任何車這麼遠）" })
    carClearRadius: number = 170;

    // ---- 物理 ----
    @property({ tooltip: "碰撞群組（本專案請用 default；WallRide 也認得它）" })
    group: string = "default";
    @property({ tooltip: "牆面摩擦力（爬牆吸地需要夠高）" })
    friction: number = 1.4;
    @property({ tooltip: "牆面彈性（建議 0，撞牆不亂彈）" })
    restitution: number = 0.0;

    @property({ tooltip: "亂數種子。0 = 每局不同；非 0 = 可重現同一張圖" })
    seed: number = 0;

    @property({ tooltip: "是否畫出內緣碰撞輪廓（除錯用）" })
    debugDraw: boolean = false;

    private rng: () => number = Math.random;

    start() {
        this.initRng();

        // 靜態剛體 + 群組
        const rb = this.getComponent(cc.RigidBody) || this.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        if (this.group) this.node.group = this.group;

        // 1) 生成內緣（含突起）的封閉點集 → 這就是碰撞面
        const inner = this.buildBoundaryPoints();
        const normals = this.outwardNormals(inner);

        const chain = this.addComponent(cc.PhysicsChainCollider);
        chain.loop = true;
        chain.points = inner;
        (chain as any).friction = this.friction;
        (chain as any).restitution = this.restitution;
        (chain as any).apply();

        // 2) 視覺：牆帶（深灰）＋ 牆外虛空（淺灰）
        this.drawArena(inner, normals);

        // 3) 場內隨機物件（蹺蹺板 / 方塊 / 彈簧…）
        this.spawnObjects(inner);

        if (this.debugDraw) this.drawOutline(inner);
    }

    // ---- 亂數（與 MapGenerator 同款 mulberry32 風格，種子可重現）----
    private initRng() {
        if (this.seed && this.seed !== 0) {
            let s = this.seed >>> 0;
            this.rng = () => {
                s |= 0; s = (s + 0x6D2B79F5) | 0;
                let t = Math.imul(s ^ (s >>> 15), 1 | s);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        } else {
            this.rng = Math.random;
        }
    }
    private rand(min: number, max: number): number { return min + this.rng() * (max - min); }
    private randInt(min: number, max: number): number { return Math.floor(this.rand(min, max + 1)); }

    // ---- 生成帶突起的內緣點 ----
    private buildBoundaryPoints(): cc.Vec2[] {
        // 先隨機決定每個突起：中心角、角寬（半寬，弧度）、深度
        const bumpCount = this.randInt(this.minBumps, this.maxBumps);
        const bumps: { center: number; halfWidth: number; height: number }[] = [];
        for (let k = 0; k < bumpCount; k++) {
            bumps.push({
                center: this.rand(0, Math.PI * 2),
                halfWidth: this.rand(this.bumpMinWidthDeg, this.bumpMaxWidthDeg) * Math.PI / 180,
                height: this.rand(this.bumpMinHeight, this.bumpMaxHeight),
            });
        }

        // 超橢圓指數：2 = 橢圓，越大越方（圓角矩形）
        const n = Math.max(2, this.rectSharpness);
        const e = 2 / n;

        const pts: cc.Vec2[] = [];
        for (let i = 0; i < this.segments; i++) {
            const theta = (i / this.segments) * Math.PI * 2;

            // 超橢圓上的基準點：|x/a|^n + |y/b|^n = 1
            const ct = Math.cos(theta), st = Math.sin(theta);
            const px = this.baseRadiusX * (ct >= 0 ? 1 : -1) * Math.pow(Math.abs(ct), e);
            const py = this.baseRadiusY * (st >= 0 ? 1 : -1) * Math.pow(Math.abs(st), e);

            // 累加所有突起在此角度造成的「向內位移」（平滑升餘弦）
            let inset = 0;
            for (const b of bumps) {
                const d = this.angularDist(theta, b.center);
                if (d < b.halfWidth) {
                    inset += b.height * 0.5 * (1 + Math.cos(Math.PI * d / b.halfWidth));
                }
            }

            // 沿半徑方向往內縮 inset（保底不要縮過頭，避免穿過中心）
            const r = Math.hypot(px, py) || 1;
            const scale = Math.max(0.2, (r - inset) / r);
            pts.push(cc.v2(px * scale, py * scale));
        }

        return this.smooth(pts, this.smoothPasses);
    }

    // 對封閉折線做數次鄰點平均：把尖刺磨成圓滑小土丘（保留整體形狀）
    private smooth(pts: cc.Vec2[], passes: number): cc.Vec2[] {
        const n = pts.length;
        let cur = pts;
        for (let p = 0; p < passes; p++) {
            const next: cc.Vec2[] = [];
            for (let i = 0; i < n; i++) {
                const a = cur[(i - 1 + n) % n], b = cur[i], c = cur[(i + 1) % n];
                // b 與左右鄰點各取一半權重平均（0.5 中心 + 0.25/0.25 鄰點）
                next.push(cc.v2(b.x * 0.5 + (a.x + c.x) * 0.25, b.y * 0.5 + (a.y + c.y) * 0.25));
            }
            cur = next;
        }
        return cur;
    }

    // 兩個角度的最短角距 [0, PI]
    private angularDist(a: number, b: number): number {
        let d = Math.abs(a - b) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d;
    }

    // ---- 視覺：把牆與虛空畫成實心帶 ----
    private drawArena(inner: cc.Vec2[], normals: cc.Vec2[]) {
        const n = inner.length;

        // 外緣（牆的外邊） & 更外圈（虛空外邊）
        const outer: cc.Vec2[] = [];
        const far: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const p = inner[i], nm = normals[i];
            outer.push(cc.v2(p.x + nm.x * this.wallThickness, p.y + nm.y * this.wallThickness));
            far.push(cc.v2(
                p.x + nm.x * (this.wallThickness + this.voidExtend),
                p.y + nm.y * (this.wallThickness + this.voidExtend),
            ));
        }

        // 牆外虛空（淺灰）放最底層，牆本體（深灰）疊在上面
        this.fillBand(outer, far, this.voidColor, "arenaVoid", this.visualZIndex - 1);
        this.fillBand(inner, outer, this.boundaryColor, "arenaWall", this.visualZIndex);
    }

    // 每個頂點朝外的單位法線（以原點為內側基準校正方向）
    private outwardNormals(pts: cc.Vec2[]): cc.Vec2[] {
        const n = pts.length;
        const out: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const next = pts[(i + 1) % n];
            // 邊切線 → 法線（垂直）
            let nx = next.y - prev.y;
            let ny = -(next.x - prev.x);
            const len = Math.hypot(nx, ny) || 1;
            nx /= len; ny /= len;
            // 校正成「朝外」（與從中心指向該點同向）
            if (nx * pts[i].x + ny * pts[i].y < 0) { nx = -nx; ny = -ny; }
            out.push(cc.v2(nx, ny));
        }
        return out;
    }

    // 在兩條封閉折線 a(內) / b(外) 之間填滿一圈實心帶
    private fillBand(a: cc.Vec2[], b: cc.Vec2[], color: cc.Color, name: string, z: number) {
        const node = new cc.Node(name);
        node.parent = this.node;
        node.setPosition(0, 0);
        node.zIndex = z;

        const g = node.addComponent(cc.Graphics);
        g.fillColor = color;

        const n = a.length;
        // 用一致繞向的四邊形累積成路徑，最後一次 fill：同向繞 → nonzero 填滿不留洞
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            g.moveTo(a[i].x, a[i].y);
            g.lineTo(a[j].x, a[j].y);
            g.lineTo(b[j].x, b[j].y);
            g.lineTo(b[i].x, b[i].y);
            g.close();
        }
        g.fill();
    }

    // ---- 場內隨機物件 ----
    private spawnObjects(inner: cc.Vec2[]) {
        if (this.maxObjects <= 0) return;

        // 用真實內緣的包圍盒做拒絕取樣（不對多邊形做外擴，避免突起凹處自相交產生假內部）
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of inner) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        if (maxX <= minX || maxY <= minY) return;

        // 先收集玩家 / 電腦車目前的位置（在本節點座標系），避免把物件生成在車上/車的上方
        const cars = this.avoidCars ? this.collectCarPositions() : [];

        const count = this.randInt(this.minObjects, this.maxObjects);
        const used: cc.Vec2[] = [];

        for (let k = 0; k < count; k++) {
            // 隨機找一個「在牆內、離牆夠遠、不壓到車、且與其他物件不太近」的點
            let px = 0, py = 0, ok = false;
            for (let tries = 0; tries < 40; tries++) {
                px = this.rand(minX, maxX);
                py = this.rand(minY, maxY);
                if (!this.pointInPolygon(px, py, inner)) continue;          // 必須在牆內
                if (this.distToBoundary(px, py, inner) < this.spawnMargin) continue; // 離牆夠遠（突起凹處也正確）
                if (cars.some(c => Math.hypot(c.x - px, c.y - py) < this.carClearRadius)) continue; // 下面/附近沒有車
                if (used.every(u => Math.hypot(u.x - px, u.y - py) >= this.minSpacing)) { ok = true; break; }
            }
            if (!ok) continue;
            used.push(cc.v2(px, py));

            if (this.objectPrefabs && this.objectPrefabs.length > 0) {
                const prefab = this.objectPrefabs[this.randInt(0, this.objectPrefabs.length - 1)];
                if (!prefab) continue;
                const node = cc.instantiate(prefab);
                node.parent = this.node;

                // 彈簧類物件貼到場地底部（其餘就地放置）
                if (this.springToFloor && node.name.toLowerCase().includes("spring")) {
                    const floorY = this.getFloorYAt(px, inner);
                    node.setPosition(px, floorY + node.height / 2);
                } else {
                    node.setPosition(px, py);
                }
            } else {
                this.makeDefaultBlock(px, py);
            }
        }
    }

    // 收集場上玩家 / 電腦車各部件的位置（轉成本節點座標系）
    // 車在 BattleManager.onLoad 就建好了，早於本元件的 start()，所以這裡抓得到。
    private collectCarPositions(): cc.Vec2[] {
        const out: cc.Vec2[] = [];
        const scene = cc.director.getScene();
        if (!scene) return out;
        scene.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            const nd = rb.node;
            if (!nd || !nd.isValid) return;
            const g = nd.group || "";
            // group 名稱含 PLAYER / BOT 的都算車（PLAYER_PART / BOT_PART / *_BODY…）
            if (g.indexOf(GROUP.PLAYER_KEY) >= 0 || g.indexOf(GROUP.BOT_KEY) >= 0) {
                const world = nd.convertToWorldSpaceAR(cc.v2(0, 0));
                out.push(this.node.convertToNodeSpaceAR(world));
            }
        });
        return out;
    }

    // 偶奇射線法：點是否在多邊形內
    private pointInPolygon(px: number, py: number, poly: cc.Vec2[]): boolean {
        let inside = false;
        const n = poly.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            const hit = ((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (hit) inside = !inside;
        }
        return inside;
    }

    // 點到整條封閉折線的最短距離（取所有邊的最小點-線段距離）
    private distToBoundary(px: number, py: number, poly: cc.Vec2[]): number {
        let best = Infinity;
        const n = poly.length;
        for (let i = 0; i < n; i++) {
            const d = this.pointSegDist(px, py, poly[i], poly[(i + 1) % n]);
            if (d < best) best = d;
        }
        return best;
    }

    // 點到單一線段的最短距離
    private pointSegDist(px: number, py: number, a: cc.Vec2, b: cc.Vec2): number {
        const vx = b.x - a.x, vy = b.y - a.y;
        const len2 = vx * vx + vy * vy || 1e-6;
        let t = ((px - a.x) * vx + (py - a.y) * vy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
    }

    // 場地底部：垂直線 x 與內緣的最低交點（彈簧用來貼地）
    private getFloorYAt(x: number, inner: cc.Vec2[]): number {
        let bestY: number | null = null;
        const n = inner.length;
        for (let i = 0; i < n; i++) {
            const p1 = inner[i], p2 = inner[(i + 1) % n];
            const lo = Math.min(p1.x, p2.x), hi = Math.max(p1.x, p2.x);
            if (x < lo || x > hi || hi - lo < 0.001) continue;
            const t = (x - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            if (bestY === null || y < bestY) bestY = y;
        }
        return bestY === null ? -this.baseRadiusY : bestY;
    }

    // 內建後備方塊：留空 prefab 池時用的靜態平台
    private makeDefaultBlock(x: number, y: number) {
        const node = new cc.Node("platform");
        node.parent = this.node;
        node.setPosition(x, y);

        const w = 180, h = 24;
        const rb = node.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        node.group = this.group;

        const box = node.addComponent(cc.PhysicsBoxCollider);
        box.size = cc.size(w, h);
        (box as any).friction = 1.0;
        (box as any).restitution = 0.0;
        (box as any).apply();

        const g = node.addComponent(cc.Graphics);
        g.fillColor = cc.color(150, 160, 175);
        g.strokeColor = cc.color(70, 80, 95);
        g.lineWidth = 3;
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        g.stroke();
    }

    // ---- 除錯：畫出內緣碰撞輪廓 ----
    private drawOutline(points: cc.Vec2[]) {
        const node = new cc.Node("arenaOutline");
        node.parent = this.node;
        node.setPosition(0, 0);
        node.zIndex = this.visualZIndex + 1;
        const g = node.addComponent(cc.Graphics);
        g.lineWidth = 3;
        g.strokeColor = cc.color(120, 200, 255, 220);
        points.forEach((p, i) => { if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
        g.close();
        g.stroke();
    }
}
