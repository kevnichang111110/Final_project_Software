import OnlineRuntime from "./OnlineRuntime";
import FirebaseService from "../net/FirebaseService";
const { ccclass, property } = cc._decorator;

// 【關鍵修正 1】：這行絕對不能少，它是告訴 TypeScript 不要去 import，而是去全域找 Colyseus 插件
declare const Colyseus: any;

@ccclass
export default class OnlineClient extends cc.Component {
    // @property({ tooltip: "本地測試用 http://127.0.0.1:2567" })
    // serverUrl: string = "http://127.0.0.1:2567";
    @property({ tooltip: "render網址" })
    serverUrl: string = "https://car-server-rle9.onrender.com";

    @property({ tooltip: "房間名稱" })
    roomName: string = "car_room";

    @property(cc.Label)
    statusLabel: cc.Label | null = null;

    //private static handlersInstalled: boolean = false;
    private isConnecting: boolean = false;

    public async connectAndJoin() {
        const myLocalName = await this.getMyDisplayName();
        if (this.statusLabel) this.statusLabel.string = "連線中...";
        if (this.isConnecting) {
            cc.warn("正在連線中，請勿重複點擊");
            return;
        }
        this.isConnecting = true;

        // 【關鍵修正 2】：確保使用正確的 endpoint 格式
        // 0.17 版建議連線初期使用 http，SDK 會自動升級成 ws
        //let endpoint = this.serverUrl.replace("ws://", "http://").replace("localhost", "127.0.0.1");
        const isLocal = false; // 要回本地測試就把這設為 true，要發布就設為 false
    
        const endpoint = isLocal 
            ? "http://127.0.0.1:2567" 
            : "https://car-server-rle9.onrender.com/";
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
            const room = await client.joinOrCreate(this.roomName, { 
                name: myLocalName 
            });

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

        room.onMessage("ready_status", (msg: any) => {
            cc.systemEvent.emit("ONLINE_READY_STATUS", msg);
        });

        // --- 【修正：補上這一段】 解決遊戲結束沒反應的問題 ---
        room.onMessage("round_result", (msg: any) => {
            cc.log(">>> [Step 3] 客戶端收到 round_result 廣播");
            if (msg.scores) {
                OnlineRuntime.p1Wins = msg.scores.P1;
                OnlineRuntime.p2Wins = msg.scores.P2;
            }
            
            // 發送事件給 OnlineBattleManager
            cc.systemEvent.emit("ONLINE_ROUND_RESULT", msg);
        });
        
        room.onMessage("joined", (msg: any) => {
            OnlineRuntime.mySeat = msg.seat === "P2" ? "P2" : "P1";
            OnlineRuntime.roomId = msg.roomId || room.roomId;
            OnlineRuntime.round = Number(msg.round || 1);
            if (msg.scores) OnlineRuntime.setScores(msg.scores);
            if (msg.name) {
                if (OnlineRuntime.mySeat === "P1") OnlineRuntime.p1Name = msg.name;
                else OnlineRuntime.p2Name = msg.name;
            }
            cc.log("[Online] 你被分配到:", OnlineRuntime.mySeat);
        });

        room.onMessage("matched", (msg: any) => {
            cc.log("[Online] 配對成功");
            if (msg.p1Name) OnlineRuntime.p1Name = msg.p1Name;
            if (msg.p2Name) OnlineRuntime.p2Name = msg.p2Name;
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

        // 轉發主機（P1）的世界狀態快照給純畫面端（P2）
        // 注意：伺服器端必須有對應的 onMessage("sync", ...) 把它廣播給對手，否則收不到
        room.onMessage("sync", (msg: any) => {
            cc.systemEvent.emit("ONLINE_SYNC_POS", msg);
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
        room.onMessage("startSuddenDeath", () => {
            cc.systemEvent.emit("ONLINE_START_SUDDEN_DEATH");
        });
        
    }
    private async getMyDisplayName(): Promise<string> {
        const user = FirebaseService.getUser();
        if (!user) {
            return cc.sys.localStorage.getItem("userName") || "Player";
        }

        try {
            const projectId = "ssdfinal-c6446";
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${user.uid}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                const name = data?.fields?.name?.stringValue;
                if (name && String(name).trim()) {
                    return String(name).trim();
                }
            }
        } catch (e) {
            cc.warn("[OnlineClient] 讀取玩家名字失敗，改用預設名稱");
        }

        return user.email ? user.email.split("@")[0] : "Player";
    }
}