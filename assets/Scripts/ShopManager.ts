import GameManager from "./GameManager";

// 定義一個簡單的商品類別，讓它能在編輯器裡設定
const {ccclass, property} = cc._decorator;

@ccclass("ItemData")
class ItemData {
    @property(cc.String) name: string = "";
    @property(cc.Integer) price: number = 0;
    @property(cc.SpriteFrame) icon: cc.SpriteFrame = null;
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

    onLoad() {
        this.updateGoldDisplay();
        //this.startIconRotation(); 

        for (let i = 0; i < 3; i++) {
            this.refreshSlot(i);
        }
    }

    // startIconRotation() {
    //     this.goldIcon.stopAllActions(); 
    //     cc.tween(this.goldIcon)
    //         .to(0.75, { scaleX: -1 }, { easing: 'sineInOut' }) // 轉到背面
    //         .to(0.75, { scaleX: 1 }, { easing: 'sineInOut' })  // 轉到正面
    //         .repeatForever()
    //         .start();
    // }
    updateGoldDisplay() {
        this.goldLabel.string = GameManager.gold.toString();
    }

    // 刷新特定位置的商品
    refreshSlot(index: number) {
        if (this.itemPool.length === 0) return;

        // 隨機從池子挑一個
        let randomIndex = Math.floor(Math.random() * this.itemPool.length);
        let item = this.itemPool[randomIndex];

        // 更新 UI
        this.slotIcons[index].spriteFrame = item.icon;
        this.slotPriceLabels[index].string = item.price.toString();
        this.currentSlotPrices[index] = item.price;
    }

    // 按鈕點擊事件 (參數 index 代表是哪一個按鈕)
    onBuyButtonClick(event, customEventData: string) {
        let index = parseInt(customEventData);
        let price = this.currentSlotPrices[index];

        if (GameManager.gold >= price) {
            GameManager.gold -= price;
            this.updateGoldDisplay();
            console.log("購買了第 " + (index + 1) + " 個商品");
            
            // 購買成功後，刷新該位置
            this.refreshSlot(index);
        } else {
            this.showLackGoldTip();
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