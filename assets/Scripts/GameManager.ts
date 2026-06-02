export interface GridPart {
    partName: string;
    gridX: number;
    gridY: number;
}

export default class GameManager {
    public static isPaused: boolean = false;
    public static gold: number = 200;
    public static bgmVolume: number = parseFloat(cc.sys.localStorage.getItem("bgm_vol") || "0.2");
    public static sfxVolume: number = parseFloat(cc.sys.localStorage.getItem("sfx_vol") || "0.5");
    public static playerWins: number = 0;
    public static botWins: number = 0;

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
            //{ gridX: 0, gridY: 1, partName: "Body1" },
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

    public static resetAllData() {
        this.gold = 200;
        this.playerWins = 0;
        this.botWins = 0;
        this.playerCarGrid = [];
        console.log("Game Data Reset");
    }
}
