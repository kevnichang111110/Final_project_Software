// HealthManager.ts  （類別名仍為 Health，檔名不變，編輯器綁定不受影響）
// 變更：
//   1. 傷害判定的零件種類改用 PartUtils.isWeaponNode（取代原本散落的 getComponent + PartType 判斷）。
//   2. 所有傷害數值改用 GameConstants.DAMAGE，分組關鍵字改用 GROUP。
//   3. 不再 import PartType（已由 isWeaponNode 內部處理）；仍 import Bullet 作型別，
//      因為 Bullet 已不再 import Health，循環依賴已解除。
//   行為與原版完全一致。

import Bullet from "./Bullet";
import { isWeaponNode } from "./core/PartUtils";
import { GROUP, DAMAGE } from "./core/GameConstants";

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
    debugBarOffsetY: number = 0;

    private isInvincible: boolean = false;
    private invincibilityDuration: number = DAMAGE.INVINCIBILITY;

    private hpBarNode: cc.Node | null = null;
    private hpBarGraphics: cc.Graphics | null = null;

    onLoad() {
        this.currentHP = this.maxHP;
        const rb = this.getComponent(cc.RigidBody);
        if (rb) rb.enabledContactListener = true;
        if (this.showDebugHPBar) {
            this.createDebugHPBar();
            this.updateDebugHPBar();
        }
    }

    createDebugHPBar() {
        if (this.hpBarNode) return;
        this.hpBarNode = new cc.Node("Debug_HP_Bar");
        this.hpBarNode.parent = this.node;
        this.hpBarNode.setPosition(0, this.debugBarOffsetY);
        this.hpBarNode.zIndex = 999;
        this.hpBarGraphics = this.hpBarNode.addComponent(cc.Graphics);
    }

    updateDebugHPBar() {
        if (!this.hpBarGraphics) return;
        const g = this.hpBarGraphics;
        g.clear();
        const w = this.debugBarWidth;
        const h = this.debugBarHeight;
        const ratio = Math.max(0, Math.min(1, this.currentHP / this.maxHP));
        const x = -w / 2;
        const y = -h / 2;
        g.fillColor = cc.Color.BLACK;
        g.rect(x - 1, y - 1, w + 2, h + 2);
        g.fill();
        g.fillColor = cc.Color.RED;
        g.rect(x, y, w, h);
        g.fill();
        g.fillColor = cc.Color.GREEN;
        g.rect(x, y, w * ratio, h);
        g.fill();
    }

    update(dt: number) {
        if (this.showDebugHPBar && this.hpBarNode) {
            this.hpBarNode.angle = -this.node.angle;
        }
    }

    onBeginContact(contact: cc.PhysicsContact, selfCollider: cc.PhysicsCollider, otherCollider: cc.PhysicsCollider) {
        if (cc.director.getScene().name === "Shop") return;
        if (this.isInvincible || this.currentHP <= 0) return;

        const myGroup = this.node.group;
        const otherGroup = otherCollider.node.group;

        // --- 先檢查是不是被子彈打到 ---
        const bullet = otherCollider.node.getComponent("Bullet") as Bullet;
        if (bullet) {
            const mySide = myGroup.includes(GROUP.PLAYER_KEY) ? "PLAYER" : "BOT";

            if (bullet.ownerSide !== mySide) {
                // 敵方子彈：武器部件受傷打折
                const dmg = isWeaponNode(this.node) ? bullet.damage * DAMAGE.BULLET_VS_WEAPON : bullet.damage;
                this.takeDamage(dmg);
                bullet.explode();
            } else {
                // 友軍子彈（剛發射時）：直接消失，不扣血
                bullet.explode();
            }
            return;
        }

        // --- 近戰／碰撞傷害 ---
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
                damage *= DAMAGE.SELF_WEAPON_MULT;     // 我是武器撞人，受極小傷
            } else if (isOtherWeapon) {
                damage *= DAMAGE.OTHER_WEAPON_MULT;    // 別人用武器撞我，受重傷
            }

            if (damage > DAMAGE.MIN_TO_APPLY) this.takeDamage(damage);
        }
    }

    takeDamage(dmg: number) {
        if (this.currentHP <= 0 || this.isInvincible) return;

        const finalDmg = Math.min(dmg, DAMAGE.MAX_PER_HIT);
        this.currentHP -= finalDmg;
        this.updateDebugHPBar();

        this.isInvincible = true;
        this.scheduleOnce(() => {
            this.isInvincible = false;
        }, this.invincibilityDuration);

        if (this.hitSound) cc.audioEngine.playEffect(this.hitSound, false);

        if (this.currentHP <= 0) {
            this.die();
        }
    }

    die() {
        if (this.dieSound) cc.audioEngine.playEffect(this.dieSound, false);
        this.currentHP = 0;
        this.updateDebugHPBar();
        if (this.onDieCallback) this.onDieCallback();
    }
}
