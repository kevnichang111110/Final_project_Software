// map/MapLoader.ts
// 「預設地圖載入器」：取代隨機程序生成的地圖（ArenaBoundaryGenerator / MapGenerator）。
//
// 設計理念：地圖外框「邊界」由設計師在編輯器裡手畫成 prefab（一條封閉的 PhysicsChainCollider），
// 本元件每局隨機挑一張 prefab 實例化；物件（蹺蹺板 / 彈簧 / 方塊）則仍然隨機生成。
//
// 物件生成有兩種模式（spawnMode 切換，編輯器設定）：
//   - Auto    ：在邊界多邊形內「拒絕取樣」隨機灑點（離牆夠遠、不壓車、彼此不重疊）。
//   - Markers ：只生在設計師預先擺好的標記點（prefab 內 "SpawnPoints" 底下的空節點）上。
//
// 一張地圖 prefab 怎麼畫（編輯器步驟）：
//   1) 建一個空節點放 (0,0)，底下加子節點命名 "Boundary"。
//   2) 在 Boundary 上加 RigidBody(Static)，節點 group = default；加 PhysicsChainCollider，
//      loop = true，friction 1.4，restitution 0；點「Edit」在場景裡拖點畫出封閉外框。
//   3) 視覺：autoDrawVisuals 開著就由本元件依邊界點自動畫深灰牆＋淺灰虛空；
//      想自己畫就把 autoDrawVisuals 關掉，在 prefab 裡自行擺 Graphics / Sprite。
//   4) （Markers 模式）加子節點 "SpawnPoints"，底下擺幾個空節點當生成點。
//   5) 把根節點拖進 assets/prefab/ 變成 prefab，重複做出多張地圖。
//   6) 場景裡用掛了本元件的節點取代舊的 MapGenerator，把多張 prefab 填進 maps。

import { GROUP } from "../core/GameConstants";

const { ccclass, property } = cc._decorator;

const SpawnMode = cc.Enum({ Auto: 0, Markers: 1 });

@ccclass
export default class MapLoader extends cc.Component {
    // ---- 預設地圖 ----
    @property({ type: [cc.Prefab], tooltip: "可隨機挑選的地圖 prefab 池（每局挑一張）" })
    maps: cc.Prefab[] = [];
    @property({ type: SpawnMode, tooltip: "物件生成模式：Auto = 邊界內隨機灑；Markers = 只在預設標記點生成" })
    spawnMode = SpawnMode.Auto;
    @property({ tooltip: "邊界碰撞節點的名稱（找不到就退而取面積最大的那條 PhysicsChainCollider）" })
    boundaryNodeName: string = "Boundary";
    @property({ tooltip: "Markers 模式：放生成標記點的父節點名稱（其直接子節點 = 各標記點）" })
    markerParentName: string = "SpawnPoints";

    // ---- 場內隨機物件 ----
    @property({ type: [cc.Prefab], tooltip: "可生成的物件 prefab 池（蹺蹺板 / 彈簧 / 平台…）隨機挑。留空則用內建方塊" })
    objectPrefabs: cc.Prefab[] = [];
    @property({ tooltip: "最少生成幾個物件" })
    minObjects: number = 2;
    @property({ tooltip: "最多生成幾個物件" })
    maxObjects: number = 4;
    @property({ tooltip: "Auto：物件離牆面的最小安全距離（避免長在牆裡）" })
    spawnMargin: number = 120;
    @property({ tooltip: "Auto：物件之間的最小間距" })
    minSpacing: number = 220;
    @property({ tooltip: "名稱含 spring 的物件是否貼到場地底部（其餘物件就地放置）" })
    springToFloor: boolean = true;
    @property({ tooltip: "避免把物件生成在玩家 / 電腦車的上方或身上" })
    avoidCars: boolean = true;
    @property({ tooltip: "與車的淨空半徑（物件中心要離任何車這麼遠）" })
    carClearRadius: number = 170;

    // ---- 視覺：牆與牆外虛空（依邊界點自動畫）----
    @property({ tooltip: "是否依邊界點自動畫深灰牆＋淺灰虛空（關掉就用 prefab 內自畫的美術）" })
    autoDrawVisuals: boolean = true;
    @property({ tooltip: "邊界牆的視覺厚度 (深灰色帶)" })
    wallThickness: number = 10;
    @property({ tooltip: "牆外淺灰色虛空往外延伸多遠（要夠大才能蓋滿畫面外側）" })
    voidExtend: number = 2000;
    @property({ tooltip: "道路路面 / 邊界顏色（中灰）" })
    boundaryColor: cc.Color = cc.color(120, 125, 132);
    @property({ tooltip: "牆外虛空顏色（深灰）" })
    voidColor: cc.Color = cc.color(50, 52, 58);
    @property({ type: cc.SpriteFrame, tooltip: "牆外虛空的石頭貼圖（留空＝維持原本 voidColor 純色填充）" })
    voidTexture: cc.SpriteFrame | null = null;
    @property({ tooltip: "視覺節點的 zIndex（越小越在底層，避免擋住車子）" })
    visualZIndex: number = -10;

    // ---- 物理（僅內建後備方塊用）----
    @property({ tooltip: "後備方塊的碰撞群組（本專案請用 default）" })
    group: string = "default";

    @property({ tooltip: "亂數種子。0 = 每局不同；非 0 = 可重現同一張圖（含選到哪張地圖）" })
    seed: number = 0;

    private rng: () => number = Math.random;
    private current: cc.Node | null = null;   // 目前載入的地圖實例（連同視覺與物件都掛在它底下）
    private boundaryPoints: cc.Vec2[] = [];    // 目前地圖邊界多邊形（≈世界座標），供外部（AirPhysics）取用

    // 目前地圖的邊界多邊形點（≈世界座標）。沒有地圖時回傳空陣列。
    public getBoundary(): cc.Vec2[] { return this.boundaryPoints; }

    start() {
        // BattleManager 若有綁定 mapLoader，會在 onLoad 階段先呼叫 loadRandomMap()；
        // 那時 current 已設定，這裡就不重複載入。沒綁定時才由這裡載入第一張。
        if (!this.current) this.loadRandomMap();
    }

    // ====================================================================
    // 核心：清掉舊地圖 → 隨機挑一張 → 讀邊界 → 畫視覺 → 生成物件
    // ====================================================================
    loadRandomMap() {
        this.initRng();

        // 1) 清掉上一張（視覺與物件都掛在 current 底下，一次銷毀全清乾淨）
        if (this.current && this.current.isValid) this.current.destroy();
        this.current = null;

        if (!this.maps || this.maps.length === 0) {
            cc.warn("[MapLoader] maps 為空，沒有可載入的地圖 prefab");
            return;
        }

        // 2) 隨機挑一張並實例化
        const prefab = this.maps[this.randInt(0, this.maps.length - 1)];
        if (!prefab) return;
        const map = cc.instantiate(prefab);
        map.parent = this.node;
        map.setPosition(0, 0);
        this.current = map;

        // 3) 找邊界、讀點（轉成 current 的本地座標；map 在原點 → 約等於世界座標）
        const inner = this.readBoundaryPoints(map);
        if (!inner || inner.length < 3) {
            cc.warn(`[MapLoader] 地圖「${prefab.name}」找不到有效的邊界 PhysicsChainCollider`);
            return;
        }
        this.boundaryPoints = inner;   // 供 AirPhysics 把車夾在場內用

        // 4) 視覺
        if (this.autoDrawVisuals) this.drawArena(inner, this.outwardNormals(inner));

        // 5) 物件
        if (this.spawnMode === SpawnMode.Markers) this.spawnAtMarkers(map, inner);
        else this.spawnAuto(inner);
    }

    // ---- 從地圖實例讀出邊界多邊形（轉成 current 本地座標）----
    private readBoundaryPoints(map: cc.Node): cc.Vec2[] | null {
        let chain = this.findBoundaryChain(map);
        if (!chain) return null;

        const node = chain.node;
        const pts: cc.Vec2[] = [];
        for (const p of chain.points) {
            // chain.points 在 collider 節點本地座標 → 世界 → current 本地
            const world = node.convertToWorldSpaceAR(cc.v2(p.x, p.y));
            pts.push(map.convertToNodeSpaceAR(world));
        }
        return pts;
    }

    // 優先取名稱符合 boundaryNodeName 的節點上的鏈條；否則取所有鏈條中包圍盒面積最大者
    private findBoundaryChain(map: cc.Node): cc.PhysicsChainCollider | null {
        const named = this.findChildByName(map, this.boundaryNodeName);
        if (named) {
            const c = named.getComponent(cc.PhysicsChainCollider);
            if (c) return c;
        }
        const all = map.getComponentsInChildren(cc.PhysicsChainCollider);
        if (all.length === 0) return null;
        let best = all[0], bestArea = -1;
        for (const c of all) {
            const pts = c.points;
            if (!pts || pts.length < 3) continue;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const p of pts) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
            const area = (maxX - minX) * (maxY - minY);
            if (area > bestArea) { bestArea = area; best = c; }
        }
        return best;
    }

    // 深度優先依名稱找子節點
    private findChildByName(root: cc.Node, name: string): cc.Node | null {
        if (root.name === name) return root;
        for (const child of root.children) {
            const found = this.findChildByName(child, name);
            if (found) return found;
        }
        return null;
    }

    // ====================================================================
    // 物件生成：Auto（邊界內拒絕取樣）
    // ====================================================================
    private spawnAuto(inner: cc.Vec2[]) {
        if (this.maxObjects <= 0) return;

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of inner) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        if (maxX <= minX || maxY <= minY) return;

        const cars = this.avoidCars ? this.collectCarPositions() : [];
        const count = this.randInt(this.minObjects, this.maxObjects);
        const used: cc.Vec2[] = [];

        for (let k = 0; k < count; k++) {
            let px = 0, py = 0, ok = false;
            for (let tries = 0; tries < 40; tries++) {
                px = this.rand(minX, maxX);
                py = this.rand(minY, maxY);
                if (!this.pointInPolygon(px, py, inner)) continue;
                if (this.distToBoundary(px, py, inner) < this.spawnMargin) continue;
                if (cars.some(c => Math.hypot(c.x - px, c.y - py) < this.carClearRadius)) continue;
                if (used.every(u => Math.hypot(u.x - px, u.y - py) >= this.minSpacing)) { ok = true; break; }
            }
            if (!ok) continue;
            used.push(cc.v2(px, py));
            this.placeObject(px, py, inner);
        }
    }

    // ====================================================================
    // 物件生成：Markers（只在設計師擺好的標記點生成）
    // ====================================================================
    private spawnAtMarkers(map: cc.Node, inner: cc.Vec2[]) {
        const parent = this.findChildByName(map, this.markerParentName);
        if (!parent || parent.children.length === 0) {
            cc.warn(`[MapLoader] Markers 模式找不到「${this.markerParentName}」或底下沒有標記點，改用 Auto`);
            this.spawnAuto(inner);
            return;
        }

        // 把標記點轉成 current 本地座標
        const markers: cc.Vec2[] = parent.children.map(ch => {
            const world = ch.convertToWorldSpaceAR(cc.v2(0, 0));
            return map.convertToNodeSpaceAR(world);
        });

        // 隨機挑一個子集（數量夾在 [minObjects, maxObjects] 與標記點數之間）
        const want = Math.min(this.randInt(this.minObjects, this.maxObjects), markers.length);
        const idx = markers.map((_, i) => i);
        this.shuffle(idx);

        for (let k = 0; k < want; k++) {
            const m = markers[idx[k]];
            this.placeObject(m.x, m.y, inner);
        }
    }

    // 在 (px, py) 放一個物件（隨機 prefab 或內建方塊）；彈簧類貼地
    private placeObject(px: number, py: number, inner: cc.Vec2[]) {
        if (this.objectPrefabs && this.objectPrefabs.length > 0) {
            const prefab = this.objectPrefabs[this.randInt(0, this.objectPrefabs.length - 1)];
            if (!prefab) return;
            const node = cc.instantiate(prefab);
            node.parent = this.current!;
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

    // ====================================================================
    // 以下為從 ArenaBoundaryGenerator 移植的幾何 / 視覺 / 工具方法
    // ====================================================================

    // ---- 亂數（mulberry32 風格，種子可重現）----
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

    // Fisher-Yates 洗牌（用本元件的種子亂數）
    private shuffle(arr: number[]) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = this.randInt(0, i);
            const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
    }

    // ---- 視覺：牆＝沿內界往外的薄實心帶；虛空＝內界往外放大成大環的實心帶 ----
    // cc.Graphics 是「每個子路徑各自實心填」，不支援跨子路徑挖洞，自交的四邊形還會破洞。
    // 因此虛空不用「大矩形挖洞」，改成「內界 → 把內界以質心放大 8 倍的外環」之間鋪實心帶：
    // void 用 fillOutside（只填外側、內側留洞透出背景）；牆用薄帶蓋在最上。
    private drawArena(inner: cc.Vec2[], normals: cc.Vec2[]) {
        const n = inner.length;
        const outer: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const p = inner[i], nm = normals[i];
            outer.push(cc.v2(p.x + nm.x * this.wallThickness, p.y + nm.y * this.wallThickness));
        }
        // 虛空：只填內界「外側」（內側留洞 → 透出背景圖）
        // 有指定石頭貼圖就鋪石頭，否則維持原本的純色填充（行為與之前完全一致）
        if (this.voidTexture) this.fillOutsideTextured(inner, "arenaVoid", this.visualZIndex - 1);
        else this.fillOutside(inner, this.voidColor, 6000, "arenaVoid", this.visualZIndex - 1);
        // 牆：內界→外界的薄帶，畫在虛空之上
        this.fillBand(inner, outer, this.boundaryColor, "arenaWall", this.visualZIndex);
    }

    // 多邊形有號面積（>0 為逆時針 CCW）
    private signedArea(pts: cc.Vec2[]): number {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            a += p.x * q.y - q.x * p.y;
        }
        return a * 0.5;
    }

    // 只填多邊形「外側」一圈寬 ext 的實心區（內側留洞）。
    // cc.Graphics 每個子路徑各自 earcut 實心填、重疊同色 OR、不支援挖洞；
    // 故用「每邊往外擠的矩形 + 每頂點的楔形三角形」鋪滿外側，每塊都凸、不自交 → 無破洞、不塞內側。
    private fillOutside(inner: cc.Vec2[], color: cc.Color, ext: number, name: string, z: number) {
        const node = new cc.Node(name);
        node.parent = this.current!;
        node.setPosition(0, 0);
        node.zIndex = z;

        const g = node.addComponent(cc.Graphics);
        g.fillColor = color;

        const n = inner.length;
        const ccw = this.signedArea(inner) > 0;

        // 一致朝外的每邊法線
        const en: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const a = inner[i], b = inner[(i + 1) % n];
            let dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            en.push(ccw ? cc.v2(dy, -dx) : cc.v2(-dy, dx));
        }

        // 每邊往外擠成矩形
        for (let i = 0; i < n; i++) {
            const a = inner[i], b = inner[(i + 1) % n], N = en[i];
            g.moveTo(a.x, a.y);
            g.lineTo(b.x, b.y);
            g.lineTo(b.x + N.x * ext, b.y + N.y * ext);
            g.lineTo(a.x + N.x * ext, a.y + N.y * ext);
            g.close();
        }
        // 每頂點補楔形三角形（蓋凸角縫；凹角重疊同色無害）
        for (let i = 0; i < n; i++) {
            const p = inner[i], Np = en[(i - 1 + n) % n], Nc = en[i];
            g.moveTo(p.x, p.y);
            g.lineTo(p.x + Np.x * ext, p.y + Np.y * ext);
            g.lineTo(p.x + Nc.x * ext, p.y + Nc.y * ext);
            g.close();
        }
        g.fill();
    }

    // 牆外虛空改鋪「石頭貼圖」版本：
    // 用反向遮罩（inverted GRAPHICS_STENCIL）把內界多邊形當模板 → 只在「內界外側」顯示，
    // 再放一張平鋪（TILED）的石頭 Sprite 當被遮罩內容，蓋滿整個外圍區域。
    // cc.Graphics 無法填貼圖，故走「遮罩 + Sprite」而非純色 fill。
    private fillOutsideTextured(inner: cc.Vec2[], name: string, z: number) {
        const node = new cc.Node(name);
        node.parent = this.current!;
        node.setPosition(0, 0);
        node.zIndex = z;

        // 反向遮罩：模板＝內界多邊形，inverted → 內側挖空、只露外側
        const mask = node.addComponent(cc.Mask);
        // GRAPHICS_STENCIL 在 2.4.8 runtime 存在，但專案內建的 creator.d.ts 型別缺這個 enum，故轉型存取
        mask.type = (cc.Mask.Type as any).GRAPHICS_STENCIL;
        mask.inverted = true;
        const g = (mask as any)._graphics as cc.Graphics;   // 2.4.x：GRAPHICS_STENCIL 以內部 graphics 繪製模板
        if (g) {
            g.clear();
            for (let i = 0; i < inner.length; i++) {
                const p = inner[i];
                if (i === 0) g.moveTo(p.x, p.y);
                else g.lineTo(p.x, p.y);
            }
            g.close();
            g.fill();
        }

        // 內界包圍盒 → 中心與尺寸；往外加大 margin 蓋滿畫面外側（沿用原本 6000 的覆蓋範圍）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of inner) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
        const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5;
        const margin = 6000;
        const side = Math.max(maxX - minX, maxY - minY) + margin * 2;

        // 平鋪石頭 Sprite（被遮罩裁切，只會出現在外側）
        const stone = new cc.Node("stone");
        stone.parent = node;
        stone.setPosition(cx, cy);
        const sp = stone.addComponent(cc.Sprite);
        sp.spriteFrame = this.voidTexture!;
        sp.type = cc.Sprite.Type.TILED;
        sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        stone.setContentSize(side, side);
    }

    // 每個頂點朝外的單位法線。
    // 改用「多邊形繞行方向（winding）」決定朝外側，而非以質心校正——
    // 質心法在凹多邊形（顛簸環形場地）的凹頂點會把法線判反，造成牆／虛空往內側溢出（內外判斷錯誤）。
    // 作法：先用有號面積判斷 CCW/CW，逐邊取一致朝外的邊法線，頂點法線＝相鄰兩邊法線的平均。
    private outwardNormals(pts: cc.Vec2[]): cc.Vec2[] {
        const n = pts.length;

        // 有號面積 > 0 表示頂點為逆時針（CCW）排列
        let area2 = 0;
        for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            area2 += a.x * b.y - b.x * a.y;
        }
        const ccw = area2 > 0;

        // 每條邊一致朝外的單位法線：CCW 時內側在邊的左手邊，朝外為 (dy, -dx)；CW 則相反
        const edgeN: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const a = pts[i], b = pts[(i + 1) % n];
            let dx = b.x - a.x, dy = b.y - a.y;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len; dy /= len;
            const nx = ccw ? dy : -dy;
            const ny = ccw ? -dx : dx;
            edgeN.push(cc.v2(nx, ny));
        }

        // 頂點法線 = 相鄰兩邊法線平均（凹頂點也不會反向）
        const out: cc.Vec2[] = [];
        for (let i = 0; i < n; i++) {
            const e0 = edgeN[(i - 1 + n) % n];
            const e1 = edgeN[i];
            let nx = e0.x + e1.x, ny = e0.y + e1.y;
            const len = Math.hypot(nx, ny) || 1;
            nx /= len; ny /= len;
            out.push(cc.v2(nx, ny));
        }
        return out;
    }

    // 在兩條封閉折線 a(內) / b(外) 之間填滿一圈實心帶
    private fillBand(a: cc.Vec2[], b: cc.Vec2[], color: cc.Color, name: string, z: number) {
        const node = new cc.Node(name);
        node.parent = this.current!;
        node.setPosition(0, 0);
        node.zIndex = z;

        const g = node.addComponent(cc.Graphics);
        g.fillColor = color;

        const n = a.length;
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

    // 收集場上玩家 / 電腦車各部件的位置（轉成 current 座標系）
    private collectCarPositions(): cc.Vec2[] {
        const out: cc.Vec2[] = [];
        const scene = cc.director.getScene();
        const current = this.current;
        if (!scene || !current) return out;
        scene.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            const nd = rb.node;
            if (!nd || !nd.isValid) return;
            const g = nd.group || "";
            if (g.indexOf(GROUP.PLAYER_KEY) >= 0 || g.indexOf(GROUP.BOT_KEY) >= 0) {
                const world = nd.convertToWorldSpaceAR(cc.v2(0, 0));
                out.push(current.convertToNodeSpaceAR(world));
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

    // 點到整條封閉折線的最短距離
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
        let minY = Infinity;
        const n = inner.length;
        for (let i = 0; i < n; i++) {
            const p1 = inner[i], p2 = inner[(i + 1) % n];
            if (p1.y < minY) minY = p1.y;
            const lo = Math.min(p1.x, p2.x), hi = Math.max(p1.x, p2.x);
            if (x < lo || x > hi || hi - lo < 0.001) continue;
            const t = (x - p1.x) / (p2.x - p1.x);
            const y = p1.y + t * (p2.y - p1.y);
            if (bestY === null || y < bestY) bestY = y;
        }
        return bestY === null ? minY : bestY;
    }

    // 內建後備方塊：留空 prefab 池時用的靜態平台
    private makeDefaultBlock(x: number, y: number) {
        const node = new cc.Node("platform");
        node.parent = this.current!;
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
}
