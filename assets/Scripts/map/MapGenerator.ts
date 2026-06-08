// map/MapGenerator.ts
// 依「事先設定好的範本參數」隨機生成地圖：
//   1. 地面外框：stadium 形狀（上下平整、左右半圓的膠囊），用封閉 PhysicsChainCollider 鋪成。
//   2. 下方地板中間有一個小突起（位置可固定或隨機）。
//   3. 場地中間隨機生成數個物件（從你給的 prefab 池隨機挑，例如蹺蹺板 / 平台）。
//   4. 彈簧 (spring) 會自動偵測膠囊地板與突起的高度，完美貼地。

const { ccclass, property } = cc._decorator;

@ccclass
export default class MapGenerator extends cc.Component {
    // ---- 外框（膠囊：上下平、左右半圓）----
    @property({ tooltip: "上下平整段的長度（不含左右半圓）" })
    straightWidth: number = 1400;
    @property({ tooltip: "上下地板的垂直間距（= 2 倍的半圓半徑）" })
    gapHeight: number = 700;
    @property({ tooltip: "左右半圓的點數（越多越平滑）" })
    capSegments: number = 32; // 稍微提高點數讓物理平滑一點
    @property({ tooltip: "碰撞群組（WallRide 認得 default / BOUNDARY）" })
    group: string = "default";
    @property({ type: cc.Node, tooltip: "手繪的綠色山坡地 (floor)" })
    floorNode: cc.Node = null; 
    private floorPoints: cc.Vec2[] = [];

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
    @property({ tooltip: "彈簧高度修正（如果浮空或埋入，請微調此數值）" })
    springYOffset: number = -111.628; // 為啥會需要這個offset 救命

    @property({ tooltip: "亂數種子。0 = 每局不同；非 0 = 可重現同一張圖" })
    seed: number = 0;

    @property({ tooltip: "是否畫出邊界輪廓（測試用）" })
    debugDraw: boolean = true;

    private rng: () => number = Math.random;
    private mapPoints: cc.Vec2[] = []; // 用來儲存外框點，給彈簧偵測用

    start() {
        this.initRng();

        // 靜態剛體 + 群組
        const rb = this.getComponent(cc.RigidBody) || this.addComponent(cc.RigidBody);
        rb.type = cc.RigidBodyType.Static;
        if (this.group) this.node.group = this.group;

        // 呼叫組員寫好的膠囊生成演算法
        const points = this.buildStadiumPoints();
        this.mapPoints = points; // 存起來

        const chain = this.addComponent(cc.PhysicsChainCollider);
        chain.loop = true;
        chain.points = points;
        
        // === 加入我們之前討論好的：賦予外框高摩擦力與零彈性 ===
        (chain as any).friction = 1.5;
        (chain as any).restitution = 0.0;
        
        (chain as any).apply();

        // === 新增：讀取綠色山坡地的碰撞點 ===
        if (this.floorNode) {
            const collider = this.floorNode.getComponent(cc.PhysicsChainCollider);
            if (collider && collider.points) {
                this.floorPoints = collider.points;
            }
        }

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

    // ---- 原汁原味的外框點生成 (組員寫的) ----
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

    // === 新增：根據外框點，精算出該 X 座標的底部高度 ===
    // === 升級版：優先偵測山坡地，其次才是藍色外框 ===
    private getFloorYAt(x: number): number {
        // 1. 先掃描有沒有綠色山坡地 (floorNode) 擋在上面
        if (this.floorPoints && this.floorPoints.length > 0) {
            for (let i = 0; i < this.floorPoints.length - 1; i++) {
                const p1 = this.floorPoints[i];
                const p2 = this.floorPoints[i + 1];
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);

                if (x >= minX && x <= maxX) {
                    if (maxX - minX < 0.01) return Math.max(p1.y, p2.y) + (this.floorNode ? this.floorNode.y : 0);
                    const t = (x - p1.x) / (p2.x - p1.x);
                    const localY = p1.y + t * (p2.y - p1.y);
                    // 算出山坡地高度後，要加上 node 本身的 Y 軸偏移量
                    return localY + (this.floorNode ? this.floorNode.y : 0);
                }
            }
        }

        // 2. 如果 X 座標超出了山坡地的範圍（或是根本沒放山坡地），退而求其次抓底部的藍色外框
        if (!this.mapPoints || this.mapPoints.length === 0) return -this.gapHeight / 2;

        for (let i = 0; i < this.mapPoints.length; i++) {
            const p1 = this.mapPoints[i];
            const p2 = this.mapPoints[(i + 1) % this.mapPoints.length];

            if (p1.y <= 0 && p2.y <= 0) {
                const minX = Math.min(p1.x, p2.x);
                const maxX = Math.max(p1.x, p2.x);
                if (x >= minX && x <= maxX) {
                    if (maxX - minX < 0.01) return Math.max(p1.y, p2.y);
                    const t = (x - p1.x) / (p2.x - p1.x);
                    return p1.y + t * (p2.y - p1.y);
                }
            }
        }
        return -this.gapHeight / 2;
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
                
                // === 彈簧判斷邏輯 ===
                // === 終極精準貼地邏輯 ===
                if (node.name.toLowerCase().includes("spring")) {
                    // 1. 取得地形表面在「floorNode 內部」的座標 (localY)
                    const localY = this.getFloorYAt(x);
                    
                    // 2. 將這個點從 floorNode 的座標系，轉換到 Map 節點 (this.node) 的座標系
                    // 這一步會自動處理所有的錨點和位置位移，非常精準
                    const worldPos = this.floorNode.convertToWorldSpaceAR(cc.v2(x, localY));
                    const localPos = this.node.convertToNodeSpaceAR(worldPos);

                    // 3. 設定彈簧位置：直接使用轉換後的 localPos
                    // 如果它還是浮空，我們就手動把 node.height / 2 拿掉或調小
                    const visualOffset = -111.628; // 從 0 開始試
                    node.setPosition(localPos.x, localPos.y + (node.height / 2) + this.springYOffset);
                } else {
                    node.setPosition(x, y);
                }
            } else {
                this.makeDefaultPlatform(x, y);
            }
        }
    }

    // 內建後備平台：靜態方塊
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
        
        // 賦予預設平台一點摩擦力
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

    // ---- 邊界輪廓 ----
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