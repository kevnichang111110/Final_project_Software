import GameManager from "./GameManager";

// 定義一個簡單的商品類別，讓它能在編輯器裡設定
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

    // --- 新增：商店配置 ---
    @property([ItemData]) itemPool: ItemData[] = []; // 商品池（在編輯器裡填寫）

    @property([cc.Sprite]) slotIcons: cc.Sprite[] = []; // 三個按鈕上的圖標組件
    @property([cc.Label]) slotPriceLabels: cc.Label[] = []; // 三個按鈕下的價錢標籤

    private currentSlotPrices: number[] = [0, 0, 0]; // 記錄目前三個位置的價格
    private currentItemPoolIndex: number[] = [0, 0, 0];
    onLoad() {
        // 1. 在這裡開啟物理引擎
        let physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        physics.gravity = cc.v2(0, -960); // 設定重力

        this.updateGoldDisplay();
        for (let i = 0; i < 3; i++) {
            this.refreshSlot(i);
        }
    }

    updateGoldDisplay() {
        this.goldLabel.string = GameManager.gold.toString();
    }

    // 刷新特定位置的商品
    refreshSlot(index: number) {
        if (this.itemPool.length === 0) return;

        let randomIndex = Math.floor(Math.random() * this.itemPool.length);
        let item = this.itemPool[randomIndex];

        this.slotIcons[index].spriteFrame = item.icon;
        this.slotPriceLabels[index].string = item.price.toString();
        this.currentSlotPrices[index] = item.price;
        this.currentItemPoolIndex[index] = randomIndex;
    }

    // 按鈕點擊事件 (參數 index 代表是哪一個按鈕)
    onBuyButtonClick(event, customEventData: string) {
        let index = parseInt(customEventData);
        let price = this.currentSlotPrices[index];

        if (GameManager.gold >= price) {
            GameManager.gold -= price;
            this.updateGoldDisplay();

            // --- 執行生成實體 ---
            let itemData = this.itemPool[this.currentItemPoolIndex[index]];
            this.spawnPart(itemData.partPrefab, event.target);

            this.refreshSlot(index);
        } else {
            this.showLackGoldTip();
        }
    }

    spawnPart(prefab: cc.Prefab, btnNode: cc.Node) {
        if (!prefab) {
            console.warn("該商品沒有設定 Prefab！");
            return;
        }
        // 1. 產生實體
        let part = cc.instantiate(prefab);
        part.parent = this.node; // 掛在 Canvas 下

        // 2. 座標轉換：讓它從按鈕位置噴出來
        let worldPos = btnNode.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.node.convertToNodeSpaceAR(worldPos);
        part.setPosition(localPos);

        // 3. 給一個向上的推力，讓它有「跳出來」的感覺
        let rb = part.getComponent(cc.RigidBody);
        if (rb) {
            rb.applyLinearImpulse(cc.v2(0, 500), rb.getWorldCenter(), true);
        }
    }
    
    showLackGoldTip() {
        console.log("正在執行抖動，目標節點是：", this.goldIcon.name);
        this.tipLabel.stopAllActions();
        this.tipLabel.opacity = 255;
        cc.tween(this.tipLabel).delay(1.0).to(0.5, { opacity: 0 }).start();   
        this.goldLabel.node.stopAllActions(); 
        this.goldLabel.node.color = cc.Color.WHITE;  
        cc.tween(this.goldLabel.node).to(0.1, { color: cc.Color.RED })
        .to(0.1, { color: cc.Color.WHITE })
        .union().repeat(5).start();
        this.goldIcon.stopAllActions();
        this.goldIcon.scaleX = 1;
        this.goldIcon.scaleY = 1;
        this.goldIcon.angle = 0;
        cc.tween(this.goldIcon)
            .to(0.05, { scaleX: 1.3, scaleY: 1.3, angle: 15 })
            .to(0.05, { scaleX: 1.0, scaleY: 1.0, angle: -15 })
            .to(0.05, { scaleX: 1.1, scaleY: 1.1, angle: 10 })
            .to(0.05, { scaleX: 1.0, scaleY: 1.0, angle: 0 })
            .call(() => {
                //this.startIconRotation();
            })
            .start();
    }
}