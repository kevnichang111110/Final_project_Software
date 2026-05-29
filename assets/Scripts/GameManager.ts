const {ccclass, property} = cc._decorator;

export interface PartConfig {
    slotName: string;
    partName: string;
}

@ccclass
export default class GameManager {
    public static gold: number = 1000; // 初始金幣數

    // --- 新增：勝場紀錄 ---
    public static playerWins: number = 0;
    public static botWins: number = 0;

    public static playerCarConfig = {
        bodyPrefabName: "",
        parts: [] as PartConfig[]
    };

    public static botConfigs = [
        {
            bodyPrefabName: "Body_bot1", 
            parts: [
                { slotName: "slot_wheel1", partName: "Wheel_bot1" },
                { slotName: "slot_wheel2", partName: "Wheel_bot1" },
                { slotName: "slot_weapon", partName: "Weapon_bot1" }
            ]
        }
    ];

    // --- 新增：重置遊戲的方法 (當有人拿到四勝回到主選單時呼叫) ---
    public static resetGame() {
        this.playerWins = 0;
        this.botWins = 0;
        this.gold = 1000;
        this.playerCarConfig = { bodyPrefabName: "", parts: [] };
    }
}