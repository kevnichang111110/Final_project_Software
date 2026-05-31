import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";
import Health from "./HealthManager";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property(cc.Label)
    timerLabel: cc.Label | null = null;

    @property(cc.Label)
    suddenDeathLabel: cc.Label | null = null; // 顯示 "SUDDEN DEATH!"

    @property([cc.Prefab])
    allPrefabs: cc.Prefab[] = [];

    @property(cc.Prefab)
    settingsPrefab: cc.Prefab | null = null;

    @property(cc.Label)
    resultLabel: cc.Label | null = null;

    @property(cc.AudioClip)
    bgmClip: cc.AudioClip | null = null;

    // --- 新增：驟死賽開始音效 ---
    @property(cc.AudioClip)
    suddenDeathSfx: cc.AudioClip | null = null; 

    // --- 戰鬥狀態變數 ---
    private matchTimer: number = 30;
    private isSuddenDeath: boolean = false;
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

        if (this.bgmClip) {
            cc.audioEngine.playMusic(this.bgmClip, true);
        }
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    setupBattle() {
        this.isGameOver = false;
        this.isSuddenDeath = false;
        this.matchTimer = 30;
        this.moveDir = 0;
        this.isAttacking = false;
        this.playerCoreHealth = null;
        this.botCoreHealth = null;

        if (this.suddenDeathLabel) this.suddenDeathLabel.node.active = false;
        if (this.timerLabel) this.timerLabel.string = "30";

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

        this.spawnGridCar(GameManager.playerCarGrid, cc.v2(250, 50), "PLAYER", this.playerRoot);

        const totalRounds = GameManager.playerWins + GameManager.botWins;
        let botIndex = 0;
        if (totalRounds <= 1) botIndex = 0; 
        else if (totalRounds <= 3) botIndex = 1; 
        else botIndex = 2;
        
        if (GameManager.botConfigs && GameManager.botConfigs.length > 0) {
            this.spawnGridCar(GameManager.botConfigs[botIndex], cc.v2(-250, 50), "BOT", this.botRoot);
        }
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
                } else {
                    cc.log(`[部件破壞] ${side} 的 ${node.name} 被打爆，戰鬥繼續。`);
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

            if (draggable.partType === PartType.LeftWheel || draggable.partType === PartType.RightWheel) {
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

        cc.tween(node)
            .delay(3)
            .to(0.5, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
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

        if (side === "PLAYER") this.wheelJoints.push(joint);
        else this.botWheelJoints.push(joint);
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
        if (this.isGameOver || GameManager.isPaused) return;

        if (!this.isSuddenDeath) {
            this.matchTimer -= dt;
            if (this.timerLabel) this.timerLabel.string = Math.ceil(this.matchTimer).toString();
            if (this.matchTimer <= 0) this.startSuddenDeath();
        }

        const playerHasWheel = this.wheelJoints.length > 0;
        if (playerHasWheel) {
            const targetSpeed = this.moveDir * -500;
            this.wheelSpeed += (targetSpeed - this.wheelSpeed) * 0.15;
            for (let j of this.wheelJoints) j.motorSpeed = this.wheelSpeed;
        } else {
            this.wheelSpeed = 0;
        }

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
        this.updateBotAI();
    }

    startSuddenDeath() {
        if (this.isSuddenDeath) return;
        this.isSuddenDeath = true;

        if (this.timerLabel) this.timerLabel.string = "OVERTIME";
        
        if (this.suddenDeathLabel) {
            this.suddenDeathLabel.node.active = true;
            cc.tween(this.suddenDeathLabel.node)
                .repeatForever(cc.tween().to(0.5, { opacity: 0 }).to(0.5, { opacity: 255 }))
                .start();
        }

        // --- 新增：播放驟死賽音效 ---
        if (this.suddenDeathSfx) {
            cc.audioEngine.playEffect(this.suddenDeathSfx, false);
        }

        this.screenShake();

        for (let i = 0; i < 20; i++) {
            this.scheduleOnce(() => {
                this.spawnSuddenDeathPart();
            }, i * 0.01); 
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
        if (this.playerCoreHealth) this.playerCoreHealth.takeDamage(5);
        if (this.botCoreHealth) this.botCoreHealth.takeDamage(5);
    }

    spawnSuddenDeathPart() {
        if (this.allPrefabs.length === 0) return;
        const prefab = this.allPrefabs[Math.floor(Math.random() * this.allPrefabs.length)];
        if (!prefab) return;

        const node = cc.instantiate(prefab);
        node.parent = this.node.parent; 
        const randomX = 480+(Math.random() - 0.5) * 1000; 
        node.setPosition(randomX, 700); 

        node.group = "default";
        node.opacity = 255;

        const rb = node.getComponent(cc.RigidBody);
        if (rb) {
            rb.type = cc.RigidBodyType.Dynamic; 
            rb.linearVelocity = cc.v2(0, -200); 
            rb.angularVelocity = (Math.random() - 0.5) * 300;
        }

        cc.tween(node)
            .delay(3)
            .to(0.5, { opacity: 0 })
            .call(() => { if (node.isValid) node.destroy(); })
            .start();
    }

    updateBotAI() {
        for (let j of this.botWheelJoints) j.motorSpeed = 1000;
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
        this.unschedule(this.suddenDeathTick);
        if (this.suddenDeathLabel) this.suddenDeathLabel.node.stopAllActions();

        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            this.resultLabel.string = winner + " WIN!";
        }

        GameManager.gold += 500;
        if (winner === "PLAYER") GameManager.playerWins++;
        else GameManager.botWins++;

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