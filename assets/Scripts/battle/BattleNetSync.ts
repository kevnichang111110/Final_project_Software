// battle/BattleNetSync.ts
// 線上對戰的網路層（從舊的 OnlineBattleManager 抽出）。由 BattleManager 在 online 模式下持有並委派。
// 主機（P1）：每幀把世界狀態序列化後廣播；非主機（P2，純畫面端）：收到後套用到本地節點。
//
// 與 BattleManager 的耦合透過 INetBattle 介面（只用公開成員），避免動到其私有狀態。

import { BuiltCar } from "./CarBuilder";
import CarBuilder from "./CarBuilder";
import Bullet from "../Bullet";
import MuzzleFlash from "../fx/MuzzleFlash";
import HitSpark from "../fx/HitSpark";
import HitFeedback from "../fx/HitFeedback";
import Health from "../HealthManager";
import OnlineRuntime, { OnlineInputState } from "../online/OnlineRuntime";
import { HITFX } from "../core/GameConstants";

// BattleNetSync 需要從 BattleManager 取得的東西
export interface INetBattle {
    node: cc.Node;
    bulletPrefab: cc.Prefab | null;
    allPrefabs: cc.Prefab[];
    countdownLabel: cc.Label | null;
    timerLabel: cc.Label | null;
    getP1Car(): BuiltCar | null;
    getP2Car(): BuiltCar | null;
    getSeesawNodes(): cc.Node[];
    // 非主機端收到「開戰」時回呼（設 isBattleStarted、顯示 FIGHT!、隱藏倒數）
    onClientFight(): void;
    // 非主機端收到「進入驟死」時回呼（顯示驟死字卡＋音效，僅一次；扣血/落物由主機算後隨快照同步）
    onClientSuddenDeath(): void;
}

export default class BattleNetSync {
    private bm: INetBattle;

    private remoteInput: OnlineInputState = { worldDir: 0, attack: false, boost: false, mouseDown: false, mouseX: 0, mouseY: 0 };

    // 非主機端視覺池：key = prefab 識別（-1 子彈、>=0 為 allPrefabs 索引）
    private visualPools: Map<number, cc.Node[]> = new Map();
    // 主機端追蹤的驟死掉落物
    private debrisNodes: { node: cc.Node, p: number }[] = [];
    private p2ShownFight = false;
    private p2ShownSuddenDeath = false;

    // 主機端累積的一次性特效，每次快照送出後清空，client 播放
    // t=0 槍口火光（a=方向弧度，c/k=開火零件→client 播 attack 音效）
    // t=1 打擊火花（a=強度 0~1，純視覺；受擊音效改由 syncHP 掉血驅動）
    // t=2 噴射能力（c/k=噴射輪→client 播 ability 音效，無位置）
    private pendingFx: { t: number, x: number, y: number, a: number, c?: number, k?: string }[] = [];

    // 安全檢查：偵測到第二個主機（伺服器把兩台都配成 P1）時只警告一次
    private hostConflict = false;

    constructor(bm: INetBattle) {
        this.bm = bm;
    }

    // ---- 事件綁定 ----
    bindEvents() {
        cc.systemEvent.on("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.on("ONLINE_SYNC_POS", this.onSyncReceived, this);
    }
    unbindEvents() {
        cc.systemEvent.off("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.off("ONLINE_SYNC_POS", this.onSyncReceived, this);
    }

    // ---- 輸入 ----
    sendInput(input: OnlineInputState) {
        if (!OnlineRuntime.room) return;
        OnlineRuntime.room.send("input", input);
    }
    getRemoteInput(): OnlineInputState {
        return this.remoteInput;
    }
    private onRemoteInput(msg: any) {
        if (!msg || !msg.seat || !msg.input) return;
        if (msg.seat === OnlineRuntime.mySeat) return; // 忽略自己的回音
        this.remoteInput = this.normalizeInput(msg.input);
    }
    private normalizeInput(raw: any): OnlineInputState {
        return {
            worldDir: Math.max(-1, Math.min(1, Number(raw.worldDir || 0))),
            attack: !!raw.attack,
            boost: !!raw.boost,
            mouseDown: !!raw.mouseDown,
            mouseX: Number(raw.mouseX || 0),
            mouseY: Number(raw.mouseY || 0),
        };
    }

    // ---- 主機：廣播完整世界快照 ----
    broadcast(meta: { started: boolean, countdown: number, timer: number, suddenDeath: boolean }) {
        if (!OnlineRuntime.room) return;
        const snapshot = {
            meta,
            cars: {
                p1: this.serializeCar(this.bm.getP1Car()),
                p2: this.serializeCar(this.bm.getP2Car()),
            },
            bullets: this.collectBullets(),
            debris: this.collectDebris(),
            seesaws: this.collectSeesaws(),
            fx: this.drainFx(),
        };
        OnlineRuntime.room.send("sync", snapshot);
    }

    registerDebris(node: cc.Node, prefabIndex: number) {
        this.debrisNodes.push({ node, p: prefabIndex });
    }

    // host：記錄一次槍口火光（世界座標 + 方向弧度 + 開火零件參照），等下次快照帶給對手
    recordMuzzle(worldPos: cc.Vec2, dir: cc.Vec2, weaponNode?: cc.Node) {
        if (this.pendingFx.length >= 40) return; // 上限保護
        const ref = this.findPartRef(weaponNode);
        this.pendingFx.push({ t: 0, x: worldPos.x, y: worldPos.y, a: Math.atan2(dir.y, dir.x), c: ref ? ref.c : undefined, k: ref ? ref.k : undefined });
    }
    // host：記錄一次打擊火花（世界座標 + 強度）
    recordHit(worldPos: cc.Vec2, strength: number) {
        if (this.pendingFx.length >= 40) return;
        this.pendingFx.push({ t: 1, x: worldPos.x, y: worldPos.y, a: Math.max(0, Math.min(1, strength)) });
    }
    // host：記錄一次噴射能力觸發（只需零件參照，無位置）。同一輪子同一批快照只記一次。
    recordAbility(wheelNode: cc.Node) {
        const ref = this.findPartRef(wheelNode);
        if (!ref) return;
        if (this.pendingFx.some(f => f.t === 2 && f.c === ref.c && f.k === ref.k)) return;
        if (this.pendingFx.length >= 40) return;
        this.pendingFx.push({ t: 2, x: 0, y: 0, a: 0, c: ref.c, k: ref.k });
    }
    // 在兩台車的 partsMap 反查某節點 → { c:車序(0=p1/1=p2), k:格子鍵 }，讓 client 找到自己那份零件播音效
    private findPartRef(node?: cc.Node): { c: number, k: string } | null {
        if (!node) return null;
        const cars = [this.bm.getP1Car(), this.bm.getP2Car()];
        for (let c = 0; c < cars.length; c++) {
            const car = cars[c];
            if (!car || !car.partsMap) continue;
            let found: string | null = null;
            car.partsMap.forEach((n, key) => { if (n === node) found = key; });
            if (found) return { c, k: found };
        }
        return null;
    }
    private drainFx(): any[] {
        const f = this.pendingFx;
        this.pendingFx = [];
        return f;
    }

    private serializeCar(car: BuiltCar | null): any[] {
        const out: any[] = [];
        if (!car || !car.partsMap) return out;
        car.partsMap.forEach((node, key) => {
            if (!node || !node.isValid) return;
            // h：該零件當前血量（整數，省頻寬），client 端用來畫血條（-1 = 無 Health）
            const hm = node.getComponent(Health);
            out.push({ k: key, x: node.x, y: node.y, a: node.angle, h: hm ? Math.round(hm.currentHP) : -1 });
        });
        return out;
    }
    private collectBullets(): any[] {
        const out: any[] = [];
        const root = this.bm.node;
        if (!root) return out;
        root.children.forEach(c => {
            if (!c || !c.isValid || !c.active) return;
            const b = c.getComponent(Bullet);
            if (b && !b.hasExploded) out.push({ x: c.x, y: c.y, a: c.angle });
        });
        return out;
    }
    private collectDebris(): any[] {
        const out: any[] = [];
        for (const d of this.debrisNodes) {
            if (d.node && d.node.isValid) out.push({ p: d.p, x: d.node.x, y: d.node.y, a: d.node.angle });
        }
        return out;
    }
    private collectSeesaws(): any[] {
        const out: any[] = [];
        for (const n of this.bm.getSeesawNodes()) out.push({ x: n.x, y: n.y, a: n.angle });
        return out;
    }

    // ---- 非主機：套用快照 ----
    private onSyncReceived(msg: any) {
        if (!msg) return;
        if (OnlineRuntime.isHost()) {
            // 自己是 host 卻收到 sync → 場上有第二個主機（多半是伺服器把兩台都配成 P1）
            if (!this.hostConflict) {
                this.hostConflict = true;
                cc.error("[Online] 偵測到第二個主機：伺服器可能把兩台都配成 P1，請檢查 onJoin 的 seat 配位");
            }
            return;
        }
        this.applyMeta(msg.meta);
        if (msg.cars) {
            this.applyCarParts(this.bm.getP1Car(), msg.cars.p1);
            this.applyCarParts(this.bm.getP2Car(), msg.cars.p2);
        }
        this.reconcileVisualBullets(msg.bullets || []);
        this.reconcileVisualDebris(msg.debris || []);
        this.applySeesaws(msg.seesaws || []);
        this.playFx(msg.fx || []);
    }

    // client：播放主機傳來的一次性特效（槍口火光 / 打擊火花 / 噴射音效）。
    // 打擊火花同時帶動背景震動：client 不跑 takeDamage，畫面震動只能由此驅動（強度 a=dmg/HITSTOP_DAMAGE）。
    private playFx(list: any[]) {
        if (!list || !list.length || !this.bm.node) return;
        for (const f of list) {
            if (f.t === 1) {
                HitSpark.spawn(this.bm.node, cc.v2(f.x, f.y), f.a);
                HitFeedback.shake(f.a * HITFX.HITSTOP_DAMAGE);
            } else if (f.t === 2) {
                this.playPartAudio(f.c, f.k, "ability");
            } else {
                MuzzleFlash.spawn(this.bm.node, cc.v2(f.x, f.y), cc.v2(Math.cos(f.a), Math.sin(f.a)));
                this.playPartAudio(f.c, f.k, "attack");
            }
        }
    }

    // client：用車序+格子鍵找到本地對應零件，播它自己的 PartAudio（攻擊/能力），保留各零件不同的音效
    private playPartAudio(c: number | undefined, k: string | undefined, kind: "attack" | "ability") {
        if (c == null || k == null) return;
        const car = c === 0 ? this.bm.getP1Car() : this.bm.getP2Car();
        if (!car || !car.partsMap) return;
        const node = car.partsMap.get(k);
        if (!node || !node.isValid) return;
        const audio = node.getComponent("PartAudio") as any;
        if (!audio) return;
        if (kind === "attack" && audio.playAttack) audio.playAttack();
        else if (kind === "ability" && audio.playAbility) audio.playAbility();
    }

    private applyMeta(meta: any) {
        if (!meta) return;
        if (!meta.started) {
            if (this.bm.countdownLabel) {
                this.bm.countdownLabel.node.active = true;
                this.bm.countdownLabel.string = String(meta.countdown);
            }
        } else if (!this.p2ShownFight) {
            this.p2ShownFight = true;
            this.bm.onClientFight();
        }
        // 驟死字卡＋音效：只在第一次轉為 true 時觸發；timer 文字交給 onClientSuddenDeath 顯示 OVERTIME
        if (meta.suddenDeath && !this.p2ShownSuddenDeath) {
            this.p2ShownSuddenDeath = true;
            this.bm.onClientSuddenDeath();
        } else if (!meta.suddenDeath && this.bm.timerLabel && meta.timer != null) {
            this.bm.timerLabel.string = String(Math.max(0, Math.ceil(meta.timer)));
        }
    }

    private applyCarParts(car: BuiltCar | null, list: any[]) {
        if (!car || !car.partsMap || !list) return;
        const present = new Set<string>();
        for (const p of list) {
            present.add(p.k);
            const node = car.partsMap.get(p.k);
            if (node && node.isValid) {
                node.setPosition(p.x, p.y);
                node.angle = p.a;
                // 主機血量 → 餵入 client 端血條（client 物理關閉、不會自行扣血）
                if (p.h != null && p.h >= 0) {
                    const hm = node.getComponent(Health);
                    if (hm) hm.syncHP(p.h);
                }
            }
        }
        // 主機已銷毀（快照中沒有）的零件 → 在 P2 同步斷開銷毀
        car.partsMap.forEach((node, key) => {
            if (node && node.isValid && !present.has(key)) {
                // 摧毀音效：節點還沒 destroy（disjointPart 延遲銷毀），先用它自己的 PartAudio 播一次 die
                const audio = node.getComponent("PartAudio") as any;
                if (audio && audio.playDie) audio.playDie();
                CarBuilder.disjointPart(node);
            }
        });
    }

    private reconcileVisualBullets(list: any[]) {
        this.reconcileVisual(-1, this.bm.bulletPrefab, list);
    }
    private reconcileVisualDebris(list: any[]) {
        const groups: Map<number, any[]> = new Map();
        for (const d of list) {
            if (!groups.has(d.p)) groups.set(d.p, []);
            groups.get(d.p)!.push(d);
        }
        groups.forEach((items, p) => {
            this.reconcileVisual(p, this.bm.allPrefabs[p] || null, items);
        });
        this.visualPools.forEach((pool, key) => {
            if (key >= 0 && !groups.has(key)) {
                for (const n of pool) if (n && n.isValid) n.active = false;
            }
        });
    }
    private reconcileVisual(key: number, prefab: cc.Prefab | null, items: any[]) {
        if (!prefab) return;
        let pool = this.visualPools.get(key);
        if (!pool) { pool = []; this.visualPools.set(key, pool); }
        while (pool.length < items.length) pool.push(this.makeVisual(prefab));
        for (let i = 0; i < pool.length; i++) {
            const n = pool[i];
            if (!n || !n.isValid) continue;
            if (i < items.length) {
                n.active = true;
                n.setPosition(items[i].x, items[i].y);
                n.angle = items[i].a;
            } else {
                n.active = false;
            }
        }
    }
    private makeVisual(prefab: cc.Prefab): cc.Node {
        const n = cc.instantiate(prefab);
        n.parent = this.bm.node;
        n.zIndex = 5;
        const rb = n.getComponent(cc.RigidBody);
        if (rb) rb.destroy();
        const b = n.getComponent(Bullet);
        if (b) b.destroy();
        return n;
    }

    private applySeesaws(list: any[]) {
        if (!list || !list.length) return;
        const nodes = this.bm.getSeesawNodes();
        const len = Math.min(nodes.length, list.length);
        for (let i = 0; i < len; i++) {
            const n = nodes[i], d = list[i];
            if (n && n.isValid && d) { n.setPosition(d.x, d.y); n.angle = d.a; }
        }
    }
}
