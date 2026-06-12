// BattleManager.ts
// 協調者：車輛生成→CarBuilder、關節→JointFactory、子彈→WeaponSystem、敵方→BotAI、常數→core/GameConstants。
//
// 本批次新增（不動任何 @property，記分板用程式生成）：
//   - 左上/右上記分板（第 1 點）
//   - 滑鼠瞄準砲開火（第 2 點，配合 MouseCannon 組件）
//   - 空中左右旋轉（第 5 點，A/D 對核心施扭矩）
//   - 噴射輪 boost（第 4 點，W / ↑ 觸發 WheelAbility.applyJet）

import GameManager from "./GameManager";
import { PHYSICS, BATTLE, GROUP, AIR, FLOW, DEBUG, HITFX } from "./core/GameConstants";
import CarBuilder, { BuiltCar } from "./battle/CarBuilder";
import BotAI from "./battle/BotAI";
import WeaponSystem from "./battle/WeaponSystem";
import Bullet from "./Bullet";
import StuckRescue from "./battle/StuckRescue";
import CarCtrl from "./battle/CarCtrl";
import BattleNetSync, { INetBattle } from "./battle/BattleNetSync";
import Seesaw from "./map/Seesaw";
import OnlineRuntime, { OnlineInputState, OnlineSeat } from "./online/OnlineRuntime";
import FirebaseService from "./net/FirebaseService";
import MapLoader from "./map/MapLoader";
import HitFeedback from "./fx/HitFeedback";
import Health from "./HealthManager";

const { ccclass, property } = cc._decorator;

type BattleMode = "LOCAL" | "HOST" | "CLIENT";

@ccclass
export default class BattleManager extends cc.Component implements INetBattle {

    // ===== 編輯器綁定（請勿更動欄位集合）=====
    @property(cc.Label) timerLabel: cc.Label | null = null;
    @property(cc.Label) suddenDeathLabel: cc.Label | null = null;
    @property(cc.Label) countdownLabel: cc.Label | null = null;
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = [];
    @property(cc.Prefab) settingsPrefab: cc.Prefab | null = null;
    @property(cc.Label) resultLabel: cc.Label | null = null;

    // 預設地圖載入器（選填）：拉進來就會在每次開局重新隨機挑一張地圖；留空則由 MapLoader 自己在 start() 載入第一張
    @property(MapLoader) mapLoader: MapLoader | null = null;

    @property(cc.AudioClip) bgmClip: cc.AudioClip | null = null;
    @property(cc.AudioClip) suddenDeathSfx: cc.AudioClip | null = null;
    @property(cc.AudioClip) countdownBgmClip: cc.AudioClip | null = null;
    @property(cc.AudioClip) victorySfx: cc.AudioClip | null = null;
    @property(cc.AudioClip) defeatSfx: cc.AudioClip | null = null;

    @property(cc.Prefab) bulletPrefab: cc.Prefab | null = null;
    @property gunFireInterval: number = 0.25;
    @property botGunFireInterval: number = 0.9;
    @property bulletSpeed: number = 1600;
    @property bulletDamage: number = 20;
    @property bulletLifetime: number = 3;

    // ===== 戰鬥狀態 =====
    private matchTimer: number = BATTLE.MATCH_TIME;
    private isSuddenDeath = false;
    private isBattleStarted = false;
    private isTimerFlashing = false;
    private isGameOver = false;
    private wasPaused = false;

    private startCountdownTimer = 0;
    private startCountdownValue = BATTLE.COUNTDOWN_FROM;

    // 本機這台車（玩家）的輸入，統一用 OnlineInputState 結構（worldDir A/左=+1、D/右=-1，沿用本地慣例）
    private localInput: OnlineInputState = { worldDir: 0, attack: false, boost: false, mouseDown: false, mouseX: 0, mouseY: 0 };

    private playerRoot: cc.Node | null = null;
    private botRoot: cc.Node | null = null;

    private playerCar: BuiltCar | null = null;
    private botCar: BuiltCar | null = null;
    private botAI: BotAI | null = null;
    private weapons: WeaponSystem | null = null;

    // 逐車控制器：玩家車（本地/線上己方）的完整操控
    private ctrlA: CarCtrl | null = null;
    // 線上 host：對手（P2）車的控制器（吃網路輸入）
    private ctrlB: CarCtrl | null = null;
    private botRescue: StuckRescue | null = null;

    // 模式：LOCAL=單機 / HOST=線上主機(P1) / CLIENT=線上純畫面端(P2)
    private mode: BattleMode = "LOCAL";
    private net: BattleNetSync | null = null;
    private sendTimer = 0;
    private syncTimer = 0;
    private sentRoundOver = false;

    // Debug 視覺（按 P 切換）
    private debugOn = DEBUG.SHOW_BOUNDS;
    private debugNode: cc.Node | null = null;
    private debugGfx: cc.Graphics | null = null;

    // 記分板
    private playerScoreLabel: cc.Label | null = null;
    private botScoreLabel: cc.Label | null = null;

    // ====================================================================
    // 生命週期
    // ====================================================================
    onLoad() {
        // 決定模式：無房間 → 單機；有房間 → 主機(P1) / 純畫面端(P2)
        this.mode = !OnlineRuntime.isOnline() ? "LOCAL" : (OnlineRuntime.isHost() ? "HOST" : "CLIENT");

        // CLIENT（線上純畫面端）完全不跑物理/傷害判定，只渲染主機快照
        Health.activeInBattle = this.mode !== "CLIENT";

        const physics = cc.director.getPhysicsManager();
        physics.enabled = this.mode !== "CLIENT";
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true;
        cc.PhysicsManager.FIXED_TIME_STEP = PHYSICS.FIXED_TIME_STEP;
        (physics as any).velocityIterations = PHYSICS.VELOCITY_ITERATIONS;
        (physics as any).positionIterations = PHYSICS.POSITION_ITERATIONS;

        // 打擊感回饋：把 HitFeedback 動態掛到主鏡頭節點（免去在 .fire 編輯器手動綁定）
        this.setupHitFeedback();

        this.createScoreboard();
        this.setupBattle();

        // 線上：建立網路同步層並綁定回合結算/對手離線事件
        if (this.mode !== "LOCAL") {
            this.net = new BattleNetSync(this);
            this.net.bindEvents();
            cc.systemEvent.on("ONLINE_ROUND_RESULT", this.onRoundResult, this);
            cc.systemEvent.on("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
        }

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        // 滑鼠事件用 capture 階段監聽，並回退到自身節點，避免被上層 UI 攔截而收不到
        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.on(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.on(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    onDestroy() {
        Health.activeInBattle = false;   // 離開戰鬥場景 → 關閉（商店等場景不顯示血條/不判傷）
        HitFeedback.onTrigger = null;    // 清掉 static hook，避免殘留指向已銷毀的實例
        if (this.net) this.net.unbindEvents();
        cc.systemEvent.off("ONLINE_ROUND_RESULT", this.onRoundResult, this);
        cc.systemEvent.off("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        const mouseTarget = cc.find("Canvas") || this.node;
        if (mouseTarget) {
            mouseTarget.off(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this, true);
            mouseTarget.off(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this, true);
        }
    }

    // ====================================================================
    // 打擊感回饋：把 HitFeedback 掛到主鏡頭節點。動態掛載避免動到 game.fire。
    // ====================================================================
    private setupHitFeedback() {
        const cam = cc.Camera.main;
        if (!cam || !cam.node) return;
        if (!cam.node.getComponent(HitFeedback)) {
            cam.node.addComponent(HitFeedback);
        }
    }

    // ====================================================================
    // 記分板（第 1 點）：左上玩家、右上敵方，程式生成所以不需編輯器拉
    // ====================================================================
    private createScoreboard() {
        const canvas = cc.find("Canvas");
        if (!canvas) return;
        this.playerScoreLabel = this.makeCornerLabel(canvas, "PLAYER_SCORE", true, cc.color(120, 200, 255));
        this.botScoreLabel = this.makeCornerLabel(canvas, "BOT_SCORE", false, cc.color(255, 150, 90));
        this.updateScoreboard();
    }

    private makeCornerLabel(canvas: cc.Node, name: string, left: boolean, color: cc.Color): cc.Label {
        const node = new cc.Node(name);
        node.parent = canvas;
        node.zIndex = 100;
        node.color = color;

        const label = node.addComponent(cc.Label);
        label.fontSize = 40;
        label.lineHeight = 44;
        label.horizontalAlign = left ? cc.Label.HorizontalAlign.LEFT : cc.Label.HorizontalAlign.RIGHT;

        const widget = node.addComponent(cc.Widget);
        widget.isAlignTop = true;
        widget.top = 24;
        if (left) {
            widget.isAlignLeft = true;
            widget.left = 30;
            node.anchorX = 0;
        } else {
            widget.isAlignRight = true;
            widget.right = 30;
            node.anchorX = 1;
        }
        widget.updateAlignment();
        return label;
    }

    private updateScoreboard() {
        if (this.mode === "LOCAL") {
            if (this.playerScoreLabel) this.playerScoreLabel.string = `PLAYER  ${GameManager.playerWins}`;
            if (this.botScoreLabel) this.botScoreLabel.string = `${GameManager.botWins}  BOT`;
        } else {
            if (this.playerScoreLabel) this.playerScoreLabel.string = `${OnlineRuntime.p1Name}  ${OnlineRuntime.p1Wins}`;
            if (this.botScoreLabel) this.botScoreLabel.string = `${OnlineRuntime.p2Wins}  ${OnlineRuntime.p2Name}`;
        }
    }

    // ==================== 線上：回合結算 ====================
    // host 偵測到某方核心死亡 → 回報伺服器贏家
    private reportRoundOver(winner: OnlineSeat) {
        if (this.mode !== "HOST" || this.sentRoundOver || !OnlineRuntime.room) return;
        this.sentRoundOver = true;
        OnlineRuntime.room.send("roundOver", { winner });
    }

    // 兩端都收到伺服器廣播的結算 → 更新比分、顯示結果、倒數回商店/選單
    private onRoundResult(msg: any) {
        if (this.isGameOver && this.sentRoundOver) return;
        this.isGameOver = true;
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
        this.startAllPhysics(false);

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
        this.scheduleOnce(() => {
            if (matchOver) { OnlineRuntime.clearMatch(); cc.director.loadScene(OnlineRuntime.menuSceneName); }
            else cc.director.loadScene(OnlineRuntime.shopSceneName);
        }, 3);
    }

    private onOpponentLeft() {
        if (this.resultLabel) { this.resultLabel.node.active = true; this.resultLabel.string = "對手離線"; }
        this.unscheduleAllCallbacks();
        this.scheduleOnce(() => cc.director.loadScene(OnlineRuntime.menuSceneName), 2);
    }

    // ====================================================================
    // 開局
    // ====================================================================
    setupBattle() {
        this.isGameOver = false;
        this.isSuddenDeath = false;
        this.isBattleStarted = false;
        this.isTimerFlashing = false;
        this.matchTimer = BATTLE.MATCH_TIME;
        this.localInput = { worldDir: 0, attack: false, boost: false, mouseDown: false, mouseX: 0, mouseY: 0 };
        this.playerCar = null;
        this.botCar = null;
        this.botAI = null;

        this.updateScoreboard();

        if (this.suddenDeathLabel) this.suddenDeathLabel.node.active = false;
        if (this.resultLabel) this.resultLabel.node.active = false;
        if (this.timerLabel) {
            this.timerLabel.node.stopAllActions();
            this.timerLabel.node.opacity = 255;
            this.timerLabel.node.color = cc.Color.WHITE;
            this.timerLabel.string = String(BATTLE.MATCH_TIME);
        }

        this.destroyCurrentBattle();

        this.playerRoot = new cc.Node("PLAYER_ROOT");
        this.playerRoot.parent = this.node;
        this.botRoot = new cc.Node("BOT_ROOT");
        this.botRoot.parent = this.node;

        // 子彈系統（子彈掛在 BattleManager 所在節點底下）
        this.weapons = new WeaponSystem(this.bulletPrefab, this.node, {
            speed: this.bulletSpeed,
            damage: this.bulletDamage,
            lifetime: this.bulletLifetime,
        });
        // 線上 host：把槍口火光與打擊火花累積起來，隨快照同步給對手畫面
        if (this.mode === "HOST") {
            this.weapons.onMuzzle = (pos, dir) => { if (this.net) this.net.recordMuzzle(pos, dir); };
            // 只同步一般傷害火花；零件擊破等級（HITSTOP_DAMAGE）client 端會自己由 disjointPart 產生
            HitFeedback.onTrigger = (pos, dmg) => {
                if (this.net && dmg < HITFX.HITSTOP_DAMAGE) this.net.recordHit(pos, dmg / HITFX.HITSTOP_DAMAGE);
            };
        }

        this.sentRoundOver = false;
        if (this.mode === "LOCAL") this.setupLocalCars();
        else this.setupOnlineCars();

        this.startCountdownTimer = 0;
        this.startCountdownValue = BATTLE.COUNTDOWN_FROM;
        if (this.countdownLabel) {
            this.countdownLabel.node.active = true;
            this.countdownLabel.string = String(BATTLE.COUNTDOWN_FROM);
        }
        if (this.countdownBgmClip) {
            cc.audioEngine.stopMusic();
            cc.audioEngine.playMusic(this.countdownBgmClip, false);
        }
    }

    // 單機：玩家車（右）＋ 倒數時生成 Bot（左）
    private setupLocalCars() {
        this.playerCar = CarBuilder.build({
            gridData: GameManager.playerCarGrid,
            startPos: cc.v2(300, 0),
            side: "PLAYER",
            root: this.playerRoot!,
            prefabs: this.allPrefabs,
            onCoreDie: (winner) => this.handleGameOver(winner),
        });
        // 玩家車已建好 → 重新挑一張預設地圖（避免車的物件壓在玩家身上）
        if (this.mapLoader) this.mapLoader.loadRandomMap();
        this.ctrlA = new CarCtrl(this.playerCar, this.playerRoot!, "PLAYER", this.weapons!, {
            useWallRide: FLOW.USE_WALLRIDE,
            useStuckRescue: FLOW.USE_STUCK_RESCUE,
            airBoundary: this.mapLoader ? this.mapLoader.getBoundary() : null,
            gunFireInterval: this.gunFireInterval,
        });
    }

    // 線上：兩台真人車一開始就建好（P1 左、P2 右鏡像）。host 才建控制器並先靜止等倒數。
    private setupOnlineCars() {
        if (this.mapLoader) this.mapLoader.seed = OnlineRuntime.seed || 1;

        this.playerCar = CarBuilder.build({
            gridData: OnlineRuntime.p1Grid,
            startPos: cc.v2(-300, 50),
            side: "PLAYER",
            root: this.playerRoot!,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P2"),
        });
        this.botCar = CarBuilder.build({
            gridData: OnlineRuntime.p2Grid,
            startPos: cc.v2(300, 50),
            side: "BOT",
            root: this.botRoot!,
            prefabs: this.allPrefabs,
            onCoreDie: () => this.reportRoundOver("P1"),
        });
        if (this.botCar && this.botCar.coreNode) this.botCar.coreNode.angle = 180;
        if (this.botRoot) this.botRoot.angle = 180;

        if (this.mapLoader) this.mapLoader.loadRandomMap();

        if (this.mode === "HOST") {
            const boundary = this.mapLoader ? this.mapLoader.getBoundary() : null;
            // P1（己方、非鏡像）：完整手感，與本地玩家車一致
            this.ctrlA = new CarCtrl(this.playerCar, this.playerRoot!, "PLAYER", this.weapons!, {
                useWallRide: FLOW.USE_WALLRIDE, useStuckRescue: FLOW.USE_STUCK_RESCUE,
                airBoundary: boundary, gunFireInterval: this.gunFireInterval,
            });
            // P2（對手、scaleX=-1 + root 180）：關掉 WallRide/AirPhysics/StuckRescue，
            // 這幾套對「鏡像/旋轉車」的計算會把車塞進牆（沿用舊線上對 P2 的最小控制）。
            this.ctrlB = new CarCtrl(this.botCar, this.botRoot!, "BOT", this.weapons!, {
                useWallRide: false, useAirPhysics: false, useStuckRescue: false,
                airBoundary: boundary, gunFireInterval: this.gunFireInterval,
            });
        }
        // 倒數期間先靜止，倒數結束 host 才轉 Dynamic（client 物理已關閉）
        this.startAllPhysics(false);
    }

    destroyCurrentBattle() {
        if (this.playerRoot && this.playerRoot.isValid) this.playerRoot.destroy();
        if (this.botRoot && this.botRoot.isValid) this.botRoot.destroy();
        this.recycleLiveBullets();
        this.ctrlA = null;
        this.ctrlB = null;
        this.botRescue = null;
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
    }

    // 回合結束把仍在飛的子彈收回池子（子彈掛在 this.node 底下）。
    // 走 explode() 而非直接 put：explode 會先 unscheduleAllCallbacks，
    // 清掉殘留的存活倒數，避免之後計時觸發造成重複回收（同一節點被 put 兩次）。
    private recycleLiveBullets() {
        const children = this.node.children.slice();   // 複製：回收會改動 children
        for (const c of children) {
            const b = c.getComponent(Bullet);
            if (b) b.explode();
        }
    }

    private spawnBotSequence() {
        if (!this.botRoot) return;
        const totalRounds = GameManager.playerWins + GameManager.botWins;
        const botIndex = totalRounds <= 1 ? 0 : (totalRounds <= 3 ? 1 : 2);

        if (GameManager.botConfigs && GameManager.botConfigs.length > botIndex) {
            this.botCar = CarBuilder.build({
                gridData: GameManager.botConfigs[botIndex],
                startPos: cc.v2(-300, 50),
                side: "BOT",
                root: this.botRoot,
                prefabs: this.allPrefabs,
                onCoreDie: (winner) => this.handleGameOver(winner),
            });
            this.botAI = new BotAI(this.botCar, this.botGunFireInterval);
            this.botRescue = FLOW.USE_STUCK_RESCUE
                ? new StuckRescue(this.botCar, this.botRoot, GROUP.BOT_PART, this.coreWorldPos(this.botCar) || cc.v2(0, 0))
                : null;
        }
    }

    private startAllPhysics(dynamic: boolean = true) {
        const activate = (root: cc.Node | null) => {
            if (!root) return;
            root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
                rb.type = dynamic ? cc.RigidBodyType.Dynamic : cc.RigidBodyType.Static;
                rb.linearVelocity = cc.v2(0, 0);
                rb.angularVelocity = 0;
                rb.awake = true;
            });
        };
        activate(this.playerRoot);
        activate(this.botRoot);
    }

    // ====================================================================
    // 主迴圈
    // ====================================================================
    update(dt: number) {
        if (GameManager.isPaused !== this.wasPaused) {
            if (GameManager.isPaused) cc.audioEngine.pauseMusic();
            else cc.audioEngine.resumeMusic();
            this.wasPaused = GameManager.isPaused;
        }

        if (this.isGameOver || GameManager.isPaused) return;

        // CLIENT（純畫面端）：只送輸入，畫面全由 BattleNetSync 套用主機快照
        if (this.mode === "CLIENT") {
            this.sendTimer += dt;
            if (this.sendTimer >= 0.05) { this.sendTimer = 0; if (this.net) this.net.sendInput(this.localInput); }
            if (this.net) this.net.updateHud(this.isBattleStarted);
            return;
        }

        // HOST：把己方輸入送出（對手會送來他的；對稱送出最簡單）
        if (this.mode === "HOST") {
            this.sendTimer += dt;
            if (this.sendTimer >= 0.05) { this.sendTimer = 0; if (this.net) this.net.sendInput(this.localInput); }
        }

        if (!this.isBattleStarted) {
            this.updateCountdown(dt);
            if (this.mode === "HOST") this.broadcastIfHost(dt);   // 倒數期間也廣播，讓 client 鏡像
            if (this.net) this.net.updateHud(this.isBattleStarted);
            return;
        }

        // 單機：Bot AI 驅動敵方車
        if (this.mode === "LOCAL" && this.botAI && this.playerRoot && this.botRoot && this.weapons) {
            this.botAI.update(dt, this.playerRoot, this.botRoot, this.weapons);
        }

        this.updateMatchTimer(dt);

        // 己方車：完整逐車操控
        if (this.ctrlA) this.ctrlA.update(this.localInput, dt, this.coreWorldPos(this.botCar));

        if (this.mode === "LOCAL") {
            // Bot 卡住自救（敵方由 BotAI 驅動）
            if (this.botRescue) this.botRescue.update(dt, !!this.botAI, this.coreWorldPos(this.playerCar));
        } else if (this.mode === "HOST") {
            // 對手車（P2）：吃網路輸入、走同一套 CarCtrl → 與本地手感一致
            if (this.ctrlB && this.net) this.ctrlB.update(this.net.getRemoteInput(), dt, this.coreWorldPos(this.playerCar));
            this.broadcastIfHost(dt);
        }

        this.updateDebugDraw();
        if (this.net) this.net.updateHud(this.isBattleStarted);
    }

    private broadcastIfHost(dt: number) {
        this.syncTimer += dt;
        if (this.syncTimer >= 0.05) {
            this.syncTimer = 0;
            if (this.net) this.net.broadcast({ started: this.isBattleStarted, countdown: this.startCountdownValue, timer: this.matchTimer });
        }
    }

    private updateCountdown(dt: number) {
        this.startCountdownTimer += dt;
        if (this.startCountdownTimer < 1) return;

        this.startCountdownTimer = 0;
        this.startCountdownValue--;

        if (this.startCountdownValue > 0) {
            if (this.countdownLabel) this.countdownLabel.string = String(this.startCountdownValue);
            // 單機：在倒數 1 時才生成 Bot（線上兩台車一開始就建好）
            if (this.mode === "LOCAL" && this.startCountdownValue === 1) this.spawnBotSequence();
        } else {
            if (this.countdownLabel) this.countdownLabel.string = "FIGHT!";
            this.isBattleStarted = true;
            this.startAllPhysics(true);

            if (this.bgmClip) {
                const clip = this.bgmClip;
                this.scheduleOnce(() => {
                    cc.audioEngine.stopMusic();
                    cc.audioEngine.playMusic(clip, true);
                }, 1.0);
            }
            this.scheduleOnce(() => {
                if (this.countdownLabel) this.countdownLabel.node.active = false;
            }, 1);
        }
    }

    private updateMatchTimer(dt: number) {
        if (this.isSuddenDeath) return;

        this.matchTimer -= dt;
        if (this.timerLabel) {
            this.timerLabel.string = Math.ceil(this.matchTimer).toString();

            if (this.matchTimer <= 5 && !this.isTimerFlashing) {
                this.isTimerFlashing = true;
                this.timerLabel.node.color = cc.Color.RED;
                cc.tween(this.timerLabel.node)
                    .repeatForever(cc.tween().to(0.5, { opacity: 50 }).to(0.5, { opacity: 255 }))
                    .start();
            }
        }

        if (this.matchTimer <= 0) this.startSuddenDeath();
    }

    // ====================================================================
    // Debug 視覺（按 P 切換）：畫每個零件的碰撞邊界、接觸探測射線、質心。
    // 零件外框：綠=AirPhysics 接管中（kinematic，零件不會飄）、紅=交給 Box2D。
    // 探測射線：橘=有命中（被視為「接觸中」→ 無法進入空中接管）、藍=沒命中。
    // 黃色十字=空中物理算出的質心。用來確認「空中翻滾到底是不是自己的物理在跑」。
    // ====================================================================
    private updateDebugDraw() {
        if (!this.debugOn) { if (this.debugGfx) this.debugGfx.clear(); return; }
        if (!this.debugGfx) {
            const canvas = cc.find("Canvas");
            if (!canvas) return;
            this.debugNode = new cc.Node("DebugDraw");
            this.debugNode.parent = canvas;
            this.debugNode.setPosition(0, 0);
            this.debugNode.zIndex = cc.macro.MAX_ZINDEX - 1;
            this.debugGfx = this.debugNode.addComponent(cc.Graphics);
        }
        const g = this.debugGfx;
        g.clear();
        if (!this.playerRoot || !this.playerRoot.isValid) return;

        const toLocal = (w: cc.Vec2) => this.debugNode!.parent!.convertToNodeSpaceAR(w);
        const airPhysics = this.ctrlA ? this.ctrlA.airPhysics : null;
        const active = !!(airPhysics && airPhysics.isActive());
        const partCol = active ? cc.color(60, 220, 90) : cc.color(230, 70, 70);
        const pm = cc.director.getPhysicsManager();
        const dirs = [cc.v2(0, -1), cc.v2(0, 1), cc.v2(-1, 0), cc.v2(1, 0)];

        this.playerRoot.getComponentsInChildren(cc.RigidBody).forEach(rb => {
            const nd = rb.node;
            if (!nd || !nd.isValid || nd.group !== GROUP.PLAYER_PART) return;

            // 碰撞邊界外框
            g.lineWidth = 2; g.strokeColor = partCol;
            const box = nd.getComponent(cc.PhysicsBoxCollider);
            const circle = nd.getComponent(cc.PhysicsCircleCollider);
            if (box) {
                const hw = box.size.width / 2, hh = box.size.height / 2, ox = box.offset.x, oy = box.offset.y;
                const corners = [cc.v2(-hw + ox, -hh + oy), cc.v2(hw + ox, -hh + oy), cc.v2(hw + ox, hh + oy), cc.v2(-hw + ox, hh + oy)];
                const w = corners.map(c => toLocal(nd.convertToWorldSpaceAR(c)));
                g.moveTo(w[0].x, w[0].y);
                for (let i = 1; i < 4; i++) g.lineTo(w[i].x, w[i].y);
                g.close(); g.stroke();
            } else if (circle) {
                const c = toLocal(nd.convertToWorldSpaceAR(cc.v2(circle.offset.x, circle.offset.y)));
                g.circle(c.x, c.y, circle.radius); g.stroke();
            }

            // 接觸探測射線
            const o = nd.convertToWorldSpaceAR(cc.v2(0, 0));
            const len = Math.max(nd.width, nd.height, 40) * 0.5 + AIR.CONTACT_PROBE;
            for (const d of dirs) {
                const end = cc.v2(o.x + d.x * len, o.y + d.y * len);
                const hits = pm.rayCast(o, end, cc.RayCastType.All);
                let hit = false;
                for (const h of hits) {
                    const gg = h.collider.node.group;
                    if (gg !== GROUP.PLAYER_PART && gg !== GROUP.PLAYER_BULLET) { hit = true; break; }
                }
                g.lineWidth = 1; g.strokeColor = hit ? cc.color(255, 170, 0) : cc.color(120, 120, 255);
                const a = toLocal(o), b = toLocal(end);
                g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
            }
        });

        // 質心
        if (active && airPhysics) {
            const cm = toLocal(airPhysics.getCoM());
            g.lineWidth = 2; g.strokeColor = cc.color(255, 240, 0);
            g.moveTo(cm.x - 12, cm.y); g.lineTo(cm.x + 12, cm.y);
            g.moveTo(cm.x, cm.y - 12); g.lineTo(cm.x, cm.y + 12);
            g.stroke();
            g.circle(cm.x, cm.y, 14); g.stroke();
        }
    }

    private coreWorldPos(car: BuiltCar | null): cc.Vec2 | null {
        if (!car || !car.coreNode || !car.coreNode.isValid) return null;
        return car.coreNode.convertToWorldSpaceAR(cc.v2(0, 0));
    }

    // ==================== INetBattle（提供給 BattleNetSync）====================
    getP1Car(): BuiltCar | null { return this.playerCar; }
    getP2Car(): BuiltCar | null { return this.botCar; }
    getSeesawNodes(): cc.Node[] {
        if (!this.mapLoader || !this.mapLoader.node) return [];
        const comps = this.mapLoader.node.getComponentsInChildren(Seesaw);
        return comps.map((c: any) => c.node).filter((n: cc.Node) => n && n.isValid);
    }
    onClientFight() {
        this.isBattleStarted = true;
        if (this.countdownLabel) {
            this.countdownLabel.string = "FIGHT!";
            this.scheduleOnce(() => { if (this.countdownLabel) this.countdownLabel.node.active = false; }, 1);
        }
    }

    // ====================================================================
    // 驟死
    // ====================================================================
    startSuddenDeath() {
        if (this.isSuddenDeath) return;
        this.isSuddenDeath = true;

        if (this.timerLabel) {
            this.timerLabel.node.stopAllActions();
            this.timerLabel.node.opacity = 255;
            this.timerLabel.string = "OVERTIME";
        }
        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.active = true;
            cc.tween(this.suddenDeathLabel.node)
                .repeatForever(cc.tween().to(0.5, { opacity: 0 }).to(0.5, { opacity: 255 }))
                .start();
        }
        if (this.suddenDeathSfx) cc.audioEngine.playEffect(this.suddenDeathSfx, false);

        for (let i = 0; i < BATTLE.SUDDEN_DEATH_PARTS; i++) {
            this.scheduleOnce(() => {
                if (!this.isGameOver && GameManager.isPaused === false) this.spawnSuddenDeathPart();
            }, i * 0.01);
        }

        this.schedule(this.suddenDeathTick, BATTLE.SUDDEN_DEATH_TICK);
    }

    suddenDeathTick() {
        if (this.isGameOver || GameManager.isPaused) return;
        if (this.playerCar && this.playerCar.coreHealth) {
            this.playerCar.coreHealth.takeDamage(BATTLE.PLAYER_CORE_DOT);
        }
        if (this.botCar && this.botCar.coreHealth) {
            this.botCar.coreHealth.takeDamage(BATTLE.BOT_CORE_DOT);
        }
    }

    spawnSuddenDeathPart() {
        if (this.isGameOver || GameManager.isPaused || this.allPrefabs.length === 0) return;

        const idx = Math.floor(Math.random() * this.allPrefabs.length);
        const prefab = this.allPrefabs[idx];
        if (!prefab) return;

        const node = cc.instantiate(prefab);
        // 線上：掛在 this.node 下並登記給網路層同步（client 視覺池也以 this.node 為父，座標一致）
        node.parent = this.mode === "LOCAL" ? this.node.parent : this.node;
        node.setPosition(Math.random() * 1200, 600);
        node.group = GROUP.DEFAULT;

        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic;
            rb.linearVelocity = cc.v2(0, -300);
            rb.angularVelocity = (Math.random() - 0.5) * 500;
        }
        if (this.mode === "HOST" && this.net) this.net.registerDebris(node, idx);

        cc.tween(node)
            .delay(4)
            .to(0.5, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    // ====================================================================
    // 勝負
    // ====================================================================
    handleGameOver(winner: "PLAYER" | "BOT") {
        if (this.isGameOver) return;
        this.isGameOver = true;

        cc.audioEngine.stopMusic();
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);

        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.stopAllActions();
            this.suddenDeathLabel.node.active = false;
        }

        GameManager.gold += BATTLE.WIN_GOLD;

        if (winner === "PLAYER") {
            GameManager.playerWins++;
            if (this.victorySfx) cc.audioEngine.playEffect(this.victorySfx, false);
        } else {
            GameManager.botWins++;
            if (this.defeatSfx) cc.audioEngine.playEffect(this.defeatSfx, false);
        }

        this.updateScoreboard();

        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            if (GameManager.playerWins >= BATTLE.WINS_TO_FINISH) {
                this.resultLabel.string = "VICTORY";
                this.resultLabel.node.color = cc.Color.YELLOW;
            } else if (GameManager.botWins >= BATTLE.WINS_TO_FINISH) {
                this.resultLabel.string = "DEFEAT";
                this.resultLabel.node.color = cc.Color.RED;
            } else {
                this.resultLabel.string = winner + " WIN!";
                this.resultLabel.node.color = cc.Color.WHITE;
            }
        }

        this.scheduleOnce(() => this.goToNextScene(), 3);
    }

    private goToNextScene() {
        const finished = GameManager.playerWins >= BATTLE.WINS_TO_FINISH
            || GameManager.botWins >= BATTLE.WINS_TO_FINISH;

        let target = "Shop";
        if (finished) {
            if (GameManager.playerWins >= BATTLE.WINS_TO_FINISH) {
                // 玩家贏得整場 → 記錄到 Firebase（未登入 / 未設定時為安全的 no-op）
                FirebaseService.incrementWins();
                FirebaseService.submitBestScore(GameManager.playerWins);
            }
            GameManager.resetAllData();
            target = "Menu";
        } else if (FLOW && FLOW.USE_SCRAMBLE) {   // FLOW 防呆：未定義時直接走商店，不讓它丟例外卡住
            target = FLOW.SCRAMBLE_SCENE;
        }

        cc.log(`[BattleManager] 回合結束 → 載入「${target}」 (P:${GameManager.playerWins}/B:${GameManager.botWins}, USE_SCRAMBLE=${FLOW ? FLOW.USE_SCRAMBLE : "undefined"})`);
        cc.director.loadScene(target);
    }

    // ====================================================================
    // 輸入
    // ====================================================================
    onKeyDown(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.localInput.worldDir = 1;   // 本地慣例：A/左 = +1
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.localInput.worldDir = -1;
                break;
            case cc.macro.KEY.space:
                this.localInput.attack = true;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.localInput.boost = true;   // 噴射 boost
                break;
            case cc.macro.KEY.p:
                this.debugOn = !this.debugOn;   // 切換 debug 邊界視覺
                cc.log(`[Debug] bounds ${this.debugOn ? "ON" : "OFF"}`);
                break;
            // S / 下：不再做爆發式脫離。下牆改用「反向輸入減速」（按與爬升相反的 A/D）。
        }
    }

    onKeyUp(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                if (this.localInput.worldDir === 1) this.localInput.worldDir = 0;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                if (this.localInput.worldDir === -1) this.localInput.worldDir = 0;
                break;
            case cc.macro.KEY.space:
                this.localInput.attack = false;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.localInput.boost = false;
                break;
        }
    }

    // 滑鼠：直接用 getLocation 當世界座標（與遊戲既有的節點世界座標系一致）
    private onMouseMove(e: cc.Event.EventMouse) {
        const p = e.getLocation();
        this.localInput.mouseX = p.x;
        this.localInput.mouseY = p.y;
    }

    private onMouseDown(e: cc.Event.EventMouse) {
        if (e.getButton() === cc.Event.EventMouse.BUTTON_LEFT) {
            this.localInput.mouseDown = true;
            this.onMouseMove(e);
        }
    }

    private onMouseUp(e: cc.Event.EventMouse) {
        if (e.getButton() === cc.Event.EventMouse.BUTTON_LEFT) {
            this.localInput.mouseDown = false;
        }
    }

    onOpenSettings() {
        if (!this.settingsPrefab) return;

        const node = cc.instantiate(this.settingsPrefab);
        node.name = "SettingsUI";
        const canvas = cc.find("Canvas");
        node.parent = canvas;
        node.setPosition(0, 0);
        node.zIndex = 10;

        GameManager.isPaused = true;
        cc.audioEngine.pauseMusic();
    }
}