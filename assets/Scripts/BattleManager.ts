// BattleManager.ts
// 協調者：車輛生成→CarBuilder、關節→JointFactory、子彈→WeaponSystem、敵方→BotAI、常數→core/GameConstants。
//
// 本批次新增（不動任何 @property，記分板用程式生成）：
//   - 左上/右上記分板（第 1 點）
//   - 滑鼠瞄準砲開火（第 2 點，配合 MouseCannon 組件）
//   - 空中左右旋轉（第 5 點，A/D 對核心施扭矩）
//   - 噴射輪 boost（第 4 點，W / ↑ 觸發 WheelAbility.applyJet）

import GameManager from "./GameManager";
import { PHYSICS, BATTLE, JOINT, GROUP, AIR, FLOW, MELEE, MOUSE_TURRET, UPRIGHT } from "./core/GameConstants";
import CarBuilder, { BuiltCar } from "./battle/CarBuilder";
import BotAI from "./battle/BotAI";
import WeaponSystem from "./battle/WeaponSystem";
import WallRide from "./battle/WallRide";
import StuckRescue from "./battle/StuckRescue";
import MouseCannon from "./weapons/MouseCannon";
import FirebaseService from "./net/FirebaseService";
import MapLoader from "./map/MapLoader";
import HitFeedback from "./fx/HitFeedback";

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

    private moveDir = 0;
    private isAttacking = false;
    private isBoosting = false;          // 噴射 boost（W / ↑）
    private wheelSpeed = 0;
    private playerGunCooldown = 0;

    // 滑鼠砲
    private isMouseDown = false;
    private mouseWorldPos: cc.Vec2 = cc.v2(0, 0);
    private mouseCannonCooldown = 0;

    // 近戰揮砍冷卻
    private meleeCooldown = 0;
    private meleeSwinging = false;

    private playerRoot: cc.Node | null = null;
    private botRoot: cc.Node | null = null;

    private playerCar: BuiltCar | null = null;
    private botCar: BuiltCar | null = null;
    private botAI: BotAI | null = null;
    private weapons: WeaponSystem | null = null;
    private wallRide: WallRide | null = null;
    private playerRescue: StuckRescue | null = null;
    private botRescue: StuckRescue | null = null;

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

        // 打擊感回饋：把 HitFeedback 動態掛到主鏡頭節點（免去在 .fire 編輯器手動綁定）
        this.setupHitFeedback();

        this.createScoreboard();
        this.setupBattle();

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
        this.meleeCooldown = 0;
        this.meleeSwinging = false;
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
        // 玩家車已建好 → 重新挑一張預設地圖（避免車的物件壓在玩家身上）
        if (this.mapLoader) this.mapLoader.loadRandomMap();

        this.wallRide = FLOW.USE_WALLRIDE ? new WallRide(this.playerCar, this.playerRoot, GROUP.PLAYER_PART) : null;
        this.playerRescue = FLOW.USE_STUCK_RESCUE
            ? new StuckRescue(this.playerCar, this.playerRoot, GROUP.PLAYER_PART, this.coreWorldPos(this.playerCar) || cc.v2(0, 0))
            : null;
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
        this.playerRescue = null;
        this.botRescue = null;
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
            this.botRescue = FLOW.USE_STUCK_RESCUE
                ? new StuckRescue(this.botCar, this.botRoot, GROUP.BOT_PART, this.coreWorldPos(this.botCar) || cc.v2(0, 0))
                : null;
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
        this.updateStuckRescue(dt);
        const touching = this.isTouchingAnything();   // 每幀算一次，翻滾與翻正共用
        if (this.wallRide) this.wallRide.update(dt, this.moveDir);
        this.updateAirRotation(touching);   // 只有完全騰空（無接觸）才翻滾
        this.updateAutoRight(touching);     // 接觸地面且傾斜 → 自動翻正
        this.updateJet();
        this.updatePlayerMelee(dt);
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

        // 遠程槍改用滑鼠左鍵發射（近戰仍維持空白鍵）
        if (this.isMouseDown && this.playerCar.gunNodes.length > 0 && this.playerGunCooldown <= 0) {
            for (const gunNode of this.playerCar.gunNodes) {
                this.weapons.fireFrom(gunNode, "PLAYER");
            }
            this.playerGunCooldown = this.gunFireInterval;
        }
    }

    // 滑鼠瞄準砲：每幀讓砲塔轉向游標（受角度限制），按住左鍵沿砲管方向開火（無差別傷害）
    private updateMouseCannons(dt: number) {
        this.mouseCannonCooldown = Math.max(0, this.mouseCannonCooldown - dt);
        if (!this.playerCar || !this.weapons) return;
        const cannons = this.playerCar.mouseCannons;
        if (cannons.length === 0) return;

        // 1) 旋轉瞄準（每幀，無論是否開火）
        for (const c of cannons) {
            if (c.node && c.node.isValid) this.aimTurret(c.node, c.joint);
        }

        // 2) 開火
        if (!this.isMouseDown || this.mouseCannonCooldown > 0) return;
        let interval = 0.18;
        for (const c of cannons) {
            if (!c.node || !c.node.isValid) continue;
            const mc = c.node.getComponent(MouseCannon);
            if (mc) interval = mc.fireInterval;
            this.weapons.fireFrom(c.node, "PLAYER", {
                speed: mc ? mc.bulletSpeed : undefined,
                damage: mc ? mc.bulletDamage : undefined,
                lifetime: mc ? mc.bulletLifetime : undefined,
                damagesAll: !!mc,
            });
            const audio = c.node.getComponent("PartAudio") as any;
            if (audio && audio.playAttack) audio.playAttack();
        }
        this.mouseCannonCooldown = interval;
    }

    // 讓砲塔的砲管轉向游標：用 P 控制器驅動關節馬達，關節本身的角度上下限會夾住可轉範圍。
    private aimTurret(weaponNode: cc.Node, joint: cc.RevoluteJoint) {
        if (!joint || !joint.isValid) return;

        const center = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        const fp = weaponNode.getChildByName("firepoint");
        const muzzle = fp
            ? fp.convertToWorldSpaceAR(cc.v2(0, 0))
            : weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));

        const barrelDir = muzzle.sub(center);
        const barrelAngle = Math.atan2(barrelDir.y, barrelDir.x) * 180 / Math.PI;

        const toMouse = this.mouseWorldPos.sub(center);
        if (toMouse.mag() < 1) return;
        const aimAngle = Math.atan2(toMouse.y, toMouse.x) * 180 / Math.PI;

        let diff = aimAngle - barrelAngle;
        while (diff > 180) diff -= 360;
        while (diff < -180) diff += 360;

        joint.enableMotor = true;
        // 玩家零件是鏡像(scaleX 反向)，馬達正轉會讓砲管角度「反向」變化，所以這裡取負號才會朝游標
        joint.motorSpeed = cc.misc.clampf(-diff * MOUSE_TURRET.AIM_GAIN, -MOUSE_TURRET.AIM_SPEED, MOUSE_TURRET.AIM_SPEED);
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

    // 空中左右旋轉（第 5 點）：只有「完全沒有接觸任何牆/地板/物件」時 A/D 才旋轉車身；
    // 只要有任何接觸（地板、牆、敵車、障礙物）就交給輪子前進後退，不硬翻。
    private updateAirRotation(touching: boolean) {
        if (!this.playerCar || !this.playerCar.coreNode || this.moveDir === 0) return;
        if (touching) return;   // 有接觸 → 不翻滾
        const rb = this.playerCar.coreNode.getComponent(cc.RigidBody);
        if (!rb) return;
        if (Math.abs(rb.angularVelocity) < AIR.MAX_ANGULAR_SPEED) {
            (rb as any).applyTorque(this.moveDir * AIR.ROTATE_TORQUE, true);
        }
    }

    // 自動翻正：接觸地面/物體、且不在牆面行駛、且車身傾斜時，施加修正扭矩回到直立。
    private updateAutoRight(touching: boolean) {
        if (!UPRIGHT.ENABLED || !touching) return;
        if (!this.playerCar || !this.playerCar.coreNode) return;
        if (this.wallRide && this.wallRide.isStuck()) return;   // 牆上交給 WallRide 對齊
        const core = this.playerCar.coreNode;
        const rb = core.getComponent(cc.RigidBody);
        if (!rb) return;

        // 車身相對「世界直立」的傾角，正規化到 -180~180
        let ang = core.angle % 360;
        if (ang > 180) ang -= 360;
        if (ang < -180) ang += 360;
        if (Math.abs(ang) < UPRIGHT.MIN_ANGLE) return;

        let torque = (-ang * UPRIGHT.GAIN) - rb.angularVelocity * UPRIGHT.DAMP;
        torque = cc.misc.clampf(torque, -UPRIGHT.MAX_TORQUE, UPRIGHT.MAX_TORQUE);
        (rb as any).applyTorque(torque, true);
    }

    // 接觸偵測：從車上「每個還活著的零件」往「下、上、左、右」四向打短射線，
    // 命中任何「非玩家自身零件」的 collider（地板/邊界/敵車/障礙物…）就視為接觸中。
    // 完全沒命中 → 真正騰空 → 才允許空中翻滾。（只探核心/輪子會漏掉車體接觸，導致在地上仍被當成騰空亂轉。）
    private isTouchingAnything(): boolean {
        if (!this.playerRoot || !this.playerRoot.isValid) return false;
        const pm = cc.director.getPhysicsManager();
        const dirs = [cc.v2(0, -1), cc.v2(0, 1), cc.v2(-1, 0), cc.v2(1, 0)];

        const bodies = this.playerRoot.getComponentsInChildren(cc.RigidBody);
        for (const rb of bodies) {
            const node = rb.node;
            if (!node || !node.isValid || node.group !== GROUP.PLAYER_PART) continue;

            const o = node.convertToWorldSpaceAR(cc.v2(0, 0));
            const len = Math.max(node.width, node.height, 40) * 0.5 + AIR.CONTACT_PROBE;
            for (const d of dirs) {
                const results = pm.rayCast(cc.v2(o.x, o.y), cc.v2(o.x + d.x * len, o.y + d.y * len), cc.RayCastType.All);
                for (const r of results) {
                    const g = r.collider.node.group;
                    if (g !== GROUP.PLAYER_PART && g !== GROUP.PLAYER_BULLET) return true;
                }
            }
        }
        return false;
    }

    // 卡住自救：玩家「有按移動鍵卻沒前進」/ Bot 卡住 一段時間後，瞬移到最近可站處
    private updateStuckRescue(dt: number) {
        if (this.playerRescue) {
            this.playerRescue.update(dt, this.moveDir !== 0, this.coreWorldPos(this.botCar));
        }
        if (this.botRescue) {
            this.botRescue.update(dt, !!this.botAI, this.coreWorldPos(this.playerCar));
        }
    }

    private coreWorldPos(car: BuiltCar | null): cc.Vec2 | null {
        if (!car || !car.coreNode || !car.coreNode.isValid) return null;
        return car.coreNode.convertToWorldSpaceAR(cc.v2(0, 0));
    }

    // 噴射輪（第 4 點）：按住 boost 時每幀向上推
    private updateJet() {
        if (!this.isBoosting || !this.playerCar) return;
        for (const ab of this.playerCar.wheelAbilities) {
            if (ab && ab.applyJet) ab.applyJet();
        }
    }

    // 近戰揮砍：按住攻擊時，揮出 → 收回 → 冷卻 → 再揮，週期之間有冷卻時間。
    private updatePlayerMelee(dt: number) {
        if (!this.playerCar || this.playerCar.weaponJoints.length === 0) return;
        const hasWheel = this.playerCar.wheelJoints.length > 0;

        if (this.meleeCooldown > 0) this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);

        // 冷卻結束且持續攻擊 → 開始新的一次揮砍
        if (!this.meleeSwinging && this.isAttacking && this.meleeCooldown <= 0) {
            this.meleeSwinging = true;
            this.meleeCooldown = MELEE.COOLDOWN;
        }

        let allReachedTop = true;
        for (const j of this.playerCar.weaponJoints) {
            j.enableMotor = hasWheel;
            const cur = j.getJointAngle();
            if (this.meleeSwinging) {
                // 揮出到上限
                if (cur < j.upperAngle - MELEE.REACH_TOLERANCE) {
                    j.motorSpeed = JOINT.MELEE_ATTACK_SPEED;
                    allReachedTop = false;
                } else {
                    j.motorSpeed = 0;
                }
            } else {
                // 收回到下限
                j.motorSpeed = cur > j.lowerAngle ? JOINT.MELEE_RETURN_SPEED : 0;
            }
        }

        // 全部揮到頂 → 結束這次揮砍，開始收回（冷卻仍在倒數，冷卻完才會再揮）
        if (this.meleeSwinging && allReachedTop) {
            this.meleeSwinging = false;
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
            // S / 下：不再做爆發式脫離。下牆改用「反向輸入減速」（按與爬升相反的 A/D）。
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

    // 滑鼠：直接用 getLocation 當世界座標（與遊戲既有的節點世界座標系一致）
    private onMouseMove(e: cc.Event.EventMouse) {
        const p = e.getLocation();
        this.mouseWorldPos = cc.v2(p.x, p.y);
    }

    private onMouseDown(e: cc.Event.EventMouse) {
        if (e.getButton() === cc.Event.EventMouse.BUTTON_LEFT) {
            this.isMouseDown = true;
            this.onMouseMove(e);
            cc.log(`[BattleManager] 左鍵按下，滑鼠座標=(${this.mouseWorldPos.x.toFixed(0)}, ${this.mouseWorldPos.y.toFixed(0)})`);
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