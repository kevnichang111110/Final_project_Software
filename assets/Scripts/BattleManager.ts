import GameManager from "./GameManager";
import { PartType } from "./Slotsetting";

const { ccclass, property } = cc._decorator;

@ccclass
export default class BattleManager extends cc.Component {

    @property([cc.Prefab])
    allPrefabs: cc.Prefab[] = [];

    private wheelJoints: cc.WheelJoint[] = []; // 儲存所有的輪胎關節
    private moveDir: number = 0; // 0: 停止, 1: 右, -1: 左
    private maxSpeed: number = 1200; // 最大轉速

    onLoad() {
        let physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        
        // 偵錯模式（建議先開著看關節位置對不對）
        //physics.debugDrawFlags = cc.PhysicsManager.DrawBits.e_jointBit | cc.PhysicsManager.DrawBits.e_shapeBit;

        this.reconstructCar();

        // 註冊鍵盤事件
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.on(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    onDestroy() {
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_DOWN, this.onKeyDown, this);
        cc.systemEvent.off(cc.SystemEvent.EventType.KEY_UP, this.onKeyUp, this);
    }

    onKeyDown(event: cc.Event.EventKeyboard) {
        switch(event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
                this.moveDir = -1;
                break;
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.moveDir = 1;
                break;
        }
    }

    onKeyUp(event: cc.Event.EventKeyboard) {
        switch(event.keyCode) {
            case cc.macro.KEY.a:
            case cc.macro.KEY.left:
            case cc.macro.KEY.d:
            case cc.macro.KEY.right:
                this.moveDir = 0;
                break;
        }
    }

    update(dt: number) {
        // 每一幀根據鍵盤輸入更新輪胎轉速
        for (let joint of this.wheelJoints) {
            if (this.moveDir !== 0) {
                joint.motorSpeed = this.maxSpeed * this.moveDir;
                joint.enableMotor = true;
            } else {
                // 停止時可以選擇關閉馬達或設速度為0
                joint.motorSpeed = 0;
                // joint.enableMotor = false; // 註解這行可以產生「煞車」效果
            }
        }
    }

    reconstructCar() {
        let config = GameManager.playerCarConfig;
        if (!config || !config.bodyPrefabName) return;

        let bodyPrefab = this.getPrefabByName(config.bodyPrefabName);
        if (!bodyPrefab) return;

        let bodyNode = cc.instantiate(bodyPrefab);
        bodyNode.parent = this.node;
        bodyNode.angle = 0; 
        bodyNode.setPosition(0, 300); 

        // 確保 Body 組別正確 (為了避開碰撞)
        bodyNode.group = "BODY"; 

        let bodyRb = bodyNode.getComponent(cc.RigidBody);
        if (bodyRb) {
            bodyRb.type = cc.RigidBodyType.Dynamic;
            bodyRb.enabled = true;
        }

        for (let partInfo of config.parts) {
            // --- 修正：使用尋找深層子節點的方法 ---
            let slotNode = this.findNodeRecursive(bodyNode, partInfo.slotName);
            let partPrefab = this.getPrefabByName(partInfo.partName);

            if (slotNode && partPrefab) {
                let partNode = cc.instantiate(partPrefab);
                partNode.parent = this.node; 
                partNode.group = "PART"; // 確保零件組別正確

                let prb = partNode.getComponent(cc.RigidBody);
                if (prb) {
                    prb.enabled = true;
                    prb.type = cc.RigidBodyType.Dynamic;
                }

                let pcol = partNode.getComponent(cc.PhysicsCollider);
                if (pcol) pcol.enabled = true;

                let worldPos = slotNode.convertToWorldSpaceAR(cc.v2(0, 0));
                partNode.setPosition(this.node.convertToNodeSpaceAR(worldPos));
                
                partNode.angle = 0; 

                this.attachPhysicalJoint(bodyNode, partNode, slotNode);
            }
        }
    }

    // 輔助函數：遞迴尋找名字匹配的子節點
    findNodeRecursive(root: cc.Node, name: string): cc.Node | null {
        if (root.name === name) return root;
        for (let child of root.children) {
            let res = this.findNodeRecursive(child, name);
            if (res) return res;
        }
        return null;
    }

    attachPhysicalJoint(body: cc.Node, part: cc.Node, slot: cc.Node) {
        let bodyRb = body.getComponent(cc.RigidBody);
        let partRb = part.getComponent(cc.RigidBody);
        let slotComp = slot.getComponent("Slotsetting");

        if (!bodyRb || !partRb || !slotComp) return;

        let worldPos = slot.convertToWorldSpaceAR(cc.v2(0, 0));
        let anchorInBody = body.convertToNodeSpaceAR(worldPos);

        // 判斷是否為輪胎類 (左輪或右輪)
        if (slotComp.slotType === PartType.LeftWheel || slotComp.slotType === PartType.RightWheel) {
            let joint = body.addComponent(cc.WheelJoint);
            joint.connectedBody = partRb;
            joint.anchor = anchorInBody;
            joint.connectedAnchor = cc.v2(0, 0);

            joint.frequency = 5;
            joint.dampingRatio = 0.7;
            joint.localAxisA = cc.v2(0, 1); 

            joint.maxMotorTorque = 10000;
            joint.enableMotor = true;
            

            this.wheelJoints.push(joint);
            
            // 【進階：區分驅動】
            // 例如你可以設定：只有前輪(LeftWheel)有動力，後輪(RightWheel)只是隨動
            // if (slotComp.slotType === PartType.LeftWheel) { ... }

        } else {
            // 武器或其它焊接零件
            let joint = body.addComponent(cc.WeldJoint);
            joint.connectedBody = partRb;
            joint.anchor = anchorInBody;
            joint.connectedAnchor = cc.v2(0, 0);
            joint.referenceAngle = 0;
            joint.frequency = 0; 
        }
    }

    getPrefabByName(name: string): cc.Prefab | undefined {
        let cleanSearchName = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.allPrefabs.find(p => {
            if (!p) return false;
            return p.name.trim().toLowerCase() === cleanSearchName;
        });
    }
}