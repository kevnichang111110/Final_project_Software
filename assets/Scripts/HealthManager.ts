import { PartType } from "./Slotsetting"; // 1. 務必匯入 PartType
import Bullet from "./Bullet";             // 2. 務必匯入 Bullet

const {ccclass, property} = cc._decorator;

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
    private invincibilityDuration: number = 0.1; // 稍微調低，讓連射子彈有感

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
        //cc.log(`[碰撞發生] 我方群組: ${this.node.group} | 撞到群組: ${otherCollider.node.group}`);
        
        if (cc.director.getScene().name === "Shop") return;
        if (this.isInvincible || this.currentHP <= 0) return;

        let myGroup = this.node.group;
        let otherGroup = otherCollider.node.group;

        // --- 修正1：先檢查是不是被子彈打到 ---
        const bullet = otherCollider.node.getComponent("Bullet") as Bullet; // 使用字串名稱確保穩定
        if (bullet) {
            const mySide = this.node.group.includes("PLAYER") ? "PLAYER" : "BOT";
            
            // 偵測到是敵方子彈
            if (bullet.ownerSide !== mySide) {
                //cc.log(`[中彈] ${this.node.name} 被 ${bullet.ownerSide} 的子彈擊中`);
                let bulletDmg = this.getComponent("Draggable")?.partType === PartType.Weapon ? bullet.damage * 0.5 : bullet.damage;
                this.takeDamage(bulletDmg);
                bullet.explode(); // 呼叫子彈爆炸消失
                return; 
            } else {
                // 友軍子彈（剛發射時）：直接讓子彈消失，不扣血
                bullet.explode();
                return;
            }
        }

        // --- 修正2：處理原本的近戰/碰撞傷害 ---
        // 判斷是否為敵對分組
        const isPlayer = myGroup.includes("PLAYER");
        const isBot = otherGroup.includes("BOT");
        const isOpponent = (isPlayer && isBot) || (myGroup.includes("BOT") && otherGroup.includes("PLAYER"));
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

        // 降低門檻，原本 400 可能太高導致近戰揮動沒傷害，改為 200 試試
        if (relativeVelocity > 200) {
            let damage = (relativeVelocity - 200) / 10;

            const myDrag = this.getComponent("Draggable") as any;
            const otherDrag = otherCollider.getComponent("Draggable") as any;

            // 修正：改用 Enum 判斷
            const isMeWeapon = myDrag && myDrag.partType === PartType.Weapon;
            const isOtherWeapon = otherDrag && otherDrag.partType === PartType.Weapon;

            if (isMeWeapon && isOtherWeapon){
                damage=damage*0.2
                if (damage > 0.5) {
                    this.takeDamage(damage);
                }
                return;
            }

            if (isMeWeapon) {
                damage *= 0.05; // 我是武器撞人，我受極小傷
            } else if (isOtherWeapon) {
                damage *= 4.0;  // 別人是武器撞我，我受重傷 (原本3倍改4倍更有感)
            }

            if (damage > 0.5) {
                this.takeDamage(damage);
            }
        }
    }

    takeDamage(dmg: number) {
        if (this.currentHP <= 0 || this.isInvincible) return;

        const maxDamagePerHit = 50; 
        const finalDmg = Math.min(dmg, maxDamagePerHit);

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