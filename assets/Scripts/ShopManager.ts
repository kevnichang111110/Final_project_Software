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

        // --- 核心改動：重組網格化車輛 ---
        if (GameManager.playerCarGrid.length > 0) {
            this.reconstructCarForEditing();
        }

        for (let i = 0; i < 3; i++) {
            this.refreshSlot(i);
        }
    }

    /**
     * 從戰鬥場景回來時，在商店中還原玩家拼好的零件
     */
    reconstructCarForEditing() {
        // 找到存放零件的層級 (建議在 Assemblyarea 下建一個名為 PartsLayer 的空節點)
        let partsLayer = cc.find("Canvas/Assemblyarea/PartsLayer");
        if (!partsLayer) {
            console.error("找不到 PartsLayer，請在 Assemblyarea 下建立它");
            return;
        }

        // 清空目前的顯示 (預防萬一)
        partsLayer.removeAllChildren();

        for (let data of GameManager.playerCarGrid) {
            let prefab = this.getPrefabByName(data.partName);
            if (prefab) {
                let partNode = cc.instantiate(prefab);
                partNode.parent = partsLayer;
                
                // 根據網格座標還原位置 (40像素一格，+20 移到中心)
                let px = data.gridX * 40 + 20;
                let py = data.gridY * 40 + 20;
                partNode.setPosition(px, py);
                partNode.angle = 0;

                // 商店內關閉物理
                let rb = partNode.getComponent(cc.RigidBody);
                if (rb) rb.type = cc.RigidBodyType.Static;
                let col = partNode.getComponent(cc.PhysicsCollider);
                if (col) col.enabled = false;
            }
        }
    }

    /**
     * 按下 Fight 按鈕時，掃描組裝區，紀錄所有零件的網格座標
     */
    Fight() {
        console.log(">>> 網格化掃描開始...");
        let partsLayer = cc.find("Canvas/Assemblyarea/PartLayer");
        if (!partsLayer || partsLayer.childrenCount === 0) {
            console.error("❌ 存檔失敗：組裝區內沒有零件！");
            return;
        }

        // 清空舊的網格數據
        GameManager.playerCarGrid = [];

        for (let p of partsLayer.children) {
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