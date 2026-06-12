// scene/OpeningDirector.ts
const { ccclass, property } = cc._decorator;

import CarBuilder, { BuiltCar, BuildParams } from "./battle/CarBuilder";
import GameManager from "./GameManager"; // 這裡直接 import 靜態類別
import { getDraggable } from "./core/PartUtils"; 
import { PartType } from "./core/PartType";

@ccclass
export default class OpeningDirector extends cc.Component {

    @property({ type: cc.Camera, tooltip: "主相機 (用來做 Zoom in 和震動)" })
    mainCamera: cc.Camera | null = null;

    @property({ type: cc.Node, tooltip: "大爆炸特效節點" })
    explosionFx: cc.Node | null = null;

    @property({ tooltip: "撞擊後要切換的下一個場景名稱" })
    nextSceneName: string = "Menu";

    @property([cc.Prefab])
    partPrefabs: cc.Prefab[] = []; 

    @property({ type: cc.Node, tooltip: "黑邊容器" })
    letterboxContainer: cc.Node | null = null;

    @property({ type: cc.AudioClip, tooltip: "引擎加速聲" })
    engineSound: cc.AudioClip | null = null;

    @property({ type: cc.AudioClip, tooltip: "大爆炸聲" })
    explosionSound: cc.AudioClip | null = null;

    private leftCar: BuiltCar | null = null;
    private rightCar: BuiltCar | null = null;

    start() {
        if (this.explosionFx) this.explosionFx.active = false;

        // 【核心修改】：從靜態類別直接抓取設計圖
        // 我們隨機選一個配置，讓開場動畫不那麼單調
        const randomIdx = Math.floor(Math.random() * GameManager.botConfigs.length);
        const selectedGridData = GameManager.botConfigs[randomIdx];

        // 建立左邊的車 (PLAYER)
        const leftParams: BuildParams = {
            gridData: selectedGridData,
            startPos: cc.v2(-400, 0),
            side: "PLAYER",
            root: this.node,
            prefabs: this.partPrefabs,
            onCoreDie: () => {}
        };
        this.leftCar = CarBuilder.build(leftParams);

        // 建立右邊的車 (BOT)
        const rightParams: BuildParams = {
            gridData: selectedGridData, // 用同一份資料，CarBuilder 會自動處理翻轉
            startPos: cc.v2(400, 0),
            side: "BOT",
            root: this.node,
            prefabs: this.partPrefabs,
            onCoreDie: () => {}
        };
        this.rightCar = CarBuilder.build(rightParams);

        this.fixCarRotation(this.leftCar);
        this.fixCarRotation(this.rightCar);

        // 關閉物理引擎，確保動畫平滑
        cc.director.getPhysicsManager().enabled = false;

        // 初始化黑邊位置
        if (this.letterboxContainer) {
            this.letterboxContainer.active = true;
            
            const topBar = this.letterboxContainer.getChildByName("TopBar");
            const bottomBar = this.letterboxContainer.getChildByName("BottomBar");
            
            if (topBar && bottomBar) {
                // 【防禦機制】：強制關閉 Widget，確保它不會把動畫拉回原位
                const tw = topBar.getComponent(cc.Widget);
                const bw = bottomBar.getComponent(cc.Widget);
                if (tw) tw.enabled = false;
                if (bw) bw.enabled = false;

                // 1. 紀錄它在編輯器排好的正確位置 (例如 320 和 -320)
                const targetTopY = topBar.y;
                const targetBotY = bottomBar.y;

                // 2. 瞬間把黑邊往外推 150 像素 (藏到螢幕外)
                topBar.y = targetTopY + 150;
                bottomBar.y = targetBotY - 150;

                // 3. 從螢幕外滑入到正確位置
                cc.tween(topBar).to(0.5, { y: targetTopY }, { easing: 'cubicOut' }).start();
                cc.tween(bottomBar).to(0.5, { y: targetBotY }, { easing: 'cubicOut' }).start();
            }
        }

        // 動畫啟動
        if (this.leftCar.coreNode && this.rightCar.coreNode) {
            this.playIntroAnimation(this.leftCar.coreNode, this.rightCar.coreNode);
        } else {
            this.scheduleOnce(() => { this.goToNextScene(); }, 1);
        }
    }

    private playIntroAnimation(leftCore: cc.Node, rightCore: cc.Node) {
        if (this.engineSound) {
            cc.audioEngine.playEffect(this.engineSound, false);
        }

        const moveDuration = 1.5;
        const targetX_Left = -50;
        const targetX_Right = 50;
        
        const leftDeltaX = targetX_Left - leftCore.x;
        const rightDeltaX = targetX_Right - rightCore.x;

        // 同步移動整台車的所有零件
        if (this.leftCar) {
            this.leftCar.partsMap.forEach(part => {
                cc.tween(part).by(moveDuration, { x: leftDeltaX }, { easing: 'quadIn' }).start();
            });
        }
        if (this.rightCar) {
            this.rightCar.partsMap.forEach(part => {
                cc.tween(part).by(moveDuration, { x: rightDeltaX }, { easing: 'quadIn' }).start();
            });
        }

        if (this.mainCamera) {
            cc.tween(this.mainCamera)
                .to(moveDuration, { zoomRatio: 2.0 }, { easing: 'quadIn' })
                .call(() => { this.onCrash(); })
                .start();
        } else {
            this.scheduleOnce(() => { this.onCrash(); }, moveDuration);
        }
    }

    private onCrash() {
        if (this.leftCar) this.leftCar.partsMap.forEach(part => part.active = false);
        if (this.rightCar) this.rightCar.partsMap.forEach(part => part.active = false);

        if (this.explosionSound) {
            cc.audioEngine.playEffect(this.explosionSound, false);
        }

        if (this.explosionFx) {
            this.explosionFx.active = true;
            const anim = this.explosionFx.getComponent(cc.Animation);
            if (anim) {
                anim.play('Explosion'); // 播放動畫
            }
        }

        if (this.mainCamera) {
            const camNode = this.mainCamera.node;
            cc.tween(camNode)
                .by(0.05, { x: 30, y: 20 })
                .by(0.05, { x: -60, y: -40 })
                .by(0.05, { x: 45, y: 30 })
                .by(0.05, { x: -15, y: -10 })
                .to(0.1, { x: 0, y: 0 })
                .delay(1) // 保持爆炸煙霧畫面一秒
                .call(() => {
                    // === 【這裡就是呼叫時機】 ===
                    this.hideLetterbox(); // 讓黑邊淡出滑走
                })
                // .delay(0.3) // 給黑邊 0.3 秒的滑出時間
                .call(() => {
                    cc.director.getPhysicsManager().enabled = true;
                    this.goToNextScene(); // 最後才切場景
                })
                .start();
        } else {
            cc.director.getPhysicsManager().enabled = true;
            this.scheduleOnce(() => { this.goToNextScene(); }, 1.2);
        }
    }

    private goToNextScene() {
        cc.director.loadScene(this.nextSceneName);
    }

    private fixCarRotation(builtCar: BuiltCar | null) {
        if (!builtCar) return;
        builtCar.partsMap.forEach(node => {
            const drag = getDraggable(node);
            if (drag && drag.partType === PartType.Weapon) {
                // 強制將水平縮放設為正向，確保所有武器的槍口都朝外
                node.scaleX = 1; 
            }
        });
    }

    private hideLetterbox() {
        if (!this.letterboxContainer) return;

        const topBar = this.letterboxContainer.getChildByName("TopBar");
        const bottomBar = this.letterboxContainer.getChildByName("BottomBar");
        
        if (topBar && bottomBar) {
            // 用 relative (by) 的方式，讓黑邊往外推 150 像素滑走
            cc.tween(topBar).by(0.3, { y: 150 }, { easing: 'cubicIn' }).start();
            cc.tween(bottomBar).by(0.3, { y: -150 }, { easing: 'cubicIn' }).start();
        }
    }
}