import GameManager, { GridPart } from "./GameManager";
import { PartType } from "./Slotsetting";

const {ccclass, property} = cc._decorator;

@ccclass("ItemData")
class ItemData {
    @property(cc.String) name: string = "";
    @property(cc.Integer) price: number = 0;
    @property(cc.SpriteFrame) icon: cc.SpriteFrame = null;
    @property(cc.Prefab) partPrefab: cc.Prefab = null; 
}

@ccclass
export default class ShopManager extends cc.Component {

    @property(cc.Label) goldLabel: cc.Label = null;
    @property(cc.Node) goldIcon: cc.Node = null;
    @property(cc.Node) tipLabel: cc.Node = null;
    @property(cc.Label) scoreLabel: cc.Label = null; 

    @property([ItemData]) itemPool: ItemData[] = [];
    @property([cc.Sprite]) slotIcons: cc.Sprite[] = [];
    @property([cc.Label]) slotPriceLabels: cc.Label[] = [];
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = [];

    // 可直接把 Core prefab 拖到這裡；如果沒拖，會從 allPrefabs 裡找名字叫 Core 的 prefab。
    @property(cc.Prefab) corePrefab: cc.Prefab | null = null;

    // Core 固定在 5x5 組裝區中心格，玩家不能拿出來。
    @property(cc.Integer) coreGridX: number = 2;
    @property(cc.Integer) coreGridY: number = 2;

    @property(cc.Prefab) settingsPrefab: cc.Prefab | null = null;

    private currentSlotPrices: number[] = [0, 0, 0];
    private currentItemPoolIndex: number[] = [0, 0, 0];

    @property(cc.AudioClip) bgmClip: cc.AudioClip | null = null;
    private bgmAudioID: number = -1;

    onLoad() {
        if (this.bgmClip) {
            this.bgmAudioID = cc.audioEngine.playMusic(this.bgmClip, true);
        }

        let physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        physics.gravity = cc.v2(0, -960);

        this.updateGoldDisplay();
        this.updateScoreDisplay();

        // 無論是不是第一輪，商店都必須保證 Assemblyarea 裡有 Core。
        if (GameManager.playerCarGrid.length > 0) {
            this.reconstructCarForEditing();
        } else {
            this.ensureCoreInAssembly();
        }

        for (let i = 0; i < 3; i++) {
            this.refreshSlot(i);
        }
    }

    reconstructCarForEditing() {
        let partLayer = this.getPartLayer();
        if (!partLayer) return;
        partLayer.removeAllChildren();

        for (let data of GameManager.playerCarGrid) {
            let prefab = this.getPrefabByName(data.partName);
            if (prefab) {
                let partNode = cc.instantiate(prefab);
                partNode.parent = partLayer;

                // --- 修改處：核心不再強制使用 coreGridX，而是使用存檔座標 ---
                const gx = data.gridX;
                const gy = data.gridY;

                let px = gx * 40 + 20;
                let py = gy * 40 + 20;
                partNode.setPosition(px, py);
                partNode.angle = 0;

                this.prepareShopPartNode(partNode);
            }
        }
        this.ensureCoreInAssembly();
    }

    /**
     * 按下 Fight 按鈕時，掃描組裝區，紀錄所有零件的網格座標。
     * 沒有 Core 不能開始戰鬥。
     */
    Fight() {
        console.log(">>> 網格化掃描開始...");
        let partLayer = this.getPartLayer();
        if (!partLayer || partLayer.childrenCount === 0) {
            console.error("❌ 存檔失敗：組裝區內沒有零件！");
            return;
        }

        this.ensureCoreInAssembly();

        if (!this.hasCoreNode(partLayer)) {
            console.error("❌ 不能開始戰鬥：組裝區內沒有核心 Core！");
            return;
        }

        // 清空舊的網格數據
        GameManager.playerCarGrid = [];

        for (let p of partLayer.children) {
            // 透過本地座標反推它是第幾格 (gx, gy)
            let gx = Math.floor(p.x / 40);
            let gy = Math.floor(p.y / 40);
            
            // 去掉名字裡的 (Clone)
            let rawName = p.name.replace(/\([^)]*\)/g, "").trim();

            GameManager.playerCarGrid.push({
                partName: rawName,
                gridX: gx,
                gridY: gy
            });
            console.log(`已紀錄零件: ${rawName} 座標: (${gx}, ${gy})`);
        }

        console.log("✅ 成功保存網格配置:", JSON.stringify(GameManager.playerCarGrid));

        // 執行跳轉
        cc.director.loadScene("game");
    }

    private getPartLayer(): cc.Node | null {
        let partLayer = cc.find("Canvas/Assemblyarea/PartLayer");
        if (!partLayer) {
            console.error("找不到 PartLayer，請在 Assemblyarea 下建立它");
            return null;
        }
        return partLayer;
    }

    private getCorePrefab(): cc.Prefab | null {
        if (this.corePrefab) return this.corePrefab;
        const prefab = this.getPrefabByName("Core");
        return prefab || null;
    }

    private cleanName(name: string): string {
        return name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
    }

    private isCoreNode(node: cc.Node): boolean {
        const draggable = node.getComponent("Draggable") as any;
        return (draggable && draggable.partType === PartType.Core) || this.cleanName(node.name) === "core";
    }

    private hasCoreNode(partLayer: cc.Node): boolean {
        return partLayer.children.some(p => this.isCoreNode(p));
    }

    private prepareShopPartNode(partNode: cc.Node) {
        const isCore = this.isCoreNode(partNode);

        let rb = partNode.getComponent(cc.RigidBody);
        if (rb) rb.type = cc.RigidBodyType.Static;

        let col = partNode.getComponent(cc.PhysicsCollider);
        if (col) col.enabled = false;

        const drag = partNode.getComponent("Draggable") as any;
        if (drag) {
            // --- 修改處：核心現在可以被拖動 ---
            drag.enabled = true; 
            if (isCore) {
                drag.partType = PartType.Core;
                // 你可以在這裡給核心加上特殊標記，讓 Draggable 知道「不能刪除它」
            }
        }
    }

     private ensureCoreInAssembly() {
        let partLayer = this.getPartLayer();
        if (!partLayer) return;

        // 如果場上已經有核心了，就什麼都不做（讓它待在玩家放的地方）
        if (this.hasCoreNode(partLayer)) return;

        // 只有在完全沒核心時，才在預設中心點生成一個
        const coreX = this.coreGridX * 40 + 20;
        const coreY = this.coreGridY * 40 + 20;

        const prefab = this.getCorePrefab();
        if (!prefab) return;

        let coreNode = cc.instantiate(prefab);
        coreNode.parent = partLayer;
        coreNode.name = "Core";
        coreNode.setPosition(coreX, coreY);
        this.prepareShopPartNode(coreNode);
    }

    updateGoldDisplay() {
        if (this.goldLabel) this.goldLabel.string = GameManager.gold.toString();
    }

    updateScoreDisplay() {
        if (this.scoreLabel) {
            this.scoreLabel.string = `PLAYER-${GameManager.playerWins} v.s. ${GameManager.botWins}-BOT`;
        }
    }

    refreshSlot(index: number) {
        if (this.itemPool.length === 0) return;
        let randomIndex = Math.floor(Math.random() * this.itemPool.length);
        let item = this.itemPool[randomIndex];
        this.slotIcons[index].spriteFrame = item.icon;
        this.slotPriceLabels[index].string = item.price.toString();
        this.currentSlotPrices[index] = item.price;
        this.currentItemPoolIndex[index] = randomIndex;
    }

    onBuyButtonClick(event, customEventData: string) {
        let index = parseInt(customEventData);
        let price = this.currentSlotPrices[index];

        if (GameManager.gold >= price) {
            GameManager.gold -= price;
            this.updateGoldDisplay();
            let itemData = this.itemPool[this.currentItemPoolIndex[index]];
            this.spawnPart(itemData.partPrefab, event.target);
            this.refreshSlot(index);
        } else {
            this.showLackGoldTip();
        }
    }

    spawnPart(prefab: cc.Prefab, btnNode: cc.Node) {
        if (!prefab) return;
        let part = cc.instantiate(prefab);
        part.parent = this.node; // 先掛在 Canvas 下方便掉落
        let worldPos = btnNode.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.node.convertToNodeSpaceAR(worldPos);
        part.setPosition(localPos);

        let rb = part.getComponent(cc.RigidBody);
        if (rb) {
            rb.applyLinearImpulse(cc.v2(0, 500), rb.getWorldCenter(), true);
        }
    }
    
    showLackGoldTip() {
        this.tipLabel.stopAllActions();
        this.tipLabel.opacity = 255;
        cc.tween(this.tipLabel).delay(1.0).to(0.5, { opacity: 0 }).start();   
        this.goldIcon.stopAllActions();
        cc.tween(this.goldIcon).to(0.05, { scale: 1.3 }).to(0.05, { scale: 1.0 }).start();
    }

    onOpenSettings() {
        if (this.settingsPrefab) {
            let node = cc.instantiate(this.settingsPrefab);
            let canvas = cc.find("Canvas");
            node.parent = canvas;
            
            // --- 核心修正：強制歸零座標並置頂 ---
            node.setPosition(0, 0); 
            node.setSiblingIndex(canvas.childrenCount - 1);
            
            // 如果 Prefab 裡有 Widget，強制刷新一次對齊
            let widget = node.getComponent(cc.Widget);
            if (widget) {
                widget.updateAlignment();
            }
        }
    }

    // --- 輔助函數 ---
    getPrefabByName(name: string): cc.Prefab | undefined {
        let cleanName = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
        return this.allPrefabs.find(p => p && p.name.trim().toLowerCase() === cleanName);
    }

    findNodeRecursive(root: cc.Node, name: string): cc.Node | null {
        if (root.name === name) return root;
        for (let child of root.children) {
            let res = this.findNodeRecursive(child, name);
            if (res) return res;
        }
        return null;
    }
}
