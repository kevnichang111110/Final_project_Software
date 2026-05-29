
export interface PartConfig {
    slotName: string;
    partName: string;
}

export default class GameManager {
    public static gold: number = 1000;
    public static bgmVolume: number = 1.0;
    public static sfxVolume: number = 1.0;
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

    public static resetAllData() {
        this.gold = 1000;
        this.playerWins = 0;
        this.botWins = 0;
        this.playerCarConfig = {
            bodyPrefabName: "",
            parts: []
        };
        console.log("reset");
    }
}