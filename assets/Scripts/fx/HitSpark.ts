// fx/HitSpark.ts
// 純程式畫的撞擊火花（中心白閃 + 放射狀短線），比 Explosion 更短促銳利。
// 用於碰撞／受擊瞬間的「打擊感」點綴，不需要任何美術或粒子 prefab。
// 用法：HitSpark.spawn(parentNode, worldPos, strength)
//   parentNode：特效掛載的父節點（通常是零件所在的 root，零件被銷毀後特效仍在）
//   worldPos  ：撞擊的世界座標
//   strength  ：0~1 的強度（依傷害量換算），控制火花大小與數量
//
// 改為「物件池」：子樹（root + flash + 最多 MAX_SPARKS 條火花）只建一次，重用時就地重置。
// 火花數量會變（5~12），故建滿 MAX_SPARKS，依本次 count 用 active 開關顯示／隱藏。
// 子節點參考快取在 root 上的 __fx。

import NodePool from "../core/NodePool";

const MAX_SPARKS = 12;   // count = round(5 + s*7)，s∈[0,1] → 上限 12

interface SparkRefs {
    flash: cc.Node;
    sparks: cc.Node[];
}

let pool: NodePool | null = null;
function getPool(): NodePool {
    if (!pool) pool = new NodePool(buildHitSpark);
    return pool;
}

// 只建一次：root + flash + MAX_SPARKS 條火花線（含各自 Graphics）。
function buildHitSpark(): cc.Node {
    const root = new cc.Node("HitSpark");

    const flash = new cc.Node("flash");
    flash.parent = root;
    flash.addComponent(cc.Graphics);

    const sparks: cc.Node[] = [];
    for (let i = 0; i < MAX_SPARKS; i++) {
        const line = new cc.Node("spark");
        line.parent = root;
        line.addComponent(cc.Graphics);
        sparks.push(line);
    }

    (root as any).__fx = { flash, sparks } as SparkRefs;
    return root;
}

export default class HitSpark {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, strength: number = 0.5) {
        if (!parent || !parent.isValid) return;

        const s = Math.max(0, Math.min(1, strength));

        const p = getPool();
        const root = p.get();
        const refs = (root as any).__fx as SparkRefs;

        root.active = true;
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 60;

        const baseR = 6 + s * 16;   // 中心閃光半徑

        // 1) 中心白閃
        const flash = refs.flash;
        flash.stopAllActions();
        flash.setPosition(0, 0); flash.angle = 0; flash.opacity = 255; flash.scale = 0.4;
        const fg = flash.getComponent(cc.Graphics);
        fg.clear();
        fg.fillColor = cc.color(255, 255, 230, 255);
        fg.circle(0, 0, baseR);
        fg.fill();
        cc.tween(flash)
            .to(0.05, { scale: 1.0 }, { easing: "quadOut" })
            .to(0.12, { scale: 1.4, opacity: 0 })
            .start();

        // 2) 放射狀短線（火花條）：本次用 count 條，其餘隱藏
        const count = Math.round(5 + s * 7);
        for (let i = 0; i < MAX_SPARKS; i++) {
            const line = refs.sparks[i];
            line.stopAllActions();
            if (i >= count) { line.active = false; continue; }
            line.active = true;

            const lg = line.getComponent(cc.Graphics);
            lg.clear();
            const len = (8 + s * 22) * (0.7 + Math.random() * 0.6);
            lg.lineWidth = 2 + s * 2;
            lg.strokeColor = cc.color(255, 220, 120, 255);
            lg.moveTo(0, 0);
            lg.lineTo(len, 0);
            lg.stroke();

            const ang = (360 / count) * i + (Math.random() - 0.5) * 25;
            line.setPosition(0, 0);
            line.opacity = 255;
            line.angle = ang;
            line.scaleX = 0.3;
            line.scaleY = 1;
            cc.tween(line)
                .to(0.12 + Math.random() * 0.08, { scaleX: 1.0, opacity: 0 }, { easing: "quadOut" })
                .start();
        }

        // 收尾：收回池子重用（取代 destroy）
        cc.tween(root)
            .delay(0.3)
            .call(() => { if (root.isValid) p.put(root); })
            .start();
    }
}
