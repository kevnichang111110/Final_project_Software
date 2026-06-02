import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";
import Health from "./HealthManager";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property(cc.Label)
    timerLabel: cc.Label | null = null; // 顯示剩餘時間

    @property(cc.Label)
    suddenDeathLabel: cc.Label | null = null; // 顯示 "SUDDEN DEATH!"

    @property(cc.Label)
    countdownLabel: cc.Label | null = null; // 新增：用於開場 3,2,1,FIGHT!

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
    countdownBgmClip: cc.AudioClip | null = null; // 倒數專用 BGM
    private wasPaused: boolean = false;

    @property(cc.AudioClip)
    victorySfx: cc.AudioClip | null = null; // 勝利音效

    @property(cc.AudioClip)
    defeatSfx: cc.AudioClip | null = null; // 失敗音效

    // --- 戰鬥狀態變數 ---
    private matchTimer: number = 30;//debug
    private isSuddenDeath: boolean = false;
    private isBattleStarted: boolean = false; // 新增：判斷是否已經開打
    private isTimerFlashing: boolean = false; // 新增：判斷倒數紅字是否正在閃爍

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

    onLoad() {
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        (physics as any).enabledContactListener = true;
        physics.enabledAccumulator = true; 
        cc.PhysicsManager.FIXED_TIME_STEP = 1/60; 

        (physics as any).velocityIterations = 40;
        (physics as any).positionIterations = 40;
        
        this.setupBattle();

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);

        // if (this.bgmClip) {
        //     cc.audioEngine.playMusic(this.bgmClip, true);
        // }
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    setupBattle() {
        this.isGameOver = false;
        this.isSuddenDeath = false;
        this.isBattleStarted = false; // 初始為 false
        this.isTimerFlashing = false;
        this.matchTimer = 30;//debug
        this.moveDir = 0;
        this.isAttacking = false;
        this.playerCoreHealth = null;
        this.botCoreHealth = null;

        this.wheelSpeedMultipliers.clear();
        this.botWheelSpeedMultipliers.clear();
        if (this.suddenDeathLabel) this.suddenDeathLabel.node.active = false;
        if (this.timerLabel) {
            this.timerLabel.string = "30";//debug
            this.timerLabel.node.color = cc.Color.WHITE; // 重置顏色
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

        this.spawnGridCar(GameManager.playerCarGrid, cc.v2(300, 50), "PLAYER", this.playerRoot);

        const totalRounds = GameManager.playerWins + GameManager.botWins;
        let botIndex = totalRounds <= 1 ? 0 : (totalRounds <= 3 ? 1 : 2);
        
        if (GameManager.botConfigs && GameManager.botConfigs.length > 0) {
            this.spawnGridCar(GameManager.botConfigs[botIndex], cc.v2(-300, 50), "BOT", this.botRoot);
        }
        this.isBattleStarted = false;
        this.startCountdownTimer = 0;
        this.startCountdownValue = 2; // 設定為 2

        if (this.countdownLabel) {
            this.countdownLabel.node.active = true;
            this.countdownLabel.string = "2"; // 初始顯示 2
        }
        if (this.countdownBgmClip) {
            cc.audioEngine.stopMusic(); // 先停止當前所有音樂
            cc.audioEngine.playMusic(this.countdownBgmClip, false); // 播放倒數 BGM (不循環)
        }
    }
    private isWheelPartType(partType: PartType): boolean {
    return partType === PartType.Wheel ||
           partType === PartType.LeftWheel ||
           partType === PartType.RightWheel;
}

    destroyCurrentBattle() {
        if (this.playerRoot && this.playerRoot.isValid) this.playerRoot.destroy();
        if (this.botRoot && this.botRoot.isValid) this.botRoot.destroy();
        this.unschedule(this.suddenDeathTick);
    }

    private getCleanNodeName(node: cc.Node): string {
        return node.name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    }

    private isCoreNode(node: cc.Node): boolean {
        const draggable = node.getComponent("Draggable") as any;
        return (draggable && draggable.partType === PartType.Core) || this.getCleanNodeName(node) === "core";
    }

    private isBodyLikeNode(node: cc.Node): boolean {
        const draggable = node.getComponent("Draggable") as any;
        return !!draggable && (draggable.partType === PartType.Body || draggable.partType === PartType.Core || this.isCoreNode(node));
    }

    private hasCoreInMap(partMap: Map<string, cc.Node>): boolean {
        let found = false;
        partMap.forEach(node => {
            if (this.isCoreNode(node)) found = true;
        });
        return found;
    }

    spawnGridCar(gridData: any[], startPos: cc.Vec2, side: "PLAYER" | "BOT", root: cc.Node) {
        const partMap = (side === "PLAYER") ? this.playerPartsMap : this.botPartsMap;
        const groupName = (side === "PLAYER") ? "PLAYER_PART" : "BOT_PART";

        for (let data of gridData) {
            const prefab = this.getPrefabByName(data.partName);
            if (!prefab) continue;

            const node = cc.instantiate(prefab);
            node.parent = root;
            node.group = groupName;
            node.setPosition(startPos.x + data.gridX * 40, startPos.y + data.gridY * 40);
            node.scaleX = 1;

            partMap.set(`${data.gridX},${data.gridY}`, node);

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
            const draggable = node.getComponent("Draggable") as any;
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
        (joint as any).dampingRatio = 1;
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
        joint.dampingRatio = 0.8;
        joint.enableMotor = true;
        joint.maxMotorTorque = 10000;

        const drag = wheelNode.getComponent("Draggable") as any;
        const speedMul = drag && typeof drag.wheelMotorMultiplier === "number" ? drag.wheelMotorMultiplier : 1;
        //const speedMul =drag.wheelMotorMultiplier;
        joint.maxMotorTorque = 10000 * speedMul; 

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
        const joint = parentBox.addComponent(cc.RevoluteJoint);
        joint.connectedBody = weaponRb;
        const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);
        joint.collideConnected = false;
        joint.enableLimit = true;
        joint.lowerAngle = (side === "PLAYER") ? -20 : -120;
        joint.upperAngle = (side === "PLAYER") ? 120 : 20;
        joint.enableMotor = true;
        joint.maxMotorTorque = 10000;
        if (side === "PLAYER") this.weaponJoints.push(joint);
        else this.botWeaponJoints.push(joint);
    }

    update(dt: number) {
        if (GameManager.isPaused !== this.wasPaused) {
            if (GameManager.isPaused) {
                cc.audioEngine.pauseMusic(); // 暫停 BGM
            } else {
                cc.audioEngine.resumeMusic(); // 恢復 BGM
            }
            this.wasPaused = GameManager.isPaused;
        }
        if (this.isGameOver || GameManager.isPaused) return;

        // 戰鬥尚未開始，不執行移動與計時
        if (!this.isBattleStarted) {
            this.startCountdownTimer += dt;

            if (this.startCountdownTimer >= 1) {
                this.startCountdownTimer = 0;
                this.startCountdownValue--;

                if (this.startCountdownValue > 0) {
                    if (this.countdownLabel) this.countdownLabel.string = this.startCountdownValue.toString();
                } 
                else if (this.startCountdownValue === 0) {
                    if (this.countdownLabel) this.countdownLabel.string = "FIGHT!";
                    this.isBattleStarted = true; // 倒數結束，正式開打
                    if (this.bgmClip) {
                        cc.audioEngine.stopMusic(); // 停止倒數音樂
                        cc.audioEngine.playMusic(this.bgmClip, true); // 播放戰鬥音樂 (循環)
                    }

                    this.scheduleOnce(() => {
                        if (this.countdownLabel) this.countdownLabel.node.active = false;
                    }, 2);
                }
            }
            return; // 倒數完成前，不執行下面的戰鬥/移動邏輯
        }

        // --- 倒數計時邏輯 ---
        if (!this.isSuddenDeath) {
            if(GameManager.isPaused)return;
            this.matchTimer -= dt;
            if (this.timerLabel) {
                this.timerLabel.string = Math.ceil(this.matchTimer).toString();
                
                // --- 新增：最後5秒紅字閃爍 ---
                if (this.matchTimer <= 5 && !this.isTimerFlashing) {
                    this.isTimerFlashing = true;
                    this.timerLabel.node.color = cc.Color.RED;
                    cc.tween(this.timerLabel.node)
                        .repeatForever(
                            cc.tween().to(0.5, { opacity: 50 }).to(0.5, { opacity: 255 })
                        )
                        .start();
                }
            }
            if (this.matchTimer <= 0) this.startSuddenDeath();
        }

        // 玩家輪子
        const playerHasWheel = this.wheelJoints.length > 0;
        if (playerHasWheel) {
            const targetSpeed = this.moveDir * -500;
            this.wheelSpeed += (targetSpeed - this.wheelSpeed) * 0.15;

            for (let j of this.wheelJoints) {
                const mul = this.wheelSpeedMultipliers.get(j) ?? 1;
                j.motorSpeed = this.wheelSpeed * mul;

                if (this.moveDir !== 0) {
                    cc.log(`[玩家移動中] 基礎速: ${this.wheelSpeed.toFixed(0)} | 倍率: ${mul} | 最終馬達速度: ${j.motorSpeed.toFixed(0)}`);
                }
            }
        } else {
            this.wheelSpeed = 0;
            for (let j of this.wheelJoints) j.motorSpeed = 0;
        }

        // 玩家武器
        for (let j of this.weaponJoints) {
            j.enableMotor = playerHasWheel;
            if (!playerHasWheel) { j.motorSpeed = 0; continue; }
            const cur = j.getJointAngle();
            if (this.isAttacking) {
                if (cur < j.upperAngle) j.motorSpeed = 1500; else j.motorSpeed = 0;
            } else {
                if (cur > j.lowerAngle) j.motorSpeed = -500; else j.motorSpeed = 0;
            }
        }
        
        // Bot AI 只有在戰鬥開始後執行
        this.updateBotAI();
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
            cc.tween(this.suddenDeathLabel.node)
                .repeatForever(cc.tween().to(0.5, { opacity: 0 }).to(0.5, { opacity: 255 }))
                .start();
        }

        if (this.suddenDeathSfx) cc.audioEngine.playEffect(this.suddenDeathSfx, false);

        this.screenShake();

        for (let i = 0; i < 20; i++) {
            this.scheduleOnce(() => this.spawnSuddenDeathPart(), i * 0.01); 
        }

        this.schedule(this.suddenDeathTick, 1);
    }

    private screenShake() {
        const canvas = cc.find("Canvas");
        if (!canvas) return;
        const originalPos = canvas.getPosition();
        const shakeStrength = 50; 
        cc.tween(canvas)
            .by(0.05, { x: shakeStrength, y: shakeStrength })
            .by(0.05, { x: -shakeStrength * 2, y: -shakeStrength * 1.5 })
            .by(0.05, { x: shakeStrength * 1.5, y: shakeStrength * 0.5 })
            .by(0.05, { x: -shakeStrength, y: -shakeStrength })
            .to(0.1, { x: originalPos.x, y: originalPos.y }) 
            .start();
    }

    suddenDeathTick() {
        if (this.isGameOver || GameManager.isPaused) return;
        if (this.playerCoreHealth) this.playerCoreHealth.takeDamage(30);//debug
        if (this.botCoreHealth) this.botCoreHealth.takeDamage(30);
    }

    spawnSuddenDeathPart() {
        if (this.allPrefabs.length === 0) return;
        const prefab = this.allPrefabs[Math.floor(Math.random() * this.allPrefabs.length)];
        if (!prefab) return;
        const node = cc.instantiate(prefab);
        node.parent = this.node.parent; 
        node.setPosition(480+(Math.random() - 0.5) * 1000, 700); 
        node.group = "default";
        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic; 
            rb.linearVelocity = cc.v2(0, -200); 
            rb.angularVelocity = (Math.random() - 0.5) * 300;
        }
        cc.tween(node).delay(1.5).to(0.5, { opacity: 0 }).call(() => { if (node.isValid) node.destroy(); }).start();
    }

    updateBotAI() {
    if (!this.isBattleStarted) return;

    for (let j of this.botWheelJoints) {
        const mul = this.botWheelSpeedMultipliers.get(j) ?? 1;
        j.motorSpeed = 1000 * mul;
    }

    for (let j of this.botWeaponJoints) {
        const cur = j.getJointAngle();
        const botAttackSpeed = 600; 
        if (cur <= j.lowerAngle) j.motorSpeed = botAttackSpeed;
        else if (cur >= j.upperAngle) j.motorSpeed = -botAttackSpeed;
        else if (j.motorSpeed === 0) j.motorSpeed = botAttackSpeed;
    }
}

    handleGameOver(winner: "PLAYER" | "BOT") {
        if (this.isGameOver) return;
        this.isGameOver = true;
        cc.audioEngine.stopMusic();
        this.unschedule(this.suddenDeathTick);
        if (this.suddenDeathLabel) this.suddenDeathLabel.node.stopAllActions();
        if (this.timerLabel) this.timerLabel.node.stopAllActions();

        GameManager.gold += 500;
        if (winner === "PLAYER"){
            GameManager.playerWins++;
            if (this.victorySfx) cc.audioEngine.playEffect(this.victorySfx, false);
        }else{
            GameManager.botWins++;
            if (this.defeatSfx) cc.audioEngine.playEffect(this.defeatSfx, false);

        }

        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.stopAllActions();
            this.suddenDeathLabel.node.active = false;
        }
        if (this.resultLabel) {
            this.resultLabel.node.active = true;

            if (GameManager.playerWins >= 4) {
                this.resultLabel.string = "VICTORY";
                this.resultLabel.node.color = cc.Color.YELLOW;
            } else if (GameManager.botWins >= 4) {
                // Bot 最終獲勝
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
        if (!this.isBattleStarted) return; // 戰鬥前不准動
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
        if (!this.settingsPrefab) return;
        const node = cc.instantiate(this.settingsPrefab);
        node.parent = cc.find("Canvas");
        node.setPosition(0, 0);
        node.setSiblingIndex(99);
    }
}