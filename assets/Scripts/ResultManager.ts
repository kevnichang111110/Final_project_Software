import GameManager from "./GameManager";
import FirebaseService from "./net/FirebaseService";
import { getPrefabByName } from "./core/PartUtils"; // 請確認路徑是否正確
import { GRID } from "./core/GameConstants";

const { ccclass, property } = cc._decorator;

@ccclass
export default class ResultManager extends cc.Component {

    @property(cc.Node) carRoot: cc.Node = null; // 用來裝車子的空節點
    @property([cc.Prefab]) allPrefabs: cc.Prefab[] = []; // 把所有零件 Prefab 拉進來
    
    @property(cc.ParticleSystem) fireworkParticle: cc.ParticleSystem = null;
    @property(cc.ParticleSystem) smokeParticle: cc.ParticleSystem = null;
    @property([cc.Node]) textLines: cc.Node[] = []; 

    private isWin: boolean = false; 

    onLoad() {
        // 1. 判斷最終輸贏：假設玩家勝場較多就是贏
        this.isWin = GameManager.playerWins > GameManager.botWins;

        // 2. 初始化：關閉所有特效與文字
        if (this.fireworkParticle) this.fireworkParticle.node.active = false;
        if (this.smokeParticle) this.smokeParticle.node.active = false;
        this.textLines.forEach(line => {
            line.x = 800;
            line.opacity = 0;
        });

        // 3. 讀取玩家在車庫拼好的藍圖，畫出純視覺版的車子
        if (GameManager.playerCarGrid && GameManager.playerCarGrid.length > 0) {
            this.buildVisualCar(GameManager.playerCarGrid);
        } else {
            cc.warn("[ResultManager] 找不到 GameManager.playerCarGrid 資料");
        }
    }

    start() {
        this.playResult();
    }

    /** * 純視覺造車：拼出外觀，但拔除所有物理與戰鬥組件 
     */
    private buildVisualCar(gridData: any[]) {
        if (!this.carRoot) return;
        this.carRoot.removeAllChildren();

        for (const data of gridData) {
            const prefab = getPrefabByName(this.allPrefabs, data.partName);
            if (!prefab) continue;

            const node = cc.instantiate(prefab);
            node.parent = this.carRoot;
            
            // 依照網格座標排版 (與 CarBuilder 邏輯相同)
            node.setPosition(
                data.gridX * GRID.CELL_SIZE,
                data.gridY * GRID.CELL_SIZE
            );

            // === 核心：拔除物理與遊戲邏輯，讓它變成靜態模型 ===
            
            // 1. 停用剛體，避免往下掉
            const rb = node.getComponent(cc.RigidBody);
            if (rb) rb.type = cc.RigidBodyType.Static; 

            // 2. 拔除碰撞體與關節
            node.getComponents(cc.PhysicsCollider).forEach(c => c.destroy());
            node.getComponents(cc.Joint).forEach(j => j.destroy());

            // 3. 拔除血量與武器腳本
            const health = node.getComponent("HealthManager");
            if (health) health.destroy();
            
            const cannon = node.getComponent("MouseCannon");
            if (cannon) cannon.enabled = false;
            
            const audio = node.getComponent("PartAudio");
            if (audio) audio.enabled = false;
        }

        this.centerCarRoot();
    }

    // 將整台車置中對齊畫面
    private centerCarRoot() {
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        this.carRoot.children.forEach(child => {
            minX = Math.min(minX, child.x - child.width / 2);
            maxX = Math.max(maxX, child.x + child.width / 2);
            minY = Math.min(minY, child.y - child.height / 2);
            maxY = Math.max(maxY, child.y + child.height / 2);
        });

        if (minX !== Infinity) {
            const centerX = (minX + maxX) / 2;
            const centerY = (minY + maxY) / 2;
            this.carRoot.children.forEach(child => {
                child.x -= centerX;
                child.y -= centerY;
            });
        }
    }

   playResult() {
        // 先決定勝負特效
        if (this.isWin) {
            if (this.fireworkParticle) {
                this.fireworkParticle.node.active = true;
                this.fireworkParticle.resetSystem(); 
            }
        } else {
            if (this.smokeParticle) {
                this.smokeParticle.node.active = true;
                this.smokeParticle.resetSystem();
                if (this.carRoot) {
                     this.carRoot.children.forEach(child => child.color = cc.color(80, 80, 80)); 
                }
            }
        }

        // === 🚀 1. 設定前兩行文字 (勝負與比分) ===
        if (this.textLines.length >= 1) {
            const titleLabel = this.textLines[0].getComponent(cc.Label);
            if (titleLabel) {
                titleLabel.string = this.isWin ? "VICTORY 🏆" : "DEFEAT 💀";
                this.textLines[0].color = this.isWin ? cc.Color.YELLOW : cc.Color.RED; 
            }
        }

        if (this.textLines.length >= 2) {
            const scoreLabel = this.textLines[1].getComponent(cc.Label);
            if (scoreLabel) {
                scoreLabel.string = `最終比分：${GameManager.playerWins} - ${GameManager.botWins} `;
            }
        }

        // === 📊 2. 設定第三行文字 (先給予預設載入文字) ===
        if (this.textLines.length >= 3) {
            const recordLabel = this.textLines[2].getComponent(cc.Label);
            if (recordLabel) {
                recordLabel.string = "正在計算最新戰績... ⏳";
            }
        }

        // === 🎬 3. 執行文字依序滑入動畫 ===
        this.textLines.forEach((line, index) => {
            cc.tween(line)
                .delay(index * 0.4) 
                .to(0.6, { x: 0, opacity: 255 }, { easing: "backOut" })
                .start();
        });

        // === 🌐 4. 後台同步更新 Firebase 並用 REST API 抓回最新勝率 ===
        // 呼叫更新資料庫，並利用 .then() 等待更新完成
        FirebaseService.updateGameResult(this.isWin)
            .then(() => {
                // 資料庫更新成功後，立刻去抓取目前登入玩家的最新文件
                const user = FirebaseService.getUser();
                if (!user) return null;

                const projectId = "ssdfinal-c6446"; 
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`;
                return fetch(url);
            })
            .then(res => res && res.ok ? res.json() : null)
            .then(data => {
                // 成功拿到包含這場比賽後的最新戰績！
                if (data && data.fields && this.textLines.length >= 3) {
                    const winRate = data.fields.winRate ? parseFloat(data.fields.winRate.doubleValue || data.fields.winRate.integerValue || "0") : 0;
                    const currentStreak = data.fields.currentStreak && data.fields.currentStreak.integerValue ? parseInt(data.fields.currentStreak.integerValue) : 0;
                    const maxStreak = data.fields.maxStreak && data.fields.maxStreak.integerValue ? parseInt(data.fields.maxStreak.integerValue) : 0;

                    const recordLabel = this.textLines[2].getComponent(cc.Label);
                    if (recordLabel) {
                        // 帥氣刷新文字！例如：目前勝率：66.7% ｜ 連勝：3 (最高：5)
                        recordLabel.string = `目前勝率：${winRate}%  |  當前連勝：${currentStreak} (最高：${maxStreak})`;
                        
                        // 額外小驚喜：如果正在連勝中，讓字體亮起來
                        if (currentStreak >= 2 && this.isWin) {
                            this.textLines[2].color = cc.color(100, 255, 100); // 綠色代表連勝發光
                        }
                    }
                }
            })
            .catch(err => {
                console.error("結算畫面更新戰績失敗：", err);
                if (this.textLines.length >= 3) {
                    const recordLabel = this.textLines[2].getComponent(cc.Label);
                    if (recordLabel) recordLabel.string = "戰績更新失聯 📡";
                }
            });
    }   
    // 給介面按鈕綁定的函數，結算完後回到主選單或清除資料
    onBackToMenu() {
        GameManager.resetAllData();
        cc.director.loadScene("Menu");
    }
}