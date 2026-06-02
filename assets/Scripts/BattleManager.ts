import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";
import Draggable, { WeaponMode } from "./Draggable";
import Health from "./HealthManager";
import Bullet from "./Bullet";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property(cc.Label)
    timerLabel: cc.Label | null = null;

    @property(cc.Label)
    suddenDeathLabel: cc.Label | null = null;

    @property(cc.Label)
    countdownLabel: cc.Label | null = null;

    @property([cc.Prefab])
    allPrefabs: cc.Prefab[] = [];

    @property(cc.Prefab)
    settingsPrefab: cc.Prefab | null = null;

    @property(cc.Label)
    resultLabel: cc.Label | null = null;

    @property(cc.AudioClip)
    bgmClip: cc.AudioClip | null = null;

    @property(cc.AudioClip)
    suddenDeathSfx: cc.AudioClip | null = null; 

    @property(cc.AudioClip)
    countdownBgmClip: cc.AudioClip | null = null; 
    private wasPaused: boolean = false;

    @property(cc.AudioClip)
    victorySfx: cc.AudioClip | null = null;

    @property(cc.AudioClip)
    defeatSfx: cc.AudioClip | null = null;

    @property(cc.Prefab)
    bulletPrefab: cc.Prefab | null = null;

    // --- 戰鬥狀態變數 ---
    private matchTimer: number = 20;
    private isSuddenDeath: boolean = false;
    private isBattleStarted: boolean = false; 
    private isTimerFlashing: boolean = false;

    private startCountdownTimer: number = 0;
    private startCountdownValue: number = 2;
    
    private playerCoreHealth: Health | null = null;
    private botCoreHealth: Health | null = null;

    private wheelJoints: cc.WheelJoint[] = [];
    private weaponJoints: cc.RevoluteJoint[] = [];
    private botWheelJoints: cc.WheelJoint[] = [];
    private botWeaponJoints: cc.RevoluteJoint[] = [];

    private wheelSpeed: number = 0;
    private moveDir: number = 0;
    private isAttacking: boolean = false;
    private isGameOver: boolean = false;

    private playerPartsMap: Map<string, cc.Node> = new Map();
    private botPartsMap: Map<string, cc.Node> = new Map();

    private playerRoot: cc.Node | null = null;
    private botRoot: cc.Node | null = null;

    private wheelSpeedMultipliers: Map<cc.WheelJoint, number> = new Map();
    private botWheelSpeedMultipliers: Map<cc.WheelJoint, number> = new Map();

    private playerGunNodes: cc.Node[] = [];
    private botGunNodes: cc.Node[] = [];
    private playerGunCooldown: number = 0;
    private botGunCooldown: number = 0;

    @property
    gunFireInterval: number = 0.25;
    @property
    botGunFireInterval: number = 0.9;
    @property
    bulletSpeed: number = 1600;
    @property
    bulletDamage: number = 20;
    @property
    bulletLifetime: number = 3;

    onLoad() {
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true; 
        cc.PhysicsManager.FIXED_TIME_STEP = 1/60; 

        //physics.debugDrawFlags = cc.PhysicsManager.DrawBits.e_aabbBit | cc.PhysicsManager.DrawBits.e_shapeBit;

        (physics as any).velocityIterations = 40;
        (physics as any).positionIterations = 40;
        
        this.setupBattle();

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    setupBattle() {
        this.isGameOver = false;
        this.isSuddenDeath = false;
        this.isBattleStarted = false; 
        this.isTimerFlashing = false;
        this.matchTimer = 20;
        this.moveDir = 0;
        this.isAttacking = false;
        this.playerCoreHealth = null;
        this.botCoreHealth = null;

        this.wheelSpeedMultipliers.clear();
        this.botWheelSpeedMultipliers.clear();
        this.playerGunNodes = [];
        this.botGunNodes = [];
        this.playerGunCooldown = 0;
        this.botGunCooldown = 0;

        if (this.suddenDeathLabel) this.suddenDeathLabel.node.active = false;
        if (this.timerLabel) {
            this.timerLabel.string = "20";
            this.timerLabel.node.color = cc.Color.WHITE;
            this.timerLabel.node.opacity = 255;
            this.timerLabel.node.stopAllActions();
        }

        this.playerPartsMap.clear();
        this.botPartsMap.clear();
        this.wheelJoints = [];
        this.weaponJoints = [];
        this.botWheelJoints = [];
        this.botWeaponJoints = [];

        this.destroyCurrentBattle();

        this.playerRoot = new cc.Node("PLAYER_ROOT");
        this.playerRoot.parent = this.node;
        this.botRoot = new cc.Node("BOT_ROOT");
        this.botRoot.parent = this.node;

        this.spawnGridCar(GameManager.playerCarGrid, cc.v2(300, 0), "PLAYER", this.playerRoot);

        // const totalRounds = GameManager.playerWins + GameManager.botWins;
        // let botIndex = totalRounds <= 1 ? 0 : (totalRounds <= 3 ? 1 : 2);
        
        // if (GameManager.botConfigs && GameManager.botConfigs.length > 0) {
        //     this.spawnGridCar(GameManager.botConfigs[botIndex], cc.v2(-300, 0), "BOT", this.botRoot);
        // }
        
        this.startCountdownTimer = 0;
        this.startCountdownValue = 2;

        if (this.countdownLabel) {
            this.countdownLabel.node.active = true;
            this.countdownLabel.string = "2";
        }
        if (this.countdownBgmClip) {
            cc.audioEngine.stopMusic();
            cc.audioEngine.playMusic(this.countdownBgmClip, false);
        }
    }

    private isWheelPartType(partType: PartType): boolean {
        return partType === PartType.Wheel;
    }

    destroyCurrentBattle() {
        if (this.playerRoot && this.playerRoot.isValid) this.playerRoot.destroy();
        if (this.botRoot && this.botRoot.isValid) this.botRoot.destroy();
        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
    }

    private getCleanNodeName(node: cc.Node): string {
        return node.name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    }

    private isCoreNode(node: cc.Node): boolean {
        const draggable = node.getComponent(Draggable) as any;
        return (draggable && draggable.partType === PartType.Core) || this.getCleanNodeName(node) === "core";
    }

    private isBodyLikeNode(node: cc.Node): boolean {
        const draggable = node.getComponent(Draggable) as any;
        return !!draggable && (draggable.partType === PartType.Body || draggable.partType === PartType.Core || this.isCoreNode(node));
    }

    spawnGridCar(gridData: any[], startPos: cc.Vec2, side: "PLAYER" | "BOT", root: cc.Node) {
        const partMap = (side === "PLAYER") ? this.playerPartsMap : this.botPartsMap;
        const groupName = (side === "PLAYER") ? "PLAYER_PART" : "BOT_PART";
        const sideMultiplier = (side === "PLAYER" ? 1 : -1);
        for (let data of gridData) {
            const prefab = this.getPrefabByName(data.partName);
            if (!prefab) continue;

            const node = cc.instantiate(prefab);
            node.parent = root;
            node.group = groupName;
            node.setPosition(startPos.x + data.gridX * 40, startPos.y + data.gridY * 40);

            node.setPosition(startPos.x + (data.gridX * 40 * sideMultiplier), startPos.y + data.gridY * 40);
            node.scaleX = sideMultiplier;

            partMap.set(`${data.gridX},${data.gridY}`, node);

            const draggable = node.getComponent(Draggable);
            if (draggable && draggable.partType === PartType.Weapon) {
                if (draggable.weaponMode === WeaponMode.Gun) {
                    if (side === "PLAYER") this.playerGunNodes.push(node);
                    else this.botGunNodes.push(node);
                }
            }

            let hp = node.getComponent(Health) || node.addComponent(Health);
            if (side === "BOT") {
                const roundBonus = (GameManager.playerWins + GameManager.botWins) * 10;
                hp.maxHP += roundBonus;
                hp.currentHP = hp.maxHP;
            }

            const isCore = this.isCoreNode(node);
            if (isCore) {
                if (side === "PLAYER") this.playerCoreHealth = hp;
                else this.botCoreHealth = hp;
            }

            hp.onDieCallback = () => {
                this.handlePartDisjoint(node);
                if (isCore) {
                    this.handleGameOver(side === "PLAYER" ? "BOT" : "PLAYER");
                }
            };
        }

        partMap.forEach((node, key) => {
            const coords = key.split(",").map(Number);
            const x = coords[0], y = coords[1];
            const draggable = node.getComponent(Draggable);
            if (!draggable) return;

            if (this.isBodyLikeNode(node)) {
                const right = partMap.get(`${x + 1},${y}`);
                if (right && this.isBodyLikeNode(right)) this.tryWeld(node, right);
                const top = partMap.get(`${x},${y + 1}`);
                if (top && this.isBodyLikeNode(top)) this.tryWeld(node, top);
            }

            if (this.isWheelPartType(draggable.partType)) {
                this.setupWheelJoint(node, partMap, x, y, side);
            } else if (draggable.partType === PartType.Weapon) {
                this.setupWeaponJoint(node, partMap, x, y, side);
            }
        });
    }

    handlePartDisjoint(node: cc.Node) {
        const joints = node.getComponents(cc.Joint);
        joints.forEach(j => j.destroy());
        const parent = node.parent;
        if (parent) {
            const allJoints = parent.getComponentsInChildren(cc.Joint);
            allJoints.forEach(j => {
                if (j.connectedBody && j.connectedBody.node === node) j.destroy();
            });
        }
        node.group = "default";
        const rb = node.getComponent(cc.RigidBody);
        if (rb) rb.applyForceToCenter(cc.v2(0, 1000), true);
        cc.tween(node).delay(1.5).to(0.5, { opacity: 0 }).call(() => { if (node.isValid) node.destroy(); }).start();
    }

    tryWeld(self: cc.Node, neighbor: cc.Node) {
        const selfRb = self.getComponent(cc.RigidBody);
        const neighborRb = neighbor.getComponent(cc.RigidBody);
        if (!selfRb || !neighborRb) return;
        const p1 = self.convertToWorldSpaceAR(cc.v2(0, 0));
        const p2 = neighbor.convertToWorldSpaceAR(cc.v2(0, 0));
        const jointWorld = cc.v2((p1.x + p2.x) * 0.5, (p1.y + p2.y) * 0.5);
        const joint = self.addComponent(cc.WeldJoint);
        joint.connectedBody = neighborRb;
        joint.anchor = self.convertToNodeSpaceAR(jointWorld);
        joint.connectedAnchor = neighbor.convertToNodeSpaceAR(jointWorld);
        joint.collideConnected = false;
        joint.frequency = 0;
    }

    setupWheelJoint(wheelNode: cc.Node, partMap: Map<string, cc.Node>, x: number, y: number, side: string) {
        let parentBox: cc.Node | null = null;
        let attachDir: "TOP" | "LEFT" | "RIGHT" | "BOTTOM" = "TOP";

        const neighbors = [
            { n: partMap.get(`${x},${y + 1}`), dir: "TOP" as const },
            { n: partMap.get(`${x - 1},${y}`), dir: "LEFT" as const },
            { n: partMap.get(`${x + 1},${y}`), dir: "RIGHT" as const },
            { n: partMap.get(`${x},${y - 1}`), dir: "BOTTOM" as const }
        ];

        for (let item of neighbors) {
            if (item.n && this.isBodyLikeNode(item.n)) {
                parentBox = item.n;
                attachDir = item.dir;
                break;
            }
        }

        if (!parentBox) return;

        if (attachDir === "LEFT") wheelNode.angle = -90;
        else if (attachDir === "RIGHT") wheelNode.angle = 90;
        else if (attachDir === "BOTTOM") wheelNode.angle = 180;
        else wheelNode.angle = 0;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const wheelRb = wheelNode.getComponent(cc.RigidBody);
        if (!parentRb || !wheelRb) return;

        const joint = parentBox.addComponent(cc.WheelJoint);
        joint.connectedBody = wheelRb;

        const worldPos = wheelNode.convertToWorldSpaceAR(cc.v2(0, 0));
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = wheelNode.convertToNodeSpaceAR(worldPos);
        joint.collideConnected = false;

        if (attachDir === "LEFT") joint.localAxisA = cc.v2(1, 0);
        else if (attachDir === "RIGHT") joint.localAxisA = cc.v2(-1, 0);
        else if (attachDir === "BOTTOM") joint.localAxisA = cc.v2(0, -1);
        else joint.localAxisA = cc.v2(0, 1);

        joint.frequency = 10;
        joint.enableMotor = true;
        joint.maxMotorTorque = 100000;

        const drag = wheelNode.getComponent(Draggable) as any;
        const speedMul = drag && typeof drag.wheelMotorMultiplier === "number" ? drag.wheelMotorMultiplier : 1;
        joint.maxMotorTorque = 100000 * speedMul; 

        if (side === "PLAYER") {
            this.wheelJoints.push(joint);
            this.wheelSpeedMultipliers.set(joint, speedMul);
        } else {
            this.botWheelJoints.push(joint);
            this.botWheelSpeedMultipliers.set(joint, speedMul);
        }
    }

    setupWeaponJoint(weaponNode: cc.Node, partMap: Map<string, cc.Node>, x: number, y: number, side: string) {
        let parentBox: cc.Node | null = null;
        const coords = [[x-1,y], [x+1,y], [x,y-1], [x,y+1]];
        for (const c of coords) {
            const n = partMap.get(`${c[0]},${c[1]}`);
            if (n && this.isBodyLikeNode(n)) { parentBox = n; break; }
        }
        if (!parentBox) return;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        if (!parentRb || !weaponRb) return;

        const draggable = weaponNode.getComponent(Draggable);
        if (draggable && draggable.weaponMode === WeaponMode.Gun) {
            // 遠程武器固定
            const joint = parentBox.addComponent(cc.WeldJoint);
            joint.connectedBody = weaponRb;
            const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
            joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
            joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
        } else {
            // 近戰武器旋轉
            const joint = parentBox.addComponent(cc.RevoluteJoint);
            joint.connectedBody = weaponRb;
            const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
            joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
            joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
            joint.enableLimit = true;
            joint.lowerAngle = (side === "PLAYER") ? -20 : -120;
            joint.upperAngle = (side === "PLAYER") ? 120 : 20;
            joint.enableMotor = true;
            joint.maxMotorTorque = 10000;
            if (side === "PLAYER") this.weaponJoints.push(joint);
            else this.botWeaponJoints.push(joint);
        }
    }

    update(dt: number) {
        // 音樂同步暫停邏輯
        if (GameManager.isPaused !== this.wasPaused) {
            if (GameManager.isPaused) cc.audioEngine.pauseMusic();
            else cc.audioEngine.resumeMusic();
            this.wasPaused = GameManager.isPaused;
        }

        if (this.isGameOver || GameManager.isPaused) return;

        // 開場倒數
        if (!this.isBattleStarted) {
            this.startCountdownTimer += dt;
            if (this.startCountdownTimer >= 1) {
                this.startCountdownTimer = 0;
                this.startCountdownValue--;
                if (this.startCountdownValue === 1) {
                    // --- 關鍵：倒數到 1 時，讓 Bot 登場 ---
                    if (this.countdownLabel) this.countdownLabel.string = "1";
                    this.spawnBotSequence(); 
                } 
                else if (this.startCountdownValue === 0) {
                    if (this.countdownLabel) this.countdownLabel.string = "FIGHT!";
                    this.isBattleStarted = true;
                    
                    // --- 關鍵：喊 FIGHT 時，啟動兩邊的物理 ---
                    this.startAllPhysics();

                    if (this.bgmClip) {
                        // 延遲 1 秒後播放 BGM
                        this.scheduleOnce(() => {
                            // 先停止目前的音樂（例如開場倒數的音樂）
                            cc.audioEngine.stopMusic();
                            // 播放戰鬥 BGM
                            cc.audioEngine.playMusic((this as any).bgmClip, true);
                        }, 1.0); // 1.0 代表 1 秒
                    }
                    this.scheduleOnce(() => { if (this.countdownLabel) this.countdownLabel.node.active = false; }, 1);
                }
            }
            return;
        }

        // 核心射擊邏輯 (關鍵修正：呼叫玩家射擊)
        this.updateGunFire(dt);
        this.updateBotAI(dt); // 傳入 dt

        // 倒數計時與突發死亡
        if (!this.isSuddenDeath) {
            this.matchTimer -= dt;
            if (this.timerLabel) {
                this.timerLabel.string = Math.ceil(this.matchTimer).toString();
                if (this.matchTimer <= 5 && !this.isTimerFlashing) {
                    this.isTimerFlashing = true;
                    this.timerLabel.node.color = cc.Color.RED;
                    cc.tween(this.timerLabel.node).repeatForever(cc.tween().to(0.5, { opacity: 50 }).to(0.5, { opacity: 255 })).start();
                }
            }
            if (this.matchTimer <= 0) this.startSuddenDeath();
        }

        // 玩家輪子
        const playerHasWheel = this.wheelJoints.length > 0;
        if (playerHasWheel) {
            const targetSpeed = this.moveDir * -600;
            this.wheelSpeed += (targetSpeed - this.wheelSpeed) * 0.15;
            for (let j of this.wheelJoints) {
                const mul = this.wheelSpeedMultipliers.get(j) ?? 1;
                j.motorSpeed = this.wheelSpeed * mul;
            }
        }

        // 玩家近戰武器
        for (let j of this.weaponJoints) {
            j.enableMotor = playerHasWheel;
            const cur = j.getJointAngle();
            if (this.isAttacking) {
                if (cur < j.upperAngle) j.motorSpeed = 1500; else j.motorSpeed = 0;
            } else {
                if (cur > j.lowerAngle) j.motorSpeed = -500; else j.motorSpeed = 0;
            }
        }
    }

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
            cc.tween(this.suddenDeathLabel.node).repeatForever(cc.tween().to(0.5, { opacity: 0 }).to(0.5, { opacity: 255 })).start();
        }
        if (this.suddenDeathSfx) cc.audioEngine.playEffect(this.suddenDeathSfx, false);
        for (let i = 0; i < 40; i++) {
            this.scheduleOnce(() => {
                // 只有在遊戲還沒結束時才生零件
                if (!this.isGameOver && GameManager.isPaused === false) {
                    this.spawnSuddenDeathPart();
                }
            }, i * 0.01); 
        }
        this.schedule(this.suddenDeathTick, 0.25);
    }

    suddenDeathTick() {
        if (this.isGameOver || GameManager.isPaused) return;
        if (this.playerCoreHealth) this.playerCoreHealth.takeDamage(6);
        if (this.botCoreHealth) this.botCoreHealth.takeDamage(5);
    }

    updateBotAI(dt: number) {
        if (!this.isBattleStarted || this.isGameOver || !this.playerRoot || !this.botRoot) return;
        let distance = (this as any).playerRoot.x - (this as any).botRoot.x;
        let absDist = Math.abs(distance);

        let botMoveDir = 0;
        if (absDist > 220) botMoveDir = distance > 0 ? 1 : -1; // 玩家太遠就追
        else if (absDist < 120) botMoveDir = distance > 0 ? -1 : 1; // 玩家太近就退

        this.botWheelJoints.forEach(j => {
            const mul = this.botWheelSpeedMultipliers.get(j) ?? 1;
            j.motorSpeed = 1500 * botMoveDir * mul;
        });

        // 攻擊 AI
        for (let j of this.botWeaponJoints) {
            const cur = j.getJointAngle();
            if (absDist < 300) {
                if (cur <= j.lowerAngle) j.motorSpeed = 1000;
                else if (cur >= j.upperAngle) j.motorSpeed = -1000;
                if (j.motorSpeed === 0) j.motorSpeed = 1000;
            } else {
                if (cur > j.lowerAngle) j.motorSpeed = -400;
            }
        }
        this.botGunCooldown = Math.max(0, this.botGunCooldown - dt);
        if (this.botGunNodes.length > 0 && this.botGunCooldown <= 0) {
            for (const gunNode of this.botGunNodes) {
                this.fireBulletFromWeapon(gunNode, "BOT");
            }
            this.botGunCooldown = this.botGunFireInterval;
        }
    }

    private updateGunFire(dt: number) {
        this.playerGunCooldown = Math.max(0, this.playerGunCooldown - dt);
        if (this.isAttacking && this.playerGunNodes.length > 0 && this.playerGunCooldown <= 0) {
            for (const gunNode of this.playerGunNodes) {
                this.fireBulletFromWeapon(gunNode, "PLAYER");
            }
            this.playerGunCooldown = this.gunFireInterval;
        }
    }

    private fireBulletFromWeapon(weaponNode: cc.Node, side: "PLAYER" | "BOT") {
        if (!weaponNode || !weaponNode.isValid) return;

        // 1. 取得武器中心的世界座標
        const originWorld = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));

        // 2. 取得槍口（firepoint）的世界座標
        let firePoint = weaponNode.getChildByName("firepoint");
        let muzzleWorld: cc.Vec2;
        
        if (firePoint) {
            muzzleWorld = firePoint.convertToWorldSpaceAR(cc.v2(0, 0));
        } else {
            // 如果沒做 firepoint，假設箭頭長度 40，朝局部 X 軸正方向
            muzzleWorld = weaponNode.convertToWorldSpaceAR(cc.v2(40, 0));
        }

        // 3. 【關鍵修正】方向 = 槍口座標 - 武器中心座標
        // 這樣不管你的箭頭怎麼轉、怎麼縮放，向量永遠是從屁股指向尖端
        let dir = muzzleWorld.sub(originWorld).normalize();

        // 4. 如果向量長度太小（重疊），給個保底方向
        if (dir.mag() < 0.1) {
            dir = side === "PLAYER" ? cc.v2(-1, 0) : cc.v2(1, 0);
        }

        // 5. 創建子彈
        this.createBulletNode(side, muzzleWorld, dir);
    }

    private createBulletNode(side: "PLAYER" | "BOT", worldPos: cc.Vec2, dir: cc.Vec2): cc.Node {
        if (!this.bulletPrefab) {
            cc.error("未綁定子彈 Prefab！");
            return new cc.Node(); 
        }

        // 直接克隆預製體，這能完美避開剛才的報錯
        const bullet = cc.instantiate(this.bulletPrefab);
        
        // 設定分組（務必與物理矩陣對應）
        bullet.group = side === "PLAYER" ? "PLAYER_BULLET" : "BOT_BULLET";
        
        // 先設定位置和角度，再加進場景
        bullet.angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;
        bullet.parent = this.node;
        bullet.setPosition(this.node.convertToNodeSpaceAR(worldPos));
        bullet.zIndex = 5;

        // 設定速度
        const rb = bullet.getComponent(cc.RigidBody);
        if (rb) {
            rb.linearVelocity = cc.v2(dir.x * this.bulletSpeed, dir.y * this.bulletSpeed);
        }

        // 設定腳本參數
        const bulletComp = bullet.getComponent(Bullet);
        if (bulletComp) {
            bulletComp.ownerSide = side;
            bulletComp.damage = this.bulletDamage;
            bulletComp.lifeTime = this.bulletLifetime;
        }

        return bullet;
    }

    handleGameOver(winner: "PLAYER" | "BOT") {
        if (this.isGameOver) return;
        this.isGameOver = true;
        cc.audioEngine.stopMusic();

        this.unschedule(this.suddenDeathTick);
        this.unschedule(this.spawnSuddenDeathPart);
        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.stopAllActions(); // 停止閃爍
            this.suddenDeathLabel.node.active = false;   // 隱藏標籤
        }
        GameManager.gold += 200;
        if (winner === "PLAYER") {
            GameManager.playerWins++;
            if (this.victorySfx) cc.audioEngine.playEffect(this.victorySfx, false);
        } else {
            GameManager.botWins++;
            if (this.defeatSfx) cc.audioEngine.playEffect(this.defeatSfx, false);
        }

        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            if (GameManager.playerWins >= 4) {
                this.resultLabel.string = "VICTORY";
                this.resultLabel.node.color = cc.Color.YELLOW;
            } else if (GameManager.botWins >= 4) {
                this.resultLabel.string = "DEFEAT";
                this.resultLabel.node.color = cc.Color.RED;
            } else {
                this.resultLabel.string = winner + " WIN!";
                this.resultLabel.node.color = cc.Color.WHITE;
            }
        }

        this.scheduleOnce(() => {
            if (GameManager.playerWins >= 4 || GameManager.botWins >= 4) {
                GameManager.resetAllData();
                cc.director.loadScene("Menu");
            } else {
                cc.director.loadScene("Shop");
            }
        }, 3);
    }

    onKeyDown(e: cc.Event.EventKeyboard) {
        if (!this.isBattleStarted) return;
        if (e.keyCode === cc.macro.KEY.a || e.keyCode === cc.macro.KEY.left) this.moveDir = 1;
        if (e.keyCode === cc.macro.KEY.d || e.keyCode === cc.macro.KEY.right) this.moveDir = -1;
        if (e.keyCode === cc.macro.KEY.space) this.isAttacking = true;
    }

    onKeyUp(e: cc.Event.EventKeyboard) {
        const k = e.keyCode;
        if (k === cc.macro.KEY.a || k === cc.macro.KEY.d || k === cc.macro.KEY.left || k === cc.macro.KEY.right) this.moveDir = 0;
        if (k === cc.macro.KEY.space) this.isAttacking = false;
    }

    getPrefabByName(name: string): cc.Prefab | undefined {
        const clean = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.allPrefabs.find(p => p && p.name.trim().toLowerCase() === clean);
    }
    onOpenSettings() {
        if (!this.settingsPrefab) {
            cc.error("BattleManager: settingsPrefab 未綁定！");
            return;
        }

        // 1. 防止重複打開
        if (cc.find("Canvas/SettingsUI")) return;

        // 2. 生成設定界面
        const node = cc.instantiate(this.settingsPrefab);
        node.name = "SettingsUI";
        const canvas = cc.find("Canvas");
        node.parent = canvas;

        // 3. 重要：確保 UI 在最前面
        // 你的子彈用了 9999，所以 UI 必須更高，或是確保層級在最後
        node.zIndex = 10; 
        node.setPosition(0, 0);

        // 4. 設定遊戲暫停
        GameManager.isPaused = true;
        
        // 5. 暫停音效
        cc.audioEngine.pauseMusic();
    }
    spawnSuddenDeathPart() {
        if (this.isGameOver || GameManager.isPaused || this.allPrefabs.length === 0) return;
        
        const prefab = this.allPrefabs[Math.floor(Math.random() * this.allPrefabs.length)];
        if (!prefab) return;

        const node = cc.instantiate(prefab);
        node.parent = this.node.parent; 
        
        // --- 修正座標：從螢幕上方隨機寬度掉落 ---
        const randomX = Math.random() * 1200; // 覆蓋大部分螢幕寬度
        node.setPosition(randomX, 600); 
        node.group = "default"; 
        
        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic; 
            rb.linearVelocity = cc.v2(0, -300); // 給一個向下的初速
            rb.angularVelocity = (Math.random() - 0.5) * 500;
        }

        cc.tween(node).delay(4).to(0.5, { opacity: 0 }).call(() => { if (node.isValid) node.destroy(); }).start();
    }
    // 專門處理 Bot 延遲登場的邏輯
    private spawnBotSequence() {
        const totalRounds = GameManager.playerWins + GameManager.botWins;
        let botIndex = totalRounds <= 1 ? 0 : (totalRounds <= 3 ? 1 : 2);
        
        if (GameManager.botConfigs && GameManager.botConfigs.length > botIndex) {
            console.log("序列載入：Bot 登場");
            // 在左邊生成 Bot
            this.spawnGridCar(GameManager.botConfigs[botIndex], cc.v2(-300, 50), "BOT", (this as any).botRoot);
        }
    }

    // 喊 FIGHT 時啟動兩台車的物理
    private startAllPhysics() {
        const activate = (root: cc.Node) => {
            if (!root) return;
            let rbs = root.getComponentsInChildren(cc.RigidBody);
            rbs.forEach(rb => {
                rb.type = cc.RigidBodyType.Dynamic;
                rb.linearVelocity = cc.v2(0, 0);
                rb.angularVelocity = 0;
                rb.awake = true;
            });
        };
        activate((this as any).playerRoot);
        activate((this as any).botRoot);
    }
}