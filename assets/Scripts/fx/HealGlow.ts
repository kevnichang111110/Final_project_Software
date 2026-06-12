// fx/HealGlow.ts
// 純程式畫的加血綠色溢光（綠色擴散光暈 + 數顆上升綠點），自我修復方塊回血中時的點綴，
// 不需任何美術或粒子 prefab。用法：HealGlow.spawn(parentNode, worldPos, size)
//   parentNode：特效掛載的父節點（方塊所在的車身 root，方塊被銷毀後特效仍在）
//   worldPos  ：方塊中心的世界座標
//   size      ：方塊邊長（決定光暈半徑）
//
// 「物件池」：子樹（root + glow + MAX_MOTES 顆綠點）只建一次，重用時就地重置。
// 子節點參考快取在 root 上的 __fx。

import NodePool from "../core/NodePool";

const MAX_MOTES = 5;

interface HealRefs {
    glow: cc.Node;
    motes: cc.Node[];
}

let pool: NodePool | null = null;
function getPool(): NodePool {
    if (!pool) pool = new NodePool(buildHealGlow);
    return pool;
}

// 只建一次：root + glow + MAX_MOTES 顆綠點（含各自 Graphics）。
function buildHealGlow(): cc.Node {
    const root = new cc.Node("HealGlow");

    const glow = new cc.Node("glow");
    glow.parent = root;
    glow.addComponent(cc.Graphics);

    const motes: cc.Node[] = [];
    for (let i = 0; i < MAX_MOTES; i++) {
        const m = new cc.Node("mote");
        m.parent = root;
        m.addComponent(cc.Graphics);
        motes.push(m);
    }

    (root as any).__fx = { glow, motes } as HealRefs;
    return root;
}

export default class HealGlow {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, size: number = 40) {
        if (!parent || !parent.isValid) return;

        const p = getPool();
        const root = p.get();
        const refs = (root as any).__fx as HealRefs;

        root.active = true;
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 45;

        // 1) 綠色擴散光暈
        const glow = refs.glow;
        glow.stopAllActions();
        glow.setPosition(0, 0); glow.angle = 0; glow.opacity = 140; glow.scale = 0.5;
        const gg = glow.getComponent(cc.Graphics);
        gg.clear();
        gg.fillColor = cc.color(80, 255, 140, 140);
        gg.circle(0, 0, size * 0.5);
        gg.fill();
        cc.tween(glow)
            .to(0.5, { scale: 1.8, opacity: 0 }, { easing: "quadOut" })
            .start();

        // 2) 上升綠點（溢出的綠光）
        for (let i = 0; i < MAX_MOTES; i++) {
            const m = refs.motes[i];
            m.stopAllActions();

            const mg = m.getComponent(cc.Graphics);
            mg.clear();
            mg.fillColor = cc.color(120, 255, 160, 220);
            mg.circle(0, 0, 2.5 + Math.random() * 2);
            mg.fill();

            m.setPosition((Math.random() - 0.5) * size * 0.6, (Math.random() - 0.5) * size * 0.3);
            m.opacity = 220;
            m.scale = 1;
            cc.tween(m)
                .to(0.6 + Math.random() * 0.2, {
                    x: m.x + (Math.random() - 0.5) * 20,
                    y: m.y + 28 + Math.random() * 18,
                    opacity: 0,
                }, { easing: "quadOut" })
                .start();
        }

        // 收尾：收回池子重用
        cc.tween(root)
            .delay(0.9)
            .call(() => { if (root.isValid) p.put(root); })
            .start();
    }
}
