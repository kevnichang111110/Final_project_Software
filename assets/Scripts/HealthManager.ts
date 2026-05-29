const {ccclass, property} = cc._decorator;

@ccclass
export default class Health extends cc.Component {
    @property(cc.Float) maxHP: number = 100;
    public currentHP: number = 100;

    // 這裡用來回傳給 BattleManager 判定勝負
    public onDieCallback: Function |null= null;

    onLoad() {
        this.currentHP = this.maxHP;
        // 必須開啟接觸監聽，否則 onBeginContact 不會觸發
        this.getComponent(cc.RigidBody).enabledContactListener = true;
    }

    // 物理引擎自動呼叫：當有東西撞到車身時
    onBeginContact(contact, selfCollider, otherCollider) {
        // 取得對方節點的分組
        let otherGroup = otherCollider.node.group;

        // 判定邏輯：如果是玩家車身被 BOT 的零件撞到，或是 BOT 車身被玩家零件撞到
        if ((this.node.group === "PLAYER_BODY" && otherGroup === "BOT_PART") ||
            (this.node.group === "BOT_BODY" && otherGroup === "PLAYER_PART")) {
            
            // 計算傷害 (暫定固定扣 10，之後可以根據相對速度計算)
            this.takeDamage(10);
        }
    }

    takeDamage(dmg: number) {
        if (this.currentHP <= 0) return;

        this.currentHP -= dmg;
        console.log(`${this.node.group} 剩下 HP: ${this.currentHP}`);

        if (this.currentHP <= 0) {
            this.die();
        }
    }

    die() {
        if (this.onDieCallback) {
            this.onDieCallback();
        }
        // 可以在這裡加爆炸特效或音效
        this.node.color = cc.Color.GRAY; // 變灰色代表報廢
    }
}