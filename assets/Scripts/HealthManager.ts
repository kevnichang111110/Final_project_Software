// HealthManager.ts  （類別名仍為 Health，檔名不變，編輯器綁定不受影響）
//
// 本次修正（只動血條，傷害判定與 @property 集合不變）：
//   1. 血條不再是零件的子節點，改掛在零件的父層（PLAYER_ROOT / BOT_ROOT，不會旋轉也沒鏡像），
//      每幀用世界座標釘在零件正上方並保持水平 → 不會再隨零件轉動。
//   2. 顯示邏輯：
//        - 剛受擊（hitTimer > 0）：血條明顯顯示，並持續 hitShowDuration 秒。
//        - 待機且殘血（currentHP < maxHP）：只淡淡顯示（idleAlpha）。
//        - 待機且滿血：完全隱藏。
//        - 已死亡（currentHP <= 0）：隱藏。
//   透明度用平滑淡入淡出，並直接畫進 Graphics 的顏色 alpha（不靠 node.opacity，較穩定）。

import Bullet from "./Bullet";
import { isWeaponNode } from "./core/PartUtils";
import { GROUP, DAMAGE } from "./core/GameConstants";
import HitFeedback from "./fx/HitFeedback";

const { ccclass, property } = cc._decorator;

@ccclass
export default class Health extends cc.Component {
    @property(cc.Float)
    maxHP: number = 100;

    public currentHP: number = 100;
    public onDieCallback: Function | null = null;

    @property(cc.AudioClip)
    hitSound: cc.AudioClip | null = null;
    @property(cc.AudioClip)
    dieSound: cc.AudioClip | null = null;

    @property(cc.Boolean)
    showDebugHPBar: boolean = true;
    @property(cc.Float)
    debugBarWidth: number = 34;
    @property(cc.Float)
    debugBarHeight: number = 5;
    @property(cc.Float)
    debugBarOffsetY: number = 28;   // 血條浮在零件中心上方多少 px（原本 0，建議拉高一點才不會壓在零件上）

    // --- 新增的可調欄位（新增 @property 不影響既有綁定）---
    @property({ type: cc.Float, tooltip: "受擊後血條持續明顯顯示的秒數" })
    hitShowDuration: number = 1.5;
    @property({ type: cc.Float, tooltip: "殘血待機時的淡顯透明度 0~1" })
    idleAlpha: number = 0.35;

    private isInvincible: boolean = false;
    private invincibilityDuration: number = DAMAGE.INVINCIBILITY;

    // 血條狀態
    private inBattle: boolean = false;
    private hpBarNode: cc.Node | null = null;
    private hpBarGraphics: cc.Graphics | null = null;
    private hitTimer: number = 0;
    private curAlpha: number = 0;
    private lastAlpha: number = -1;
    private lastRatio: number = -1;

    onLoad() {
        this.currentHP = this.maxHP;
        const rb = this.getComponent(cc.RigidBody);
        if (rb) rb.enabledContactListener = true;

        // 只有在戰鬥場景才需要血條
        this.inBattle = cc.director.getScene().name === "game";
    }

    onDestroy() {
        // 血條掛在 root 底下，零件死亡銷毀時要一起清掉
        if (this.hpBarNode && this.hpBarNode.isValid) {
            this.hpBarNode.destroy();
        }
        this.hpBarNode = null;
        this.hpBarGraphics = null;
    }

    // ====================================================================
    // 血條
    // ====================================================================
    private createHPBar() {
        if (this.hpBarNode || !this.node.parent) {
            cc.log(`[HP] createHPBar SKIP (barExists=${!!this.hpBarNode}, parent=${!!this.node.parent})`);
            return;
        }

        const node = new cc.Node("HP_Bar");
        node.parent = this.node.parent;   // 掛在 root（不旋轉、不鏡像）
        node.zIndex = 999;
        node.angle = 0;
        node.scale = 1;

        this.hpBarNode = node;
        this.hpBarGraphics = node.addComponent(cc.Graphics);
        this.curAlpha = 0;
        this.lastAlpha = -1;
        this.lastRatio = -1;
    }

    private drawBar(ratio: number, alpha: number) {
        const g = this.hpBarGraphics;
        if (!g) return;

        g.clear();
        if (alpha <= 0.01) return;   // 隱藏時不畫任何東西

        const a = Math.round(alpha * 255);
        const w = this.debugBarWidth;
        const h = this.debugBarHeight;
        const x = -w / 2;
        const y = -h / 2;

        // 外框
        g.fillColor = cc.color(0, 0, 0, a);
        g.rect(x - 1, y - 1, w + 2, h + 2);
        g.fill();
        // 底色（紅）
        g.fillColor = cc.color(200, 40, 40, a);
        g.rect(x, y, w, h);
        g.fill();
        // 前景（綠，依血量比例）
        g.fillColor = cc.color(70, 200, 70, a);
        g.rect(x, y, w * ratio, h);
        g.fill();
    }

    update(dt: number) {
        if (!this.inBattle || !this.showDebugHPBar) return;
        if (!this.node || !this.node.isValid) return;

        // 懶建立：確保父層已就緒才建血條
        if (!this.hpBarNode) {
            this.createHPBar();
            if (!this.hpBarNode) return;
        }
        if (!this.hpBarNode.isValid) return;

        // 倒數受擊顯示時間
        if (this.hitTimer > 0) this.hitTimer = Math.max(0, this.hitTimer - dt);

        // 決定目標透明度
        let targetAlpha: number;
        if (this.currentHP <= 0) {
            targetAlpha = 0;                 // 已死亡
        } else if (this.hitTimer > 0) {
            targetAlpha = 1;                 // 剛受擊：明顯
        } else if (this.currentHP < this.maxHP) {
            targetAlpha = this.idleAlpha;    // 殘血待機：淡顯
        } else {
            targetAlpha = 0;                 // 滿血待機：隱藏
        }

        // 平滑過渡
        this.curAlpha += (targetAlpha - this.curAlpha) * 0.25;
        if (targetAlpha === 0 && this.curAlpha < 0.02) this.curAlpha = 0;
        if (targetAlpha === 1 && this.curAlpha > 0.98) this.curAlpha = 1;

        // 完全隱藏時就不必更新位置，省一點
        if (this.curAlpha <= 0.01) {
            if (this.lastAlpha > 0.01) {     // 從可見變不可見，清一次
                this.drawBar(0, 0);
                this.lastAlpha = 0;
            }
            return;
        }

        // 釘在零件中心正上方，保持水平、不旋轉、不鏡像
        const worldCenter = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        const parent = this.hpBarNode.parent;
        if (parent) {
            const local = parent.convertToNodeSpaceAR(
                cc.v2(worldCenter.x, worldCenter.y + this.debugBarOffsetY)
            );
            this.hpBarNode.setPosition(local);
        }
        this.hpBarNode.angle = 0;
        this.hpBarNode.scaleX = 1;
        this.hpBarNode.scaleY = 1;

        // 只有在數值有變化時才重畫
        const ratio = Math.max(0, Math.min(1, this.currentHP / this.maxHP));
        if (Math.abs(this.curAlpha - this.lastAlpha) > 0.01 || Math.abs(ratio - this.lastRatio) > 0.01) {
            this.drawBar(ratio, this.curAlpha);
            this.lastAlpha = this.curAlpha;
            this.lastRatio = ratio;
        }
    }

    // ====================================================================
    // 傷害判定（行為與原版一致）
    // ====================================================================
    onBeginContact(contact: cc.PhysicsContact, selfCollider: cc.PhysicsCollider, otherCollider: cc.PhysicsCollider) {
        if (cc.director.getScene().name === "Shop") return;
        if (this.isInvincible || this.currentHP <= 0) return;

        const myGroup = this.node.group;
        const otherGroup = otherCollider.node.group;

        // --- 子彈 ---
        const bullet = otherCollider.node.getComponent("Bullet") as Bullet;
        if (bullet) {
            // 無差別子彈（滑鼠砲）：不分敵我都受傷
            if (bullet.damagesAll) {
                const dmg = isWeaponNode(this.node) ? bullet.damage * DAMAGE.BULLET_VS_WEAPON : bullet.damage;
                this.takeDamage(dmg);
                bullet.explode();
                return;
            }

            const mySide = myGroup.includes(GROUP.PLAYER_KEY) ? "PLAYER" : "BOT";

            if (bullet.ownerSide !== mySide) {
                const dmg = isWeaponNode(this.node) ? bullet.damage * DAMAGE.BULLET_VS_WEAPON : bullet.damage;
                this.takeDamage(dmg);
                bullet.explode();
            } else {
                bullet.explode();
            }
            return;
        }

        // --- 近戰／碰撞 ---
        const isPlayer = myGroup.includes(GROUP.PLAYER_KEY);
        const isBot = otherGroup.includes(GROUP.BOT_KEY);
        const isOpponent =
            (isPlayer && isBot) ||
            (myGroup.includes(GROUP.BOT_KEY) && otherGroup.includes(GROUP.PLAYER_KEY));
        if (!isOpponent) return;

        const worldManifold = contact.getWorldManifold();
        const p = worldManifold.points[0];
        if (!p) return;

        const rb1 = selfCollider.getComponent(cc.RigidBody);
        const rb2 = otherCollider.getComponent(cc.RigidBody);
        if (!rb1 || !rb2) return;

        const v1 = cc.v2();
        const v2 = cc.v2();
        rb1.getLinearVelocityFromWorldPoint(p, v1);
        rb2.getLinearVelocityFromWorldPoint(p, v2);

        const relativeVelocity = v1.sub(v2).mag();

        if (relativeVelocity > DAMAGE.COLLISION_THRESHOLD) {
            let damage = (relativeVelocity - DAMAGE.COLLISION_THRESHOLD) / DAMAGE.COLLISION_DIVISOR;

            const isMeWeapon = isWeaponNode(this.node);
            const isOtherWeapon = isWeaponNode(otherCollider.node);

            if (isMeWeapon && isOtherWeapon) {
                damage *= DAMAGE.WEAPON_VS_WEAPON;
                if (damage > DAMAGE.MIN_TO_APPLY) this.takeDamage(damage);
                return;
            }

            if (isMeWeapon) {
                damage *= DAMAGE.SELF_WEAPON_MULT;
            } else if (isOtherWeapon) {
                damage *= DAMAGE.OTHER_WEAPON_MULT;
            }

            if (damage > DAMAGE.MIN_TO_APPLY) this.takeDamage(damage);
        }
    }

    takeDamage(dmg: number) {
        if (this.currentHP <= 0 || this.isInvincible) {
            cc.log(`[HP] takeDamage IGNORED (hp=${this.currentHP.toFixed(0)} invincible=${this.isInvincible})`);
            return;
        }
        cc.log(`[HP] takeDamage on "${this.node.name}" dmg=${dmg.toFixed(1)}`);

        // 方塊防禦：BlockTrait.damageMultiplier < 1 代表高防禦
        let incoming = dmg;
        const trait = this.getComponent("BlockTrait") as any;
        if (trait && typeof trait.damageMultiplier === "number") {
            incoming *= trait.damageMultiplier;
        }

        const finalDmg = Math.min(incoming, DAMAGE.MAX_PER_HIT);
        this.currentHP -= finalDmg;

        // 打擊感回饋（鏡頭震動／縮放衝擊／火花／大擊 hitstop）：強度依實際傷害縮放，
        // 接觸點用零件中心世界座標。涵蓋近戰、碰撞、子彈所有扣血路徑。
        HitFeedback.trigger(finalDmg, this.node.convertToWorldSpaceAR(cc.v2(0, 0)));

        // 受擊 → 讓血條明顯顯示一段時間
        this.hitTimer = this.hitShowDuration;
        // 直接強制立刻顯示血條：takeDamage 由物理回呼觸發，即使 update 因故沒跑，受擊也一定看得到血條。
        this.forceShowBar();

        this.isInvincible = true;
        this.scheduleOnce(() => {
            this.isInvincible = false;
        }, this.invincibilityDuration);

        this.playSfx("hit");

        if (this.currentHP <= 0) {
            this.die();
        }
    }

    die() {
        this.playSfx("die");
        this.currentHP = 0;
        if (this.onDieCallback) this.onDieCallback();
    }

    // 受擊當下立刻把血條建好、釘到零件上方並畫成明顯。不靠 update（即使 update 沒跑也看得到）。
    private forceShowBar() {
        if (!this.inBattle || !this.showDebugHPBar) { cc.log(`[HP] forceShowBar SKIP inBattle=${this.inBattle} show=${this.showDebugHPBar}`); return; }
        if (!this.node || !this.node.isValid) return;
        if (!this.hpBarNode) { this.createHPBar(); if (!this.hpBarNode) { cc.log("[HP] forceShowBar SKIP: bar not created"); return; } }
        if (!this.hpBarNode.isValid) return;

        const worldCenter = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        const parent = this.hpBarNode.parent;
        if (parent) {
            const local = parent.convertToNodeSpaceAR(cc.v2(worldCenter.x, worldCenter.y + this.debugBarOffsetY));
            this.hpBarNode.setPosition(local);
        }
        this.hpBarNode.angle = 0;
        this.hpBarNode.scaleX = 1;
        this.hpBarNode.scaleY = 1;

        this.curAlpha = 1;
        const ratio = Math.max(0, Math.min(1, this.currentHP / this.maxHP));
        this.drawBar(ratio, 1);
        cc.log(`[HP] forceShowBar DREW ratio=${ratio.toFixed(2)} at (${this.hpBarNode.x.toFixed(0)},${this.hpBarNode.y.toFixed(0)}) parent=${parent ? parent.name : "null"}`);
        this.lastAlpha = 1;
        this.lastRatio = ratio;
    }

    // 優先用 PartAudio（第 8 點的通用音效介面），沒有才退回 Health 自己的舊欄位
    private playSfx(kind: "hit" | "die") {
        const audio = this.getComponent("PartAudio") as any;
        if (audio) {
            if (kind === "hit" && audio.playHit) { audio.playHit(); return; }
            if (kind === "die" && audio.playDie) { audio.playDie(); return; }
        }
        const clip = kind === "hit" ? this.hitSound : this.dieSound;
        if (clip) cc.audioEngine.playEffect(clip, false);
    }
}
