// fx/HitFeedback.ts
// 集中式「打擊感」回饋系統。掛在 Main Camera 節點上（由 BattleManager 在開局時動態 addComponent）。
//
// 提供 static 介面，任何 gameplay 程式碼一行即可觸發，強度依傷害量比例縮放：
//   HitFeedback.trigger(damage, worldPos?)
//     - 鏡頭震動：用 zoomRatio 快速忽近忽遠的脈動呈現（trauma 模型，逐幀衰減）。
//       為什麼不用移動相機節點：主鏡頭 alignWithScreen 開著時會強制對齊螢幕、忽略節點 transform，
//       移動節點不是無效就是把視野弄壞（畫面變超大）。zoomRatio 在對齊模式下仍有效，最安全。
//     - 受擊染紅濾鏡（HitFlash 全螢幕覆蓋）
//     - 撞擊火花（HitSpark，需 worldPos）
//     - hitstop（大擊才有：短暫降低 scheduler timeScale 製造慢動作）
//
// 非戰鬥場景（沒有實例）時所有 static 呼叫皆安全 no-op。

import { HITFX } from "../core/GameConstants";
import HitSpark from "./HitSpark";

const { ccclass } = cc._decorator;

@ccclass
export default class HitFeedback extends cc.Component {
    private static instance: HitFeedback | null = null;

    private camera: cc.Camera | null = null;
    private baseZoom: number = 1;

    private trauma: number = 0;
    private elapsed: number = 0;          // 抖動相位用的時間累加器
    private hitstopActive: boolean = false;

    private flashNode: cc.Node | null = null;   // 全螢幕受擊染紅濾鏡

    onLoad() {
        HitFeedback.instance = this;
        this.camera = this.getComponent(cc.Camera);
        if (this.camera) this.baseZoom = this.camera.zoomRatio;
        // 不動 alignWithScreen：維持原本對齊螢幕的正確視野。
        this.createFlashOverlay();
    }

    onDestroy() {
        if (HitFeedback.instance === this) HitFeedback.instance = null;
        if (this.camera) this.camera.zoomRatio = this.baseZoom;   // 還原縮放
        if (this.hitstopActive) {                                 // 保險：還原時間倍率
            cc.director.getScheduler().setTimeScale(1);
            this.hitstopActive = false;
        }
    }

    // 全螢幕紅色濾鏡（掛在 Canvas 下、超大尺寸、最高 zIndex），受擊時短暫染紅
    private createFlashOverlay() {
        const parent = this.node.parent;   // Canvas（相機的父層，螢幕空間置中）
        if (!parent) return;

        const node = new cc.Node("HitFlash");
        node.parent = parent;
        node.setPosition(0, 0);
        node.zIndex = cc.macro.MAX_ZINDEX;  // 蓋在所有遊戲物件與 HUD 之上
        node.opacity = 0;

        const g = node.addComponent(cc.Graphics);
        const w = cc.winSize.width * 1.8;
        const h = cc.winSize.height * 1.8;
        g.fillColor = cc.color(HITFX.FLASH_COLOR_R, HITFX.FLASH_COLOR_G, HITFX.FLASH_COLOR_B, 255);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();

        this.flashNode = node;
    }

    update(dt: number) {
        if (!this.camera) return;

        if (this.trauma <= 0) {
            if (this.camera.zoomRatio !== this.baseZoom) this.camera.zoomRatio = this.baseZoom;
            return;
        }

        this.elapsed += dt;
        this.trauma = Math.max(0, this.trauma - HITFX.SHAKE_DECAY * dt);

        // 震動 = zoomRatio 快速忽近忽遠的脈動，幅度依 trauma^2 衰減
        const s = this.trauma * this.trauma;
        const wob = this.noise(this.elapsed * HITFX.SHAKE_FREQ) * s * HITFX.SHAKE_ZOOM_AMP;
        this.camera.zoomRatio = this.baseZoom * (1 + wob);
    }

    // 確定性偽隨機 [-1,1]
    private noise(t: number): number {
        const v = Math.sin(t * 12.9898) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
    }

    // ===== 實例方法 =====
    addTrauma(amount: number) {
        this.trauma = Math.min(HITFX.SHAKE_MAX_TRAUMA, this.trauma + amount);
    }

    flash(alpha01: number) {
        if (!this.flashNode || !this.flashNode.isValid) return;
        const peak = Math.round(Math.min(HITFX.FLASH_MAX_ALPHA, alpha01) * 255);
        if (peak <= 0) return;
        cc.Tween.stopAllByTarget(this.flashNode);
        this.flashNode.opacity = 0;
        cc.tween(this.flashNode)
            .to(HITFX.FLASH_IN_TIME, { opacity: peak })
            .to(HITFX.FLASH_OUT_TIME, { opacity: 0 })
            .start();
    }

    hitstop(scale: number, time: number) {
        if (this.hitstopActive) return;          // 重入保護：避免把時間倍率卡在慢速
        this.hitstopActive = true;
        cc.director.getScheduler().setTimeScale(scale);
        // 用真實時間還原（setTimeout 不受 scheduler timeScale 影響）
        setTimeout(() => {
            cc.director.getScheduler().setTimeScale(1);
            this.hitstopActive = false;
        }, time * 1000);
    }

    // ===== static 總入口（任何地方一行觸發；無實例時安全 no-op）=====
    static trigger(damage: number, worldPos?: cc.Vec2) {
        const inst = HitFeedback.instance;
        if (!inst || damage < HITFX.MIN_DAMAGE) return;

        inst.addTrauma(Math.min(HITFX.SHAKE_MAX_TRAUMA, damage * HITFX.SHAKE_PER_DAMAGE));

        if (damage >= HITFX.FLASH_MIN_DAMAGE) {
            inst.flash(damage * HITFX.FLASH_PER_DAMAGE);
        }

        if (damage >= HITFX.HITSTOP_DAMAGE) {
            inst.hitstop(HITFX.HITSTOP_SCALE, HITFX.HITSTOP_TIME);
        }

        if (worldPos && damage >= HITFX.SPARK_MIN_DAMAGE && inst.node.parent) {
            const strength = Math.min(1, damage / HITFX.HITSTOP_DAMAGE);
            HitSpark.spawn(inst.node.parent, worldPos, strength);
        }
    }
}
