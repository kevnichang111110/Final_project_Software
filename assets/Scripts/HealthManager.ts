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

    // Debug 血條開關
    @property
    showDebugHPBar: boolean = true;

    @property
    debugBarWidth: number = 34;

    @property
    debugBarHeight: number = 5;

    @property
    debugBarOffsetY: number = 0;

    private isInvincible: boolean = false;
    private invincibilityDuration: number = 0.2;

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

        // 放在零件中心
        this.hpBarNode.setPosition(0, this.debugBarOffsetY);

        // 顯示在最上層
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

        // 黑色外框
        g.fillColor = cc.Color.BLACK;
        g.rect(x - 1, y - 1, w + 2, h + 2);
        g.fill();

        // 紅色底血量
        g.fillColor = cc.Color.RED;
        g.rect(x, y, w, h);
        g.fill();

        // 綠色目前血量
        g.fillColor = cc.Color.GREEN;
        g.rect(x, y, w * ratio, h);
        g.fill();
    }

    update(dt: number) {
        if (this.showDebugHPBar && this.hpBarNode) {
            // 讓血條不要跟著零件旋轉，方便 debug 看
            this.hpBarNode.angle = -this.node.angle;
        }
    }

    onBeginContact(contact: cc.PhysicsContact, selfCollider: cc.PhysicsCollider, otherCollider: cc.PhysicsCollider) {
        if (cc.director.getScene().name === "Shop") return;
        if (this.isInvincible) return;

        let myGroup = this.node.group;
        let otherGroup = otherCollider.node.group;

        if (myGroup === otherGroup || otherGroup === "default") return;

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

        if (relativeVelocity > 400) {
            let damage = (relativeVelocity - 400) / 15;

            const myDrag = this.getComponent("Draggable") as any;
            const otherDrag = otherCollider.getComponent("Draggable") as any;

            const isMeWeapon = myDrag && myDrag.partType === 1;
            const isOtherWeapon = otherDrag && otherDrag.partType === 1;

            // 武器撞武器不扣血
            if (isMeWeapon && isOtherWeapon) return;

            if (isMeWeapon) {
                damage *= 0.01;
            } else {
                if (isOtherWeapon) {
                    damage *= 3;
                }
            }

            if (damage > 0.5) {
                this.takeDamage(damage);
            }
        }
    }

    takeDamage(dmg: number) {
        if (this.currentHP <= 0 || this.isInvincible) return;

        const maxDamagePerHit = 20;
        const finalDmg = Math.min(dmg, maxDamagePerHit);

        this.currentHP -= finalDmg;

        cc.log(`[傷害] 分組: ${this.node.group} | 受到傷害: ${dmg.toFixed(1)} | 剩餘血量: ${this.currentHP.toFixed(1)} / ${this.maxHP}`);

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

        this.node.color = cc.Color.GRAY;

        this.currentHP = 0;
        this.updateDebugHPBar();

        if (this.onDieCallback) {
            this.onDieCallback();
        }
    }
}