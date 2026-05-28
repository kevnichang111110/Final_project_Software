import Slotsetting, { PartType } from "./Slotsetting";

const {ccclass, property} = cc._decorator;

@ccclass
export default class Draggable extends cc.Component {
    private rb: cc.RigidBody = null;
    private assemblyArea: cc.Node = null;

    // 修正：Enum 的正確寫法
    @property({ type: cc.Enum(PartType) })
    partType = PartType.Wheel; 

    onLoad() {
        this.rb = this.getComponent(cc.RigidBody);
        // 確保路徑與你的 Node Tree 一模一樣 (Assemblyarea 小寫 a)
        this.assemblyArea = cc.find("Canvas/Assemblyarea"); 

        this.node.on(cc.Node.EventType.TOUCH_START, this.onDragStart, this);
        this.node.on(cc.Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.on(cc.Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
    }

    onDragStart() {
        // --- 修正：拆卸邏輯 ---
        // 注意：這裡的字串要跟你 Slotsetting.ts 裡的類別名稱一致
        let currentSlot = this.node.parent.getComponent("Slotsetting");
        if (currentSlot) {
            currentSlot.isOccupied = false; 
            
            let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0,0));
            this.node.parent = cc.find("Canvas");
            
            // 修正：解決 Vec2 / Vec3 錯誤，使用 setPosition
            let localPos = this.node.parent.convertToNodeSpaceAR(worldPos);
            this.node.setPosition(localPos.x, localPos.y);
        }

        if (this.rb) {
            this.rb.type = cc.RigidBodyType.Static;
            let collider = this.getComponent(cc.PhysicsCollider);
            if (collider) collider.enabled = true; 
        }
        this.node.setSiblingIndex(this.node.parent.childrenCount - 1);
    }

    onDragMove(event: cc.Event.EventTouch) {
        let delta = event.getDelta();
        this.node.x += delta.x;
        this.node.y += delta.y;
    }

    onDragEnd() {
        if (this.partType === PartType.Body) { 
            this.handleBodyDrop();
            return;
        }

        if (!this.assemblyArea) {
            console.error("找不到 Assemblyarea");
            if (this.rb) this.rb.type = cc.RigidBodyType.Dynamic;
            return;
        }

        let areaRect = this.assemblyArea.getBoundingBoxToWorld();
        let myBounds = this.node.getBoundingBoxToWorld();

        if (areaRect.intersects(myBounds)) {
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Static;
                this.rb.linearVelocity = cc.v2(0, 0);
            }
            this.node.angle = 0;
            this.trySnapToSlot();
        } else {
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Dynamic;
                this.rb.awake = true; // 強制喚醒剛體
            }
        }
    }

    handleBodyDrop() {
        let areaRect = this.assemblyArea.getBoundingBoxToWorld();
        if (areaRect.intersects(this.node.getBoundingBoxToWorld())) {
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Static;
                this.rb.linearVelocity = cc.v2(0, 0);
            }
            this.node.angle = 90; 
            
            // 讓 Body 自動置中於組裝區
            let worldPos = this.assemblyArea.convertToWorldSpaceAR(cc.v2(0,0));
            let localPos = this.node.parent.convertToNodeSpaceAR(worldPos);
            this.node.setPosition(localPos.x, localPos.y);
        } else {
            if (this.rb) this.rb.type = cc.RigidBodyType.Dynamic;
        }
    }

    trySnapToSlot() {
        // 注意：這裡的搜尋字串要跟你插槽腳本的類別名一致
        let allSlots = cc.find("Canvas").getComponentsInChildren("Slotsetting");
        let minDistance = 120;
        let targetSlot: any = null;

        let myWorldPos = this.node.convertToWorldSpaceAR(cc.v2(0,0));

        for (let slot of allSlots) {
            if (slot.slotType !== this.partType || slot.isOccupied) continue;

            let slotWorldPos = slot.node.convertToWorldSpaceAR(cc.v2(0,0));
            let dist = slotWorldPos.sub(myWorldPos).mag();

            console.log(`插槽 ${slot.node.name} 距離: ${dist.toFixed(2)}`);
            if (dist < minDistance) {
                minDistance = dist;
                targetSlot = slot;
            }
        }

        if (targetSlot) {
            this.node.parent = targetSlot.node; 
            this.node.setPosition(0, 0);   
            this.node.angle = 0; 
            targetSlot.isOccupied = true;
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Static;
                let collider = this.getComponent(cc.PhysicsCollider);
                if (collider) collider.enabled = false; 
            }   
        }
    }
}