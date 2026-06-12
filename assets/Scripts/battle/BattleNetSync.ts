// battle/BattleNetSync.ts
// 線上對戰的網路層（從舊的 OnlineBattleManager 抽出）。由 BattleManager 在 online 模式下持有並委派。
// 主機（P1）：每幀把世界狀態序列化後廣播；非主機（P2，純畫面端）：收到後套用到本地節點。
//
// 與 BattleManager 的耦合透過 INetBattle 介面（只用公開成員），避免動到其私有狀態。

import { BuiltCar } from "./CarBuilder";
import CarBuilder from "./CarBuilder";
import Bullet from "../Bullet";
import OnlineRuntime, { OnlineInputState } from "../online/OnlineRuntime";

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
}

export default class BattleNetSync {
    private bm: INetBattle;

    private remoteInput: OnlineInputState = { worldDir: 0, attack: false, boost: false, mouseDown: false, mouseX: 0, mouseY: 0 };

    // 非主機端視覺池：key = prefab 識別（-1 子彈、>=0 為 allPrefabs 索引）
    private visualPools: Map<number, cc.Node[]> = new Map();
    // 主機端追蹤的驟死掉落物
    private debrisNodes: { node: cc.Node, p: number }[] = [];
    private p2ShownFight = false;

    // 診斷
    private debugLabel: cc.Label | null = null;
    private txCount = 0;
    private rxCount = 0;
    private hostConflict = false;

    constructor(bm: INetBattle) {
        this.bm = bm;
    }

    // ---- 事件綁定 ----
    bindEvents() {
        cc.systemEvent.on("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.on("ONLINE_SYNC_POS", this.onSyncReceived, this);
        this.createDebugHud();
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
    broadcast(meta: { started: boolean, countdown: number, timer: number }) {
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
        };
        OnlineRuntime.room.send("sync", snapshot);
        this.txCount++;
    }

    registerDebris(node: cc.Node, prefabIndex: number) {
        this.debrisNodes.push({ node, p: prefabIndex });
    }

    private serializeCar(car: BuiltCar | null): any[] {
        const out: any[] = [];
        if (!car || !car.partsMap) return out;
        car.partsMap.forEach((node, key) => {
            if (!node || !node.isValid) return;
            out.push({ k: key, x: node.x, y: node.y, a: node.angle });
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
            this.hostConflict = true;
            return;
        }
        this.rxCount++;
        this.applyMeta(msg.meta);
        if (msg.cars) {
            this.applyCarParts(this.bm.getP1Car(), msg.cars.p1);
            this.applyCarParts(this.bm.getP2Car(), msg.cars.p2);
        }
        this.reconcileVisualBullets(msg.bullets || []);
        this.reconcileVisualDebris(msg.debris || []);
        this.applySeesaws(msg.seesaws || []);
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
        if (this.bm.timerLabel && meta.timer != null) {
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
            }
        }
        // 主機已銷毀（快照中沒有）的零件 → 在 P2 同步斷開銷毀
        car.partsMap.forEach((node, key) => {
            if (node && node.isValid && !present.has(key)) CarBuilder.disjointPart(node);
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

    // ---- 診斷 HUD ----
    private createDebugHud() {
        const canvas = cc.find("Canvas");
        if (!canvas) return;
        const node = new cc.Node("DEBUG_HUD");
        node.parent = canvas; node.zIndex = 200;
        const label = node.addComponent(cc.Label);
        label.fontSize = 24; label.lineHeight = 28;
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        const widget = node.addComponent(cc.Widget);
        widget.isAlignTop = true; widget.top = 70;
        widget.isAlignHorizontalCenter = true;
        widget.updateAlignment();
        this.debugLabel = label;
    }
    updateHud(started: boolean) {
        if (!this.debugLabel) return;
        const host = OnlineRuntime.isHost();
        if (this.hostConflict) {
            this.debugLabel.string = "CONFLICT: 2 HOSTS! (seat 兩台都 P1?)";
            this.debugLabel.node.color = cc.Color.RED;
            return;
        }
        this.debugLabel.node.color = host ? cc.color(120, 255, 120) : cc.color(255, 220, 120);
        this.debugLabel.string = host
            ? `SEAT=${OnlineRuntime.mySeat} HOST=Y started=${started ? "Y" : "N"} tx=${this.txCount}`
            : `SEAT=${OnlineRuntime.mySeat} HOST=N started=${this.p2ShownFight ? "Y" : "N"} rx=${this.rxCount}`;
    }
}
