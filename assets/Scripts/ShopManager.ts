// ShopManager.ts
// 變更：原本自己實作的 cleanName / isCoreNode / getPrefabByName 改為委派 core/PartUtils，
//       移除重複實作；網格數字改用 GameConstants.GRID。其餘商店/組裝邏輯不變。
//       （檔名/類別名/所有 @property 不變，編輯器綁定不受影響。）

import GameManager, { GridPart } from "./GameManager";
import OnlineRuntime from "./online/OnlineRuntime";
import { PartType } from "./core/PartType";
import { GRID } from "./core/GameConstants";
import {
    cleanName as utilCleanName,
    isCoreNode as utilIsCoreNode,
    getPrefabByName as utilGetPrefabByName,
} from "./core/PartUtils";

const { ccclass, property } = cc._decorator;

@ccclass("ItemData")
class ItemData {
    @property(cc.String) name: string = "";
    @property(cc.Integer) price: number = 0;
    @property(cc.SpriteFrame) icon: cc.SpriteFrame = null;
    @property(cc.Prefab) partPrefab: cc.Prefab = null;
    @property(cc.Integer)
    unlockRound: number = 0;   // 0 = 一開始就會出現

    @property({ type: cc.Enum(PartType), tooltip: "這個商品屬於哪一類（方塊/武器/輪子）" })
    category = PartType.Body;
}

@ccclass
export default class ShopManager extends cc.Component {

    @property(cc.Label) announcementLabel: cc.Label | null = null;

    @property(cc.Label) goldLabel: cc.Label = null;
    @property(cc.Node) goldIcon: cc.Node = null;
    @property(cc.Node) tipLabel: cc.Node = null;
    @property(cc.Label) scoreLabel: cc.Label = null;

    @property([ItemData]) itemPool: ItemData[] = [];
    @property([cc.Sprite]) slotIcons: cc.Sprite[] = [];
    @property([cc.Label]) slotPriceLabels: cc.Label[] = [];
    @property({ type: [cc.Prefab], tooltip: "選填：只放『不在商店販售、也不是核心』的零件即可。商店商品的 prefab 會自動從 itemPool 取得，不必再重複拖一次" })
    allPrefabs: cc.Prefab[] = [];

    // 實際查找用的零件清單：onLoad 時自動由 itemPool + corePrefab + allPrefabs 合併產生
    private partPrefabs: cc.Prefab[] = [];

    @property(cc.Prefab) corePrefab: cc.Prefab | null = null;

    @property(cc.Integer) coreGridX: number = 2;
    @property(cc.Integer) coreGridY: number = 2;

    @property(cc.Prefab) settingsPrefab: cc.Prefab | null = null;

    private currentSlotPrices: number[] = [0, 0, 0];
    private currentItemPoolIndex: number[] = [0, 0, 0];

    @property(cc.AudioClip) bgmClip: cc.AudioClip | null = null;
    private bgmAudioID: number = -1;

    onLoad() {
        this.buildPrefabList();

        if (this.bgmClip) {
            this.bgmAudioID = cc.audioEngine.playMusic(this.bgmClip, true);
        }

        let physics = cc.director.getPhysicsManager();
        physics.enabled = true;
        physics.gravity = cc.v2(0, -960);

        // 多人模式：每次回到商店都重置金錢，讓每回合雙方有相同的固定預算（公平）
        if (OnlineRuntime.isOnline()) GameManager.gold = 200;

        this.updateGoldDisplay();
        this.updateScoreDisplay();
        this.checkSpecialRoundAnnouncement();

        // 還原上一場的車：線上要讀「自己座位」的 grid（伺服器回傳的 p1/p2），
        // 否則 P2 會讀到 GameManager.playerCarGrid（可能是別人的或被覆蓋）→ 武器被刷掉
        const restoreGrid: GridPart[] = OnlineRuntime.isOnline()
            ? ((OnlineRuntime.mySeat === "P1" ? OnlineRuntime.p1Grid : OnlineRuntime.p2Grid) as GridPart[])
            : GameManager.playerCarGrid;
        if (restoreGrid.length > 0) {
            this.reconstructCarForEditing(restoreGrid);
        } else {
            this.ensureCoreInAssembly();
        }

        this.grantClaimedTools();

        this.slotCategories = [this.slot0Category, this.slot1Category, this.slot2Category];

        for (let i = 0; i < 3; i++) {
            this.refreshSlot(i);
        }

        this.fixSlotIconLayering();
    }

    // 讓商店格子的「物品圖片」顯示在按鈕前面（圖片在前）。
    // 圖片是純 Sprite、不掛 Button/觸控，所以即使疊在按鈕上面，觸控仍會交給後面的按鈕
    //（選取優先級在按鈕後面）。若你的圖片目前蓋掉按鈕點不到，請見下方說明。
    private fixSlotIconLayering() {
        for (const sp of this.slotIcons) {
            if (!sp || !sp.node) continue;
            sp.node.zIndex = 5;   // 排到同層按鈕之上（數字比按鈕大即可）
        }
    }

    // 把搶奪階段玩家(P1)搶到的道具，免費生成在商店上方讓玩家拖去組裝
    private grantClaimedTools() {
        // 防呆：若 GameManager 尚未更新到含此方法，直接跳過，避免商店進場報錯
        if (typeof (GameManager as any).consumeClaimedTools !== "function") return;

        let tools: string[] = [];
        try {
            tools = (GameManager as any).consumeClaimedTools("P1") || [];
        } catch (e) {
            tools = [];
        }
        if (tools.length === 0) return;

        let i = 0;
        for (const name of tools) {
            const prefab = this.getPrefabByName(name);
            if (!prefab) continue;
            const part = cc.instantiate(prefab);
            part.parent = this.node;
            part.group = "default";   // 同 spawnPart：鬆散零件改用 default 群組才會彼此碰撞（武器/輪子）
            part.setPosition(-220 + i * 90, 220);
            const rb = part.getComponent(cc.RigidBody);
            if (rb) rb.type = cc.RigidBodyType.Static;   // 靜止等玩家拖，不會掉走
            i++;
        }

        this.showFlashingNotice("搶到的道具已送達！", cc.Color.GREEN);
    }

    reconstructCarForEditing(grid: GridPart[] = GameManager.playerCarGrid) {
        let partLayer = this.getPartLayer();
        if (!partLayer) return;
        partLayer.removeAllChildren();

        for (let data of grid) {
            let prefab = this.getPrefabByName(data.partName);
            if (prefab) {
                let partNode = cc.instantiate(prefab);
                partNode.parent = partLayer;

                const gx = data.gridX;
                const gy = data.gridY;
                let px = gx * GRID.CELL_SIZE + GRID.SNAP_OFFSET;
                let py = gy * GRID.CELL_SIZE + GRID.SNAP_OFFSET;
                partNode.setPosition(px, py);
                partNode.angle = 0;

                this.prepareShopPartNode(partNode);
            }
        }
        this.ensureCoreInAssembly();
    }

    /**
     * 按下 Fight 按鈕：掃描組裝區，紀錄所有零件的網格座標。沒有 Core 不能開始。
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

        GameManager.playerCarGrid = [];

        for (let p of partLayer.children) {
            let gx = Math.floor(p.x / GRID.CELL_SIZE);
            let gy = Math.floor(p.y / GRID.CELL_SIZE);

            let rawName = p.name.replace(/\([^)]*\)/g, "").trim();

            GameManager.playerCarGrid.push({
                partName: rawName,
                gridX: gx,
                gridY: gy
            });
            console.log(`已紀錄零件: ${rawName} 座標: (${gx}, ${gy})`);
        }

        console.log("✅ 成功保存網格配置:", JSON.stringify(GameManager.playerCarGrid));
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

    // --- 以下三個改為委派 core/PartUtils，移除重複實作 ---
    private cleanName(name: string): string {
        return utilCleanName(name);
    }

    private isCoreNode(node: cc.Node): boolean {
        return utilIsCoreNode(node);
    }

    getPrefabByName(name: string): cc.Prefab | undefined {
        return utilGetPrefabByName(this.partPrefabs, name);
    }

    // 把 itemPool 裡每個商品的 partPrefab + corePrefab + （選填的）allPrefabs 合併成一份零件清單，
    // 並依名稱去重。如此商店只需設定 itemPool 一次即可，不必再另外維護 allPrefabs。
    private buildPrefabList() {
        const list: cc.Prefab[] = [];
        const seen: { [name: string]: boolean } = {};
        const add = (p: cc.Prefab | null) => {
            if (p && !seen[p.name]) { seen[p.name] = true; list.push(p); }
        };

        for (const item of this.itemPool) if (item) add(item.partPrefab);
        add(this.corePrefab);
        for (const p of this.allPrefabs) add(p);   // 仍可手動補充不在商店賣的零件

        this.partPrefabs = list;
    }
    // ----------------------------------------------------

    private hasCoreNode(partLayer: cc.Node): boolean {
        return partLayer.children.some(p => this.isCoreNode(p));
    }

    private prepareShopPartNode(partNode: cc.Node) {
        const isCore = this.isCoreNode(partNode);

        let rb = partNode.getComponent(cc.RigidBody);
        if (rb) rb.type = cc.RigidBodyType.Static;

        // 商店內所有零件都保留碰撞框（武器 / 輪子 / 車身 / 核心），讓零件之間有實體碰撞。
        // 重建存檔車時 prefab 狀態可能殘留 disabled，這裡明確啟用以確保有碰撞框。
        (partNode.getComponents(cc.PhysicsCollider) as cc.PhysicsCollider[])
            .forEach(c => { c.enabled = true; });

        const drag = partNode.getComponent("Draggable") as any;
        if (drag) {
            drag.enabled = true;
            if (isCore) {
                drag.partType = PartType.Core;
            }
        }
    }

    private ensureCoreInAssembly() {
        let partLayer = this.getPartLayer();
        if (!partLayer) return;

        if (this.hasCoreNode(partLayer)) return;

        const coreX = this.coreGridX * GRID.CELL_SIZE + GRID.SNAP_OFFSET;
        const coreY = this.coreGridY * GRID.CELL_SIZE + GRID.SNAP_OFFSET;

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
        if (!this.scoreLabel) return;

        // 檢查目前是否為線上模式
        if (OnlineRuntime.isOnline()) {
            // 線上模式：顯示 P1 vs P2
            this.scoreLabel.string = `${OnlineRuntime.p1Name}-${OnlineRuntime.p1Wins} v.s. ${OnlineRuntime.p2Wins}-${OnlineRuntime.p2Name}`;
            
            // 選擇性：根據你是哪位玩家改變顏色，讓玩家更有帶入感
            if (OnlineRuntime.mySeat === "P1") {
                this.scoreLabel.node.color = cc.color(120, 200, 255); // 藍色 (P1)
            } else {
                this.scoreLabel.node.color = cc.color(255, 150, 90);  // 橘色 (P2)
            }
        } else {
            // 單機模式：維持原本的 Player vs Bot
            this.scoreLabel.string = `PLAYER-${GameManager.playerWins} v.s. ${GameManager.botWins}-BOT`;
            this.scoreLabel.node.color = cc.Color.WHITE;
        }
    }

    @property({ type: cc.Enum(PartType), tooltip: "第 1 格（買按鈕 CustomEventData = 0）賣哪一類" })
    slot0Category = PartType.Body;
    @property({ type: cc.Enum(PartType), tooltip: "第 2 格（買按鈕 CustomEventData = 1）賣哪一類" })
    slot1Category = PartType.Weapon;
    @property({ type: cc.Enum(PartType), tooltip: "第 3 格（買按鈕 CustomEventData = 2）賣哪一類" })
    slot2Category = PartType.Wheel;

    // 執行期由上面三個欄位組出，索引對應按鈕的 CustomEventData
    private slotCategories: PartType[] = [];

    refreshSlot(index: number) {
        const eligibleAll = this.getEligibleItems();
        const category = this.slotCategories[index] != null ? this.slotCategories[index] : PartType.Body;

        // 先抽該類別；該類別目前沒有可解鎖商品時，退回全部（避免空格子）
        const byCategory = eligibleAll.filter(it => (it.category != null ? it.category : PartType.Body) === category);
        const source = byCategory.length > 0 ? byCategory : (eligibleAll.length > 0 ? eligibleAll : this.itemPool);

        if (source.length === 0) return;

        let randomIndex = Math.floor(Math.random() * source.length);
        let item = source[randomIndex];

        this.slotIcons[index].spriteFrame = item.icon;
        this.slotPriceLabels[index].string = item.price.toString();
        this.currentSlotPrices[index] = item.price;
        this.currentItemPoolIndex[index] = this.itemPool.indexOf(item);
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
        part.parent = this.node;
        // prefab 預設群組是 PLAYER_PART（武器/輪子），而碰撞矩陣設定 PLAYER_PART 之間「不互撞」
        //（戰鬥中同車零件不該互相碰撞）。商店內鬆散零件要做物理堆疊，必須改成會自撞的 default 群組。
        part.group = "default";
        let worldPos = btnNode.convertToWorldSpaceAR(cc.v2(0, 0));
        let localPos = this.node.convertToNodeSpaceAR(worldPos);
        part.setPosition(localPos);

        let rb = part.getComponent(cc.RigidBody);
        if (rb) {
            rb.applyLinearImpulse(cc.v2(0, 500), rb.getWorldCenter(), true);
        }
    }

    showLackGoldTip() {
        if (this.tipLabel) {
            this.tipLabel.stopAllActions();
            this.tipLabel.opacity = 255;
            cc.tween(this.tipLabel)
                .delay(1.0)
                .to(0.5, { opacity: 0 })
                .start();
        }

        if (this.goldIcon) {
            this.goldIcon.stopAllActions();
            this.goldIcon.scale = 1;
            cc.tween(this.goldIcon)
                .to(0.05, { scale: 1.3 })
                .to(0.05, { scale: 1.0 })
                .to(0.05, { scale: 1.2 })
                .to(0.05, { scale: 1.0 })
                .start();
        }

        if (this.goldLabel) {
            let labelNode = this.goldLabel.node;
            labelNode.stopAllActions();
            labelNode.color = cc.Color.WHITE;

            cc.tween(labelNode)
                .to(0.1, { color: cc.Color.RED })
                .to(0.1, { color: cc.Color.WHITE })
                .union()
                .repeat(5)
                .start();
        }
    }

    onOpenSettings() {
        if (this.settingsPrefab) {
            let node = cc.instantiate(this.settingsPrefab);
            let canvas = cc.find("Canvas");
            node.parent = canvas;

            node.setPosition(0, 0);
            node.setSiblingIndex(canvas.childrenCount - 1);

            let widget = node.getComponent(cc.Widget);
            if (widget) {
                widget.updateAlignment();
            }
        }
    }

    // --- 輔助函數 ---
    findNodeRecursive(root: cc.Node, name: string): cc.Node | null {
        if (root.name === name) return root;
        for (let child of root.children) {
            let res = this.findNodeRecursive(child, name);
            if (res) return res;
        }
        return null;
    }

    private getCurrentRound(): number {
        if (OnlineRuntime.isOnline()) {
            // 線上模式回傳目前是第幾局
            return OnlineRuntime.p1Wins + OnlineRuntime.p2Wins;
        }
        return GameManager.playerWins + GameManager.botWins;
    }

    private getEligibleItems(): ItemData[] {
        const round = this.getCurrentRound();
        return this.itemPool.filter(item => (item.unlockRound || 0) <= round);
    }

    private checkSpecialRoundAnnouncement() {
        if (!this.announcementLabel) return;

        const node = this.announcementLabel.node;
        const totalRounds = GameManager.playerWins + GameManager.botWins;

        let message = "";
        let color = cc.Color.WHITE;

        if (totalRounds === 2 || totalRounds === 4) {
            message = "New items in shop!";
            color = cc.Color.WHITE;
        } else if (totalRounds === 6) {
            message = "Sudden death...";
            color = cc.Color.RED;
        }

        if (message !== "") {
            this.showFlashingNotice(message, color);
        } else {
            node.active = false;
        }
    }

    private showFlashingNotice(msg: string, color: cc.Color) {
        if (!this.announcementLabel) return;
        const node = this.announcementLabel.node;

        this.announcementLabel.string = msg;
        node.color = color;
        node.active = true;
        node.opacity = 255;

        node.stopAllActions();

        cc.tween(node)
            .repeatForever(
                cc.tween().to(0.4, { opacity: 80 }).to(0.4, { opacity: 255 })
            )
            .start();

        this.scheduleOnce(() => {
            node.stopAllActions();
            cc.tween(node)
                .to(0.5, { opacity: 0 })
                .call(() => {
                    node.active = false;
                })
                .start();
        }, 5);
    }
}