// fx/HitFeedback.ts
// 集中式「打擊感」回饋系統。掛在 Main Camera 節點上（由 BattleManager 在開局時動態 addComponent）。
//
// 提供 static 介面，任何 gameplay 程式碼一行即可觸發，強度依傷害量比例縮放：
//   HitFeedback.trigger(damage, worldPos?)
//     - 鏡頭震動（trauma 模型：累加 → 平方 → 多頻率 sin 位移，逐幀衰減）
//     - 鏡頭縮放衝擊（zoom punch：zoomRatio 快進慢出）
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
    private basePos: cc.Vec2 = cc.v2(0, 0);
    private baseAngle: number = 0;
    private baseZoom: number = 1;
    private origAlign: boolean = true;       // 還原用：相機原本的 alignWithScreen

    private trauma: number = 0;
    private elapsed: number = 0;       // 抖動相位用的時間累加器
    private hitstopActive: boolean = false;

    private flashNode: cc.Node | null = null;   // 全螢幕受擊染紅濾鏡

    // 三組互質相位，讓 X/Y/角度的抖動不同步、更自然
    private static readonly PHASE_X = 12.9898;
    private static readonly PHASE_Y = 78.2330;
    private static readonly PHASE_A = 37.7191;

    onLoad() {
        HitFeedback.instance = this;
        this.camera = this.getComponent(cc.Camera);

        if (this.camera) {
            this.baseZoom = this.camera.zoomRatio;
            // 關鍵：相機開著 alignWithScreen 時會強制對齊螢幕、忽略節點 transform，
            // 導致「移動相機節點做震動」完全無效。關掉它，改由節點 transform 控制視角。
            // 相機節點位於原點 (0,0)、角度 0，關掉後視角與原本一致、不會跳動。
            this.origAlign = (this.camera as any).alignWithScreen;
            (this.camera as any).alignWithScreen = false;
        }

        // 以原點為震動基準（對齊原本置中的視角）
        this.node.setPosition(0, 0);
        this.node.angle = 0;
        this.basePos = cc.v2(0, 0);
        this.baseAngle = 0;

        this.createFlashOverlay();
    }

    onDestroy() {
        if (HitFeedback.instance === this) HitFeedback.instance = null;
        // 還原相機 alignWithScreen，避免影響其他場景／重進場景
        if (this.camera) (this.camera as any).alignWithScreen = this.origAlign;
        // 保險：若銷毀時仍在 hitstop，務必還原時間倍率
        if (this.hitstopActive) {
            cc.director.getScheduler().setTimeScale(1);
            this.hitstopActive = false;
        }
    }

    // 建立全螢幕紅色濾鏡（掛在 Canvas 下、超大尺寸、最高 zIndex），受擊時短暫染紅
    private createFlashOverlay() {
        const parent = this.node.parent;   // Canvas（相機的父層，螢幕空間置中）
        if (!parent) return;

        const node = new cc.Node("HitFlash");
        node.parent = parent;
        node.setPosition(0, 0);
        node.zIndex = cc.macro.MAX_ZINDEX;  // 蓋在所有遊戲物件與 HUD 之上
        node.opacity = 0;

        const g = node.addComponent(cc.Graphics);
        // 放大 1.8 倍，確保鏡頭震動／拉近時邊緣不會露出
        const w = cc.winSize.width * 1.8;
        const h = cc.winSize.height * 1.8;
        g.fillColor = cc.color(HITFX.FLASH_COLOR_R, HITFX.FLASH_COLOR_G, HITFX.FLASH_COLOR_B, 255);
        g.rect(-w / 2, -h / 2, w, h);
        g.fill();

        this.flashNode = node;
    }

    update(dt: number) {
        if (this.trauma <= 0) {
            // 已歸零：確保鏡頭回到基準位置／角度（只在剛歸零那次寫回，update 成本可忽略）
            if (this.node.x !== this.basePos.x || this.node.y !== this.basePos.y || this.node.angle !== this.baseAngle) {
                this.node.setPosition(this.basePos);
                this.node.angle = this.baseAngle;
            }
            return;
        }

        this.elapsed += dt;
        this.trauma = Math.max(0, this.trauma - HITFX.SHAKE_DECAY * dt);

        const shake = this.trauma * this.trauma;     // 平方讓收尾更柔順
        const t = this.elapsed * HITFX.SHAKE_FREQ;

        const ox = HITFX.SHAKE_MAX_OFFSET * shake * this.noise(t, HitFeedback.PHASE_X);
        const oy = HITFX.SHAKE_MAX_OFFSET * shake * this.noise(t, HitFeedback.PHASE_Y);
        const oa = HITFX.SHAKE_MAX_ANGLE * shake * this.noise(t, HitFeedback.PHASE_A);

        this.node.setPosition(this.basePos.x + ox, this.basePos.y + oy);
        this.node.angle = this.baseAngle + oa;
    }

    // 確定性偽隨機 [-1,1]：用 sin(t*seed) 取小數部分再映射，避免每幀 Math.random 造成過度高頻抖動
    private noise(t: number, seed: number): number {
        const v = Math.sin(t * seed) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
    }

    // ===== 實例方法 =====
    addTrauma(amount: number) {
        this.trauma = Math.min(HITFX.SHAKE_MAX_TRAUMA, this.trauma + amount);
    }

    zoomPunch(amount: number) {
        if (!this.camera) return;
        cc.Tween.stopAllByTarget(this.camera);
        this.camera.zoomRatio = this.baseZoom;
        cc.tween(this.camera)
            .to(HITFX.ZOOM_IN_TIME, { zoomRatio: this.baseZoom + amount }, { easing: "quadOut" })
            .to(HITFX.ZOOM_OUT_TIME, { zoomRatio: this.baseZoom }, { easing: "quadIn" })
            .start();
    }

    flash(alpha01: number) {
        if (!this.flashNode || !this.flashNode.isValid) return;
        const peak = Math.round(Math.min(HITFX.FLASH_MAX_ALPHA, alpha01) * 255);
        if (peak <= 0) return;
        cc.Tween.stopAllByTarget(this.flashNode);
        this.flashNode.opacity = 0;
        // 快染、慢退（cc.Graphics 會吃 node.opacity，與 Explosion 的做法一致）
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
        inst.zoomPunch(Math.min(HITFX.ZOOM_MAX, damage * HITFX.ZOOM_PER_DAMAGE));

        if (damage >= HITFX.FLASH_MIN_DAMAGE) {
            inst.flash(damage * HITFX.FLASH_PER_DAMAGE);
        }

        if (damage >= HITFX.HITSTOP_DAMAGE) {
            inst.hitstop(HITFX.HITSTOP_SCALE, HITFX.HITSTOP_TIME);
        }

        if (worldPos && damage >= HITFX.SPARK_MIN_DAMAGE && inst.node.parent) {
            // 火花掛在 Canvas（相機父層）以世界座標呈現；強度用傷害對 MAX_PER_HIT 等級正規化
            const strength = Math.min(1, damage / HITFX.HITSTOP_DAMAGE);
            HitSpark.spawn(inst.node.parent, worldPos, strength);
        }
    }
}
