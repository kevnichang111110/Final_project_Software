// Draggable.ts
// 變更：
//   1. WeaponMode 移到 core/PartType 統一管理；這裡 import 後再 re-export，
//      讓任何「from "./Draggable" import { WeaponMode }」的舊程式仍可運作。
//   2. PartType 改從 core/PartType 匯入（原本從 ./Slotsetting，Slotsetting 現在也是 re-export）。
//   3. 網格相關數字改用 GameConstants.GRID。
//   拖曳/吸附行為與原版一致。

import { PartType, WeaponMode } from "./core/PartType";
import { GRID } from "./core/GameConstants";
import { cleanName } from "./core/PartUtils";

export { WeaponMode };

const { ccclass, property } = cc._decorator;

@ccclass
export default class Draggable extends cc.Component {
    private rb: cc.RigidBody | null = null;
    private assemblyArea: cc.Node | null = null;
    private partsLayer: cc.Node | null = null;
    private lastValidPos: cc.Vec2 = cc.v2(0, 0);
    private hintGfx: cc.Graphics | null = null;   // 放置提示（綠=可放、紅=不可放）

    @property({ type: cc.Enum(PartType) })
    partType = PartType.Wheel;

    @property
    wheelMotorMultiplier: number = 1;

    @property({ type: cc.Enum(WeaponMode) })
    weaponMode: WeaponMode = WeaponMode.Melee;

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
        return this.partType === PartType.Core || cleanName(this.node.name) === "core";
    }

    onDragStart() {
        // 抓起前紀錄位置，若核心放錯地方可以彈回來
        this.lastValidPos = this.node.getPosition();

        if (this.node.parent !== cc.find("Canvas")) {
            let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
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
        let delta = event.getDelta();
        this.node.x += delta.x;
        this.node.y += delta.y;
        this.updateHint();
    }

    onDragEnd() {
        this.clearHint();

        if (!this.assemblyArea || !this.partsLayer) {
            this.handleFailedDrop();
            return;
        }

        let worldPos = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.assemblyArea.convertToNodeSpaceAR(worldPos);

        // 檢查是否在 5x5 網格範圍內 (0 ~ AREA_MAX)
        if (localPos.x >= 0 && localPos.x <= GRID.AREA_MAX && localPos.y >= 0 && localPos.y <= GRID.AREA_MAX) {

            let gridX = Math.floor(localPos.x / GRID.CELL_SIZE);
            let gridY = Math.floor(localPos.y / GRID.CELL_SIZE);

            // 占用檢查 + 武器/輪子必須鄰接 Body 的規則
            if (!this.canPlaceAt(gridX, gridY)) {
                this.handleFailedDrop();
                return;
            }

            // 吸附成功
            let snappedX = gridX * GRID.CELL_SIZE + GRID.SNAP_OFFSET;
            let snappedY = gridY * GRID.CELL_SIZE + GRID.SNAP_OFFSET;

            this.node.parent = this.partsLayer;
            this.node.setPosition(snappedX, snappedY);
            this.node.angle = 0;

            if (this.rb) this.rb.type = cc.RigidBodyType.Static;
        } else {
            this.handleFailedDrop();
        }
    }

    // ---- 放置規則 ----
    // 武器、輪子必須鄰接一個 Body/Core 才能放；Body、Core 只要格子空著即可。
    // ---- 放置規則 ----
    private canPlaceAt(gx: number, gy: number): boolean {
        // 1. 檢查是否超出邊界
        if (gx < 0 || gx >= GRID.COUNT || gy < 0 || gy >= GRID.COUNT) return false;
        
        // 2. 檢查格子是否被佔用
        if (this.isGridOccupied(gx, gy)) return false;

        // 3. 檢查場上是否已經有其他零件
        let hasOtherParts = false;
        if (this.partsLayer) {
            for (let p of this.partsLayer.children) {
                // 排除自己與提示框
                if (p !== this.node && p.name !== "placeHint") {
                    hasOtherParts = true;
                    break;
                }
            }
        }

        // 如果場上空無一物，第一塊放哪都可以（通常是 Core）
        if (!hasOtherParts) return true;

        // 4. 連接規則
        if (this.partType === PartType.Weapon || this.partType === PartType.Wheel) {
            // 武器和輪子：必須貼著 Body 或 Core (維持你原本的嚴格規則)
            if (!this.hasAdjacentBody(gx, gy)) return false;
        } else {
            // Body 或 Core：必須跟現有的「任何」方塊相鄰，不能憑空放置
            if (!this.hasAnyAdjacentPart(gx, gy)) return false;
        }

        return true;
    }

    // 檢查上下左右是否有「任何」合法的方塊
    private hasAnyAdjacentPart(gx: number, gy: number): boolean {
        if (!this.partsLayer) return false;
        for (let p of this.partsLayer.children) {
            if (p === this.node || p.name === "placeHint") continue;
            let pgx = Math.floor(p.x / GRID.CELL_SIZE);
            let pgy = Math.floor(p.y / GRID.CELL_SIZE);
            let dx = Math.abs(pgx - gx);
            let dy = Math.abs(pgy - gy);
            // 判斷是否為上下左右相鄰 (距離為 1)
            if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
                return true;
            }
        }
        return false;
    }

    private hasAdjacentBody(gx: number, gy: number): boolean {
        return this.bodyLikeAt(gx - 1, gy) || this.bodyLikeAt(gx + 1, gy)
            || this.bodyLikeAt(gx, gy - 1) || this.bodyLikeAt(gx, gy + 1);
    }

    private bodyLikeAt(gx: number, gy: number): boolean {
        if (!this.partsLayer) return false;
        for (let p of this.partsLayer.children) {
            if (p === this.node) continue;
            if (p.name === "placeHint") continue;   // 提示框不算零件，避免誤判格子被佔用
            const pgx = Math.floor(p.x / GRID.CELL_SIZE);
            const pgy = Math.floor(p.y / GRID.CELL_SIZE);
            if (pgx === gx && pgy === gy) {
                const d = p.getComponent(Draggable);
                if (d && (d.partType === PartType.Body || d.partType === PartType.Core)) return true;
                if (cleanName(p.name) === "core") return true;
                return false;   // 該格有東西但不是 Body → 不算鄰接 Body
            }
        }
        return false;
    }

    // ---- 放置提示 ----
    private ensureHint() {
        if (this.hintGfx && this.hintGfx.node && this.hintGfx.node.isValid) return;
        if (!this.partsLayer) return;
        // 共用單一提示節點，避免每個零件實例各建一個而在 PartLayer 累積空節點
        let n = this.partsLayer.getChildByName("placeHint");
        if (n && n.isValid) {
            this.hintGfx = n.getComponent(cc.Graphics) || n.addComponent(cc.Graphics);
            return;
        }
        n = new cc.Node("placeHint");
        n.parent = this.partsLayer;
        n.setPosition(0, 0);
        n.zIndex = 50;
        this.hintGfx = n.addComponent(cc.Graphics);
    }

    private updateHint() {
        if (!this.assemblyArea) return;
        this.ensureHint();
        if (!this.hintGfx) return;

        this.hintGfx.clear();

        const worldPos = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        const localPos = this.assemblyArea.convertToNodeSpaceAR(worldPos);
        const inGrid = localPos.x >= 0 && localPos.x <= GRID.AREA_MAX
            && localPos.y >= 0 && localPos.y <= GRID.AREA_MAX;
        if (!inGrid) return;

        const gx = Math.floor(localPos.x / GRID.CELL_SIZE);
        const gy = Math.floor(localPos.y / GRID.CELL_SIZE);
        const ok = this.canPlaceAt(gx, gy);

        this.hintGfx.fillColor = ok ? cc.color(80, 230, 120, 110) : cc.color(235, 80, 80, 110);
        this.hintGfx.fillRect(gx * GRID.CELL_SIZE, gy * GRID.CELL_SIZE, GRID.CELL_SIZE, GRID.CELL_SIZE);
    }

    private clearHint() {
        if (this.hintGfx) this.hintGfx.clear();
    }

    // 統一處理失敗的放置
    private handleFailedDrop() {
        if (this.isCorePart()) {
            this.returnToLastValidPos();   // 核心強制彈回
        } else {
            this.resetPhysics();           // 一般部件掉落
        }
    }

    private returnToLastValidPos() {
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
            // 掉成鬆散零件時改用 default 群組：prefab 預設的 PLAYER_PART 在碰撞矩陣裡彼此不互撞，
            // 會讓武器/輪子互相穿透。default 群組會自撞，零件才能在商店裡堆疊。
            this.node.group = "default";
            // 此節點的 box2d fixture 早已建立，改 node.group 不會自動重建過濾器；
            // 必須對每個 PhysicsCollider 呼叫 apply() 重建 fixture，新的 default 群組才會生效。
            (this.node.getComponents(cc.PhysicsCollider) as cc.PhysicsCollider[])
                .forEach(c => c.apply());
            this.rb.type = cc.RigidBodyType.Dynamic;
            this.rb.awake = true;
        }
    }

    isGridOccupied(gx: number, gy: number): boolean {
        if (!this.partsLayer) return false;

        for (let p of this.partsLayer.children) {
            if (p === this.node) continue;
            if (p.name === "placeHint") continue;   // 提示框不算零件，避免誤判格子被佔用
            let pgx = Math.floor(p.x / GRID.CELL_SIZE);
            let pgy = Math.floor(p.y / GRID.CELL_SIZE);
            if (pgx === gx && pgy === gy) return true;
        }
        return false;
    }

    onTouchStart(event: cc.Event.EventTouch) {
        // 加入這段：通知 ShopManager，我把這個方塊拔起來了，請檢查其他方塊有沒有因此斷開！
        let shopNode = cc.find("Canvas/ShopManager");
        if (shopNode) {
            let shopManager = shopNode.getComponent("ShopManager");
            if (shopManager && typeof shopManager.checkAndDropUnconnectedParts === "function") {
                // 傳入 this.node，請演算法掃描時當作我已經不在了
                shopManager.checkAndDropUnconnectedParts(this.node);
            }
        }
    }
}
