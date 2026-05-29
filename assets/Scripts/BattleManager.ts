import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";
import Health from "./HealthManager"; // 確保你有建立這個腳本

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property([cc.Prefab])
    allPrefabs: cc.Prefab[] = [];

    @property(cc.Prefab)
    settingsPrefab: cc.Prefab |null= null;

    @property(cc.Label)
    resultLabel: cc.Label |null= null;

    // --- 玩家相關變數 ---
    private playerBody: cc.Node |null= null;
    private playerWheelJoints: cc.WheelJoint[] = [];
    private playerWeaponJoints: cc.RevoluteJoint[] = [];
    private moveDir: number = 0; 
    private isAttacking: boolean = false;

    // --- Bot 相關變數 ---
    private botBody: cc.Node |null= null;
    private botWheelJoints: cc.WheelJoint[] = [];
    private botWeaponJoints: cc.RevoluteJoint[] = [];

    private maxSpeed: number = 1200; 
    private isGameOver: boolean = false;

    onLoad() {
        let physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        
        // 如果需要除錯，取消註解下一行可以看到紅點圓心
        // physics.debugDrawFlags = cc.PhysicsManager.DrawBits.e_jointBit | cc.PhysicsManager.DrawBits.e_shapeBit;

        this.setupBattle();

        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    setupBattle() {
        this.isGameOver = false;

        // 1. 生成玩家 (生在右邊 350)
        this.playerBody = this.spawnCar(GameManager.playerCarConfig, cc.v2(350, 0), "PLAYER");
        
        // 2. 生成第一個 Bot (生在左邊 -350)
        if (GameManager.botConfigs && GameManager.botConfigs.length > 0) {
            this.botBody = this.spawnCar(GameManager.botConfigs[0], cc.v2(-350, 0), "BOT");
        }
    }

    update(dt: number) {
        if (this.isGameOver) return;

        // 1. 玩家控制
        for (let joint of this.playerWheelJoints) {
            // 因為玩家面向左，moveDir 1(右) 應該是負轉速，-1(左) 應該是正轉速
            joint.motorSpeed = this.moveDir !== 0 ? this.maxSpeed * +this.moveDir : 0;
        }
        for (let j of this.playerWeaponJoints) {
            let curAngle = j.getJointAngle();
            j.motorSpeed = this.isAttacking ? (curAngle < j.upperAngle ? 1500 : 0) : (curAngle > j.lowerAngle ? -500 : 0);
        }

        // 2. Bot AI 控制
        this.updateBotAI();
    }

    updateBotAI() {
        if (!this.playerBody || !this.botBody) return;

        let distance = this.playerBody.x - this.botBody.x;
        let absDist = Math.abs(distance);

        // Bot 移動：維持在一定距離
        let botMoveDir = 0;
        if (absDist > 280) botMoveDir = distance > 0 ? 1 : -1;
        else if (absDist < 180) botMoveDir = distance > 0 ? -1 : 1;

        for (let joint of this.botWheelJoints) {
            joint.motorSpeed = this.maxSpeed * botMoveDir * 0.6; // Bot 速度稍慢
        }

        // Bot 攻擊：近距離自動亂揮
        for (let j of this.botWeaponJoints) {
            let curAngle = j.getJointAngle();
            if (absDist < 350) {
                if (curAngle >= j.upperAngle) j.motorSpeed = -1000;
                else if (curAngle <= j.lowerAngle) j.motorSpeed = 1000;
                if (j.motorSpeed === 0) j.motorSpeed = 1000;
            } else {
                if (curAngle > j.lowerAngle) j.motorSpeed = -400;
            }
        }
    }

    spawnCar(config: any, spawnPos: cc.Vec2, side: "PLAYER" | "BOT"): cc.Node | null {
        let bodyPrefab = this.getPrefabByName(config.bodyPrefabName);
        if (!bodyPrefab) {
            console.error("找不到車身 Prefab:", config.bodyPrefabName);
            return null;
        }

        let bodyNode = cc.instantiate(bodyPrefab);
        bodyNode.parent = this.node;
        bodyNode.setPosition(spawnPos);
        bodyNode.group = side === "PLAYER" ? "PLAYER_BODY" : "BOT_BODY";

        let hp = bodyNode.addComponent(Health) as Health; 
        hp.onDieCallback = () => { this.handleGameOver(side === "PLAYER" ? "BOT" : "PLAYER"); };

        let bodyRb = bodyNode.getComponent(cc.RigidBody);
        if (bodyRb) bodyRb.type = cc.RigidBodyType.Dynamic;

        for (let partInfo of config.parts) {
            let slotNode = this.findNodeRecursive(bodyNode, partInfo.slotName);
            let partPrefab = this.getPrefabByName(partInfo.partName);

            if (slotNode && partPrefab) {
                let partNode = cc.instantiate(partPrefab);
                partNode.parent = this.node; 
                partNode.group = side === "PLAYER" ? "PLAYER_PART" : "BOT_PART";

                let prb = partNode.getComponent(cc.RigidBody);
                if (prb) prb.type = cc.RigidBodyType.Dynamic;
                
                let pcol = partNode.getComponent(cc.PhysicsCollider);
                if (pcol) pcol.enabled = true;

                let worldPos = slotNode.convertToWorldSpaceAR(cc.v2(0, 0));
                partNode.setPosition(this.node.convertToNodeSpaceAR(worldPos));
                
                this.attachJoint(bodyNode, partNode, slotNode, side);
            }
        }
        return bodyNode;
    }

    attachJoint(body: cc.Node, part: cc.Node, slot: cc.Node, side: "PLAYER" | "BOT") {
        let partRb = part.getComponent(cc.RigidBody);
        let slotComp = slot.getComponent("Slotsetting");
        if (!partRb || !slotComp) return;

        let anchorInBody = body.convertToNodeSpaceAR(slot.convertToWorldSpaceAR(cc.v2(0, 0)));

        if (slotComp.slotType === PartType.LeftWheel || slotComp.slotType === PartType.RightWheel) {
            let joint = body.addComponent(cc.WheelJoint);
            joint.connectedBody = partRb;
            joint.collideConnected = false;
            joint.anchor = anchorInBody;
            joint.connectedAnchor = cc.v2(0, 0);
            joint.localAxisA = cc.v2(0, 1);
            joint.frequency = 15; // 提高避震硬度
            joint.dampingRatio = 0.8;
            joint.maxMotorTorque = 20000;
            joint.enableMotor = true;

            if (side === "PLAYER") this.playerWheelJoints.push(joint);
            else this.botWheelJoints.push(joint);
        } else {
            let joint = body.addComponent(cc.RevoluteJoint);
            joint.connectedBody = partRb;
            joint.collideConnected = false;
            joint.anchor = anchorInBody;
            joint.connectedAnchor = cc.v2(0, 0);
            joint.enableLimit = true;

            // 針對玩家或 Bot 的 Prefab 朝向設定不同的角度限制

            joint.lowerAngle = -20; joint.upperAngle = 120;
            joint.enableMotor = true;
            joint.maxMotorTorque = 800000;
            if (side === "PLAYER") this.playerWeaponJoints.push(joint);
            else this.botWeaponJoints.push(joint);
        }
    }

    handleGameOver(winner: "PLAYER" | "BOT") {
        if (this.isGameOver) return;
        this.isGameOver = true;
        GameManager.gold += 500; 
        if (winner === "PLAYER") {
            GameManager.playerWins++;
            if(this.resultLabel) this.resultLabel.string = "PLAYER WIN!";
        } else {
            GameManager.botWins++;
            
            if(this.resultLabel) this.resultLabel.string = "BOT WIN!";
        }
        console.log(`目前比分 - 玩家: ${GameManager.playerWins} vs Bot: ${GameManager.botWins}`);
        console.log(`目前金幣: ${GameManager.gold}`);

        // 顯示結果 Label
        if (this.resultLabel) {
            this.resultLabel.node.active = true;
            this.resultLabel.node.scale = 0;
            cc.tween(this.resultLabel.node).to(0.5, { scale: 1.5 }, { easing: 'backOut' }).start();
        }

        if (GameManager.playerWins >= 4 || GameManager.botWins >= 4) {
            // --- 最終結果邏輯 ---
            let finalText = (GameManager.playerWins >= 4) ? "🏆 CHAMPION 🏆" : "💀 DEFEAT 💀";
            if (this.resultLabel) this.resultLabel.string = finalText;

            console.log("比賽結束，準備回到主選單");

            this.scheduleOnce(() => {
                // 比賽徹底結束，重置比分與金幣（或是你想保留金幣就不要重置 gold）
                GameManager.playerWins = 0;
                GameManager.botWins = 0;
                GameManager.gold = 1000; // 如果想讓玩家下一場重新開始，就取消註解這行
                
                // 跳轉到 Menu
                cc.director.loadScene("Menu");
            }, 3);

        } else {
            // --- 繼續比賽邏輯 ---
            console.log("回合結束，準備回商店改裝");
            this.scheduleOnce(() => {
                cc.director.loadScene("Shop");
            }, 3);
        }
    }

    // --- 輔助函數 ---
    onKeyDown(e: cc.Event.EventKeyboard) {
        switch(e.keyCode) {
            case cc.macro.KEY.a: case cc.macro.KEY.left: this.moveDir = -1; break;
            case cc.macro.KEY.d: case cc.macro.KEY.right: this.moveDir = 1; break;
            case cc.macro.KEY.space: this.isAttacking = true; break;
        }
    }
    onKeyUp(e: cc.Event.EventKeyboard) {
        switch(e.keyCode) {
            case cc.macro.KEY.a: case cc.macro.KEY.left:
            case cc.macro.KEY.d: case cc.macro.KEY.right: this.moveDir = 0; break;
            case cc.macro.KEY.space: this.isAttacking = false; break;
        }
    }
    findNodeRecursive(root: cc.Node, name: string): cc.Node | null {
        if (root.name === name) return root;
        for (let child of root.children) {
            let res = this.findNodeRecursive(child, name);
            if (res) return res;
        }
        return null;
    }
    getPrefabByName(name: string): cc.Prefab | undefined {
        let clean = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.allPrefabs.find(p => p && p.name.trim().toLowerCase() === clean);
    }
    onOpenSettings() {
        if (this.settingsPrefab) {
            let node = cc.instantiate(this.settingsPrefab);
            let canvas = cc.find("Canvas");
            node.parent = canvas;
            node.setSiblingIndex(canvas.childrenCount - 1);
            node.setPosition(0, 0);
        }
    }
    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }
}