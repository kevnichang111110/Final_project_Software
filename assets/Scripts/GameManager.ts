// GameManager.ts
// 跨場景的全域狀態（靜態類別，非組件）。
// 本次新增：gameMode（vs Bot / 本機雙人）與 claimedTools（搶奪階段搶到的道具）。

export interface GridPart {
    partName: string;
    gridX: number;
    gridY: number;
}

export enum GameMode {
    VsBot = 0,          // 玩家 vs 電腦
    LocalTwoPlayer = 1, // 本機雙人
}

export default class GameManager {
    public static isPaused: boolean = false;
    public static gold: number = 200;
    public static bgmVolume: number = parseFloat(cc.sys.localStorage.getItem("bgm_vol") || "0.2");
    public static sfxVolume: number = parseFloat(cc.sys.localStorage.getItem("sfx_vol") || "0.5");
    public static playerWins: number = 0;
    public static botWins: number = 0;

    // 由 Menu 設定；預設 vs Bot，讓單人流程開箱即用
    public static gameMode: GameMode = GameMode.VsBot;

    // 搶奪階段搶到的道具（道具名稱需對應到 allPrefabs 裡的 prefab 名稱）
    // P1 = 你操作的玩家、P2 = 本機第二位玩家、BOT = 電腦
    public static claimedTools: { [side: string]: string[] } = { P1: [], P2: [], BOT: [] };

    public static playerCarGrid: GridPart[] = [];

    public static botConfigs = [
        [
            { gridX: 0, gridY: 1, partName: "Body1" },
            { gridX: 1, gridY: 1, partName: "Core" },
            { gridX: 2, gridY: 1, partName: "Body1" },
            { gridX: 0, gridY: 0, partName: "Wheel1" },
            { gridX: 2, gridY: 0, partName: "Wheel1" },
            { gridX: 3, gridY: 1, partName: "Weapon1" }
        ],

        [
            { gridX: 1, gridY: 1, partName: "Core" },
            { gridX: 2, gridY: 1, partName: "Body1" },
            { gridX: 3, gridY: 1, partName: "Body1" },
            { gridX: 0, gridY: 1, partName: "Wheel1" },
            { gridX: 3, gridY: 0, partName: "Wheel2" },
            { gridX: 4, gridY: 1, partName: "Weapon1" }
        ],
        [
            { gridX: 1, gridY: 1, partName: "Core" },
            { gridX: 2, gridY: 1, partName: "Body1" },
            { gridX: 3, gridY: 1, partName: "Body1" },
            { gridX: 0, gridY: 1, partName: "Wheel1" },
            { gridX: 3, gridY: 0, partName: "Wheel2" },
            { gridX: 3, gridY: 2, partName: "Wheel2" },
            { gridX: 4, gridY: 1, partName: "Gun1" }
        ]
    ];

    // 取走某一側搶到的道具（取出後清空，避免下回合重複發放）
    public static consumeClaimedTools(side: string): string[] {
        const list = this.claimedTools[side] ? this.claimedTools[side].slice() : [];
        this.claimedTools[side] = [];
        return list;
    }

    public static resetAllData() {
        this.gold = 200;
        this.playerWins = 0;
        this.botWins = 0;
        this.playerCarGrid = [];
        this.claimedTools = { P1: [], P2: [], BOT: [] };
        console.log("Game Data Reset");
    }
}
