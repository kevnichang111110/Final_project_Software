// fx/HitFeedback.ts
// 集中式「打擊感」回饋系統。掛在 Main Camera 節點上（由 BattleManager 在開局時動態 addComponent）。
//
// 提供 static 介面，任何 gameplay 程式碼一行即可觸發，強度依傷害量比例縮放：
//   HitFeedback.trigger(damage, worldPos?)
//     - 震動：位移「背景節點(Canvas/bg)」呈現（trauma 模型，逐幀衰減）。
//       為什麼不移動相機：主鏡頭 alignWithScreen 開著時會強制對齊螢幕、忽略節點 transform，
//       移動相機節點不是無效就是把視野弄壞。背景是純 Sprite（無 Widget、無物理），位移它最安全且明顯。
//     - 撞擊火花（HitSpark，需 worldPos）
//     - hitstop（大擊才有：短暫降低 scheduler timeScale 製造慢動作）
//
// 非戰鬥場景（沒有實例）時所有 static 呼叫皆安全 no-op。
// 想加入更多一起震動的節點，往 SHAKE_NODE_PATHS 加路徑即可（須為非物理的純視覺節點）。

import { HITFX } from "../core/GameConstants";
import HitSpark from "./HitSpark";

const { ccclass } = cc._decorator;

// 要一起震動的視覺節點路徑（相對場景根）。背景全螢幕、純 Sprite，位移它最安全又明顯。
const SHAKE_NODE_PATHS = ["Canvas/bg"];
// 把震動節點稍微放大，留出位移餘裕，避免抖動時露出邊緣黑邊（背景常常剛好等於畫面大小）。
const SHAKE_OVERSCALE = 1.15;

@ccclass
export default class HitFeedback extends cc.Component {
    private static instance: HitFeedback | null = null;

    private trauma: number = 0;
    private elapsed: number = 0;          // 抖動相位用的時間累加器
    private hitstopActive: boolean = false;

    // 被震動的節點與其基準位置／縮放（震動是「基準位置 + 位移」，結束後歸位）
    private shakeNodes: cc.Node[] = [];
    private shakeBase: cc.Vec2[] = [];
    private shakeBaseScale: number[] = [];

    onLoad() {
        HitFeedback.instance = this;
        for (const p of SHAKE_NODE_PATHS) {
            const n = cc.find(p);
            if (!n) continue;
            this.shakeNodes.push(n);
            this.shakeBase.push(n.getPosition());
            this.shakeBaseScale.push(n.scale);
            n.scale = n.scale * SHAKE_OVERSCALE;   // 放大留位移餘裕，避免露邊
        }
    }

    onDestroy() {
        if (HitFeedback.instance === this) HitFeedback.instance = null;
        for (let i = 0; i < this.shakeNodes.length; i++) {
            const n = this.shakeNodes[i];
            if (n && n.isValid) { n.setPosition(this.shakeBase[i]); n.scale = this.shakeBaseScale[i]; }
        }
        if (this.hitstopActive) {                 // 保險：還原時間倍率
            cc.director.getScheduler().setTimeScale(1);
            this.hitstopActive = false;
        }
    }

    private restoreShakeNodes() {
        for (let i = 0; i < this.shakeNodes.length; i++) {
            const n = this.shakeNodes[i];
            if (n && n.isValid) n.setPosition(this.shakeBase[i]);
        }
    }

    update(dt: number) {
        if (this.trauma <= 0) return;

        this.elapsed += dt;
        this.trauma = Math.max(0, this.trauma - HITFX.SHAKE_DECAY * dt);

        if (this.trauma <= 0) { this.restoreShakeNodes(); return; }

        // 位移幅度 = trauma^2，收尾更柔順；X/Y 用不同相位讓抖動更自然
        const s = this.trauma * this.trauma;
        const t = this.elapsed * HITFX.SHAKE_FREQ;
        const ox = HITFX.SHAKE_MAX_OFFSET * s * this.noise(t, 12.9898);
        const oy = HITFX.SHAKE_MAX_OFFSET * s * this.noise(t, 78.2330);

        for (let i = 0; i < this.shakeNodes.length; i++) {
            const n = this.shakeNodes[i];
            if (n && n.isValid) n.setPosition(this.shakeBase[i].x + ox, this.shakeBase[i].y + oy);
        }
    }

    // 確定性偽隨機 [-1,1]
    private noise(t: number, seed: number): number {
        const v = Math.sin(t * seed) * 43758.5453;
        return (v - Math.floor(v)) * 2 - 1;
    }

    // ===== 實例方法 =====
    addTrauma(amount: number) {
        this.trauma = Math.min(HITFX.SHAKE_MAX_TRAUMA, this.trauma + amount);
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

        if (damage >= HITFX.HITSTOP_DAMAGE) {
            inst.hitstop(HITFX.HITSTOP_SCALE, HITFX.HITSTOP_TIME);
        }

        if (worldPos && damage >= HITFX.SPARK_MIN_DAMAGE && inst.node.parent) {
            const strength = Math.min(1, damage / HITFX.HITSTOP_DAMAGE);
            HitSpark.spawn(inst.node.parent, worldPos, strength);
        }
    }
}
