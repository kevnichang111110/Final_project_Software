import { PartType } from "./Slotsetting";

const {ccclass, property} = cc._decorator;

@ccclass
export default class Draggable extends cc.Component {
    private rb: cc.RigidBody | null = null;
    private assemblyArea: cc.Node | null = null;
    private partsLayer: cc.Node | null = null;
    private lastValidPos: cc.Vec2 = cc.v2(0, 0);

    @property({ type: cc.Enum(PartType) })
    partType = PartType.LeftWheel; 
    @property
    wheelMotorMultiplier: number = 1;  

    onLoad() {
        if (cc.director.getScene().name === "game") {
            this.enabled = false; 
            return;
        }

        this.rb = this.getComponent(cc.RigidBody);
        this.assemblyArea = cc.find("Canvas/Assemblyarea"); 
        this.partsLayer = cc.find("Canvas/Assemblyarea/PartLayer");

        this.node.on(cc.Node.EventType.TOUCH_START, this.onDragStart, this);
        this.node.on(cc.Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.on(cc.Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
    }

    private isCorePart(): boolean {
        const cleanName = this.node.name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.partType === PartType.Core || cleanName === "core";
    }

    onDragStart() {
        // 抓起前紀錄位置，若核心放錯地方可以彈回來
        this.lastValidPos = this.node.getPosition();

        if (this.node.parent !== cc.find("Canvas")) {
            let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0,0));
            this.node.parent = cc.find("Canvas");
            this.node.setPosition(this.node.parent.convertToNodeSpaceAR(worldPos));
        }

        if (this.rb) {
            this.rb.type = cc.RigidBodyType.Static;
            let collider = this.getComponent(cc.PhysicsCollider);
            if (collider) collider.enabled = true; 
        }
        
        this.node.setSiblingIndex(this.node.parent.childrenCount - 1);
    }

    onDragMove(event: cc.Event.EventTouch) {
        // --- 修正：核心也要能跟著滑鼠走，所以移除之前的 return ---
        let delta = event.getDelta();
        this.node.x += delta.x;
        this.node.y += delta.y;
    }

    onDragEnd() {
        // --- 修正：核心也要執行放開後的吸附檢查，移除之前的 return ---
        
        if (!this.assemblyArea || !this.partsLayer) {
            this.handleFailedDrop();
            return;
        }

        let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.assemblyArea.convertToNodeSpaceAR(worldPos);

        // 檢查是否在 5x5 網格範圍內 (0~200)
        if (localPos.x >= 0 && localPos.x <= 200 && localPos.y >= 0 && localPos.y <= 200) {
            
            let gridX = Math.floor(localPos.x / 40);
            let gridY = Math.floor(localPos.y / 40);

            // 檢查該格子是否已有東西
            if (this.isGridOccupied(gridX, gridY)) {
                this.handleFailedDrop();
                return;
            }

            // 吸附成功
            let snappedX = gridX * 40 + 20;
            let snappedY = gridY * 40 + 20;

            this.node.parent = this.partsLayer; 
            this.node.setPosition(snappedX, snappedY);
            this.node.angle = 0;
            
            if (this.rb) this.rb.type = cc.RigidBodyType.Static;
        } else {
            // 在區外
            this.handleFailedDrop();
        }
    }

    // 統一處理失敗的放置
    private handleFailedDrop() {
        if (this.isCorePart()) {
            // 核心強制彈回原位
            this.returnToLastValidPos();
        } else {
            // 一般部件掉落
            this.resetPhysics();
        }
    }

    private returnToLastValidPos() {
        // --- 修正：先檢查 partsLayer 是否存在，解決 Type 'Node | null' 報錯 ---
        if (this.partsLayer) {
            this.node.parent = this.partsLayer;
            this.node.setPosition(this.lastValidPos);
            if (this.rb) this.rb.type = cc.RigidBodyType.Static;
        } else {
            this.resetPhysics();
        }
    }

    resetPhysics() {
        if (this.rb) {
            this.rb.type = cc.RigidBodyType.Dynamic;
            this.rb.awake = true;
        }
    }

    isGridOccupied(gx: number, gy: number): boolean {
        // --- 修正：解決 Object is possibly 'null' 報錯 ---
        if (!this.partsLayer) return false;

        for (let p of this.partsLayer.children) {
            if (p === this.node) continue;
            let pgx = Math.floor(p.x / 40);
            let pgy = Math.floor(p.y / 40);
            if (pgx === gx && pgy === gy) return true;
        }
        return false;
    }
}