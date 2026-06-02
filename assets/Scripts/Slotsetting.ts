const {ccclass, property} = cc._decorator;

export enum PartType {
    Body=0,
    Weapon=1,
    Core = 4,
    Wheel=5
}

@ccclass
export default class PartSlot extends cc.Component {
    @property({ type: cc.Enum(PartType) }) 
    slotType = PartType.Wheel; 

    public isOccupied: boolean = false; 
}