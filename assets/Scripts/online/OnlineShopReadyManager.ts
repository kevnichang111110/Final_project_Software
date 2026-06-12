import OnlineRuntime, { OnlineGridPart } from "./OnlineRuntime";
import { GRID } from "../core/GameConstants";
import GameManager from "../GameManager";

const { ccclass, property } = cc._decorator;

@ccclass
export default class OnlineShopReadyManager extends cc.Component {
    @property(cc.Label)
    statusLabel: cc.Label | null = null;

    @property(cc.Button)
    readyButton: cc.Button | null = null;

    private alreadyReady: boolean = false;

    onLoad() {
        cc.systemEvent.on("ONLINE_READY_STATUS", this.onReadyStatus, this);
        cc.systemEvent.on("ONLINE_READY_REJECTED", this.onReadyRejected, this);
        cc.systemEvent.on("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
    }

    onDestroy() {
        cc.systemEvent.off("ONLINE_READY_STATUS", this.onReadyStatus, this);
        cc.systemEvent.off("ONLINE_READY_REJECTED", this.onReadyRejected, this);
        cc.systemEvent.off("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
    }

    public Ready() {
        cc.log("🚩 [StatusManager] 按下 Ready 按鈕");
        if (!OnlineRuntime.room) {
            if (this.statusLabel) this.statusLabel.string = "尚未連到房間";
            (this as any).statusLabel.node.active = true;
            return;
        }
        if (this.statusLabel) this.statusLabel.string = "等待對手準備中...";
        const grid = this.scanAssemblyGrid();
        if (grid.length === 0) {
            if (this.statusLabel) this.statusLabel.string = "組裝區沒有零件";
            return;
        }
        if (!grid.some(p => p.partName === "Core")) {
            if (this.statusLabel) this.statusLabel.string = "車子需要 Core 才能 Ready";
            return;
        }

        this.alreadyReady = true;
        if (this.readyButton) this.readyButton.interactable = false;

        if (this.statusLabel) {
            this.statusLabel.node.active = true; 
            this.statusLabel.string = "等待對手準備中...";
        }

        // 把目前組裝好的車子保存起來，回到商店時可以重建
        GameManager.playerCarGrid = grid.map(p => ({
            partName: p.partName,
            gridX: p.gridX,
            gridY: p.gridY
        }));

        cc.log("[Online] 已保存本地組裝 grid:", JSON.stringify(GameManager.playerCarGrid));

        // 再送給 server
        cc.log("[Online] 發送準備狀態與 Grid 資料");
        OnlineRuntime.room.send("ready", { grid });

        
    }

    private scanAssemblyGrid(): OnlineGridPart[] {
        const partLayer = cc.find("Canvas/Assemblyarea/PartLayer");
        if (!partLayer) {
            cc.error("找不到 Canvas/Assemblyarea/PartLayer");
            return [];
        }

        const result: OnlineGridPart[] = [];
        for (const p of partLayer.children) {
            const rawName = p.name.replace(/\([^)]*\)/g, "").trim();
            result.push({
                partName: rawName,
                gridX: Math.floor(p.x / GRID.CELL_SIZE),
                gridY: Math.floor(p.y / GRID.CELL_SIZE)
            });
        }
        cc.log("[OnlineShopReady] grid", JSON.stringify(result));
        return result;
    }

    private onReadyStatus(msg: any) {
        if (!this.statusLabel) return;
        const meReady = OnlineRuntime.mySeat === "P1" ? !!msg.p1Ready : !!msg.p2Ready;
        const otherReady = OnlineRuntime.mySeat === "P1" ? !!msg.p2Ready : !!msg.p1Ready;
        
        if (!meReady && !otherReady) {
                // 情況 A：雙方都還沒按 Ready
                this.statusLabel.string = "Build your own car!";
                this.statusLabel.node.color = cc.Color.WHITE;
            } 
            else if (meReady && !otherReady) {
                // 情況 B：我好了，對面還沒好
                this.statusLabel.string = "Waiting for your opponent...";
                this.statusLabel.node.color = cc.Color.YELLOW;
            } 
            else if (!meReady && otherReady) {
                // 情況 C：對面好了，在等我
                this.statusLabel.string = "Opponent is waiting for you...";
                this.statusLabel.node.color = cc.Color.CYAN; // 給個不同的顏色提醒玩家
            } 
            else if (meReady && otherReady) {
                // 情況 D：雙方都 Ready 了（準備跳轉場景前）
                this.statusLabel.string = "Both ready! Starting...";
                this.statusLabel.node.color = cc.Color.GREEN;
            }    }

    private onReadyRejected(msg: any) {
        this.alreadyReady = false;
        if (this.readyButton) this.readyButton.interactable = true;
        if (this.statusLabel) this.statusLabel.string = msg && msg.reason ? String(msg.reason) : "Ready 被拒絕";
    }

    private onOpponentLeft() {
        if (this.statusLabel) this.statusLabel.string = "對手離線";
    }
}
