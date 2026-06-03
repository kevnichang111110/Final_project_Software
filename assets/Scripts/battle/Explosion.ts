// battle/Explosion.ts
// 純程式畫的爆炸特效（閃光圈 + 外擴環 + 飛濺碎屑），不需要任何美術或粒子 prefab。
// 用法：Explosion.spawn(parentNode, worldPos, size)
//   parentNode：特效掛載的父節點（通常是零件原本的父層 root，零件被銷毀後特效仍在）
//   worldPos  ：爆炸的世界座標
//   size      ：大小（約等於零件尺寸）

export default class Explosion {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, size: number = 60) {
        if (!parent || !parent.isValid) return;

        const root = new cc.Node("Explosion");
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 50;

        const radius = Math.max(size, 30) * 0.5;

        // 1) 中心閃光
        const flash = new cc.Node("flash");
        flash.parent = root;
        const fg = flash.addComponent(cc.Graphics);
        fg.fillColor = cc.color(255, 235, 150, 255);
        fg.circle(0, 0, radius);
        fg.fill();
        flash.scale = 0.3;
        cc.tween(flash)
            .to(0.10, { scale: 1.1 }, { easing: "quadOut" })
            .to(0.18, { scale: 1.5, opacity: 0 })
            .start();

        // 2) 外擴環
        const ring = new cc.Node("ring");
        ring.parent = root;
        const rg = ring.addComponent(cc.Graphics);
        rg.lineWidth = 6;
        rg.strokeColor = cc.color(255, 140, 40, 255);
        rg.circle(0, 0, radius);
        rg.stroke();
        ring.scale = 0.2;
        cc.tween(ring)
            .to(0.35, { scale: 2.0, opacity: 0 }, { easing: "quadOut" })
            .start();

        // 3) 飛濺碎屑
        const count = 8;
        for (let i = 0; i < count; i++) {
            const d = new cc.Node("debris");
            d.parent = root;
            const dg = d.addComponent(cc.Graphics);
            const r = 3 + Math.random() * 3;
            dg.fillColor = cc.color(255, 180, 80, 255);
            dg.circle(0, 0, r);
            dg.fill();

            const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
            const dist = radius * (1.6 + Math.random() * 1.6);
            cc.tween(d)
                .to(0.3 + Math.random() * 0.2, { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, opacity: 0 }, { easing: "quadOut" })
                .start();
        }

        // 收尾銷毀
        cc.tween(root)
            .delay(0.7)
            .call(() => { if (root.isValid) root.destroy(); })
            .start();
    }
}