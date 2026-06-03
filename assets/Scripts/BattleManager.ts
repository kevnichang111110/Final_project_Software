// BattleManager.ts
// 協調者：車輛生成→CarBuilder、關節→JointFactory、子彈→WeaponSystem、敵方→BotAI、常數→core/GameConstants。
//
// 本批次新增（不動任何 @property，記分板用程式生成）：
//   - 左上/右上記分板（第 1 點）
//   - 滑鼠瞄準砲開火（第 2 點，配合 MouseCannon 組件）
//   - 空中左右旋轉（第 5 點，A/D 對核心施扭矩）
//   - 噴射輪 boost（第 4 點，W / ↑ 觸發 WheelAbility.applyJet）

import GameManager from "./GameManager";
import { PHYSICS, BATTLE, JOINT, GROUP, AIR, FLOW } from "./core/GameConstants";
import CarBuilder, { BuiltCar } from "./battle/CarBuilder";
import BotAI from "./battle/BotAI";
import WeaponSystem from "./battle/WeaponSystem";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    // ===== 編輯器綁定（請勿更動欄位集合）=====
    @property(cc.Label) timerLabel: cc.Label | null = null;
    @property(cc.Label) suddenDeathLabel: cc.Label | null = null;
    @property(cc.Label) countdownLabel: cc.Label | null = null;
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = [];
    @property(cc.Prefab) settingsPrefab: cc.Prefab | null = null;
    @property(cc.Label) resultLabel: cc.Label | null = null;

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

    private moveDir = 0;
    private isAttacking = false;
    private isBoosting = false;          // 噴射 boost（W / ↑）
    private wheelSpeed = 0;
    private playerGunCooldown = 0;

    // 滑鼠砲
    private isMouseDown = false;
    private mouseWorldPos: cc.Vec2 = cc.v2(0, 0);
    private mouseCannonCooldown = 0;

    private playerRoot: cc.Node | null = null;
    private botRoot: cc.Node | null = null;

    private playerCar: BuiltCar | null = null;
    private botCar: BuiltCar | null = null;
    private botAI: BotAI | null = null;
    private weapons: WeaponSystem | null = null;

    // 記分板
    private playerScoreLabel: cc.Label | null = null;
    private botScoreLabel: cc.Label | null = null;

    // ====================================================================
    // 生命週期
    // ====================================================================
    onLoad() {
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true;
        cc.PhysicsManager.FIXED_TIME_STEP = PHYSICS.FIXED_TIME_STEP;
        (physics as any).velocityIterations = PHYSICS.VELOCITY_ITERATIONS;
        (physics as any).positionIterations = PHYSICS.POSITION_ITERATIONS;

        this.createScoreboard();
        this.setupBattle();

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        const canvas = cc.find("Canvas");
        if (canvas) {
            canvas.on(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
            canvas.on(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
            canvas.on(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this);
        }
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        const canvas = cc.find("Canvas");
        if (canvas) {
            canvas.off(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
            canvas.off(cc.Node.EventType.MOUSE_DOWN, this.onMouseDown, this);
            canvas.off(cc.Node.EventType.MOUSE_UP, this.onMouseUp, this);
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
        if (this.playerScoreLabel) this.playerScoreLabel.string = `PLAYER  ${GameManager.playerWins}`;
        if (this.botScoreLabel) this.botScoreLabel.string = `${GameManager.botWins}  BOT`;
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
        this.moveDir = 0;
        this.isAttacking = false;
        this.isBoosting = false;
        this.isMouseDown = false;
        this.wheelSpeed = 0;
        this.playerGunCooldown = 0;
        this.mouseCannonCooldown = 0;
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

        // 生成玩家車
        this.playerCar = CarBuilder.build({
            gridData: GameManager.playerCarGrid,
            startPos: cc.v2(300, 0),
            side: "PLAYER",
            root: this.playerRoot,
            prefabs: this.allPrefabs,
            onCoreDie: (winner) => this.handleGameOver(winner),
        });

        // 開場倒數
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

    destroyCurrentBattle() {
        if (this.playerRoot && this.playerRoot.isValid) this.playerRoot.destroy();
        if (this.botRoot && this.botRoot.isValid) this.botRoot.destroy();
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
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
        }
    }

    private startAllPhysics() {
        const activate = (root: cc.Node | null) => {
            if (!root) return;
            root.getComponentsInChildren(cc.RigidBody).forEach(rb => {
                rb.type = cc.RigidBodyType.Dynamic;
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

        if (!this.isBattleStarted) {
            this.updateCountdown(dt);
            return;
        }

        this.updatePlayerGun(dt);
        this.updateMouseCannons(dt);

        if (this.botAI && this.playerRoot && this.botRoot && this.weapons) {
            this.botAI.update(dt, this.playerRoot, this.botRoot, this.weapons);
        }

        this.updateMatchTimer(dt);
        this.updatePlayerMovement();
        this.updateAirRotation();
        this.updateJet();
        this.updatePlayerMelee();
    }

    private updateCountdown(dt: number) {
        this.startCountdownTimer += dt;
        if (this.startCountdownTimer < 1) return;

        this.startCountdownTimer = 0;
        this.startCountdownValue--;

        if (this.startCountdownValue === 1) {
            if (this.countdownLabel) this.countdownLabel.string = "1";
            this.spawnBotSequence();
        } else if (this.startCountdownValue === 0) {
            if (this.countdownLabel) this.countdownLabel.string = "FIGHT!";
            this.isBattleStarted = true;
            this.startAllPhysics();

            if (this.bgmClip) {
                this.scheduleOnce(() => {
                    cc.audioEngine.stopMusic();
                    cc.audioEngine.playMusic(this.bgmClip, true);
                }, 1.0);
            }
            this.scheduleOnce(() => {
                if (this.countdownLabel) this.countdownLabel.node.active = false;
            }, 1);
        }
    }

    private updatePlayerGun(dt: number) {
        this.playerGunCooldown = Math.max(0, this.playerGunCooldown - dt);
        if (!this.playerCar || !this.weapons) return;

        if (this.isAttacking && this.playerCar.gunNodes.length > 0 && this.playerGunCooldown <= 0) {
            for (const gunNode of this.playerCar.gunNodes) {
                this.weapons.fireFrom(gunNode, "PLAYER");
            }
            this.playerGunCooldown = this.gunFireInterval;
        }
    }

    // 滑鼠瞄準砲（第 2 點）：按住左鍵朝游標方向連射，子彈無差別傷害
    private updateMouseCannons(dt: number) {
        this.mouseCannonCooldown = Math.max(0, this.mouseCannonCooldown - dt);
        if (!this.playerCar || !this.weapons) return;
        const cannons = this.playerCar.mouseCannons;
        if (cannons.length === 0 || !this.isMouseDown || this.mouseCannonCooldown > 0) return;

        let interval = 0.18;
        for (const node of cannons) {
            if (!node || !node.isValid) continue;
            const mc = node.getComponent("MouseCannon") as any;
            if (mc) interval = mc.fireInterval;
            this.weapons.fireTowards(node, "PLAYER", this.mouseWorldPos, {
                speed: mc ? mc.bulletSpeed : undefined,
                damage: mc ? mc.bulletDamage : undefined,
                lifetime: mc ? mc.bulletLifetime : undefined,
                damagesAll: true,
            });
            const audio = node.getComponent("PartAudio") as any;
            if (audio && audio.playAttack) audio.playAttack();
        }
        this.mouseCannonCooldown = interval;
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

    private updatePlayerMovement() {
        if (!this.playerCar || this.playerCar.wheelJoints.length === 0) return;

        const targetSpeed = this.moveDir * JOINT.WHEEL_TARGET_SPEED;
        this.wheelSpeed += (targetSpeed - this.wheelSpeed) * JOINT.WHEEL_SMOOTHING;

        for (const j of this.playerCar.wheelJoints) {
            const mul = this.playerCar.wheelMultipliers.get(j) ?? 1;
            j.motorSpeed = this.wheelSpeed * mul;
        }
    }

    // 空中左右旋轉（第 5 點）：A/D 對核心施扭矩，角速度有上限避免狂轉。
    // 地面上輪子與焊接會抵抗大部分扭矩；離地時就能用來翻正/轉體。
    private updateAirRotation() {
        if (!this.playerCar || !this.playerCar.coreNode || this.moveDir === 0) return;
        const rb = this.playerCar.coreNode.getComponent(cc.RigidBody);
        if (!rb) return;
        if (Math.abs(rb.angularVelocity) < AIR.MAX_ANGULAR_SPEED) {
            (rb as any).applyTorque(this.moveDir * AIR.ROTATE_TORQUE, true);
        }
    }

    // 噴射輪（第 4 點）：按住 boost 時每幀向上推
    private updateJet() {
        if (!this.isBoosting || !this.playerCar) return;
        for (const ab of this.playerCar.wheelAbilities) {
            if (ab && ab.applyJet) ab.applyJet();
        }
    }

    private updatePlayerMelee() {
        if (!this.playerCar) return;
        const hasWheel = this.playerCar.wheelJoints.length > 0;

        for (const j of this.playerCar.weaponJoints) {
            j.enableMotor = hasWheel;
            const cur = j.getJointAngle();
            if (this.isAttacking) {
                j.motorSpeed = cur < j.upperAngle ? JOINT.MELEE_ATTACK_SPEED : 0;
            } else {
                j.motorSpeed = cur > j.lowerAngle ? JOINT.MELEE_RETURN_SPEED : 0;
            }
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

        const prefab = this.allPrefabs[Math.floor(Math.random() * this.allPrefabs.length)];
        if (!prefab) return;

        const node = cc.instantiate(prefab);
        node.parent = this.node.parent;
        node.setPosition(Math.random() * 1200, 600);
        node.group = GROUP.DEFAULT;

        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic;
            rb.linearVelocity = cc.v2(0, -300);
            rb.angularVelocity = (Math.random() - 0.5) * 500;
        }

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

        this.scheduleOnce(() => {
            if (GameManager.playerWins >= BATTLE.WINS_TO_FINISH || GameManager.botWins >= BATTLE.WINS_TO_FINISH) {
                GameManager.resetAllData();
                cc.director.loadScene("Menu");
            } else if (FLOW.USE_SCRAMBLE) {
                cc.director.loadScene(FLOW.SCRAMBLE_SCENE);  // 每局結束 → 搶奪階段 → （由它）進商店
            } else {
                cc.director.loadScene("Shop");
            }
        }, 3);
    }

    // ====================================================================
    // 輸入
    // ====================================================================
    onKeyDown(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.moveDir = 1;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.moveDir = -1;
                break;
            case cc.macro.KEY.space:
                this.isAttacking = true;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.isBoosting = true;   // 噴射 boost
                break;
        }
    }

    onKeyUp(event: cc.Event.EventKeyboard) {
        switch (event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                if (this.moveDir === 1) this.moveDir = 0;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                if (this.moveDir === -1) this.moveDir = 0;
                break;
            case cc.macro.KEY.space:
                this.isAttacking = false;
                break;
            case cc.macro.KEY.w:
            case cc.macro.KEY.up:
                this.isBoosting = false;
                break;
        }
    }

    // 滑鼠：把螢幕座標轉成世界座標供瞄準
    private onMouseMove(e: cc.Event.EventMouse) {
        const sp = e.getLocation();
        const cam = cc.Camera.main;
        if (cam && (cam as any).getScreenToWorldPoint) {
            this.mouseWorldPos = (cam as any).getScreenToWorldPoint(cc.v2(sp.x, sp.y));
        } else {
            this.mouseWorldPos = cc.v2(sp.x, sp.y);
        }
    }

    private onMouseDown(e: cc.Event.EventMouse) {
        if (e.getButton() === cc.Event.EventMouse.BUTTON_LEFT) {
            this.isMouseDown = true;
            this.onMouseMove(e);
        }
    }

    private onMouseUp(e: cc.Event.EventMouse) {
        if (e.getButton() === cc.Event.EventMouse.BUTTON_LEFT) {
            this.isMouseDown = false;
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
