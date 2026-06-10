// battle/Explosion.ts
// 純程式畫的爆炸特效（閃光圈 + 外擴環 + 飛濺碎屑），不需要任何美術或粒子 prefab。
// 用法：Explosion.spawn(parentNode, worldPos, size)
//   parentNode：特效掛載的父節點（通常是零件原本的父層 root，零件被銷毀後特效仍在）
//   worldPos  ：爆炸的世界座標
//   size      ：大小（約等於零件尺寸）
//
// 改為「物件池」：子樹（root + flash + ring + 8 碎屑）只建一次，之後重用時就地重置
// （停動作、歸位、清空重畫 Graphics、重啟 tween），收尾不再 destroy 而是收回池子。
// 子節點參考快取在 root 上的 __fx，省去每次 getChildByName。

import NodePool from "../core/NodePool";

const DEBRIS_COUNT = 8;

interface ExplosionRefs {
    flash: cc.Node;
    ring: cc.Node;
    debris: cc.Node[];
}

let pool: NodePool | null = null;
function getPool(): NodePool {
    if (!pool) pool = new NodePool(buildExplosion);
    return pool;
}

// 只建一次：root 與所有子節點 + Graphics。實際的半徑/顏色/位移在每次 spawn 時重畫。
function buildExplosion(): cc.Node {
    const root = new cc.Node("Explosion");

    const flash = new cc.Node("flash");
    flash.parent = root;
    flash.addComponent(cc.Graphics);

    const ring = new cc.Node("ring");
    ring.parent = root;
    ring.addComponent(cc.Graphics);

    const debris: cc.Node[] = [];
    for (let i = 0; i < DEBRIS_COUNT; i++) {
        const d = new cc.Node("debris");
        d.parent = root;
        d.addComponent(cc.Graphics);
        debris.push(d);
    }

    (root as any).__fx = { flash, ring, debris } as ExplosionRefs;
    return root;
}

export default class Explosion {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, size: number = 60) {
        if (!parent || !parent.isValid) return;

        const p = getPool();
        const root = p.get();
        const refs = (root as any).__fx as ExplosionRefs;

        root.active = true;
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 50;

        const radius = Math.max(size, 30) * 0.5;

        // 1) 中心閃光
        const flash = refs.flash;
        flash.stopAllActions();
        flash.setPosition(0, 0); flash.angle = 0; flash.opacity = 255; flash.scale = 0.3;
        const fg = flash.getComponent(cc.Graphics);
        fg.clear();
        fg.fillColor = cc.color(255, 235, 150, 255);
        fg.circle(0, 0, radius);
        fg.fill();
        cc.tween(flash)
            .to(0.10, { scale: 1.1 }, { easing: "quadOut" })
            .to(0.18, { scale: 1.5, opacity: 0 })
            .start();

        // 2) 外擴環
        const ring = refs.ring;
        ring.stopAllActions();
        ring.setPosition(0, 0); ring.angle = 0; ring.opacity = 255; ring.scale = 0.2;
        const rg = ring.getComponent(cc.Graphics);
        rg.clear();
        rg.lineWidth = 6;
        rg.strokeColor = cc.color(255, 140, 40, 255);
        rg.circle(0, 0, radius);
        rg.stroke();
        cc.tween(ring)
            .to(0.35, { scale: 2.0, opacity: 0 }, { easing: "quadOut" })
            .start();

        // 3) 飛濺碎屑
        for (let i = 0; i < DEBRIS_COUNT; i++) {
            const d = refs.debris[i];
            d.stopAllActions();
            d.setPosition(0, 0); d.angle = 0; d.opacity = 255; d.scale = 1;
            const dg = d.getComponent(cc.Graphics);
            dg.clear();
            const r = 3 + Math.random() * 3;
            dg.fillColor = cc.color(255, 180, 80, 255);
            dg.circle(0, 0, r);
            dg.fill();

            const ang = (Math.PI * 2 * i) / DEBRIS_COUNT + (Math.random() - 0.5) * 0.5;
            const dist = radius * (1.6 + Math.random() * 1.6);
            cc.tween(d)
                .to(0.3 + Math.random() * 0.2, { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, opacity: 0 }, { easing: "quadOut" })
                .start();
        }

        // 收尾：收回池子重用（取代 destroy）
        cc.tween(root)
            .delay(0.7)
            .call(() => { if (root.isValid) p.put(root); })
            .start();
    }
}
