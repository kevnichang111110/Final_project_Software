import Slotsetting, { PartType } from "./Slotsetting";

const {ccclass, property} = cc._decorator;

@ccclass
export default class Draggable extends cc.Component {
    private rb: cc.RigidBody = null;
    private assemblyArea: cc.Node = null;

    // 修正：Enum 的正確寫法
    @property({ type: cc.Enum(PartType) })
    partType = PartType.LeftWheel; 

    onLoad() {
        if (cc.director.getScene().name === "game") {
            this.enabled = false; 
            return;
        }

        this.rb = this.getComponent(cc.RigidBody);
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
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Dynamic;
                this.rb.awake = true;
            }
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
        if (!this.assemblyArea) return;
        let areaRect = this.assemblyArea.getBoundingBoxToWorld();
        if (areaRect.intersects(this.node.getBoundingBoxToWorld())) {
            if (this.rb) {
                this.rb.type = cc.RigidBodyType.Static;
                this.rb.linearVelocity = cc.v2(0, 0);
            }
            this.node.angle = 0; 
            
            // 讓 Body 自動置中於組裝區
            let worldPos = this.assemblyArea.convertToWorldSpaceAR(cc.v2(0,0));
            let localPos = this.node.parent.convertToNodeSpaceAR(worldPos);
            this.node.setPosition(localPos.x, localPos.y);
        } else {
            if (this.rb) this.rb.type = cc.RigidBodyType.Dynamic;
        }
    }

    trySnapToSlot() {
        let allSlots = cc.find("Canvas").getComponentsInChildren("Slotsetting");
        let minDistance = 120;
        let targetSlot: any = null;
        let myWorldPos = this.node.convertToWorldSpaceAR(cc.v2(0,0));

        for (let slot of allSlots) {
            // --- 修正後的判斷邏輯 ---
            let isWheelMatch = (this.partType === PartType.LeftWheel || this.partType === PartType.RightWheel) && 
                               (slot.slotType === PartType.LeftWheel || slot.slotType === PartType.RightWheel);
            let isExactMatch = slot.slotType === this.partType;

            // 只要滿足「輪胎匹配」或「完全匹配」其中之一即可，且插槽必須未被佔用
            if (!(isWheelMatch || isExactMatch) || slot.isOccupied) {
                continue;
            }
            // --- 刪除原本下面那行 redundant 的 if ---

            let slotWorldPos = slot.node.convertToWorldSpaceAR(cc.v2(0,0));
            let dist = slotWorldPos.sub(myWorldPos).mag();

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