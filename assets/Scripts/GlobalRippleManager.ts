// battle/GlobalRippleManager.ts
const { ccclass, property } = cc._decorator;

@ccclass
export default class GlobalRippleManager extends cc.Component {

    onLoad() {
        // 將此節點設為常駐節點
        cc.game.addPersistRootNode(this.node);

        // === 修正：EVENT_AFTER_SCENE_LAUNCH 直接掛在 cc.Director 底下 ===
        cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, this.onSceneLaunch, this);
        
        this.bindCanvasListener();
    }

    onDestroy() {
        // === 修正：同步修改移除監聽的地方 ===
        cc.director.off(cc.Director.EVENT_AFTER_SCENE_LAUNCH, this.onSceneLaunch, this);
    }

    private onSceneLaunch() {
        // 每次換新場景，就去重新抓取新場景的 Canvas 並綁定滑鼠
        this.bindCanvasListener();
    }

    private bindCanvasListener() {
        const canvas = cc.find("Canvas");
        if (!canvas) return;

        // 先 off 再 on，徹底防止重複綁定監聽
        canvas.off(cc.Node.EventType.MOUSE_DOWN, this.onGlobalMouseDown, this, true);
        canvas.on(cc.Node.EventType.MOUSE_DOWN, this.onGlobalMouseDown, this, true);
    }

    private onGlobalMouseDown(e: cc.Event.EventMouse) {
        // 只認下游標左鍵
        if (e.getButton() !== cc.Event.EventMouse.BUTTON_LEFT) return;

        const canvas = cc.find("Canvas");
        if (!canvas) return;

        // 取得點擊的世界座標
        const worldPos = e.getLocation();
        
        // 觸發生成水波
        this.spawnClickRipple(canvas, worldPos);
    }

    private spawnClickRipple(canvas: cc.Node, worldPos: cc.Vec2) {
        // 1. 建立特效節點
        const rippleNode = new cc.Node("GlobalClickRipple");
        rippleNode.parent = canvas;
        rippleNode.zIndex = 9999; // 給予極高的層級，確保蓋在 UI 按鈕和所有零件上方

        // 2. 轉換座標到當前場景的 Canvas 本地座標系
        const localPos = canvas.convertToNodeSpaceAR(worldPos);
        rippleNode.setPosition(localPos);

        // 3. 用 Graphics 向量繪製圓圈
        const g = rippleNode.addComponent(cc.Graphics);
        g.lineWidth = 2;
        g.strokeColor = cc.color(120, 200, 255, 200); // 科技感水藍色
        g.circle(0, 0, 10);
        g.stroke();

        // 4. 動態動畫：擴大並淡出
        rippleNode.scale = 0.2;
        rippleNode.opacity = 255;

        cc.tween(rippleNode)
            .to(0.35, 
                { scale: 2.2, opacity: 0 }, 
                { easing: 'quadOut' }
            )
            .call(() => {
                if (rippleNode.isValid) rippleNode.destroy();
            })
            .start();
    }
}