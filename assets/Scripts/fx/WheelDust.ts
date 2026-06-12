// fx/WheelDust.ts
// 輪子在地板滾動時揚起的塵土特效。兩個東西在同一檔：
//   DustPuff（純程式畫的物件池特效）：在輪下冒出幾顆淡褐色小塵團，往上＋往後飄散後淡出。
//   WheelDust（cc.Component 驅動器，掛在每個輪子節點上）：每幀檢查「貼地 + 轉得夠快」，
//             符合就節流呼叫 DustPuff.spawn。玩家與 Bot 的輪子都會掛（見 CarBuilder）。
//
// 設計同 HitSpark：子樹只建一次，重用時就地重置；參考快取在 root 上的 __fx。
// 不需任何美術或粒子 prefab。

import NodePool from "../core/NodePool";
import { GROUP, WHEELDUST } from "../core/GameConstants";

const { ccclass } = cc._decorator;

const MAX_PUFFS = 4;

interface PuffRefs {
    puffs: cc.Node[];
}

let pool: NodePool | null = null;
function getPool(): NodePool {
    if (!pool) pool = new NodePool(buildDustPuff);
    return pool;
}

// 只建一次：root + MAX_PUFFS 顆塵團（含各自 Graphics）。
function buildDustPuff(): cc.Node {
    const root = new cc.Node("DustPuff");

    const puffs: cc.Node[] = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
        const pf = new cc.Node("puff");
        pf.parent = root;
        pf.addComponent(cc.Graphics);
        puffs.push(pf);
    }

    (root as any).__fx = { puffs } as PuffRefs;
    return root;
}

// 純程式畫的揚塵特效（物件池）。
export class DustPuff {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, dirSign: number) {
        if (!parent || !parent.isValid) return;

        const p = getPool();
        const root = p.get();
        const refs = (root as any).__fx as PuffRefs;

        root.active = true;
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 4;   // 壓在輪子／子彈下面

        for (let i = 0; i < MAX_PUFFS; i++) {
            const pf = refs.puffs[i];
            pf.stopAllActions();

            const g = pf.getComponent(cc.Graphics);
            g.clear();
            g.fillColor = cc.color(200, 190, 170, 180);   // 淡褐塵土
            g.circle(0, 0, 4 + Math.random() * 3);
            g.fill();

            pf.setPosition(0, 0);
            pf.opacity = 180;
            pf.scale = 0.3;
            cc.tween(pf)
                .to(0.35 + Math.random() * 0.15, {
                    x: dirSign * (14 + Math.random() * 18),
                    y: 16 + Math.random() * 14,
                    scale: 1.6,
                    opacity: 0,
                }, { easing: "quadOut" })
                .start();
        }

        cc.tween(root)
            .delay(0.6)
            .call(() => { if (root.isValid) p.put(root); })
            .start();
    }
}

// 掛在每個輪子節點上的驅動器：貼地 + 轉得夠快 → 節流揚塵。
@ccclass
export default class WheelDust extends cc.Component {
    carRoot: cc.Node | null = null;   // 由 CarBuilder 注入：特效掛載的車身 root（輪子被銷毀後仍在）

    private rb: cc.RigidBody | null = null;
    private timer = 0;

    onLoad() {
        this.rb = this.getComponent(cc.RigidBody);
    }

    update(dt: number) {
        this.timer -= dt;
        if (this.timer > 0) return;
        if (!this.rb || !this.carRoot || !this.carRoot.isValid) return;

        // 轉得夠快才揚塵（靜止/慢速不冒）
        if (Math.abs(this.rb.angularVelocity) < WHEELDUST.MIN_SPIN) return;

        // 從輪心往下打射線判斷貼地（同 BattleManager.isGrounded 的做法）
        const o = this.node.convertToWorldSpaceAR(cc.v2(0, 0));
        const len = Math.max(this.node.width, this.node.height, 40) * 0.5 + WHEELDUST.GROUND_PROBE;
        const pm = cc.director.getPhysicsManager();
        const results = pm.rayCast(cc.v2(o.x, o.y), cc.v2(o.x, o.y - len), cc.RayCastType.Closest);
        let grounded = false;
        for (const r of results) {
            const g = r.collider.node.group;
            if (g === GROUP.DEFAULT || g === GROUP.BOUNDARY) { grounded = true; break; }
        }
        if (!grounded) return;

        // 接觸點 ≈ 輪子底部；塵土往「行進反方向」飄（角速度正負代表轉向）
        const contact = cc.v2(o.x, o.y - len * 0.6);
        const dirSign = this.rb.angularVelocity > 0 ? 1 : -1;
        DustPuff.spawn(this.carRoot, contact, dirSign);
        this.timer = WHEELDUST.EMIT_INTERVAL;
    }
}
