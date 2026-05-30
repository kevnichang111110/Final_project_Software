import { PartType } from "./Slotsetting";

const {ccclass, property} = cc._decorator;

@ccclass
export default class Draggable extends cc.Component {
    private rb: cc.RigidBody = null;
    private assemblyArea: cc.Node = null;
    private partsLayer: cc.Node = null;

    @property({ type: cc.Enum(PartType) })
    partType = PartType.LeftWheel; 

    onLoad() {
        // 戰鬥場景不啟用拖拽
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

    onDragStart() {
        // 抓起時，如果原本在網格內，先回到 Canvas 層級
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
        
        // 置頂顯示
        this.node.setSiblingIndex(this.node.parent.childrenCount - 1);
    }

    onDragMove(event: cc.Event.EventTouch) {
        let delta = event.getDelta();
        this.node.x += delta.x;
        this.node.y += delta.y;
    }

    onDragEnd() {
        if (!this.assemblyArea || !this.partsLayer) {
            console.error("找不到組裝區或零件層，請檢查節點名稱！");
            this.resetPhysics();
            return;
        }

        // 1. 取得在組裝區本地座標系下的位置
        let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.assemblyArea.convertToNodeSpaceAR(worldPos);

        // 2. 檢查是否在 5x5 網格範圍內 (200x200)
        // 假設你的 AssemblyArea Anchor 是 (0,0)
        if (localPos.x >= 0 && localPos.x <= 200 && localPos.y >= 0 && localPos.y <= 200) {
            
            // 計算網格索引
            let gridX = Math.floor(localPos.x / 40);
            let gridY = Math.floor(localPos.y / 40);

            // 檢查該格子是否已有東西 (預防重疊)
            if (this.isGridOccupied(gridX, gridY)) {
                this.resetPhysics(); // 有東西了，不吸附，直接掉落
                return;
            }

            // 3. 執行吸附
            let snappedX = gridX * 40 + 20;
            let snappedY = gridY * 40 + 20;

            this.node.parent = this.partsLayer; 
            this.node.setPosition(snappedX, snappedY);
            this.node.angle = 0;
            
            if (this.rb) this.rb.type = cc.RigidBodyType.Static;
            console.log(`吸附成功: (${gridX}, ${gridY})`);
        } else {
            // 在區外，恢復物理
            this.resetPhysics();
        }
    }

    // 輔助：恢復物理狀態
    resetPhysics() {
        if (this.rb) {
            this.rb.type = cc.RigidBodyType.Dynamic;
            this.rb.awake = true;
        }
    }

    // 輔助：檢查網格是否被佔用
    isGridOccupied(gx: number, gy: number): boolean {
        for (let p of this.partsLayer.children) {
            if (p === this.node) continue;
            let pgx = Math.floor(p.x / 40);
            let pgy = Math.floor(p.y / 40);
            if (pgx === gx && pgy === gy) return true;
        }
        return false;
    }
}