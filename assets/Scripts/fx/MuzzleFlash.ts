// fx/MuzzleFlash.ts
// 純程式畫的槍口火光（中心亮閃 + 數條前向火光），武器發射瞬間的點綴，不需任何美術或粒子 prefab。
// 用法：MuzzleFlash.spawn(parentNode, worldPos, dir)
//   parentNode：特效掛載的父節點（子彈容器 = BattleManager.node，武器被銷毀後特效仍在）
//   worldPos  ：槍口的世界座標（muzzleWorld）
//   dir       ：已正規化的發射方向；整個特效會旋轉對齊此方向
//
// 「物件池」：子樹（root + flash + MAX_STREAKS 條火光）只建一次，重用時就地重置。
// 子節點參考快取在 root 上的 __fx。

import NodePool from "../core/NodePool";
import { MUZZLEFX } from "../core/GameConstants";

const MAX_STREAKS = MUZZLEFX.MAX_STREAKS;

interface MuzzleRefs {
    flash: cc.Node;
    streaks: cc.Node[];
}

let pool: NodePool | null = null;
function getPool(): NodePool {
    if (!pool) pool = new NodePool(buildMuzzleFlash);
    return pool;
}

// 只建一次：root + flash + MAX_STREAKS 條火光線（含各自 Graphics）。
function buildMuzzleFlash(): cc.Node {
    const root = new cc.Node("MuzzleFlash");

    const flash = new cc.Node("flash");
    flash.parent = root;
    flash.addComponent(cc.Graphics);

    const streaks: cc.Node[] = [];
    for (let i = 0; i < MAX_STREAKS; i++) {
        const line = new cc.Node("streak");
        line.parent = root;
        line.addComponent(cc.Graphics);
        streaks.push(line);
    }

    (root as any).__fx = { flash, streaks } as MuzzleRefs;
    return root;
}

export default class MuzzleFlash {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, dir: cc.Vec2) {
        if (!parent || !parent.isValid) return;

        const p = getPool();
        const root = p.get();
        const refs = (root as any).__fx as MuzzleRefs;

        root.active = true;
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.angle = Math.atan2(dir.y, dir.x) * 180 / Math.PI;   // 整個特效沿發射方向（局部 +x）
        root.zIndex = 55;

        // 1) 中心亮閃
        const flash = refs.flash;
        flash.stopAllActions();
        flash.setPosition(0, 0); flash.angle = 0; flash.opacity = 255; flash.scale = 0.4;
        const fg = flash.getComponent(cc.Graphics);
        fg.clear();
        fg.fillColor = cc.color(255, 240, 180, 255);
        fg.circle(0, 0, 9);
        fg.fill();
        cc.tween(flash)
            .to(0.04, { scale: 1.1 }, { easing: "quadOut" })
            .to(0.10, { scale: 1.4, opacity: 0 })
            .start();

        // 2) 前向火光條（局部 +x，扇形展開）
        const half = (MAX_STREAKS - 1) / 2;
        for (let i = 0; i < MAX_STREAKS; i++) {
            const line = refs.streaks[i];
            line.stopAllActions();
            line.active = true;

            const lg = line.getComponent(cc.Graphics);
            lg.clear();
            const len = 12 + Math.random() * 10;
            lg.lineWidth = 3;
            lg.strokeColor = cc.color(255, 200, 90, 255);
            lg.moveTo(0, 0);
            lg.lineTo(len, 0);
            lg.stroke();

            line.setPosition(0, 0);
            line.opacity = 255;
            line.angle = (i - half) * MUZZLEFX.FAN_DEG + (Math.random() - 0.5) * 6;
            line.scaleX = 0.3;
            line.scaleY = 1;
            cc.tween(line)
                .to(0.10 + Math.random() * 0.05, { scaleX: 1.0, opacity: 0 }, { easing: "quadOut" })
                .start();
        }

        // 收尾：收回池子重用
        cc.tween(root)
            .delay(0.25)
            .call(() => { if (root.isValid) p.put(root); })
            .start();
    }
}
