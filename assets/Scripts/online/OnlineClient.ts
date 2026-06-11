import OnlineRuntime from "./OnlineRuntime";

const { ccclass, property } = cc._decorator;

// 【關鍵修正 1】：這行絕對不能少，它是告訴 TypeScript 不要去 import，而是去全域找 Colyseus 插件
declare const Colyseus: any;

@ccclass
export default class OnlineClient extends cc.Component {
    @property({ tooltip: "本地測試用 http://127.0.0.1:2567" })
    serverUrl: string = "http://127.0.0.1:2567";

    @property({ tooltip: "房間名稱" })
    roomName: string = "car_room";

    @property(cc.Label)
    statusLabel: cc.Label | null = null;

    private static handlersInstalled: boolean = false;

    public async connectAndJoin() {
        if (this.statusLabel) this.statusLabel.string = "連線中...";

        // 【關鍵修正 2】：確保使用正確的 endpoint 格式
        // 0.17 版建議連線初期使用 http，SDK 會自動升級成 ws
        let endpoint = this.serverUrl.replace("ws://", "http://").replace("localhost", "127.0.0.1");

        cc.log("[OnlineClient] 準備連線至:", endpoint);

        if (typeof Colyseus === "undefined") {
            cc.error("❌ 找不到 Colyseus 插件！請確認 colyseus.js 已經勾選 Import As Plugin。");
            if (this.statusLabel) this.statusLabel.string = "插件載入失敗";
            return;
        }

        try {
            const client = new Colyseus.Client(endpoint);
            
            // 【關鍵修正 3】：連線請求
            // 由於你是 0.15 插件連 0.17 伺服器，如果沒改 colyseus.js 的代碼，這裡還是會報 Reading name。
            // 請確保你已經按照我上一封訊息改了 colyseus.js 裡的 consumeSeatReservation。
            const room = await client.joinOrCreate(this.roomName);

            OnlineRuntime.room = room;
            OnlineRuntime.roomId = room.roomId;
            
            // 安裝訊息監聽
            OnlineClient.installRoomHandlers(room);

            if (this.statusLabel) this.statusLabel.string = "連線成功！";
            cc.log("[OnlineClient] ✅ 連線成功！房號:", room.roomId);

        } catch (e: any) {
            cc.error("[OnlineClient] ❌ 連線失敗:", e);
            let errorMsg = e?.message || String(e);
            
            // 如果還是噴 Reading name，提示用戶檢查 colyseus.js
            if (errorMsg.includes("reading 'name'")) {
                errorMsg = "版本不相容 (請檢查 colyseus.js 修改)";
            }
            if (this.statusLabel) this.statusLabel.string = "失敗: " + errorMsg;
        }
    }

    public static installRoomHandlers(room: any) {
        // 每次連線都重新綁定監聽，確保舊的連線不會干擾
        // 如果你的遊戲會反覆進出房間，這裡建議把 handlersInstalled 邏輯拿掉
        if (!room) return;

        // 【關鍵】不要用 if (handlersInstalled) return，確保每個 room 都會綁定
        cc.log("[OnlineClient] 正在綁定訊息處理器...");
        room.onMessage("joined", (msg: any) => {
            OnlineRuntime.mySeat = msg.seat === "P2" ? "P2" : "P1";
            OnlineRuntime.roomId = msg.roomId || room.roomId;
            OnlineRuntime.round = Number(msg.round || 1);
            if (msg.scores) OnlineRuntime.setScores(msg.scores);
            cc.log("[Online] 你被分配到:", OnlineRuntime.mySeat);
        });

        room.onMessage("matched", (msg: any) => {
            cc.log("[Online] 配對成功，準備進入商店");
            if (msg.scores) OnlineRuntime.setScores(msg.scores);
            cc.director.loadScene(OnlineRuntime.shopSceneName);
        });

        room.onMessage("battle_start", (msg: any) => {
            cc.log("[Online] 戰鬥開始！");
            OnlineRuntime.p1Grid = msg.p1Grid || [];
            OnlineRuntime.p2Grid = msg.p2Grid || [];
            OnlineRuntime.seed = Number(msg.seed || 0);
            cc.director.loadScene(OnlineRuntime.onlineGameSceneName);
        });

        // 轉發遠端輸入到本地戰鬥管理器
        room.onMessage("input", (msg: any) => {
            cc.systemEvent.emit("ONLINE_REMOTE_INPUT", msg);
        });

        room.onMessage("opponent_left", () => {
            cc.systemEvent.emit("ONLINE_OPPONENT_LEFT");
        });

        room.onLeave((code: number) => {
            cc.warn("[Online] 離開房間，代碼:", code);
            OnlineRuntime.clearMatch();
        });

        room.onError((code: number, message: string) => {
            cc.error(`[Online] 房間錯誤 (${code}): ${message}`);
        });
        
    }
}