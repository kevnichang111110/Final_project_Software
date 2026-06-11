import OnlineRuntime, { OnlineGridPart } from "./OnlineRuntime";
import { GRID } from "../core/GameConstants";

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

        if (this.statusLabel) {
            this.statusLabel.string = OnlineRuntime.isOnline()
                ? "組裝完成後按 Ready，等雙方都 Ready 才開戰"
                : "目前不是線上模式";
        }
    }

    onDestroy() {
        cc.systemEvent.off("ONLINE_READY_STATUS", this.onReadyStatus, this);
        cc.systemEvent.off("ONLINE_READY_REJECTED", this.onReadyRejected, this);
        cc.systemEvent.off("ONLINE_OPPONENT_LEFT", this.onOpponentLeft, this);
    }

    public Ready() {
        if (!OnlineRuntime.room) {
            if (this.statusLabel) this.statusLabel.string = "尚未連到房間";
            return;
        }

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
        
        // 這裡只負責發送資料給伺服器
        cc.log("[Online] 發送準備狀態與 Grid 資料");
        OnlineRuntime.room.send("ready", { grid });

        if (this.statusLabel) this.statusLabel.string = "等待對手準備中...";
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
        this.statusLabel.string = `你：${meReady ? "Ready" : "組裝中"} / 對手：${otherReady ? "Ready" : "組裝中"}`;
    }

    private onReadyRejected(msg: any) {
        this.alreadyReady = false;
        if (this.readyButton) this.readyButton.interactable = true;
        if (this.statusLabel) this.statusLabel.string = msg && msg.reason ? String(msg.reason) : "Ready 被拒絕";
    }

    private onOpponentLeft() {
        if (this.statusLabel) this.statusLabel.string = "對手離線";
    }
}
