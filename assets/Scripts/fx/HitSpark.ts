// fx/HitSpark.ts
// 純程式畫的撞擊火花（中心白閃 + 放射狀短線），比 Explosion 更短促銳利。
// 用於碰撞／受擊瞬間的「打擊感」點綴，不需要任何美術或粒子 prefab。
// 用法：HitSpark.spawn(parentNode, worldPos, strength)
//   parentNode：特效掛載的父節點（通常是零件所在的 root，零件被銷毀後特效仍在）
//   worldPos  ：撞擊的世界座標
//   strength  ：0~1 的強度（依傷害量換算），控制火花大小與數量

export default class HitSpark {
    static spawn(parent: cc.Node, worldPos: cc.Vec2, strength: number = 0.5) {
        if (!parent || !parent.isValid) return;

        const s = Math.max(0, Math.min(1, strength));

        const root = new cc.Node("HitSpark");
        root.parent = parent;
        root.setPosition(parent.convertToNodeSpaceAR(worldPos));
        root.zIndex = 60;

        const baseR = 6 + s * 16;   // 中心閃光半徑

        // 1) 中心白閃
        const flash = new cc.Node("flash");
        flash.parent = root;
        const fg = flash.addComponent(cc.Graphics);
        fg.fillColor = cc.color(255, 255, 230, 255);
        fg.circle(0, 0, baseR);
        fg.fill();
        flash.scale = 0.4;
        cc.tween(flash)
            .to(0.05, { scale: 1.0 }, { easing: "quadOut" })
            .to(0.12, { scale: 1.4, opacity: 0 })
            .start();

        // 2) 放射狀短線（火花條）
        const count = Math.round(5 + s * 7);
        for (let i = 0; i < count; i++) {
            const line = new cc.Node("spark");
            line.parent = root;
            const lg = line.addComponent(cc.Graphics);
            const len = (8 + s * 22) * (0.7 + Math.random() * 0.6);
            lg.lineWidth = 2 + s * 2;
            lg.strokeColor = cc.color(255, 220, 120, 255);
            lg.moveTo(0, 0);
            lg.lineTo(len, 0);
            lg.stroke();

            const ang = (360 / count) * i + (Math.random() - 0.5) * 25;
            line.angle = ang;
            line.scaleX = 0.3;
            cc.tween(line)
                .to(0.12 + Math.random() * 0.08, { scaleX: 1.0, opacity: 0 }, { easing: "quadOut" })
                .start();
        }

        // 收尾銷毀
        cc.tween(root)
            .delay(0.3)
            .call(() => { if (root.isValid) root.destroy(); })
            .start();
    }
}
