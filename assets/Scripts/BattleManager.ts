import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";
import Health from "./HealthManager";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property([cc.Prefab])
    allPrefabs: cc.Prefab[] = [];

    @property(cc.Prefab)
    settingsPrefab: cc.Prefab |null= null;

    @property(cc.Label)
    resultLabel: cc.Label |null= null;

    @property(cc.AudioClip)
    bgmClip: cc.AudioClip |null= null;

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

    private playerRoot: cc.Node|null = null;
    private botRoot: cc.Node |null= null;

    onLoad() {
        const physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        //physics.enabledAccumulator = true; 
        //cc.PhysicsManager.FIXED_TIME_STEP = 1/60; 
        //physics.debugDrawFlags = cc.PhysicsManager.DrawBits.e_jointBit| cc.PhysicsManager.DrawBits.e_shapeBit;

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
        this.moveDir = 0;
        this.isAttacking = false;

        this.playerPartsMap.clear();
        this.botPartsMap.clear();
        this.wheelJoints = [];
        this.weaponJoints = [];
        this.botWheelJoints = [];
        this.botWeaponJoints = [];

        this.destroyCurrentBattle();

        // 玩家與 Bot 根節點，方便管理與清除
        this.playerRoot = new cc.Node("PLAYER_ROOT");
        this.playerRoot.parent = this.node;

        this.botRoot = new cc.Node("BOT_ROOT");
        this.botRoot.parent = this.node;

        // 玩家
        this.spawnGridCar(GameManager.playerCarGrid, cc.v2(250, 50), "PLAYER", this.playerRoot);

        // Bot
        if (GameManager.botConfigs && GameManager.botConfigs.length > 0) {
            this.spawnGridCar(GameManager.botConfigs[0], cc.v2(-250, 50), "BOT", this.botRoot);
        }
    }

    destroyCurrentBattle() {
        if (this.playerRoot && this.playerRoot.isValid) {
            this.playerRoot.destroy();
            this.playerRoot = null;
        }

        if (this.botRoot && this.botRoot.isValid) {
            this.botRoot.destroy();
            this.botRoot = null;
        }
    }

    spawnGridCar(gridData: any[], startPos: cc.Vec2, side: "PLAYER" | "BOT", root: cc.Node) {
        const partMap = (side === "PLAYER") ? this.playerPartsMap : this.botPartsMap;
        const groupName = (side === "PLAYER") ? "PLAYER_PART" : "BOT_PART";

        // 先生成全部零件
        for (let data of gridData) {
            const prefab = this.getPrefabByName(data.partName);
            if (!prefab) continue;

            const node = cc.instantiate(prefab);
            node.parent = root;
            node.group = groupName;

            const offsetX = data.gridX * 40;
            const offsetY = data.gridY * 40;

            node.setPosition(startPos.x + offsetX, startPos.y + offsetY);

            // 物理節點不要翻轉，避免 joint / collider 異常
            node.scaleX = 1;

            partMap.set(`${data.gridX},${data.gridY}`, node);

            // 第一個零件當作核心血量節點
            if (gridData.indexOf(data) === 0) {
                let hp = node.getComponent(Health) || node.addComponent(Health);
                hp.onDieCallback = () => {
                    this.handleGameOver(side === "PLAYER" ? "BOT" : "PLAYER");
                };
            }
        }

        // 再建立關節
        partMap.forEach((node, key) => {
            const coords = key.split(",").map(Number);
            const x = coords[0];
            const y = coords[1];

            const draggable = node.getComponent("Draggable") as any;
            if (!draggable) return;

            if (draggable.partType === PartType.Body) {
                const right = partMap.get(`${x + 1},${y}`);
                if (right) {
                    const rightDrag = right.getComponent("Draggable") as any;
                    if (rightDrag && rightDrag.partType === PartType.Body) {
                        this.tryWeld(node, right);
                    }
                }

                const top = partMap.get(`${x},${y + 1}`);
                if (top) {
                    const topDrag = top.getComponent("Draggable") as any;
                    if (topDrag && topDrag.partType === PartType.Body) {
                        this.tryWeld(node, top);
                    }
                }
                
            }

            if (draggable.partType === PartType.LeftWheel || draggable.partType === PartType.RightWheel) {
                this.setupWheelJoint(node, partMap, x, y, side);
            } else if (draggable.partType === PartType.Weapon) {
                this.setupWeaponJoint(node, partMap, x, y, side);
            }
        });
    }

    tryWeld(self: cc.Node, neighbor: cc.Node) {
        if (!self || !neighbor) return;

        const selfRb = self.getComponent(cc.RigidBody);
        const neighborRb = neighbor.getComponent(cc.RigidBody);
        if (!selfRb || !neighborRb) return;

        // 用兩個方塊中心的中點當關節位置，避免 anchor / connectedAnchor 不一致
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
        joint.referenceAngle = 0;
    }

    setupWheelJoint(wheelNode: cc.Node, partMap: Map<string, cc.Node>, x: number, y: number, side: string) {
        // 找上方當底盤的方塊，沒有就不建立
        const parentBox = partMap.get(`${x},${y + 1}`);
        if (!parentBox || parentBox === wheelNode) return;

        const parentDrag = parentBox.getComponent("Draggable") as any;
        if (!parentDrag || parentDrag.partType !== PartType.Body) return;

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const wheelRb = wheelNode.getComponent(cc.RigidBody);
        if (!parentRb || !wheelRb) return;

        const joint = parentBox.addComponent(cc.WheelJoint);
        joint.connectedBody = wheelRb;

        const worldPos = wheelNode.convertToWorldSpaceAR(cc.v2(0, 0));
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = wheelNode.convertToNodeSpaceAR(worldPos);

        joint.collideConnected = false;
        joint.localAxisA = cc.v2(0, 1);

        joint.frequency = 8;
        joint.dampingRatio = 0.9;

        joint.enableMotor = true;
        joint.maxMotorTorque = 2000;
        joint.motorSpeed = 0;

        if (side === "PLAYER") this.wheelJoints.push(joint);
        else this.botWheelJoints.push(joint);
    }

    setupWeaponJoint(weaponNode: cc.Node, partMap: Map<string, cc.Node>, x: number, y: number, side: string) {
        let parentBox: cc.Node |null= null;

        const neighbors = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
        ];

        for (const coord of neighbors) {
            const n = partMap.get(`${coord[0]},${coord[1]}`);
            if (!n || n === weaponNode) continue;

            const drag = n.getComponent("Draggable") as any;
            if (drag && drag.partType === PartType.Body) {
                parentBox = n;
                break;
            }
        }

        if (!parentBox) {
            console.warn(`武器 (${x},${y}) 找不到相鄰的車身方塊來連接！`);
            return;
        }

        const parentRb = parentBox.getComponent(cc.RigidBody);
        const weaponRb = weaponNode.getComponent(cc.RigidBody);
        if (!parentRb || !weaponRb) return;

        const joint = parentBox.addComponent(cc.RevoluteJoint);
        joint.connectedBody = weaponRb;

        // 兩邊都使用同一個世界點
        const worldPos = weaponNode.convertToWorldSpaceAR(cc.v2(0, 0));
        joint.anchor = parentBox.convertToNodeSpaceAR(worldPos);
        joint.connectedAnchor = weaponNode.convertToNodeSpaceAR(worldPos);

        joint.collideConnected = false;
        joint.enableLimit = true;

        if (side === "PLAYER") {
            joint.lowerAngle = -20;
            joint.upperAngle = 120;
        } else {
            joint.lowerAngle = -120;
            joint.upperAngle = 20;
        }

        joint.enableMotor = true;
        joint.maxMotorTorque = 400000;
        joint.motorSpeed = 0;

        if (side === "PLAYER") this.weaponJoints.push(joint);
        else this.botWeaponJoints.push(joint);
    }

    update(dt: number) {
        if (this.isGameOver) return;

        // 玩家輪子
        const targetSpeed = this.moveDir * -500;
        this.wheelSpeed += (targetSpeed - this.wheelSpeed) * 0.15;

        for (let j of this.wheelJoints) {
            j.motorSpeed = this.wheelSpeed;
        }

        // 玩家武器
        for (let j of this.weaponJoints) {
            const cur = j.getJointAngle();

            if (this.isAttacking) {
                if (cur < j.upperAngle) j.motorSpeed = 1500;
                else j.motorSpeed = 0;
            } else {
                if (cur > j.lowerAngle) j.motorSpeed = -500;
                else j.motorSpeed = 0;
            }
        }

        this.updateBotAI();
    }

    updateBotAI() {
        if (this.botWheelJoints.length === 0) return;

        for (let j of this.botWheelJoints) {
            j.motorSpeed = 1000;
        }

        for (let j of this.botWeaponJoints) {
            const cur = j.getJointAngle();

            if (cur <= j.lowerAngle) {
                j.motorSpeed = 1000;
            } else if (cur >= j.upperAngle) {
                j.motorSpeed = -1000;
            } else if (j.motorSpeed === 0) {
                j.motorSpeed = 1000;
            }
        }
    }

    handleGameOver(winner: "PLAYER" | "BOT") {
        if (this.isGameOver) return;
        this.isGameOver = true;

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
        if (k === cc.macro.KEY.a || k === cc.macro.KEY.d || k === cc.macro.KEY.left || k === cc.macro.KEY.right) {
            this.moveDir = 0;
        }
        if (k === cc.macro.KEY.space) this.isAttacking = false;
    }

    getPrefabByName(name: string): cc.Prefab | undefined {
        const clean = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.allPrefabs.find(p => p && p.name.trim().toLowerCase() === clean);
    }

    onOpenSettings() {
        if (!this.settingsPrefab) return;

        const node = cc.instantiate(this.settingsPrefab);
        const canvas = cc.find("Canvas");
        node.parent = canvas;
        node.setPosition(0, 0);
        node.setSiblingIndex(99);
    }
}