const {ccclass, property} = cc._decorator;
export interface PartConfig {
    slotName: string;
    partName: string;
}

@ccclass
export default class GameManager {
    public static gold: number = 1000; // 初始金幣數
    public static playerCarConfig = {
        bodyPrefabName: "",
        parts: [] as PartConfig[]
    };
}