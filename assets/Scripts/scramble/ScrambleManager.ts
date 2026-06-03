// scramble/ScrambleManager.ts
//（第 9 點）即時競速「搶奪階段」，類似超級雞馬的隨機箱子：
//   - 場上散佈 4~5 個道具箱
//   - 兩位競爭者（本機雙人：P1 + P2；vs 電腦：P1 + BOT）即時移動，身體碰到箱子就搶走
//   - 限時或全部搶完即結束，把各自搶到的道具寫進 GameManager.claimedTools，再進商店
//
// 控制：
//   P1：A/D 移動、W 跳
//   P2（雙人）：← / → 移動、↑ 跳
//   BOT（vs 電腦）：自動追最近的未搶箱子
//
// 用法：建一個名為 "Scramble" 的場景，放一個節點掛這個組件即可（場地/角色/箱子都用程式生成，
//       不一定要美術；想換成自己的 prefab 之後再替換 makeRect 即可）。
//       道具池 toolPool 填「道具名稱」，名稱要對得上 allPrefabs 裡的 prefab，商店才能據此免費發給玩家。

import GameManager, { GameMode } from "../GameManager";
import { SCRAMBLE } from "../core/GameConstants";
import ScrambleGrabber from "./ScrambleGrabber";
import ScrambleBox from "./ScrambleBox";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ScrambleManager extends cc.Component {

    @property({ type: [cc.String], tooltip: "可被搶的道具名稱池（需對應 prefab 名稱，例如 Wheel2 / Gun1 / Body1）" })
    toolPool: string[] = [];

    @property(cc.AudioClip) startSfx: cc.AudioClip | null = null;
    @property(cc.AudioClip) claimSfx: cc.AudioClip | null = null;
    @property(cc.AudioClip) endSfx: cc.AudioClip | null = null;

    private p1: ScrambleGrabber | null = null;
    private p2: ScrambleGrabber | null = null;   // 雙人時是 P2，vs 電腦時是 BOT
    private p2IsBot: boolean = false;

    private boxes: ScrambleBox[] = [];
    private claimedCount: number = 0;
    private tally: { [side: string]: string[] } = { P1: [], P2: [], BOT: [] };

    private timeLeft: number = SCRAMBLE.DURATION;
    private ended: boolean = false;

    private statusLabel: cc.Label | null = null;

    // 輸入狀態
    private p1Left = false; private p1Right = false;
    private p2Left = false; private p2Right = false;

    // ====================================================================
    onLoad() {
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        physics.gravity = cc.v2(0, -1600);

        this.createArena();

        const twoPlayer = GameManager.gameMode === GameMode.LocalTwoPlayer;
        this.p1 = this.createGrabber("P1", -SCRAMBLE.ARENA_WIDTH * 0.3, cc.color(90, 170, 255));
        if (twoPlayer) {
            this.p2 = this.createGrabber("P2", SCRAMBLE.ARENA_WIDTH * 0.3, cc.color(90, 230, 120));
            this.p2IsBot = false;
        } else {
            this.p2 = this.createGrabber("BOT", SCRAMBLE.ARENA_WIDTH * 0.3, cc.color(255, 110, 90));
            this.p2IsBot = true;
        }

        this.spawnBoxes();
        this.createStatusLabel(twoPlayer);

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        if (this.startSfx) cc.audioEngine.playEffect(this.startSfx, false);
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    // ====================================================================
    // 場景生成（用 Graphics + 物理碰撞器，沒美術也能跑）
    // ====================================================================
    private makeRect(w: number, h: number, color: cc.Color, dynamic: boolean, sensor: boolean, fixedRotation: boolean): cc.Node {
        const node = new cc.Node();
        node.parent = this.node;

        const g = node.addComponent(cc.Graphics);
        g.fillColor = color;
        g.roundRect(-w / 2, -h / 2, w, h, 6);
        g.fill();

        const rb = node.addComponent(cc.RigidBody);
        rb.type = dynamic ? cc.RigidBodyType.Dynamic : cc.RigidBodyType.Static;
        if (dynamic && fixedRotation) rb.fixedRotation = true;

        const col = node.addComponent(cc.PhysicsBoxCollider);
        col.size = cc.size(w, h);
        col.sensor = sensor;
        col.friction = 0.4;
        col.apply();

        node.group = "default";
        return node;
    }

    private addLabel(parent: cc.Node, text: string, fontSize: number, color: cc.Color): cc.Label {
        const node = new cc.Node("label");
        node.parent = parent;
        node.color = color;
        node.zIndex = 5;
        const label = node.addComponent(cc.Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 4;
        return label;
    }

    private createArena() {
        const W = SCRAMBLE.ARENA_WIDTH;
        const gy = SCRAMBLE.GROUND_Y;
        const wall = cc.color(70, 72, 86);

        const ground = this.makeRect(W, 40, wall, false, false, false);
        ground.setPosition(0, gy);

        const left = this.makeRect(40, 900, wall, false, false, false);
        left.setPosition(-W / 2, gy + 450);

        const right = this.makeRect(40, 900, wall, false, false, false);
        right.setPosition(W / 2, gy + 450);

        // 一兩個中間平台，讓高處的箱子需要跳上去拿
        const plat1 = this.makeRect(220, 30, wall, false, false, false);
        plat1.setPosition(-260, gy + 180);
        const plat2 = this.makeRect(220, 30, wall, false, false, false);
        plat2.setPosition(260, gy + 180);
    }

    private createGrabber(side: "P1" | "P2" | "BOT", x: number, color: cc.Color): ScrambleGrabber {
        const size = SCRAMBLE.GRABBER_SIZE;
        const node = this.makeRect(size, size, color, true, false, true);
        node.setPosition(x, SCRAMBLE.GROUND_Y + 120);
        node.name = side + "_GRABBER";
        this.addLabel(node, side, 22, cc.Color.WHITE);

        const comp = node.addComponent(ScrambleGrabber);
        comp.side = side;
        return comp;
    }

    private spawnBoxes() {
        const count = SCRAMBLE.MIN_BOXES + Math.floor(Math.random() * (SCRAMBLE.MAX_BOXES - SCRAMBLE.MIN_BOXES + 1));
        const pool = this.toolPool.length > 0 ? this.toolPool : ["道具A", "道具B", "道具C", "道具D", "道具E"];

        const W = SCRAMBLE.ARENA_WIDTH;
        const left = -W * 0.4;
        const step = (W * 0.8) / Math.max(1, count - 1);

        for (let i = 0; i < count; i++) {
            const name = pool[Math.floor(Math.random() * pool.length)];
            const node = this.makeRect(SCRAMBLE.BOX_SIZE, SCRAMBLE.BOX_SIZE, cc.color(245, 205, 70), false, true, false);
            const x = left + step * i;
            const y = SCRAMBLE.GROUND_Y + (i % 2 === 0 ? 90 : 230); // 高低交錯，有些要跳
            node.setPosition(x, y);
            node.name = "BOX_" + name;
            this.addLabel(node, name, 18, cc.color(60, 40, 0));

            const box = node.addComponent(ScrambleBox);
            box.init(this, name);
            this.boxes.push(box);
        }
    }

    private createStatusLabel(twoPlayer: boolean) {
        const node = new cc.Node("ScrambleStatus");
        node.parent = this.node;
        node.setPosition(0, 320);
        node.color = cc.Color.WHITE;
        node.zIndex = 50;
        this.statusLabel = node.addComponent(cc.Label);
        this.statusLabel.fontSize = 30;
        this.statusLabel.lineHeight = 36;
        this.statusLabel.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        this.updateStatus();
    }

    private opponentName(): string {
        return this.p2IsBot ? "BOT" : "P2";
    }

    private updateStatus() {
        if (!this.statusLabel) return;
        const opp = this.opponentName();
        this.statusLabel.string =
            `搶奪！剩餘 ${Math.max(0, Math.ceil(this.timeLeft))}s\n` +
            `P1 搶到 ${this.tally["P1"].length}   ${opp} 搶到 ${this.tally[opp].length}`;
    }

    // ====================================================================
    // 主迴圈
    // ====================================================================
    update(dt: number) {
        if (this.ended) return;

        if (this.p1) this.p1.setInput((this.p1Right ? 1 : 0) + (this.p1Left ? -1 : 0));

        if (this.p2) {
            if (this.p2IsBot) this.updateBot();
            else this.p2.setInput((this.p2Right ? 1 : 0) + (this.p2Left ? -1 : 0));
        }

        this.timeLeft -= dt;
        this.updateStatus();
        if (this.timeLeft <= 0) this.endScramble();
    }

    private updateBot() {
        const bot = this.p2;
        if (!bot) return;
        const target = this.nearestUnclaimed(bot.node);
        if (!target) { bot.setInput(0); return; }

        const dx = target.node.x - bot.node.x;
        bot.setInput(Math.abs(dx) > 12 ? Math.sign(dx) : 0);
        if (target.node.y > bot.node.y + SCRAMBLE.BOT_JUMP_DY) bot.queueJump();
    }

    private nearestUnclaimed(from: cc.Node): ScrambleBox | null {
        let best: ScrambleBox | null = null;
        let bestDist = Infinity;
        for (const b of this.boxes) {
            if (b.claimed || !b.node || !b.node.isValid) continue;
            const d = b.node.position.sub(from.position).mag();
            if (d < bestDist) { bestDist = d; best = b; }
        }
        return best;
    }

    // 被搶走時由 ScrambleBox 呼叫
    onBoxClaimed(box: ScrambleBox, side: string) {
        if (!this.tally[side]) this.tally[side] = [];
        this.tally[side].push(box.toolName);
        this.claimedCount++;

        const col = box.getComponent(cc.PhysicsBoxCollider);
        if (col) col.enabled = false;

        if (this.claimSfx) cc.audioEngine.playEffect(this.claimSfx, false);

        cc.tween(box.node)
            .to(0.12, { scale: 1.3 })
            .to(0.18, { scale: 0, opacity: 0 })
            .call(() => { if (box.node && box.node.isValid) box.node.destroy(); })
            .start();

        this.updateStatus();

        if (this.claimedCount >= this.boxes.length) {
            this.scheduleOnce(() => this.endScramble(), 0.6);
        }
    }

    private endScramble() {
        if (this.ended) return;
        this.ended = true;

        if (this.p1) this.p1.setInput(0);
        if (this.p2) this.p2.setInput(0);

        // 寫回全域，供商店/後續使用
        GameManager.claimedTools["P1"] = this.tally["P1"].slice();
        GameManager.claimedTools["P2"] = this.tally["P2"] ? this.tally["P2"].slice() : [];
        GameManager.claimedTools["BOT"] = this.tally["BOT"] ? this.tally["BOT"].slice() : [];

        const opp = this.opponentName();
        if (this.statusLabel) {
            const p1List = this.tally["P1"].join("、") || "無";
            const oppList = this.tally[opp].join("、") || "無";
            this.statusLabel.string = `搶奪結束！\nP1：${p1List}\n${opp}：${oppList}`;
        }

        if (this.endSfx) cc.audioEngine.playEffect(this.endSfx, false);

        this.scheduleOnce(() => {
            cc.director.loadScene(SCRAMBLE.AFTER_SCENE);
        }, 2.5);
    }

    // ====================================================================
    // 輸入
    // ====================================================================
    onKeyDown(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a: this.p1Left = true; break;
            case cc.macro.KEY.d: this.p1Right = true; break;
            case cc.macro.KEY.w: if (this.p1) this.p1.queueJump(); break;

            case cc.macro.KEY.left: if (!this.p2IsBot) this.p2Left = true; break;
            case cc.macro.KEY.right: if (!this.p2IsBot) this.p2Right = true; break;
            case cc.macro.KEY.up: if (!this.p2IsBot && this.p2) this.p2.queueJump(); break;
        }
    }

    onKeyUp(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a: this.p1Left = false; break;
            case cc.macro.KEY.d: this.p1Right = false; break;
            case cc.macro.KEY.left: this.p2Left = false; break;
            case cc.macro.KEY.right: this.p2Right = false; break;
        }
    }
}
