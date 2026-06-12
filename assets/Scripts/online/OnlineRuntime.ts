export interface OnlineGridPart {
    partName: string;
    gridX: number;
    gridY: number;
}

export interface OnlineInputState {
    worldDir: number;       // -1 = world left, 0 = stop, 1 = world right
    attack: boolean;
    boost: boolean;
    mouseDown: boolean;
    mouseX: number;
    mouseY: number;
}

export type OnlineSeat = "P1" | "P2";

export default class OnlineRuntime {
    public static p1Name: string = "P1";
    public static p2Name: string = "P2";

    public static serverUrl: string = "ws://localhost:2567";
    public static room: any = null;
    public static roomId: string = "";
    public static mySeat: OnlineSeat = "P1";

    public static p1Grid: OnlineGridPart[] = [];
    public static p2Grid: OnlineGridPart[] = [];
    public static p1Wins: number = 0;
    public static p2Wins: number = 0;
    public static round: number = 1;
    public static seed: number = 0;

    // Phase 1：線上對戰改用統一的本地戰鬥場景 game.fire（同一個 BattleManager 依房間自動切 HOST/CLIENT）
    public static onlineGameSceneName: string = "game";
    public static shopSceneName: string = "onlineShop";
    public static menuSceneName: string = "Result";

    public static defaultInput(): OnlineInputState {
        return { worldDir: 0, attack: false, boost: false, mouseDown: false, mouseX: 0, mouseY: 0 };
    }

    public static isOnline(): boolean {
        return !!this.room;
    }

    public static isHost(): boolean {
        return this.mySeat === "P1";
    }

    public static setScores(scores: any) {
        if (!scores) return;
        this.p1Wins = Number(scores.P1 || 0);
        this.p2Wins = Number(scores.P2 || 0);
    }

    public static clearMatch() {
        this.room = null;
        this.roomId = "";
        this.mySeat = "P1";
        this.p1Grid = [];
        this.p2Grid = [];
        this.p1Wins = 0;
        this.p2Wins = 0;
        this.round = 1;
        this.seed = 0;
        this.p1Name = "P1";
        this.p2Name = "P2";
    }
}
