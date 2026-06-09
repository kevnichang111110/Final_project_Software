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

    private trauma: number = 0;
    private elapsed: number = 0;       // 抖動相位用的時間累加器
    private hitstopActive: boolean = false;

    // 三組互質相位，讓 X/Y/角度的抖動不同步、更自然
    private static readonly PHASE_X = 12.9898;
    private static readonly PHASE_Y = 78.2330;
    private static readonly PHASE_A = 37.7191;

    onLoad() {
        HitFeedback.instance = this;
        this.basePos = this.node.getPosition();
        this.baseAngle = this.node.angle;
        this.camera = this.getComponent(cc.Camera);
        if (this.camera) this.baseZoom = this.camera.zoomRatio;
    }

    onDestroy() {
        if (HitFeedback.instance === this) HitFeedback.instance = null;
        // 保險：若銷毀時仍在 hitstop，務必還原時間倍率
        if (this.hitstopActive) {
            cc.director.getScheduler().setTimeScale(1);
            this.hitstopActive = false;
        }
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
