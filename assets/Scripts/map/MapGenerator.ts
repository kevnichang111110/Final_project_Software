// map/MapGenerator.ts
// 依「事先設定好的範本參數」隨機生成地圖：
//   1. 地面外框：stadium 形狀（上下平整、左右半圓的膠囊），用封閉 PhysicsChainCollider 鋪成。
//   2. 下方地板中間有一個小突起（位置可固定或隨機）。
//   3. 場地中間隨機生成數個物件（從你給的 prefab 池隨機挑，例如蹺蹺板 / 平台）。
//
// 掛在一個空節點（Map）上即可。搭配 WallRide：邊界 group 維持 default / BOUNDARY，車才繞得了一圈。
// 想要可重現的隨機就設定 seed（非 0）。

const { ccclass, property } = cc._decorator;

// FIXME: 目前需要重構，而且畫出來的圖車子爬不上去

@ccclass
export default class MapGenerator extends cc.Component {
    // ---- 外框（膠囊：上下平、左右半圓）----
    @property({ tooltip: "上下平整段的長度（不含左右半圓）" })
    straightWidth: number = 1400;
    @property({ tooltip: "上下地板的垂直間距（= 2 倍的半圓半徑）" })
    gapHeight: number = 700;
    @property({ tooltip: "左右半圓的點數（越多越平滑）" })
    capSegments: number = 16;
    @property({ tooltip: "碰撞群組（WallRide 認得 default / BOUNDARY）" })
    group: string = "default";

    // ---- 地板小突起 ----
    @property({ tooltip: "突起寬度（0 = 不要突起）" })
    bumpWidth: number = 160;
    @property({ tooltip: "突起高度（往場地內凸）" })
    bumpHeight: number = 60;
    @property({ tooltip: "突起 X 是否隨機；關閉則用 bumpX" })
    bumpRandomX: boolean = true;
    @property({ tooltip: "固定突起 X（bumpRandomX 關閉時用）" })
    bumpX: number = 0;

    // ---- 中間隨機物件 ----
    @property({ type: [cc.Prefab], tooltip: "可生成的物件 prefab 池（蹺蹺板 / 平台…）隨機挑。留空則用內建平台" })
    objectPrefabs: cc.Prefab[] = [];
    @property({ tooltip: "最少生成幾個" })
    minObjects: number = 2;
    @property({ tooltip: "最多生成幾個" })
    maxObjects: number = 4;
    @property({ tooltip: "物件離左右兩端的邊距" })
    spawnMarginX: number = 250;
    @property({ tooltip: "物件生成帶的半高（圍繞中心 y 上下這麼多內隨機）" })
    spawnBandY: number = 180;
    @property({ tooltip: "物件之間最小水平間距" })
    minSpacingX: number = 280;

    @property({ tooltip: "亂數種子。0 = 每局不同；非 0 = 可重現同一張圖" })
    seed: number = 0;

    @property({ tooltip: "是否畫出邊界輪廓（測試用）" })
    debugDraw: boolean = true;

    private rng: () => number = Math.random;

    start() {
        this.initRng();

        // 靜態剛體 + 群組
        const rb = this.getComponent(cc.RigidBody) || this.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        if (this.group) this.node.group = this.group;

        const points = this.buildStadiumPoints();
        const chain = this.addComponent(cc.PhysicsChainCollider);
        chain.loop = true;
        chain.points = points;
        (chain as any).apply();

        if (this.debugDraw) this.drawOutline(points);

        this.spawnMiddleObjects();
    }

    // ---- 亂數 ----
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
    private randInt(n: number): number { return Math.floor(this.rng() * n); }

    // ---- 外框點 ----
    private buildStadiumPoints(): cc.Vec2[] {
        const r = this.gapHeight / 2;
        const hs = this.straightWidth / 2;
        const pts: cc.Vec2[] = [];

        // 下方地板（左 → 右），中間插入突起
        pts.push(cc.v2(-hs, -r));
        if (this.bumpWidth > 0 && this.bumpHeight > 0) {
            const bx = this.bumpRandomX
                ? this.rand(-hs + this.bumpWidth, hs - this.bumpWidth)
                : this.bumpX;
            pts.push(cc.v2(bx - this.bumpWidth / 2, -r));
            pts.push(cc.v2(bx, -r + this.bumpHeight));   // 突起頂點（往場地內凸）
            pts.push(cc.v2(bx + this.bumpWidth / 2, -r));
        }
        pts.push(cc.v2(hs, -r));

        // 右半圓（下 → 上）：圓心 (hs, 0)，角度 -90° → +90°
        for (let i = 1; i < this.capSegments; i++) {
            const a = (-90 + 180 * i / this.capSegments) * Math.PI / 180;
            pts.push(cc.v2(hs + Math.cos(a) * r, Math.sin(a) * r));
        }

        // 上方天花板（右 → 左）
        pts.push(cc.v2(hs, r));
        pts.push(cc.v2(-hs, r));

        // 左半圓（上 → 下）：圓心 (-hs, 0)，角度 90° → 270°
        for (let i = 1; i < this.capSegments; i++) {
            const a = (90 + 180 * i / this.capSegments) * Math.PI / 180;
            pts.push(cc.v2(-hs + Math.cos(a) * r, Math.sin(a) * r));
        }

        return pts;   // loop = true 會自動接回起點
    }

    // ---- 中間隨機物件 ----
    private spawnMiddleObjects() {
        const hs = this.straightWidth / 2;
        const minX = -hs + this.spawnMarginX;
        const maxX = hs - this.spawnMarginX;
        if (maxX <= minX) return;

        const count = this.minObjects + this.randInt(Math.max(1, this.maxObjects - this.minObjects + 1));
        const usedX: number[] = [];

        for (let k = 0; k < count; k++) {
            // 找一個跟其他物件不要太近的 x（試幾次）
            let x = 0, ok = false;
            for (let tries = 0; tries < 12; tries++) {
                x = this.rand(minX, maxX);
                if (usedX.every(ux => Math.abs(ux - x) >= this.minSpacingX)) { ok = true; break; }
            }
            if (!ok) continue;
            usedX.push(x);

            const y = this.rand(-this.spawnBandY, this.spawnBandY);

            if (this.objectPrefabs && this.objectPrefabs.length > 0) {
                const prefab = this.objectPrefabs[this.randInt(this.objectPrefabs.length)];
                if (!prefab) continue;
                const node = cc.instantiate(prefab);
                node.parent = this.node;
                node.setPosition(x, y);
            } else {
                this.makeDefaultPlatform(x, y);   // 沒給 prefab 就放內建靜態平台
            }
        }
    }

    // 內建後備平台：靜態方塊（沒提供 prefab 時用）
    private makeDefaultPlatform(x: number, y: number) {
        const node = new cc.Node("platform");
        node.parent = this.node;
        node.setPosition(x, y);

        const w = 180, h = 24;
        const rb = node.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        node.group = this.group;

        const box = node.addComponent(cc.PhysicsBoxCollider);
        box.size = cc.size(w, h);
        (box as any).apply();

        const g = node.addComponent(cc.Graphics);
        g.fillColor = cc.color(150, 160, 175);
        g.strokeColor = cc.color(70, 80, 95);
        g.lineWidth = 3;
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();
        g.stroke();
    }

    // ---- 邊界輪廓（測試用）----
    private drawOutline(points: cc.Vec2[]) {
        const n = new cc.Node("mapOutline");
        n.parent = this.node;
        n.setPosition(0, 0);
        const g = n.addComponent(cc.Graphics);
        g.lineWidth = 4;
        g.strokeColor = cc.color(120, 200, 255, 200);
        points.forEach((p, i) => { if (i === 0) g.moveTo(p.x, p.y); else g.lineTo(p.x, p.y); });
        g.close();
        g.stroke();
    }
}