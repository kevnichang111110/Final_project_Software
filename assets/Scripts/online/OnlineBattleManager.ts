import { BATTLE, GROUP, JOINT, MELEE, MOUSE_TURRET } from "../core/GameConstants";
import CarBuilder, { BuiltCar } from "../battle/CarBuilder";
import WeaponSystem from "../battle/WeaponSystem";
import MapLoader from "../map/MapLoader"; // 請確認你的路徑
import MouseCannon from "../weapons/MouseCannon";
import Health from "../HealthManager";
import OnlineRuntime, { OnlineInputState, OnlineSeat } from "./OnlineRuntime";

const { ccclass, property } = cc._decorator;

type SideGroup = "PLAYER" | "BOT";

@ccclass
export default class OnlineBattleManager extends cc.Component {
    // ===== 編輯器綁定 =====
    @property(cc.Label) timerLabel: cc.Label | null = null;
    @property(cc.Label) countdownLabel: cc.Label | null = null;
    @property(cc.Label) suddenDeathLabel: cc.Label | null = null; 
    @property(cc.Label) resultLabel: cc.Label | null = null;
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = [];
    @property(cc.Prefab) bulletPrefab: cc.Prefab | null = null;
    @property(cc.Component) mapLoader: any = null; // 改用通用的，防止 import 錯誤

    @property gunFireInterval: number = 0.25;
    @property bulletSpeed: number = 1600;
    @property bulletDamage: number = 20;
    @property bulletLifetime: number = 3;

    // ===== 內部實體 =====
    private p1Root: cc.Node | null = null;
    private p2Root: cc.Node | null = null;
    private p1Car: BuiltCar | null = null;
    private p2Car: BuiltCar | null = null;
    private weapons: WeaponSystem | null = null;

    private p1Input: OnlineInputState = OnlineRuntime.defaultInput();
    private p2Input: OnlineInputState = OnlineRuntime.defaultInput();
    private myInput: OnlineInputState = OnlineRuntime.defaultInput();
    private leftDown: boolean = false;
    private rightDown: boolean = false;

    private p1GunCooldown: number = 0;
    private p2GunCooldown: number = 0;
    private p1MouseCooldown: number = 0;
    private p2MouseCooldown: number = 0;
    private p1MeleeCooldown: number = 0;
    private p2MeleeCooldown: number = 0;

    private sendTimer: number = 0;
    private syncTimer: number = 0;
    private matchTimer: number = BATTLE.MATCH_TIME;
    private countdownValue: number = BATTLE.COUNTDOWN_FROM;
    private countdownTimer: number = 0;
    
    private isBattleStarted: boolean = false;
    private isGameOver: boolean = false;
    private isSuddenDeath: boolean = false;
    private sentRoundOver: boolean = false;
    private isTimerFlashing: boolean = false;

    private p1ScoreLabel: cc.Label | null = null;
    private p2ScoreLabel: cc.Label | null = null;

    onLoad() {
        // 1. 告訴引擎：失去焦點時不要自動暫停
        (cc.game as any).pauseOnBlur = false;

        // 2. 【進階強制邏輯】監聽「隱藏」事件，一旦發生隱藏就強制叫引擎恢復運作
        // 這能應付大部分瀏覽器強制節能的行為
        cc.game.on(cc.game.EVENT_HIDE, () => {
            cc.log("[Online] 檢測到視窗失焦，強制繼續運作中...");
            cc.game.resume(); // 強制恢復
        });

        // 原本的其他邏輯...
        if (!OnlineRuntime.room) {
            cc.error("[OnlineBattleManager] 無房間連線，返回 Menu。");
            cc.director.loadScene(OnlineRuntime.menuSceneName);
            return;
        }

        Health.activeInBattle = true;
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true;

        this.createScoreboard();
        this.setupBattle();
        this.bindInput();
        this.bindNetworkEvents();
    }

    onDestroy() {
        Health.activeInBattle = false;
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
        cc.systemEvent.off("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.off("ONLINE_ROUND_RESULT", this.onRoundResult, this);
        cc.systemEvent.off("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
        cc.systemEvent.off("ONLINE_SYNC_POS", this.onSyncReceived, this);
        cc.systemEvent.off("ONLINE_START_SUDDEN_DEATH", this.startSuddenDeath, this);

        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.off(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    private setupBattle() {
        // 重置狀態
        this.matchTimer = BATTLE.MATCH_TIME;
        this.countdownValue = BATTLE.COUNTDOWN_FROM;
        this.countdownTimer = 0;
        this.isBattleStarted = false;
        this.isGameOver = false;
        this.isSuddenDeath = false;
        this.sentRoundOver = false;

        // UI 初始化
        if (this.resultLabel) this.resultLabel.node.active = false;
        if (this.suddenDeathLabel) this.suddenDeathLabel.node.active = false;
        if (this.timerLabel) {
            this.timerLabel.node.stopAllActions();
            this.timerLabel.node.color = cc.Color.WHITE;
            this.timerLabel.string = String(BATTLE.MATCH_TIME);
        }
        if (this.countdownLabel) {
            this.countdownLabel.node.active = true;
            this.countdownLabel.string = String(BATTLE.COUNTDOWN_FROM);
        }

        // 建立根節點
        this.p1Root = new cc.Node("P1_ROOT");
        this.p1Root.parent = this.node;
        this.p2Root = new cc.Node("P2_ROOT");
        this.p2Root.parent = this.node;

        this.weapons = new WeaponSystem(this.bulletPrefab, this.node, {
            speed: this.bulletSpeed,
            damage: this.bulletDamage,
            lifetime: this.bulletLifetime,
        });

        // 蓋車
        this.p1Car = CarBuilder.build({
            gridData: OnlineRuntime.p1Grid,
            startPos: cc.v2(-300, 50),
            side: "PLAYER",
            root: this.p1Root,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P2")
        });

        this.p2Car = CarBuilder.build({
            gridData: OnlineRuntime.p2Grid,
            startPos: cc.v2(300, 50),
            side: "BOT",
            root: this.p2Root,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P1")
        });

        // 【修正地圖同步】：徹底移除 cc.math.seed
        if (this.mapLoader) {
            const finalSeed = OnlineRuntime.seed || 1;
            this.mapLoader.seed = finalSeed;
            if (typeof this.mapLoader.loadRandomMap === "function") {
                this.mapLoader.loadRandomMap();
            }
        }

        this.startAllPhysics(false);
        this.updateScoreboard();
    }

    private bindInput() {
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.on(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    private bindNetworkEvents() {
        cc.systemEvent.on("ONLINE_REMOTE_INPUT", this.onRemoteInput, this);
        cc.systemEvent.on("ONLINE_ROUND_RESULT", this.onRoundResult, this);
        cc.systemEvent.on("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
        cc.systemEvent.on("ONLINE_SYNC_POS", this.onSyncReceived, this);
        cc.systemEvent.on("ONLINE_START_SUDDEN_DEATH", this.startSuddenDeath, this);
    }

    update(dt: number) {
        if (this.isGameOver) return;

        // 1. 同步我的輸入 (20 FPS)
        this.sendTimer += dt;
        if (this.sendTimer >= 0.05) {
            this.sendTimer = 0;
            this.sendMyInput();
        }

        // 2. 處理倒數計時 (兩邊都會跑)
        if (!this.isBattleStarted) {
            this.updateCountdown(dt);
            return;
        }

        // 3. 主機判定邏輯
        this.updateMatchTimer(dt);

        // 4. 【核心修正】主機同步邏輯：只有主機發送位置快照
        if (OnlineRuntime.isHost()) {
            this.syncTimer += dt;
            if (this.syncTimer >= 0.1) {
                this.syncTimer = 0;
                this.sendStateSync();
            }
        }

        this.updateCooldowns(dt);
        this.applyCarControl(this.p1Car, this.p1Input, "PLAYER", 1, dt);
        this.applyCarControl(this.p2Car, this.p2Input, "BOT", 2, dt);
    }

    private updateCooldowns(dt: number) {
        this.p1GunCooldown = Math.max(0, this.p1GunCooldown - dt);
        this.p2GunCooldown = Math.max(0, this.p2GunCooldown - dt);
        this.p1MouseCooldown = Math.max(0, this.p1MouseCooldown - dt);
        this.p2MouseCooldown = Math.max(0, this.p2MouseCooldown - dt);
        this.p1MeleeCooldown = Math.max(0, this.p1MeleeCooldown - dt);
        this.p2MeleeCooldown = Math.max(0, this.p2MeleeCooldown - dt);
    }

    private updateCountdown(dt: number) {
        this.countdownTimer += dt;
        if (this.countdownTimer < 1) return;
        this.countdownTimer = 0;
        this.countdownValue--;

        if (this.countdownValue > 0) {
            if (this.countdownLabel) this.countdownLabel.string = String(this.countdownValue);
        } else {
            this.isBattleStarted = true;
            this.startAllPhysics(true);
            if (this.countdownLabel) {
                this.countdownLabel.string = "FIGHT!";
                this.scheduleOnce(() => { if (this.countdownLabel) this.countdownLabel.node.active = false; }, 1);
            }
        }
    }

    private updateMatchTimer(dt: number) {
        if (this.isSuddenDeath || this.isGameOver) return;
        this.matchTimer -= dt;

        if (this.timerLabel) {
            this.timerLabel.string = String(Math.max(0, Math.ceil(this.matchTimer)));
            if (this.matchTimer <= 5 && !this.isTimerFlashing) {
                this.isTimerFlashing = true;
                this.timerLabel.node.color = cc.Color.RED;
                cc.tween(this.timerLabel.node).repeatForever(cc.tween().to(0.5, { opacity: 50 }).to(0.5, { opacity: 255 })).start();
            }
        }

        if (this.matchTimer <= 0) {
            if (OnlineRuntime.room) OnlineRuntime.room.send("startSuddenDeath");
        }
    }

    public startSuddenDeath() {
        if (this.isSuddenDeath) return;
        this.isSuddenDeath = true;
        if (this.timerLabel) {
            this.timerLabel.node.stopAllActions();
            this.timerLabel.node.opacity = 255;
            this.timerLabel.string = "OVERTIME";
            this.timerLabel.node.color = cc.Color.RED;
        }
        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.active = true;
            cc.tween(this.suddenDeathLabel.node).repeatForever(cc.tween().to(0.5, { opacity: 0 }).to(0.5, { opacity: 255 })).start();
        }
        this.schedule(this.suddenDeathTick, BATTLE.SUDDEN_DEATH_TICK);
        this.schedule(this.spawnSuddenDeathPart, 0.5);
    }

    private suddenDeathTick() {
        if (this.isGameOver) return;
        if (this.p1Car?.coreHealth) this.p1Car.coreHealth.takeDamage(BATTLE.PLAYER_CORE_DOT);
        if (this.p2Car?.coreHealth) this.p2Car.coreHealth.takeDamage(BATTLE.BOT_CORE_DOT);
    }

    private spawnSuddenDeathPart() {
        if (this.isGameOver || this.allPrefabs.length === 0) return;
        const prefab = this.allPrefabs[Math.floor(Math.random() * this.allPrefabs.length)];
        if (!prefab) return;
        const node = cc.instantiate(prefab);
        node.parent = this.node;
        node.setPosition(Math.random() * 1000 - 500, 700);
        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic;
            rb.linearVelocity = cc.v2(0, -400);
        }
        this.scheduleOnce(() => { if (node.isValid) node.destroy(); }, 3);
    }

    // ===== 核心同步方法 =====

    private sendStateSync() {
        if (!this.p1Car || !this.p1Car.coreNode || !this.p1Car.coreNode.isValid ||
            !this.p2Car || !this.p2Car.coreNode || !this.p2Car.coreNode.isValid) {
            return;
        }
        // P1 主機發送快照
        const snapshot = {
            p1: this.getCarSnapshot(this.p1Car),
            p2: this.getCarSnapshot(this.p2Car)
        };
        OnlineRuntime.room.send("sync", snapshot);
    }

    private getCarSnapshot(car: BuiltCar) {
        if (!car || !car.coreNode) return null;
        const rb = car.coreNode.getComponent(cc.RigidBody);
        return {
            x: car.coreNode.x,
            y: car.coreNode.y,
            angle: car.coreNode.angle,
            vx: rb ? rb.linearVelocity.x : 0,
            vy: rb ? rb.linearVelocity.y : 0
        };
    }

    private onSyncReceived(msg: any) {
        if (OnlineRuntime.mySeat === "P2") {
            this.applySyncToCar(this.p1Car, msg.p1);
            this.applySyncToCar(this.p2Car, msg.p2);
        }
    }

    private applySyncToCar(car: BuiltCar | null, data: any) {
        if (!car || !car.coreNode || !data) return;
        const rb = car.coreNode.getComponent(cc.RigidBody);
        if (!rb) return;
        car.coreNode.setPosition(data.x, data.y);
        car.coreNode.angle = data.angle;
        rb.linearVelocity = cc.v2(data.vx, data.vy);
        rb.awake = true;
    }

    private sendMyInput() {
        if (!OnlineRuntime.room) return;
        if (OnlineRuntime.mySeat === "P1") this.p1Input = this.myInput;
        else this.p2Input = this.myInput;
        OnlineRuntime.room.send("input", this.myInput);
    }

    private onRemoteInput(msg: any) {
        if (!msg || !msg.seat || !msg.input) return;
        const input = this.normalizeInput(msg.input);
        if (msg.seat === "P1") this.p1Input = input;
        else this.p2Input = input;
    }

    private reportRoundOver(winner: OnlineSeat) {
        if (!OnlineRuntime.isHost() || this.sentRoundOver) return;
        if (!OnlineRuntime.room) return;''

        cc.log(`>>> [Step 1] P1 主機偵測到死亡，向伺服器報告贏家: ${winner}`);
        this.sentRoundOver = true;
        OnlineRuntime.room.send("roundOver", { winner });
    }

    private onRoundResult(msg: any) {
        cc.log(">>> [Step 4] OnlineBattleManager 收到事件，準備倒數 3 秒回商店");
        // 如果已經在處理結算了，就不要重複進來
        if (this.isGameOver && this.sentRoundOver) return; 
        
        cc.log("[Online] 收到結算廣播，準備回商店");
        this.isGameOver = true;

        // 【關鍵修正】：不要用 unscheduleAllCallbacks
        // 改為只停止「驟死賽」相關的排程
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
        
        this.startAllPhysics(false);

        // 同步分數到本地（這解決了比分沒變的問題）
        if (msg && msg.scores) {
            OnlineRuntime.p1Wins = Number(msg.scores.P1 || 0);
            OnlineRuntime.p2Wins = Number(msg.scores.P2 || 0);
            this.updateScoreboard();
        }

        const winner = msg && msg.winner === "P2" ? "P2" : "P1";
        const iWon = winner === OnlineRuntime.mySeat;
        const matchOver = !!(msg && msg.matchOver);

        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            this.resultLabel.string = matchOver ? (iWon ? "VICTORY" : "DEFEAT") : `${winner} WIN!`;
            this.resultLabel.node.color = iWon ? cc.Color.YELLOW : cc.Color.WHITE;
        }

        // 確保跳轉指令只會被排入一次
        this.scheduleOnce(() => {
            if (matchOver) {
                OnlineRuntime.clearMatch();
                cc.director.loadScene(OnlineRuntime.menuSceneName);
            } else {
                cc.log(">>> 執行跳轉至: " + OnlineRuntime.shopSceneName);
                cc.director.loadScene(OnlineRuntime.shopSceneName);
            }
        }, 3);
    }

    private onOpponentLeft() {
        if (this.resultLabel) { this.resultLabel.node.active = true; this.resultLabel.string = "對手離線"; }
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => cc.director.loadScene(OnlineRuntime.menuSceneName), 2);
    }

    private normalizeInput(raw: any): OnlineInputState {
        return {
            worldDir: Math.max(-1, Math.min(1, Number(raw.worldDir || 0))),
            attack: !!raw.attack,
            boost: !!raw.boost,
            mouseDown: !!raw.mouseDown,
            mouseX: Number(raw.mouseX || 0),
            mouseY: Number(raw.mouseY || 0)
        };
    }

    // ... 其餘 Input 監聽方法 (onKeyDown 等) 保留不變 ...

    private startAllPhysics(dynamic: boolean) {
        const setRoot = (root: cc.Node | null) => {
            if (!root) return;
            root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
                rb.type = dynamic ? cc.RigidBodyType.Dynamic : cc.RigidBodyType.Static;
                rb.linearVelocity = cc.v2(0, 0);
                rb.angularVelocity = 0;
                rb.awake = true;
            });
        };
        setRoot(this.p1Root);
        setRoot(this.p2Root);
    }

    private applyCarControl(car: BuiltCar | null, input: OnlineInputState, side: SideGroup, index: number, dt: number) {
        if (!car) return;
        const targetSpeed = input.worldDir * Math.abs(JOINT.WHEEL_TARGET_SPEED);
        for (const j of car.wheelJoints) {
            const mul = car.wheelMultipliers.get(j) || 1;
            j.motorSpeed = targetSpeed * mul;
        }
        this.updateMelee(car, input, index);
        this.updateGuns(car, input, side, index);
        this.updateMouseCannons(car, input, side, index, dt);
    }

    private updateMelee(car: BuiltCar, input: OnlineInputState, index: number) {
        const cooldown = index === 1 ? this.p1MeleeCooldown : this.p2MeleeCooldown;
        if (!input.attack || cooldown > 0) {
            for (const j of car.weaponJoints) {
                const cur = j.getJointAngle();
                if (cur > j.lowerAngle + MELEE.REACH_TOLERANCE) { j.motorSpeed = JOINT.MELEE_RETURN_SPEED; }
            }
            return;
        }
        for (const j of car.weaponJoints) {
            const cur = j.getJointAngle();
            if (cur <= j.lowerAngle + MELEE.REACH_TOLERANCE) { j.motorSpeed = JOINT.MELEE_ATTACK_SPEED; }
            else if (cur >= j.upperAngle - MELEE.REACH_TOLERANCE) { j.motorSpeed = JOINT.MELEE_RETURN_SPEED; }
        }
        if (index === 1) this.p1MeleeCooldown = MELEE.COOLDOWN; else this.p2MeleeCooldown = MELEE.COOLDOWN;
    }

    private updateGuns(car: BuiltCar, input: OnlineInputState, side: SideGroup, index: number) {
        if (!this.weapons || !input.mouseDown || car.gunNodes.length === 0) return;
        const cooldown = index === 1 ? this.p1GunCooldown : this.p2GunCooldown;
        if (cooldown > 0) return;
        for (const gun of car.gunNodes) { this.weapons.fireFrom(gun, side); }
        if (index === 1) this.p1GunCooldown = this.gunFireInterval; else this.p2GunCooldown = this.gunFireInterval;
    }

    private updateMouseCannons(car: BuiltCar, input: OnlineInputState, side: SideGroup, index: number, _dt: number) {
        if (!this.weapons || car.mouseCannons.length === 0) return;
        for (const c of car.mouseCannons) { this.aimTurret(c, cc.v2(input.mouseX, input.mouseY)); }
        if (!input.mouseDown) return;
        const cooldown = index === 1 ? this.p1MouseCooldown : this.p2MouseCooldown;
        if (cooldown > 0) return;
        let interval = 0.18;
        for (const c of car.mouseCannons) {
            if (!c.node || !c.node.isValid) continue;
            const mc = c.node.getComponent(MouseCannon);
            if (mc) interval = mc.fireInterval;
            this.weapons.fireFrom(c.node, side, {
                speed: mc ? mc.bulletSpeed : undefined,
                damage: mc ? mc.bulletDamage : undefined,
                lifetime: mc ? mc.bulletLifetime : undefined,
                damagesAll: !!mc
            });
        }
        if (index === 1) this.p1MouseCooldown = interval; else this.p2MouseCooldown = interval;
    }

    private aimTurret(c: { node: cc.Node, joint: cc.RevoluteJoint, mountOffset: number }, targetWorld: cc.Vec2) {
        const weaponNode = c.node; const joint = c.joint;
        if (!joint || !joint.isValid) return;
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        const parent = joint.node;
        if (!weaponRb || !parent || !parent.isValid) return;
        const center = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const fp = weaponNode.getChildByName("firepoint");
        const muzzle = fp ? fp.convertToWorldSpaceAR(cc.v2(0, 0)) : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));
        const cur = Math.atan2(muzzle.y - center.y, muzzle.x - center.x) * 180 / Math.PI;
        const toTarget = targetWorld.sub(center);
        if (toTarget.mag() < 1) return;
        const aim = Math.atan2(toTarget.y, toTarget.x) * 180 / Math.PI;
        const base = parent.angle + c.mountOffset;
        let off = aim - base;
        while (off > 180) off -= 360; while (off < -180) off += 360;
        off = cc.misc.clampf(off, -MOUSE_TURRET.HALF_ARC, MOUSE_TURRET.HALF_ARC);
        const target = base + off;
        let err = target - cur;
        while (err > 180) err -= 360; while (err < -180) err += 360;
        weaponRb.angularVelocity = cc.misc.clampf(err * MOUSE_TURRET.AIM_GAIN, -MOUSE_TURRET.AIM_SPEED, MOUSE_TURRET.AIM_SPEED);
    }

    private createScoreboard() {
        const canvas = cc.find("Canvas"); if (!canvas) return;
        this.p1ScoreLabel = this.makeCornerLabel(canvas, "P1_SCORE", true, cc.color(120, 200, 255));
        this.p2ScoreLabel = this.makeCornerLabel(canvas, "P2_SCORE", false, cc.color(255, 150, 90));
        this.updateScoreboard();
    }

    private makeCornerLabel(canvas: cc.Node, name: string, left: boolean, color: cc.Color): cc.Label {
        const node = new cc.Node(name); node.parent = canvas; node.zIndex = 100; node.color = color;
        const label = node.addComponent(cc.Label); label.fontSize = 40; label.lineHeight = 44;
        label.horizontalAlign = left ? cc.Label.HorizontalAlign.LEFT : cc.Label.HorizontalAlign.RIGHT;
        const widget = node.addComponent(cc.Widget); widget.isAlignTop = true; widget.top = 24;
        if (left) { widget.isAlignLeft = true; widget.left = 30; node.anchorX = 0; }
        else { widget.isAlignRight = true; widget.right = 30; node.anchorX = 1; }
        widget.updateAlignment(); return label;
    }

    private updateScoreboard() {
        if (this.p1ScoreLabel) this.p1ScoreLabel.string = `P1  ${OnlineRuntime.p1Wins}`;
        if (this.p2ScoreLabel) this.p2ScoreLabel.string = `${OnlineRuntime.p2Wins}  P2`;
    }

    private onKeyDown(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a: case cc.macro.KEY.left: this.leftDown = true; break;
            case cc.macro.KEY.d: case cc.macro.KEY.right: this.rightDown = true; break;
            case cc.macro.KEY.space: this.myInput.attack = true; break;
            case cc.macro.KEY.w: case cc.macro.KEY.up: this.myInput.boost = true; break;
        }
        this.refreshMoveDir();
    }

    private onKeyUp(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a: case cc.macro.KEY.left: this.leftDown = false; break;
            case cc.macro.KEY.d: case cc.macro.KEY.right: this.rightDown = false; break;
            case cc.macro.KEY.space: this.myInput.attack = false; break;
            case cc.macro.KEY.w: case cc.macro.KEY.up: this.myInput.boost = false; break;
        }
        this.refreshMoveDir();
    }

    private refreshMoveDir() {
        if (this.leftDown && !this.rightDown) this.myInput.worldDir = -1;
        else if (this.rightDown && !this.leftDown) this.myInput.worldDir = 1;
        else this.myInput.worldDir = 0;
    }

    private onMouseMove(event: cc.Event.EventMouse) {
        const canvas = cc.find("Canvas") || this.node;
        const loc = event.getLocation();
        const world = canvas.convertToWorldSpaceAR(canvas.convertToNodeSpaceAR(loc));
        this.myInput.mouseX = world.x; this.myInput.mouseY = world.y;
    }

    private onMouseDown(event: cc.Event.EventMouse) {
        if (event.getButton && event.getButton() !== cc.Event.EventMouse.BUTTON_LEFT) return;
        this.myInput.mouseDown = true; this.onMouseMove(event);
    }

    private onMouseUp() { this.myInput.mouseDown = false; }
}